import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

// Keep TLS certificate verification explicit and silence pg-connection-string's
// compatibility warning. These legacy modes currently map to verify-full, so
// normalize them now before pg v9 changes their semantics.
const connectionUrl = new URL(process.env.DATABASE_URL);
const sslMode = (connectionUrl.searchParams.get("sslmode") || "").toLowerCase();
if (process.env.DATABASE_SSL === "true" || ["prefer", "require", "verify-ca"].includes(sslMode)) {
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
