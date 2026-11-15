export function planWarehouseAllocation(locations, requestedQuantity) {
  if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1) {
    throw new TypeError("Requested warehouse quantity must be a positive safe integer");
  }
  let remaining = requestedQuantity;
  const allocations = [];
  for (const location of locations) {
    if (remaining <= 0) break;
    const available = Number(location.quantity);
    if (!Number.isSafeInteger(available) || available < 0) {
      throw new TypeError("Warehouse quantity must be a non-negative safe integer");
    }
    const quantity = Math.min(remaining, available);
    if (quantity > 0) {
      allocations.push({ warehouse_id: location.warehouse_id, quantity });
      remaining -= quantity;
    }
  }
  return { allocations, unassigned_quantity: remaining };
}

export async function allocateOrderWarehouseStock(client, {
  orderId, variantId, quantity, reason, actorAdminId = null
}) {
  const locations = await client.query(
    `SELECT warehouse_id, quantity FROM warehouse_inventory
     WHERE variant_id=$1 AND quantity>0
     ORDER BY updated_at, warehouse_id FOR UPDATE`,
    [variantId]
  );
  const plan = planWarehouseAllocation(locations.rows, quantity);
  for (const allocation of plan.allocations) {
    const updated = await client.query(
      `UPDATE warehouse_inventory SET quantity=quantity-$1, updated_at=now()
       WHERE warehouse_id=$2 AND variant_id=$3 AND quantity >= $1 RETURNING quantity`,
      [allocation.quantity, allocation.warehouse_id, variantId]
    );
    if (!updated.rowCount) throw new Error("Warehouse stock changed while allocating an order");
    await client.query(
      `INSERT INTO order_warehouse_allocations(order_id,warehouse_id,variant_id,quantity)
       VALUES($1,$2,$3,$4)`,
      [orderId, allocation.warehouse_id, variantId, allocation.quantity]
    );
    await client.query(
      `INSERT INTO warehouse_stock_movements
       (warehouse_id,variant_id,delta,reason,reference_type,reference_id,actor_admin_id)
       VALUES($1,$2,$3,$4,'order',$5,$6)`,
      [allocation.warehouse_id, variantId, -allocation.quantity, reason, orderId, actorAdminId]
    );
  }
  return plan;
}

export async function restoreOrderWarehouseStock(client, orderId, actorAdminId = null) {
  const allocations = await client.query(
    `SELECT id, warehouse_id, variant_id, quantity
     FROM order_warehouse_allocations
     WHERE order_id=$1 AND restored_at IS NULL
     ORDER BY variant_id, warehouse_id FOR UPDATE`,
    [orderId]
  );
  for (const allocation of allocations.rows) {
    await client.query(
      `INSERT INTO warehouse_inventory(warehouse_id,variant_id,quantity,updated_at)
       VALUES($1,$2,$3,now())
       ON CONFLICT(warehouse_id,variant_id)
       DO UPDATE SET quantity=warehouse_inventory.quantity+EXCLUDED.quantity,updated_at=now()`,
      [allocation.warehouse_id, allocation.variant_id, allocation.quantity]
    );
    await client.query(
      `INSERT INTO warehouse_stock_movements
       (warehouse_id,variant_id,delta,reason,reference_type,reference_id,actor_admin_id)
       VALUES($1,$2,$3,'order_cancelled','order',$4,$5)`,
      [allocation.warehouse_id, allocation.variant_id, allocation.quantity, orderId, actorAdminId]
    );
    await client.query(
      "UPDATE order_warehouse_allocations SET restored_at=now() WHERE id=$1 AND restored_at IS NULL",
      [allocation.id]
    );
  }
  return allocations.rowCount;
}
