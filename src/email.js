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
    await pool.query("UPDATE notification_outbox SET status='sent',attempts=attempts+1,sent_at=now() WHERE id=$1", [id]);
    return { queued: true, configured: true, sent: true };
  } catch {
    await pool.query("UPDATE notification_outbox SET status='failed',attempts=attempts+1,last_error='Email provider request failed' WHERE id=$1", [id]).catch(() => {});
    return { queued: true, configured: true, sent: false };
  }
}
