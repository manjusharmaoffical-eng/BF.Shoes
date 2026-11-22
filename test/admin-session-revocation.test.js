import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [schema, security, auth, routes] = await Promise.all([
  readFile(new URL("../schema.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/security.js", import.meta.url), "utf8"),
  readFile(new URL("../src/auth.js", import.meta.url), "utf8"),
  readFile(new URL("../src/routes.js", import.meta.url), "utf8")
]);

test("admin session revocation uses an additive persistent session version", () => {
  assert.match(schema, /session_version INTEGER NOT NULL DEFAULT 0/);
  assert.match(schema, /ALTER TABLE admins ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0/);
  assert.match(security, /sv: Number\(admin\.session_version \?\? 0\)/);
  assert.match(auth, /sessionVersionMatches\(admin, claims\)/);
});

test("password changes increment session version and revoke every prior admin token", () => {
  assert.match(routes, /UPDATE admins SET password_hash=\$1, session_version=session_version\+1 WHERE id=\$2/);
  assert.match(routes, /All existing admin sessions have been revoked/);
});

test("admin JWT verification is pinned to HS256", () => {
  assert.match(security, /algorithm: "HS256"/);
  assert.match(security, /algorithms: \["HS256"\]/);
});
