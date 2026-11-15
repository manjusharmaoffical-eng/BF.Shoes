import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

test("root and versioned health endpoints share the same database health check", () => {
  assert.match(server, /async function healthCheck\(_req, res\)/);
  assert.match(server, /app\.get\("\/health", healthCheck\)/);
  assert.match(server, /app\.get\("\/api\/v1\/health", healthCheck\)/);
  assert.match(server, /await pool\.query\("SELECT 1"\)/);
  assert.match(server, /res\.status\(503\)\.json\(\{ status: "unavailable" \}\)/);
});
