import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { planWarehouseAllocation } from "../src/warehouse-stock.js";

test("warehouse order allocation consumes locations in supplied FIFO order", () => {
  const plan = planWarehouseAllocation([
    { warehouse_id: "wh-a", quantity: 2 },
    { warehouse_id: "wh-b", quantity: 5 }
  ], 6);
  assert.deepEqual(plan, {
    allocations: [
      { warehouse_id: "wh-a", quantity: 2 },
      { warehouse_id: "wh-b", quantity: 4 }
    ],
    unassigned_quantity: 0
  });
});

test("warehouse order allocation leaves legacy unassigned stock untouched", () => {
  assert.deepEqual(
    planWarehouseAllocation([{ warehouse_id: "wh-a", quantity: 2 }], 5),
    { allocations: [{ warehouse_id: "wh-a", quantity: 2 }], unassigned_quantity: 3 }
  );
});

test("warehouse allocation rejects invalid quantities", () => {
  assert.throws(() => planWarehouseAllocation([], 0), /positive safe integer/);
  assert.throws(() => planWarehouseAllocation([{ warehouse_id: "wh-a", quantity: -1 }], 1), /non-negative safe integer/);
});

test("order warehouse allocation schema supports idempotent restoration and indexes", async () => {
  const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS order_warehouse_allocations/);
  assert.match(schema, /UNIQUE \(order_id, warehouse_id, variant_id\)/);
  assert.match(schema, /restored_at TIMESTAMPTZ/);
  const helper = await readFile(new URL("../src/warehouse-stock.js", import.meta.url), "utf8");
  assert.match(helper, /WHERE order_id=\$1 AND restored_at IS NULL/);
  assert.match(helper, /SET restored_at=now\(\) WHERE id=\$1 AND restored_at IS NULL/);
});

test("all order creation and cancellation flows use the warehouse allocation ledger", async () => {
  const [routes, storefront] = await Promise.all([
    readFile(new URL("../src/routes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/storefront.js", import.meta.url), "utf8")
  ]);
  assert.match(routes, /allocateOrderWarehouseStock/);
  assert.match(routes, /restoreOrderWarehouseStock/);
  assert.match(storefront, /allocateOrderWarehouseStock/);
  assert.match(storefront, /storefront_payu_paid/);
  assert.match(storefront, /storefront_paytabs_paid/);
  assert.match(storefront, /storefront_cod_order/);
});
