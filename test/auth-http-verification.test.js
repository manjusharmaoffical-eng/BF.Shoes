import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";

// These tests exercise the real Express authentication middleware with a
// deterministic in-memory database response; no live credentials or DB writes.
process.env.DATABASE_URL = "postgresql://bf_shoes_test:bf_shoes_test@127.0.0.1:5432/bf_shoes_test";
process.env.DATABASE_SSL = "false";
process.env.JWT_SECRET = "bf-shoes-auth-http-test-secret-32-bytes-minimum";

const { pool } = await import("../src/db.js");
const { authenticate, requireScope } = await import("../src/auth.js");
const { createAccessToken, newApiKey, hashSecret } = await import("../src/security.js");

after(async () => {
  await pool.end();
});

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    });
  }
}

test("read-only API key gets HTTP 200 for reads and HTTP 403 for product writes", async () => {
  const key = newApiKey();
  const originalQuery = pool.query;
  pool.query = async sql => {
    if (sql.includes("FROM api_keys")) {
      return { rows: [{
        id: "api-key-http-test",
        key_hash: hashSecret(key.raw),
        scopes: ["products:read", "inventory:read", "orders:read"],
        active: true,
        expires_at: null
      }] };
    }
    if (sql.startsWith("UPDATE api_keys SET last_used_at")) return { rows: [], rowCount: 1 };
    throw new Error("Unexpected database query in API-key HTTP test");
  };

  try {
    const app = express();
    app.get("/products", authenticate, requireScope("products:read"), (_req, res) => res.json({ ok: true }));
    app.post("/products", authenticate, requireScope("products:write"), (_req, res) => res.status(201).json({ ok: true }));

    await withServer(app, async base => {
      const read = await fetch(`${base}/products`, { headers: { "x-api-key": key.raw } });
      assert.equal(read.status, 200);
      assert.deepEqual(await read.json(), { ok: true });

      const write = await fetch(`${base}/products`, { method: "POST", headers: { "x-api-key": key.raw } });
      assert.equal(write.status, 403);
      const body = await write.json();
      assert.equal(body.error, "Insufficient scope");
      assert.equal(body.required, "products:write");
    });
  } finally {
    pool.query = originalQuery;
  }
});

test("an admin token issued before a password change gets HTTP 401 after session_version increments", async () => {
  const originalQuery = pool.query;
  pool.query = async sql => {
    assert.match(sql, /FROM admins WHERE id = \$1/);
    // The token below was issued at session_version 7; password change moved it to 8.
    return { rows: [{ id: "admin-http-test", email: "admin@example.test", role: "admin", active: true, session_version: 8 }] };
  };

  try {
    const oldToken = createAccessToken({ id: "admin-http-test", role: "admin", session_version: 7 });
    const currentToken = createAccessToken({ id: "admin-http-test", role: "admin", session_version: 8 });
    const app = express();
    app.get("/admin/me", authenticate, (_req, res) => res.json({ ok: true }));

    await withServer(app, async base => {
      const revoked = await fetch(`${base}/admin/me`, { headers: { authorization: `Bearer ${oldToken}` } });
      assert.equal(revoked.status, 401);
      assert.equal((await revoked.json()).error, "Admin session revoked");

      const current = await fetch(`${base}/admin/me`, { headers: { authorization: `Bearer ${currentToken}` } });
      assert.equal(current.status, 200);
      assert.deepEqual(await current.json(), { ok: true });
    });
  } finally {
    pool.query = originalQuery;
  }
});
