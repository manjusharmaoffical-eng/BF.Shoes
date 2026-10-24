import "dotenv/config";
import fs from "node:fs/promises";
import { pool } from "./db.js";

try {
  const sql = await fs.readFile(new URL("../schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
  console.log("BF SHOES database schema applied.");
} finally {
  await pool.end();
}
