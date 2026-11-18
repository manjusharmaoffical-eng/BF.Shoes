import { pool } from "./db.js";

const MAX_ATTEMPTS = 5;
const PROVIDER_TIMEOUT_MS = 15_000;

function providerConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

async function sendWithResend(row) {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": "bf-shoes-notification/" + row.id
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [row.recipient],
      subject: row.subject,
      text: row.text_body
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  });
}

async function markEmailFailed(id, message) {
  await pool.query(
    "UPDATE notification_outbox SET status='failed',sending_at=NULL,last_error=$1 WHERE id=$2 AND status='sending'",
    [message, id]
  );
}

// Queue first, then make a guarded immediate attempt when credentials exist.
// If credentials are absent, the scheduled worker can deliver it later.
export async function deliverEmail({ kind, recipient, subject, textBody }) {
  const queued = await pool.query(
    "INSERT INTO notification_outbox(kind,recipient,subject,text_body) VALUES($1,$2,$3,$4) RETURNING id",
    [kind, recipient, subject, textBody]
  );
  const id = queued.rows[0].id;
  if (!providerConfigured()) return { queued: true, configured: false };
  const result = await retryQueuedEmail(id);
  return { queued: true, ...result };
}

// Claim and commit before network I/O. The sending state prevents the cron worker
// or another admin retry from claiming the same row while the provider is called.
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
    if (row.status === "sent") {
      await client.query("ROLLBACK");
      return { found: true, alreadySent: true, sent: true, attempts: row.attempts };
    }
    if (!providerConfigured()) {
      await client.query("ROLLBACK");
      return { found: true, configured: false, sent: false };
    }
    if (row.status === "sending" || (row.status !== "failed" && !(row.status === "pending" && row.attempts === 0))) {
      await client.query("ROLLBACK");
      return { found: true, inProgress: true, sent: false, attempts: row.attempts };
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await client.query("ROLLBACK");
      return { found: true, limitReached: true, sent: false, attempts: row.attempts };
    }
    await client.query(
      "UPDATE notification_outbox SET status='sending',sending_at=now(),attempts=attempts+1,last_error=NULL WHERE id=$1",
      [id]
    );
    row.attempts += 1;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  try {
    const response = await sendWithResend(row);
    if (!response.ok) {
      await markEmailFailed(id, "Email provider returned HTTP " + response.status);
      return { found: true, configured: true, sent: false, attempts: row.attempts };
    }
    await pool.query(
      "UPDATE notification_outbox SET status='sent',sending_at=NULL,sent_at=now(),last_error=NULL WHERE id=$1 AND status='sending'",
      [id]
    );
    return { found: true, configured: true, sent: true, attempts: row.attempts };
  } catch {
    await markEmailFailed(id, "Email provider request failed").catch(() => {});
    return { found: true, configured: true, sent: false, attempts: row.attempts };
  }
}

// Bounded worker for Vercel Cron or a self-hosted scheduler.
// A short lease recovers rows left in 'sending' after a crashed worker.
export async function processEmailOutbox({ limit = 10 } = {}) {
  if (!providerConfigured()) {
    return { configured: false, processed: 0, sent: 0, failed: 0 };
  }
  const batchSize = Math.max(1, Math.min(25, Number.isInteger(limit) ? limit : 10));

  await pool.query(
    "UPDATE notification_outbox SET status='failed',sending_at=NULL,last_error='Previous delivery worker timed out' WHERE status='sending' AND sending_at < now() - interval '15 minutes' AND attempts < $1",
    [MAX_ATTEMPTS]
  );
  await pool.query(
    "UPDATE notification_outbox SET status='failed',sending_at=NULL,last_error='Email retry limit reached' WHERE status='sending' AND sending_at < now() - interval '15 minutes' AND attempts >= $1",
    [MAX_ATTEMPTS]
  );

  const claimed = await pool.query(
    `WITH picked AS (
       SELECT id FROM notification_outbox
       WHERE status IN ('pending','failed') AND attempts < $1
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED LIMIT $2
     )
     UPDATE notification_outbox n
     SET status='sending',sending_at=now(),attempts=n.attempts+1,last_error=NULL
     FROM picked WHERE n.id=picked.id
     RETURNING n.id,n.kind,n.recipient,n.subject,n.text_body,n.attempts`,
    [MAX_ATTEMPTS, batchSize]
  );

  const summary = { configured: true, processed: claimed.rowCount, sent: 0, failed: 0 };
  for (const row of claimed.rows) {
    try {
      const response = await sendWithResend(row);
      if (!response.ok) {
        await markEmailFailed(row.id, "Email provider returned HTTP " + response.status);
        summary.failed++;
      } else {
        await pool.query(
          "UPDATE notification_outbox SET status='sent',sending_at=NULL,sent_at=now(),last_error=NULL WHERE id=$1 AND status='sending'",
          [row.id]
        );
        summary.sent++;
      }
    } catch {
      await markEmailFailed(row.id, "Email provider request failed").catch(() => {});
      summary.failed++;
    }
  }
  return summary;
}
