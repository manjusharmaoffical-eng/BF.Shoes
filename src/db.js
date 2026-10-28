import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

// pg connection-string SSL options can override the explicit ssl object.
// Strip SSL-related URL parameters so certificate validation is controlled
// by DATABASE_SSL_MODE below rather than an ambiguous URL setting.
function databaseConnectionString(value) {
  const url = new URL(value);
  for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert"]) {
    url.searchParams.delete(key);
  }
  return url.toString();
}

const sslMode = (process.env.DATABASE_SSL_MODE || "verify-full").toLowerCase();
if (!["verify-full", "require", "disable"].includes(sslMode)) {
  throw new Error("DATABASE_SSL_MODE must be verify-full, require, or disable");
}
if (process.env.NODE_ENV === "production" && sslMode === "disable") {
  throw new Error("DATABASE_SSL_MODE=disable is not allowed in production");
}

const ssl = sslMode === "disable"
  ? false
  : { rejectUnauthorized: sslMode === "verify-full" };

export const pool = new Pool({
  connectionString: databaseConnectionString(process.env.DATABASE_URL),
  ssl,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on("error", (err) => {
  // Never log connection strings or credentials.
  console.error("Unexpected idle database client error:", err.code || err.name || "DatabaseError");
});
