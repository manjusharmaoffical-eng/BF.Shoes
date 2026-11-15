import express from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { authenticate, requireScope } from './auth.js';
import { getCustomerSession } from './customer-auth.js';
import { canTransitionReturnStatus, isWithinReturnWindow, RETURN_STATUSES, validateReturnItems } from './return-workflow.js';

export const returnsRouter = express.Router();

const createSchema = z.object({
  order_number: z.number().int().positive(),
  request_type: z.enum(['return', 'exchange']),
  reason: z.string().trim().min(10).max(1000),
  items: z.array(z.object({
    order_item_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(10),
    requested_size: z.string().trim().max(40).optional().default('')
  }).strict()).min(1).max(20)
}).strict();

returnsRouter.post('/', async (req, res, next) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Check the order, request reason and selected items.' });
  let client;
  try {
    const session = await getCustomerSession(req);
    if (!session) return res.status(401).json({ error: 'Sign in to request a return or exchange.' });
    client = await pool.connect();
    await client.query('BEGIN');
    const orderResult = await client.query(
      `SELECT o.id,o.order_number,o.status,o.currency,o.shipping_country,COALESCE(o.delivered_at,o.updated_at) AS delivered_at
       FROM orders o JOIN customer_accounts c ON lower(c.email)=lower(o.customer_email)
       WHERE o.order_number=$1 AND c.id=$2 AND c.active=true FOR UPDATE OF o`,
      [parsed.data.order_number, session.row.id]
    );
    const order = orderResult.rows[0];
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found in your account.' }); }
    if (order.status !== 'delivered') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'A return or exchange request can be submitted after the order is marked delivered.' }); }
    if (!isWithinReturnWindow(order.delivered_at)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Return or exchange requests must be submitted within 12 hours after delivery.' }); }
    const existing = await client.query("SELECT id FROM return_requests WHERE order_id=$1 AND status NOT IN ('rejected','cancelled')", [order.id]);
    if (existing.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'A return or exchange request already exists for this order.' }); }
    const orderItems = await client.query('SELECT id,quantity FROM order_items WHERE order_id=$1', [order.id]);
    let items;
    try { items = validateReturnItems(parsed.data.items, orderItems.rows, parsed.data.request_type); }
    catch (error) { await client.query('ROLLBACK'); return res.status(400).json({ error: error.message }); }
    const created = await client.query(
      `INSERT INTO return_requests(order_id,customer_id,request_type,reason,status)
       VALUES($1,$2,$3,$4,'requested') RETURNING id,order_id,request_type,reason,status,created_at`,
      [order.id, session.row.id, parsed.data.request_type, parsed.data.reason]
    );
    const request = created.rows[0];
    for (const item of items) await client.query(
      'INSERT INTO return_request_items(request_id,order_item_id,quantity,requested_size) VALUES($1,$2,$3,$4)',
      [request.id, item.order_item_id, item.quantity, item.requested_size]
    );
    await client.query(
      `INSERT INTO return_request_events(request_id,actor_type,actor_id,to_status,customer_message)
       VALUES($1,'customer',$2,'requested','Your request has been received and is waiting for BF SHOES review.')`,
      [request.id, session.row.id]
    );
    await client.query(
      `INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id)
       VALUES('system',$1,'return_request.created','return_request',$2)`,
      [session.row.id, request.id]
    );
    await client.query('COMMIT');
    return res.status(201).json({ data: { ...request, currency: order.currency, items }, message: 'Request submitted. No refund, fee or stock change has been made.' });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Your customer session expired. Please sign in again.' });
    if (err.code === '23505') return res.status(409).json({ error: 'A return or exchange request already exists for this order.' });
    next(err);
  } finally { client?.release(); }
});

