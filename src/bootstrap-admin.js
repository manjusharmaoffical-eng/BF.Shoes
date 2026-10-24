import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 14) {
  throw new Error("Set a valid BOOTSTRAP_ADMIN_EMAIL and a unique BOOTSTRAP_ADMIN_PASSWORD of at least 14 characters");
}

const client = await pool.connect();
try {
  const hash = await bcrypt.hash(password, 12);
  await client.query("BEGIN");
  // Serializes concurrent bootstrap attempts across processes using the same database.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('bf-shoes-api-bootstrap-admin'))");
  const count = await client.query("SELECT count(*)::int AS n FROM admins");
  if (count.rows[0].n > 0) throw new Error("Admin already exists; bootstrap is disabled");
  await client.query("INSERT INTO admins(email, password_hash, role) VALUES($1,$2,'admin')", [email, hash]);
  await client.query("COMMIT");
  console.log("Initial BF SHOES admin created. Remove bootstrap credentials from the environment now.");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  throw err;
} finally {
  client.release();
  await pool.end();
}
