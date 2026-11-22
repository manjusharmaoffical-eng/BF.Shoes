import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import bcrypt from "bcryptjs";

// These tests use an in-memory pool stub. They never connect to or mutate a real DB.
process.env.DATABASE_URL ||= "postgresql://bf_shoes_test:bf_shoes_test@127.0.0.1:5432/bf_shoes_test";
process.env.DATABASE_SSL = "false";
process.env.JWT_SECRET = "bf-shoes-auth-http-test-secret-32-bytes-minimum";

const [{ router }, { pool }, { newApiKey, hashSecret, createAccessToken }] = await Promise.all([
  import("../src/routes.js"),
  import("../src/db.js"),
  import("../src/security.js")
]);

function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", router);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: "Unexpected test server error", detail: err.message });
  });
  const server = createServer(app);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise(done => {
          server.close(done);
          server.closeAllConnections?.();
        })
      });
    });
  });
}

test("read-only API key gets HTTP 200 for reads and HTTP 403 for every product, inventory and order write", async () => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const apiKey = newApiKey();
  const readOnlyScopes = ["products:read", "inventory:read", "orders:read"];
  const keyRecord = {
    id: "00000000-0000-4000-8000-000000000001",
    key_hash: hashSecret(apiKey.raw),
    scopes: readOnlyScopes,
    active: true,
    expires_at: null
  };

  pool.query = async sql => {
    const statement = String(sql).replace(/\s+/g, " ").trim();
    if (statement.startsWith("SELECT id, key_hash, scopes, active, expires_at FROM api_keys WHERE key_prefix = $1")) {
      return { rows: [keyRecord], rowCount: 1 };
    }
    if (statement.startsWith("UPDATE api_keys SET last_used_at = now() WHERE id = $1")) {
      return { rows: [], rowCount: 1 };
    }
    if (statement.startsWith("SELECT p.*, COALESCE(json_agg")) return { rows: [], rowCount: 0 };
    if (statement.startsWith("SELECT v.id, v.sku, v.size_label")) return { rows: [], rowCount: 0 };
    if (statement === "SELECT * FROM orders ORDER BY created_at DESC LIMIT 200") return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected SQL in read-only API-key test: ${statement}`);
  };
  pool.connect = async () => {
    throw new Error("A read-only API key reached a database write handler");
  };

  const server = await startTestServer();
  try {
    for (const path of ["/api/v1/products", "/api/v1/inventory", "/api/v1/orders"]) {
      const response = await fetch(server.baseUrl + path, { headers: { "x-api-key": apiKey.raw } });
      const body = await response.json();
      assert.equal(response.status, 200, `GET ${path}: ${JSON.stringify(body)}`);
      assert.ok(Array.isArray(body.data), `GET ${path} returns a data array`);
    }

    const writes = [
      ["POST", "/api/v1/products", { name: "Read-only probe", slug: "read-only-probe", price_cents: 100 }],
      ["PUT", "/api/v1/inventory/READONLY-PROBE/count", { stock_qty: 1, reason: "test count" }],
      ["POST", "/api/v1/orders", { customer_name: "Test Buyer", customer_email: "test@example.com", items: [{ sku: "READONLY-PROBE", quantity: 1 }] }]
    ];
    for (const [method, path, body] of writes) {
      const response = await fetch(server.baseUrl + path, {
        method,
        headers: { "content-type": "application/json", "x-api-key": apiKey.raw },
        body: JSON.stringify(body)
      });
      assert.equal(response.status, 403, `${method} ${path} must be denied`);
      assert.equal((await response.json()).error, "Insufficient scope");
    }
  } finally {
    await server.close();
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
});

test("password change increments session version and the old admin JWT receives HTTP 401", async () => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const admin = {
    id: "00000000-0000-4000-8000-000000000002",
    email: "auth-http-test@example.com",
    role: "admin",
    active: true,
    session_version: 7,
    password_hash: await bcrypt.hash("CurrentPassword!2026", 4)
  };
  const oldToken = createAccessToken(admin);

  pool.query = async sql => {
    const statement = String(sql).replace(/\s+/g, " ").trim();
    if (statement.startsWith("SELECT id, email, role, active, session_version FROM admins WHERE id = $1")) {
      return {
        rows: [{
          id: admin.id,
          email: admin.email,
          role: admin.role,
          active: admin.active,
          session_version: admin.session_version
        }],
        rowCount: 1
      };
    }
    throw new Error(`Unexpected SQL in session-revocation test: ${statement}`);
  };

  const client = {
    async query(sql, params = []) {
      const statement = String(sql).replace(/\s+/g, " ").trim();
      if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (statement.startsWith("SELECT id, password_hash, active FROM admins WHERE id=$1 FOR UPDATE")) {
        return {
          rows: [{ id: admin.id, password_hash: admin.password_hash, active: admin.active }],
          rowCount: 1
        };
      }
      if (statement.startsWith("UPDATE admins SET password_hash=$1, session_version=session_version+1 WHERE id=$2")) {
        admin.password_hash = params[0];
        admin.session_version += 1;
        return { rows: [], rowCount: 1 };
      }
      if (statement.startsWith("INSERT INTO audit_events(actor_type, actor_id, action, resource_type, resource_id)")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected transaction SQL in session-revocation test: ${statement}`);
    },
    release() {}
  };
  pool.connect = async () => client;

  const server = await startTestServer();
  try {
    const changed = await fetch(server.baseUrl + "/api/v1/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${oldToken}` },
      body: JSON.stringify({
        current_password: "CurrentPassword!2026",
        new_password: "NewStrongPassword!2026"
      })
    });
    assert.equal(changed.status, 200);
    assert.match((await changed.json()).message, /All existing admin sessions have been revoked/);
    assert.equal(admin.session_version, 8);

    const stale = await fetch(server.baseUrl + "/api/v1/auth/me", {
      headers: { authorization: `Bearer ${oldToken}` }
    });
    assert.equal(stale.status, 401);
    assert.equal((await stale.json()).error, "Admin session revoked");

    const freshToken = createAccessToken(admin);
    const fresh = await fetch(server.baseUrl + "/api/v1/auth/me", {
      headers: { authorization: `Bearer ${freshToken}` }
    });
    assert.equal(fresh.status, 200);
    assert.equal((await fresh.json()).actor.role, "admin");
  } finally {
    await server.close();
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
});
