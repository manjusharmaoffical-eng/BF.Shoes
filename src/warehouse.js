import express from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { authenticate, requireScope } from "./auth.js";

export const warehouseRouter = express.Router();
warehouseRouter.use(authenticate);

const warehouseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,24}$/),
  address: z.string().trim().max(500).optional().default("")
}).strict();

warehouseRouter.get("/summary", requireScope("inventory:read"), async (_req, res, next) => {
  try {
    const [warehouses, legacy, production, movements, lowStock] = await Promise.all([
      pool.query(\`SELECT w.id,w.name,w.code,w.address,w.active,
        COALESCE(sum(wi.quantity),0)::bigint AS units_in_stock,
        count(wi.variant_id) FILTER (WHERE wi.quantity > 0)::int AS stocked_variants
        FROM warehouses w LEFT JOIN warehouse_inventory wi ON wi.warehouse_id=w.id
        GROUP BY w.id ORDER BY w.name\`),
      pool.query(\`SELECT COALESCE(sum(GREATEST(v.stock_qty-COALESCE(a.allocated,0),0)),0)::bigint AS unassigned_legacy_units
        FROM variants v LEFT JOIN (
          SELECT variant_id,sum(quantity)::bigint AS allocated FROM warehouse_inventory GROUP BY variant_id
        ) a ON a.variant_id=v.id WHERE v.active=true\`),
      pool.query(\`SELECT date_trunc('day',completed_at)::date AS day,
        sum(good_qty)::int AS good_units,sum(rejected_qty)::int AS rejected_units,
        count(*)::int AS completed_batches
        FROM production_batches WHERE status='completed' AND completed_at >= now()-interval '30 days'
        GROUP BY 1 ORDER BY 1\`),
      pool.query(\`SELECT date_trunc('day',created_at)::date AS day,
        sum(delta) FILTER (WHERE delta > 0)::int AS stock_in,
        abs(sum(delta) FILTER (WHERE delta < 0))::int AS stock_out
        FROM warehouse_stock_movements WHERE created_at >= now()-interval '30 days'
        GROUP BY 1 ORDER BY 1\`),
      pool.query(\`SELECT p.name AS product_name,v.sku,v.size_label,v.color_name,
        COALESCE(sum(wi.quantity),0)::int AS warehouse_units
        FROM variants v JOIN products p ON p.id=v.product_id
        LEFT JOIN warehouse_inventory wi ON wi.variant_id=v.id
        WHERE v.active=true GROUP BY p.name,v.sku,v.size_label,v.color_name
        HAVING COALESCE(sum(wi.quantity),0) <= 5
        ORDER BY warehouse_units,v.sku LIMIT 20\`)
    ]);
    res.set("Cache-Control","no-store");
    res.json({data:{
      warehouses:warehouses.rows,
      unassigned_legacy_units:legacy.rows[0].unassigned_legacy_units,
      production_daily:production.rows,
      stock_movements_daily:movements.rows,
      low_stock:lowStock.rows,
      note:"Warehouse stock is location-assigned stock. Existing variant stock with no recorded warehouse is shown separately as unassigned legacy stock."
    }});
  } catch(err){next(err);}
});

warehouseRouter.get("/warehouses", requireScope("inventory:read"), async (_req,res,next)=>{
  try{
    const result=await pool.query(\`SELECT w.id,w.name,w.code,w.address,w.active,
      COALESCE(sum(wi.quantity),0)::bigint AS units_in_stock
      FROM warehouses w LEFT JOIN warehouse_inventory wi ON wi.warehouse_id=w.id
      GROUP BY w.id ORDER BY w.name\`);
    res.json({data:result.rows});
  }catch(err){next(err);}
});

warehouseRouter.post("/warehouses", requireScope("inventory:write"), async(req,res,next)=>{
  const parsed=warehouseSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Invalid warehouse",details:parsed.error.flatten()});
  try{
    const r=await pool.query("INSERT INTO warehouses(name,code,address,created_by) VALUES($1,$2,$3,$4) RETURNING *",
      [parsed.data.name,parsed.data.code,parsed.data.address,req.actor.type==="admin"?req.actor.id:null]);
    await pool.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES($1,$2,'warehouse.create','warehouse',$3)",
      [req.actor.type,req.actor.id,r.rows[0].id]);
    res.status(201).json({data:r.rows[0]});
  }catch(err){if(err.code==="23505")return res.status(409).json({error:"Warehouse code already exists"});next(err);}
});

const stockSchema=z.object({
  sku:z.string().trim().min(2).max(80),
  delta:z.number().int().min(-1000000).max(1000000).refine(v=>v!==0),
  reason:z.string().trim().min(3).max(200)
}).strict();

warehouseRouter.post("/warehouses/:id/stock",requireScope("inventory:write"),async(req,res,next)=>{
  const parsed=stockSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Invalid warehouse stock adjustment",details:parsed.error.flatten()});
  let client;
  try{
    client=await pool.connect();await client.query("BEGIN");
    const wh=await client.query("SELECT id FROM warehouses WHERE id=$1 AND active=true FOR UPDATE",[req.params.id]);
    if(!wh.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Active warehouse not found"});}
    const v=await client.query("SELECT id,stock_qty FROM variants WHERE sku=$1 AND active=true FOR UPDATE",[parsed.data.sku]);
    if(!v.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Active SKU not found"});}
    const current=await client.query("SELECT quantity FROM warehouse_inventory WHERE warehouse_id=$1 AND variant_id=$2 FOR UPDATE",[req.params.id,v.rows[0].id]);
    const before=Number(current.rows[0]?.quantity||0),next=before+parsed.data.delta;
    if(next<0){await client.query("ROLLBACK");return res.status(409).json({error:"Warehouse stock cannot be negative",available:before});}
    const aggregate=Number(v.rows[0].stock_qty)+parsed.data.delta;
    if(aggregate<0){await client.query("ROLLBACK");return res.status(409).json({error:"Aggregate SKU stock cannot be negative",available:Number(v.rows[0].stock_qty)});}
    await client.query(\`INSERT INTO warehouse_inventory(warehouse_id,variant_id,quantity,updated_at)
      VALUES($1,$2,$3,now()) ON CONFLICT(warehouse_id,variant_id)
      DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=now()\`,[req.params.id,v.rows[0].id,next]);
    await client.query("UPDATE variants SET stock_qty=$1,updated_at=now() WHERE id=$2",[aggregate,v.rows[0].id]);
    await client.query("INSERT INTO inventory_movements(variant_id,delta,reason,actor_admin_id) VALUES($1,$2,$3,$4)",
      [v.rows[0].id,parsed.data.delta,"warehouse:"+parsed.data.reason,req.actor.type==="admin"?req.actor.id:null]);
    await client.query("INSERT INTO warehouse_stock_movements(warehouse_id,variant_id,delta,reason,actor_admin_id) VALUES($1,$2,$3,$4,$5)",
      [req.params.id,v.rows[0].id,parsed.data.delta,parsed.data.reason,req.actor.type==="admin"?req.actor.id:null]);
    await client.query("COMMIT");
    res.json({data:{sku:parsed.data.sku,warehouse_id:req.params.id,quantity:next,aggregate_stock:aggregate}});
  }catch(err){if(client)await client.query("ROLLBACK").catch(()=>{});next(err);}
  finally{client?.release();}
});

const batchSchema=z.object({
  sku:z.string().trim().min(2).max(80),
  planned_qty:z.number().int().min(1).max(1000000),
  planned_for:z.string().date().optional().nullable(),
  notes:z.string().trim().max(1000).optional().default("")
}).strict();

warehouseRouter.post("/production/batches",requireScope("inventory:write"),async(req,res,next)=>{
  const parsed=batchSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Invalid production batch",details:parsed.error.flatten()});
  try{
    const r=await pool.query(\`INSERT INTO production_batches(product_id,variant_id,planned_qty,planned_for,notes,created_by)
      SELECT p.id,v.id,$2,$3,$4,$5 FROM variants v JOIN products p ON p.id=v.product_id
      WHERE v.sku=$1 AND v.active=true AND p.active=true RETURNING *\`,
      [parsed.data.sku,parsed.data.planned_qty,parsed.data.planned_for||null,parsed.data.notes,req.actor.type==="admin"?req.actor.id:null]);
    if(!r.rowCount)return res.status(404).json({error:"Active SKU not found"});
    await pool.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES($1,$2,'production.batch.create','production_batch',$3)",
      [req.actor.type,req.actor.id,r.rows[0].id]);
    res.status(201).json({data:r.rows[0]});
  }catch(err){next(err);}
});

warehouseRouter.get("/production/batches",requireScope("inventory:read"),async(_req,res,next)=>{
  try{
    const r=await pool.query(\`SELECT b.*,p.name AS product_name,v.sku,v.size_label,v.color_name
      FROM production_batches b JOIN products p ON p.id=b.product_id JOIN variants v ON v.id=b.variant_id
      ORDER BY b.created_at DESC LIMIT 200\`);
    res.json({data:r.rows});
  }catch(err){next(err);}
});

warehouseRouter.patch("/production/batches/:id/start",requireScope("inventory:write"),async(req,res,next)=>{
  try{
    const r=await pool.query(\`UPDATE production_batches SET status='in_progress',started_at=COALESCE(started_at,now()),updated_at=now()
      WHERE id=$1 AND status='planned' RETURNING *\`,[req.params.id]);
    if(!r.rowCount)return res.status(409).json({error:"Batch not found or not in planned state"});
    await pool.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES($1,$2,'production.batch.start','production_batch',$3)",
      [req.actor.type,req.actor.id,r.rows[0].id]);
    res.json({data:r.rows[0]});
  }catch(err){next(err);}
});

const completeSchema=z.object({
  warehouse_id:z.string().uuid(),
  good_qty:z.number().int().min(0).max(1000000),
  rejected_qty:z.number().int().min(0).max(1000000),
  notes:z.string().trim().max(1000).optional().default("")
}).strict().refine(v=>v.good_qty+v.rejected_qty>0,{message:"Record at least one good or rejected unit"});

warehouseRouter.post("/production/batches/:id/complete",requireScope("inventory:write"),async(req,res,next)=>{
  const parsed=completeSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Invalid production completion",details:parsed.error.flatten()});
  let client;
  try{
    client=await pool.connect();await client.query("BEGIN");
    const b=await client.query("SELECT * FROM production_batches WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!b.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Production batch not found"});}
    const batch=b.rows[0],total=parsed.data.good_qty+parsed.data.rejected_qty;
    if(!["planned","in_progress"].includes(batch.status)){await client.query("ROLLBACK");return res.status(409).json({error:"Production batch is already closed"});}
    if(total>batch.planned_qty){await client.query("ROLLBACK");return res.status(400).json({error:"Good plus rejected units cannot exceed planned quantity"});}
    const wh=await client.query("SELECT id FROM warehouses WHERE id=$1 AND active=true FOR UPDATE",[parsed.data.warehouse_id]);
    if(!wh.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Active destination warehouse not found"});}
    const variant=await client.query("SELECT stock_qty FROM variants WHERE id=$1 FOR UPDATE",[batch.variant_id]);
    const aggregate=Number(variant.rows[0].stock_qty)+parsed.data.good_qty;
    if(aggregate>1000000){await client.query("ROLLBACK");return res.status(400).json({error:"Aggregate stock limit exceeded"});}
    if(parsed.data.good_qty>0){
      const current=await client.query("SELECT quantity FROM warehouse_inventory WHERE warehouse_id=$1 AND variant_id=$2 FOR UPDATE",[parsed.data.warehouse_id,batch.variant_id]);
      const next=Number(current.rows[0]?.quantity||0)+parsed.data.good_qty;
      await client.query(\`INSERT INTO warehouse_inventory(warehouse_id,variant_id,quantity,updated_at)
        VALUES($1,$2,$3,now()) ON CONFLICT(warehouse_id,variant_id)
        DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=now()\`,[parsed.data.warehouse_id,batch.variant_id,next]);
      await client.query("UPDATE variants SET stock_qty=$1,updated_at=now() WHERE id=$2",[aggregate,batch.variant_id]);
      await client.query("INSERT INTO inventory_movements(variant_id,delta,reason,actor_admin_id) VALUES($1,$2,'production_completed',$3)",
        [batch.variant_id,parsed.data.good_qty,req.actor.type==="admin"?req.actor.id:null]);
      await client.query("INSERT INTO warehouse_stock_movements(warehouse_id,variant_id,delta,reason,reference_type,reference_id,actor_admin_id) VALUES($1,$2,$3,'production_completed','production_batch',$4,$5)",
        [parsed.data.warehouse_id,batch.variant_id,parsed.data.good_qty,batch.id,req.actor.type==="admin"?req.actor.id:null]);
    }
    const updated=await client.query(\`UPDATE production_batches SET good_qty=$1,rejected_qty=$2,status='completed',
      completed_at=now(),notes=CASE WHEN $3='' THEN notes ELSE notes||E'\\n'||$3 END,updated_at=now()
      WHERE id=$4 RETURNING *\`,[parsed.data.good_qty,parsed.data.rejected_qty,parsed.data.notes,batch.id]);
    await client.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES($1,$2,'production.batch.complete','production_batch',$3)",
      [req.actor.type,req.actor.id,batch.id]);
    await client.query("COMMIT");
    res.json({data:{batch:updated.rows[0],aggregate_stock:aggregate}});
  }catch(err){if(client)await client.query("ROLLBACK").catch(()=>{});next(err);}
  finally{client?.release();}
});

const transferSchema=z.object({
  from_warehouse_id:z.string().uuid(),
  to_warehouse_id:z.string().uuid(),
  sku:z.string().trim().min(2).max(80),
  quantity:z.number().int().min(1).max(1000000)
}).strict().refine(v=>v.from_warehouse_id!==v.to_warehouse_id,{message:"Choose two different warehouses"});

warehouseRouter.post("/transfers",requireScope("inventory:write"),async(req,res,next)=>{
  const parsed=transferSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Invalid stock transfer",details:parsed.error.flatten()});
  let client;
  try{
    client=await pool.connect();await client.query("BEGIN");
    const ids=[parsed.data.from_warehouse_id,parsed.data.to_warehouse_id].sort();
    const wh=await client.query("SELECT id FROM warehouses WHERE id=ANY($1::uuid[]) AND active=true ORDER BY id FOR UPDATE",[ids]);
    if(wh.rowCount!==2){await client.query("ROLLBACK");return res.status(404).json({error:"Both active warehouses are required"});}
    const v=await client.query("SELECT id FROM variants WHERE sku=$1 AND active=true FOR UPDATE",[parsed.data.sku]);
    if(!v.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Active SKU not found"});}
    const source=await client.query("SELECT quantity FROM warehouse_inventory WHERE warehouse_id=$1 AND variant_id=$2 FOR UPDATE",[parsed.data.from_warehouse_id,v.rows[0].id]);
    const sourceQty=Number(source.rows[0]?.quantity||0);
    if(sourceQty<parsed.data.quantity){await client.query("ROLLBACK");return res.status(409).json({error:"Insufficient stock in source warehouse",available:sourceQty});}
    const destination=await client.query("SELECT quantity FROM warehouse_inventory WHERE warehouse_id=$1 AND variant_id=$2 FOR UPDATE",[parsed.data.to_warehouse_id,v.rows[0].id]);
    const destinationQty=Number(destination.rows[0]?.quantity||0)+parsed.data.quantity;
    await client.query("UPDATE warehouse_inventory SET quantity=$1,updated_at=now() WHERE warehouse_id=$2 AND variant_id=$3",[sourceQty-parsed.data.quantity,parsed.data.from_warehouse_id,v.rows[0].id]);
    await client.query(\`INSERT INTO warehouse_inventory(warehouse_id,variant_id,quantity,updated_at)
      VALUES($1,$2,$3,now()) ON CONFLICT(warehouse_id,variant_id)
      DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=now()\`,[parsed.data.to_warehouse_id,v.rows[0].id,destinationQty]);
    const transfer=await client.query("INSERT INTO stock_transfers(from_warehouse_id,to_warehouse_id,variant_id,quantity,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [parsed.data.from_warehouse_id,parsed.data.to_warehouse_id,v.rows[0].id,parsed.data.quantity,req.actor.type==="admin"?req.actor.id:null]);
    await client.query("INSERT INTO warehouse_stock_movements(warehouse_id,variant_id,delta,reason,reference_type,reference_id,actor_admin_id) VALUES($1,$2,$3,'stock_transfer_out','stock_transfer',$4,$5),($6,$2,$7,'stock_transfer_in','stock_transfer',$4,$5)",
      [parsed.data.from_warehouse_id,v.rows[0].id,-parsed.data.quantity,transfer.rows[0].id,req.actor.type==="admin"?req.actor.id:null,parsed.data.to_warehouse_id,parsed.data.quantity]);
    await client.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES($1,$2,'warehouse.stock.transfer','stock_transfer',$3)",
      [req.actor.type,req.actor.id,transfer.rows[0].id]);
    await client.query("COMMIT");
    res.status(201).json({data:transfer.rows[0]});
  }catch(err){if(client)await client.query("ROLLBACK").catch(()=>{});next(err);}
  finally{client?.release();}
});

warehouseRouter.get("/transfers",requireScope("inventory:read"),async(_req,res,next)=>{
  try{
    const r=await pool.query(\`SELECT t.*,f.name AS from_warehouse,to_wh.name AS to_warehouse,
      v.sku,v.size_label,v.color_name FROM stock_transfers t
      JOIN warehouses f ON f.id=t.from_warehouse_id JOIN warehouses to_wh ON to_wh.id=t.to_warehouse_id
      JOIN variants v ON v.id=t.variant_id ORDER BY t.created_at DESC LIMIT 100\`);
    res.json({data:r.rows});
  }catch(err){next(err);}
});
