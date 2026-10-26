import express from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { deliverEmail } from "./email.js";

export const newsletterRouter = express.Router();
newsletterRouter.post("/subscribe", async (req, res, next) => {
  const parsed = z.object({ email: z.string().trim().email().max(254) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email address" });
  const email = parsed.data.email.toLowerCase();
  try {
    await pool.query(
      "INSERT INTO newsletter_subscribers(email) VALUES($1) ON CONFLICT(email) DO UPDATE SET active=true",
      [email]
    );
    let emailStatus = "pending_configuration";
    try {
      const result = await deliverEmail({
        kind: "newsletter_welcome",
        recipient: email,
        subject: "Welcome to BF SHOES",
        textBody: "Thanks for subscribing to BF SHOES updates. You can contact the store to unsubscribe."
      });
      emailStatus = result.sent ? "sent" : "saved";
    } catch { emailStatus = "saved"; }
    res.status(202).json({ message: "Thanks for subscribing to BF SHOES.", email_status: emailStatus });
  } catch (err) { next(err); }
});