returnsRouter.get('/mine', async (req, res, next) => {
  try {
    const session = await getCustomerSession(req);
    if (!session) return res.status(401).json({ error: 'Sign in to view your requests.' });
    const result = await pool.query(
      `SELECT r.id,r.request_type,r.reason,r.status,r.customer_message,r.created_at,r.updated_at,
        o.order_number,o.currency,
        COALESCE((SELECT json_agg(json_build_object('product_name',oi.product_name,'sku',oi.sku,'size',oi.size_label,
          'color',oi.color_name,'quantity',ri.quantity,'requested_size',ri.requested_size))
          FROM return_request_items ri JOIN order_items oi ON oi.id=ri.order_item_id WHERE ri.request_id=r.id),'[]'::json) AS items,
        COALESCE((SELECT json_agg(json_build_object('status',e.to_status,'message',e.customer_message,'created_at',e.created_at) ORDER BY e.created_at)
          FROM return_request_events e WHERE e.request_id=r.id AND e.customer_message<>''),'[]'::json) AS history
       FROM return_requests r JOIN orders o ON o.id=r.order_id
       WHERE r.customer_id=$1 ORDER BY r.created_at DESC LIMIT 50`,
      [session.row.id]
    );
    return res.json({ data: result.rows });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Your customer session expired. Please sign in again.' });
    next(err);
  }
});

returnsRouter.get('/admin', authenticate, requireScope('orders:write'), async (req, res, next) => {
  if (req.actor.type !== 'admin' || !['admin', 'manager'].includes(req.actor.role)) return res.status(403).json({ error: 'Owner or manager access required.' });
  try {
    const result = await pool.query(
      `SELECT r.id,r.request_type,r.reason,r.status,r.customer_message,r.internal_note,r.created_at,r.updated_at,
        o.order_number,o.currency,o.total_cents,o.customer_name,o.customer_email,o.shipping_country,
        COALESCE((SELECT json_agg(json_build_object('product_name',oi.product_name,'sku',oi.sku,'size',oi.size_label,
          'color',oi.color_name,'quantity',ri.quantity,'requested_size',ri.requested_size))
          FROM return_request_items ri JOIN order_items oi ON oi.id=ri.order_item_id WHERE ri.request_id=r.id),'[]'::json) AS items
       FROM return_requests r JOIN orders o ON o.id=r.order_id
       ORDER BY CASE WHEN r.status IN ('requested','under_review') THEN 0 ELSE 1 END,r.created_at DESC LIMIT 200`
    );
    return res.json({ data: result.rows });
  } catch (err) { next(err); }
});

const updateSchema = z.object({
  status: z.enum(RETURN_STATUSES),
  customer_message: z.string().trim().max(500).optional().default(''),
  internal_note: z.string().trim().max(1000).optional().default('')
}).strict();

returnsRouter.patch('/admin/:id', authenticate, requireScope('orders:write'), async (req, res, next) => {
  if (req.actor.type !== 'admin' || !['admin', 'manager'].includes(req.actor.role)) return res.status(403).json({ error: 'Owner or manager access required.' });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid return request update.' });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const found = await client.query('SELECT id,status FROM return_requests WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!found.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Return request not found.' }); }
    const previous = found.rows[0];
    if (!canTransitionReturnStatus(previous.status, parsed.data.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Invalid return request transition: ${previous.status} to ${parsed.data.status}.` });
    }
    const updated = await client.query(
      `UPDATE return_requests SET status=$1,customer_message=$2,internal_note=$3,reviewed_by=$4,updated_at=now()
       WHERE id=$5 RETURNING id,status,customer_message,internal_note,updated_at`,
      [parsed.data.status, parsed.data.customer_message, parsed.data.internal_note, req.actor.id, req.params.id]
    );
    await client.query(
      `INSERT INTO return_request_events(request_id,actor_type,actor_id,from_status,to_status,customer_message,internal_note)
       VALUES($1,'admin',$2,$3,$4,$5,$6)`,
      [req.params.id, req.actor.id, previous.status, parsed.data.status, parsed.data.customer_message, parsed.data.internal_note]
    );
    await client.query(
      `INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id)
       VALUES('admin',$1,'return_request.status_change','return_request',$2)`,
      [req.actor.id, req.params.id]
    );
    await client.query('COMMIT');
    return res.json({ data: updated.rows[0], message: 'Request status updated. No refund, fee or inventory change was triggered.' });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally { client?.release(); }
});
