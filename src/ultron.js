import express from "express";
import { pool } from "./db.js";
import { authenticate } from "./auth.js";

export const ultronRouter = express.Router();
ultronRouter.use(authenticate);

// Ultron is intentionally read-only: it reports business health but cannot alter
// stock, orders, finances, credentials, or user accounts.
function ownerOnly(req, res, next) {
  if (req.actor?.type !== "admin" || req.actor?.role !== "admin") {
    return res.status(403).json({ error: "Owner permission required" });
  }
  next();
}
ultronRouter.use(ownerOnly);

ultronRouter.get("/help", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    data: {
      name: "Ultron",
      mode: "read-only",
      commands: [
        { command: "GET /api/v1/ultron/status", description: "Business health, low-stock alerts, recent order counts, and finance data completeness." },
        { command: "GET /api/v1/ultron/help", description: "Show available safe monitoring endpoints." }
      ],
      safety: "Ultron does not execute financial transfers, edit products, change stock, or change order status."
    }
  });
});

ultronRouter.get("/status", async (_req, res, next) => {
  try {
    const [products, orders, costs] = await Promise.all([
      pool.query(`SELECT count(*)::int AS active_products,
        count(*) FILTER (WHERE v.low_stock)::int AS low_stock_variants
        FROM products p LEFT JOIN (
          SELECT product_id, bool_or(stock_qty <= 5) AS low_stock
          FROM variants WHERE active = true GROUP BY product_id
        ) v ON v.product_id = p.id WHERE p.active = true`),
      pool.query(`SELECT count(*) FILTER (WHERE status IN ('pending','processing'))::int AS open_orders,
        count(*) FILTER (WHERE status = 'delivered' AND updated_at >= now() - interval '30 days')::int AS delivered_last_30_days
        FROM orders`),
      pool.query(`SELECT count(*)::int AS delivered_units_missing_cost
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'delivered' AND oi.unit_cost_cents IS NULL`)
    ]);
    res.set("Cache-Control", "no-store");
    res.json({
      data: {
        service: "BF SHOES",
        assistant: "Ultron",
        mode: "read-only",
        checked_at: new Date().toISOString(),
        inventory: products.rows[0],
        orders: orders.rows[0],
        finance: {
          delivered_units_missing_cost: costs.rows[0].delivered_units_missing_cost,
          profit_report_complete: Number(costs.rows[0].delivered_units_missing_cost) === 0
        },
        alerts: [
          ...(Number(products.rows[0].low_stock_variants) > 0 ? ["Low-stock variants need review."] : []),
          ...(Number(costs.rows[0].delivered_units_missing_cost) > 0 ? ["Some delivered order items have no recorded unit cost; profit may be incomplete."] : [])
        ]
      }
    });
  } catch (err) { next(err); }
});
