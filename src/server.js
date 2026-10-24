import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { pool } from "./db.js";
import { router } from "./routes.js";
import { storefrontRouter } from "./storefront.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
  throw new Error("Set JWT_SECRET to a random value of at least 32 bytes");
}

const app = express();
app.disable("x-powered-by");
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
  throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 10");
}
app.set("trust proxy", trustProxyHops);
app.use(helmet());
const allowedOrigins = (process.env.ADMIN_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "Idempotency-Key"]
}));
app.use(express.json({ limit: "100kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", service: "bf-shoes-api" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

app.use("/api/v1/auth/login", rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false }));
// Public storefront endpoints are deliberately separated from admin/integration routes.
app.use("/api/v1/store/orders", rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false }));
app.use("/api/v1/store", storefrontRouter);
app.use("/api/v1", router);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.resolve(__dirname, "../frontend"), { index: "index.html", maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  console.error("Request failed:", err.code || err.name || "Error");
  if (err.message === "Origin not allowed by CORS") return res.status(403).json({ error: "Origin not allowed" });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON request body" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
  if (err.code === "23503") return res.status(400).json({ error: "Referenced resource does not exist" });
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => console.log(`BF SHOES API listening on ${port}`));

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
