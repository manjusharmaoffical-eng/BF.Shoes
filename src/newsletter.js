import express from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { deliverEmail } from "./email.js";
import { createNewsletterUnsubscribeToken, verifyNewsletterUnsubscribeToken } from "./newsletter-tokens.js";

export const newsletterRouter = express.Router();

function unsubscribeUrl(email) {
  const token = createNewsletterUnsubscribeToken(email);
  const configuredHost = process.env.PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = configuredHost
    ? (/^https:\\/\\//i.test(configuredHost) ? configuredHost : "https://" + configuredHost)
    : "https://bf-shoes.vercel.app";
  return new URL("/api/v1/newsletter/unsubscribe", base).toString() + "?token=" + encodeURIComponent(token);
}

newsletterRouter.post("/subscribe", async (req, res, next) => {
  const parsed = z.object({ email: z.string().trim().email().max(254) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email address" });
  const email = parsed.data.email.toLowerCase();
  try {
    await pool.query(
      "INSERT INTO newsletter_subscribers(email) VALUES($1) ON CONFLICT(email) DO UPDATE SET active=true,consented_at=now()",
      [email]
    );
    let emailStatus = "pending_configuration";
    try {
      const link = unsubscribeUrl(email);
      const result = await deliverEmail({
        kind: "newsletter_welcome",
        recipient: email,
        subject: "Welcome to BF SHOES",
        textBody: "Thanks for subscribing to BF SHOES updates. To unsubscribe at any time, open this link: " + link
      });
      emailStatus = result.sent ? "sent" : "saved";
    } catch { emailStatus = "saved"; }
    res.status(202).json({ message: "Thanks for subscribing to BF SHOES.", email_status: emailStatus });
  } catch (err) { next(err); }
});

newsletterRouter.get("/unsubscribe", async (req, res, next) => {
  const email = verifyNewsletterUnsubscribeToken(String(req.query.token || ""));
  if (!email) return res.status(400).type("text/plain").send("This unsubscribe link is invalid or has expired. Please contact BF SHOES support.");
  try {
    await pool.query("UPDATE newsletter_subscribers SET active=false WHERE email=$1", [email]);
    res.set("Cache-Control", "no-store");
    return res.status(200).type("html").send("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Unsubscribed · BF SHOES</title><body style=\"font:16px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#111\"><h1>You’re unsubscribed.</h1><p>You will no longer receive BF SHOES newsletter updates at this address.</p><a href=\"/\">Return to BF SHOES</a></body></html>");
  } catch (err) { next(err); }
});
