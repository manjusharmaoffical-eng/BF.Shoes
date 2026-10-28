import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

// Keep TLS certificate verification explicit. node-postgres warns about sslmode=require
// on newer versions; normalize it to verify-full when DATABASE_SSL=true.
const connectionUrl = new URL(process.env.DATABASE_URL);
if (process.env.DATABASE_SSL === "true") {
  connectionUrl.searchParams.set("sslmode", "verify-full");
}

export const pool = new Pool({
  connectionString: connectionUrl.toString(),
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on("error", (err) => {
  console.error("Unexpected idle database client error:", err.message);
});
