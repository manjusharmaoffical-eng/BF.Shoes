import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ALL_SCOPES, createAccessToken, verifyAccessToken, sessionVersionMatches,
  newApiKey, hashSecret
} from "../src/security.js";

process.env.JWT_SECRET = "bf-shoes-auth-contract-test-secret-32-bytes-minimum";

test("admin access tokens carry a session version and reject stale sessions", () => {
  const admin = { id: "admin-test-id", role: "admin", session_version: 7 };
  const token = createAccessToken(admin);
  const claims = verifyAccessToken(token);
  assert.equal(claims.sv, 7);
  assert.equal(sessionVersionMatches({ session_version: 7 }, claims), true);
  assert.equal(sessionVersionMatches({ session_version: 8 }, claims), false);
  assert.equal(sessionVersionMatches({ session_version: 0 }, { role: "admin" }), false);
});

test("API key generation creates a one-time bfsk secret with a matching lookup prefix", () => {
  const key = newApiKey();
  assert.match(key.raw, /^bfsk_[A-Za-z0-9_-]{43}$/);
  assert.equal(key.prefix, key.raw.slice(0, 13));
  assert.equal(hashSecret(key.raw).length, 64);
  assert.notEqual(key.raw, key.prefix);
});

test("integration read-only scope set covers all three APIs but grants no write scopes", async () => {
  const routes = await readFile(new URL("../src/routes.js", import.meta.url), "utf8");
  const auth = await readFile(new URL("../src/auth.js", import.meta.url), "utf8");
  for (const scope of ["products:read", "inventory:read", "orders:read"]) {
    assert.ok(ALL_SCOPES.includes(scope), scope);
    assert.match(routes, new RegExp('requireScope\\("' + scope.replace(":", "\\:") + '"\\)'));
  }
  for (const scope of ["products:write", "inventory:write", "orders:write"]) {
    assert.ok(ALL_SCOPES.includes(scope), scope);
  }
  assert.match(auth, /Insufficient scope/);
  assert.match(auth, /!scopes\.includes\("\*"\) && !scopes\.includes\(scope\)/);
  assert.match(routes, /const INTEGRATION_SCOPES = ALL_SCOPES\.filter\(scope => scope !== "keys:write"\)/);
  assert.match(routes, /session_version=session_version\+1/);
  assert.match(routes, /All existing admin sessions have been revoked/);
});

test("password changes increment the session version and authentication rejects mismatches", async () => {
  const auth = await readFile(new URL("../src/auth.js", import.meta.url), "utf8");
  const routes = await readFile(new URL("../src/routes.js", import.meta.url), "utf8");
  assert.match(auth, /sessionVersionMatches\(admin, claims\)/);
  assert.match(auth, /Admin session revoked/);
  assert.match(routes, /session_version=session_version\+1/);
});
