import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : false,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on("error", (err) => {
  console.error("Unexpected idle database client error:", err.message);
});
