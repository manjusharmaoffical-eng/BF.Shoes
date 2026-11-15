import { pool } from "./db.js";

// Optional Resend delivery. Secrets are read only from environment and never returned to clients.
export async function deliverEmail({ kind, recipient, subject, textBody }) {
  const queued = await pool.query(
    "INSERT INTO notification_outbox(kind,recipient,subject,text_body) VALUES($1,$2,$3,$4) RETURNING id",
    [kind, recipient, subject, textBody]
  );
  const id = queued.rows[0].id;
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return { queued: true, configured: false };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [recipient], subject, text: textBody })
    });
    if (!response.ok) {
      await pool.query("UPDATE notification_outbox SET status='failed',attempts=attempts+1,last_error=$1 WHERE id=$2", ["Email provider returned HTTP " + response.status, id]);
      return { queued: true, configured: true, sent: false };
    }
    await pool.query("UPDATE notification_outbox SET status='sent',attempts=attempts+1,sent_at=now(),last_error=NULL WHERE id=$1", [id]);
    return { queued: true, configured: true, sent: true };
  } catch {
    await pool.query("UPDATE notification_outbox SET status='failed',attempts=attempts+1,last_error='Email provider request failed' WHERE id=$1", [id]).catch(() => {});
    return { queued: true, configured: true, sent: false };
  }
}

// Owner-triggered retry for a queued notification. A pending row with attempts=0
// is eligible (provider was not configured); failed rows are eligible up to five attempts.
// The row is claimed before the network request to prevent duplicate concurrent retries.
export async function retryQueuedEmail(id) {
  const client = await pool.connect();
  let row;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT id,recipient,subject,text_body,status,attempts FROM notification_outbox WHERE id=$1 FOR UPDATE",
      [id]
    );
    row = result.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { found: false };
    }
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      await client.query("ROLLBACK");
      return { found: true, configured: false, sent: false };
    }
    if (row.status === "sent") {
      await client.query("ROLLBACK");
      return { found: true, alreadySent: true, sent: true, attempts: row.attempts };
    }
    if (!["failed", "pending"].includes(row.status) || (row.status === "pending" && row.attempts > 0)) {
      await client.query("ROLLBACK");
      return { found: true, inProgress: true, sent: false, attempts: row.attempts };
    }
    if (row.attempts >= 5) {
      await client.query("ROLLBACK");
      return { found: true, limitReached: true, sent: false, attempts: row.attempts };
    }
    await client.query(
      "UPDATE notification_outbox SET status='pending',attempts=attempts+1,last_error=NULL WHERE id=$1",
      [id]
    );
    await client.query("COMMIT");
    row.attempts += 1;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [row.recipient], subject: row.subject, text: row.text_body })
    });
    if (!response.ok) {
      await pool.query(
        "UPDATE notification_outbox SET status='failed',last_error=$1 WHERE id=$2",
        ["Email provider returned HTTP " + response.status, id]
      );
      return { found: true, configured: true, sent: false, attempts: row.attempts };
    }
    await pool.query(
      "UPDATE notification_outbox SET status='sent',sent_at=now(),last_error=NULL WHERE id=$1",
      [id]
    );
    return { found: true, configured: true, sent: true, attempts: row.attempts };
  } catch {
    await pool.query(
      "UPDATE notification_outbox SET status='failed',last_error='Email provider request failed' WHERE id=$1",
      [id]
    ).catch(() => {});
    return { found: true, configured: true, sent: false, attempts: row.attempts };
  }
}
