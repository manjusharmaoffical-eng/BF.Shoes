import bcrypt from "bcryptjs";
import { pool } from "./db.js";
import { hashSecret, safeEqual, verifyAccessToken } from "./security.js";
import { scopesForAdminRole } from "./policies.js";

export async function authenticate(req, res, next) {
  try {
    const auth = req.get("authorization") || "";
    if (auth.startsWith("Bearer ")) {
      const claims = verifyAccessToken(auth.slice(7));
      if (claims.typ !== "admin" || !claims.sub || !["admin", "manager", "staff"].includes(claims.role)) {
        return res.status(401).json({ error: "Invalid access token" });
      }
      const result = await pool.query(
        "SELECT id, email, role, active FROM admins WHERE id = $1",
        [claims.sub]
      );
      const admin = result.rows[0];
      if (!admin?.active) return res.status(401).json({ error: "Admin account inactive" });
      req.actor = { type: "admin", id: admin.id, role: admin.role, scopes: scopesForAdminRole(admin.role) };
      return next();
    }

    const raw = req.get("x-api-key");
    if (!raw || !raw.startsWith("bfsk_")) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const prefix = raw.slice(0, 13);
    const result = await pool.query(
      `SELECT id, key_hash, scopes, active, expires_at
       FROM api_keys WHERE key_prefix = $1`,
      [prefix]
    );
    const candidateHash = hashSecret(raw);
    const key = result.rows.find((row) => row.active && safeEqual(row.key_hash, candidateHash) &&
      (!row.expires_at || new Date(row.expires_at).getTime() > Date.now()));
    if (!key) return res.status(401).json({ error: "Invalid API key" });

    await pool.query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [key.id]);
    req.actor = { type: "api_key", id: key.id, role: "integration", scopes: key.scopes };
    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    next(err);
  }
}

export function requireScope(scope) {
  return (req, res, next) => {
    const scopes = req.actor?.scopes || [];
    if (!scopes.includes("*") && !scopes.includes(scope)) {
      return res.status(403).json({ error: "Insufficient scope", required: scope });
    }
    next();
  };
}

export async function checkPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
