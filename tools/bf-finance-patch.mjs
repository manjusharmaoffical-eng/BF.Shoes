import fs from "node:fs";

function replaceOnce(file, before, after, label) {
  const original = fs.readFileSync(file, "utf8");
  const count = original.split(before).length - 1;

  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 match; found ${count}. No change made to this file.`);
  }

  fs.writeFileSync(file, original.replace(before, after));
  console.log("OK:", label);
}

try {
  replaceOnce(
    "schema.sql",
    ");\nALTER TABLE orders ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;",
    ");\nALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;\nALTER TABLE orders ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;",
    "Add delivered_at schema column"
  );

  replaceOnce(
    "src/routes.js",
    '"UPDATE orders SET status=$1, updated_at=now() WHERE id=$2 RETURNING *",\n      [nextStatus, old.id]',
    '"UPDATE orders SET status=$1, updated_at=now(), delivered_at=CASE WHEN $1=\'delivered\' THEN COALESCE(delivered_at, now()) ELSE delivered_at END WHERE id=$2 RETURNING *",\n      [nextStatus, old.id]',
    "Save delivery timestamp"
  );

  replaceOnce(
    "src/finance.js",
    "COALESCE(sum(o.subtotal_cents),0)::bigint AS revenue_cents,",
    "COALESCE(sum(o.subtotal_cents::bigint),0)::bigint AS product_revenue_cents,\n   COALESCE(sum(o.delivery_fee_cents::bigint),0)::bigint AS delivery_fee_revenue_cents,\n   COALESCE(sum(o.subtotal_cents::bigint + o.delivery_fee_cents::bigint),0)::bigint AS revenue_cents,",
    "Split product and delivery revenue"
  );

  replaceOnce(
    "src/finance.js",
    "o.updated_at::date >= $1",
    "COALESCE(o.delivered_at,o.updated_at)::date >= $1",
    "Use delivery date for range start"
  );

  replaceOnce(
    "src/finance.js",
    "o.updated_at::date <= $2",
    "COALESCE(o.delivered_at,o.updated_at)::date <= $2",
    "Use delivery date for range end"
  );

  replaceOnce(
    "src/finance.js",
    "Profit estimate uses delivered order value less recorded cost of goods, recorded operating expenses and interest actually paid in the selected period.",
    "Profit estimate uses product sales plus delivery fees, less recorded cost of goods, recorded operating expenses and interest actually paid in the selected period.",
    "Update profit explanation"
  );

  console.log("Patch completed. Database migration has NOT been run.");
} catch (error) {
  console.error("PATCH STOPPED:", error.message);
  process.exitCode = 1;
}
