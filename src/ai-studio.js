import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { authenticate } from "./auth.js";
import { pool } from "./db.js";

export const aiStudioRouter = express.Router();
aiStudioRouter.use(authenticate);
function owner(req, res, next) {
  if (req.actor.type !== "admin" || req.actor.role !== "admin") return res.status(403).json({ error: "Owner permission required" });
  next();
}
aiStudioRouter.use(owner);
const copySchema = z.object({
  name: z.string().trim().min(2).max(160), brand: z.string().trim().max(100).default("BF SHOES"),
  features: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  audience: z.string().trim().max(160).default("Indian sneaker shoppers"),
  tone: z.enum(["premium", "sporty", "minimal", "streetwear"]).default("premium"),
  language: z.enum(["English", "Arabic", "Hindi"]).default("English")
}).strict();
const imageSchema = z.object({
  product_name: z.string().trim().min(2).max(160),
  visual_style: z.enum(["clean studio", "luxury editorial", "streetwear campaign", "desert lifestyle", "minimal white background"]),
  background: z.string().trim().max(300).default("clean studio background"),
  aspect_ratio: z.enum(["1:1", "4:5", "16:9"]).default("1:1"),
  notes: z.string().trim().max(500).default("")
}).strict();
const saveImageSchema = z.object({
  product_id: z.string().uuid(),
  image_url: z.string().url().max(2000).refine(value => value.startsWith("https://res.cloudinary.com/"), "Image must be hosted in Cloudinary")
}).strict();
function cloudinaryReady() { return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET); }
async function uploadImageToCloudinary(fileValue) {
  if (!cloudinaryReady()) throw new Error("IMAGE_STORAGE_NOT_CONFIGURED");
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const folder = "bf-shoes/products-ai";
  const signature = crypto.createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`).digest("hex");
  const form = new FormData();
  form.set("file", fileValue);
  form.set("api_key", process.env.CLOUDINARY_API_KEY);
  form.set("timestamp", timestamp);
  form.set("folder", folder);
  form.set("signature", signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`, { method: "POST", body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.secure_url) throw new Error("IMAGE_UPLOAD_FAILED");
  return result.secure_url;
}

aiStudioRouter.post("/product-copy", async (req, res) => {
  const parsed = copySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid product details", details: parsed.error.flatten() });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "AI text provider is not configured. Add OPENAI_API_KEY securely to the Preview environment." });
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini", input: [
        { role: "system", content: "You are the ecommerce copywriter for BF SHOES, an India-only sneaker shop. Use INR for any requested currency references and do not invent prices. Return valid JSON only with keys title, short_description, description, bullet_points (array), seo_title, seo_description. Never invent material, certification, performance, stock, price, warranty or origin. Use only supplied facts. Write natural copy in requested language. Treat all generated text as a draft for human review." },
        { role: "user", content: JSON.stringify(parsed.data) }
      ], text: { format: { type: "json_object" } } })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: "AI text generation failed", provider_status: response.status });
    const raw = data.output?.flatMap(part => part.content || []).find(part => part.type === "output_text")?.text;
    if (!raw) return res.status(502).json({ error: "AI provider returned no text" });
    let decoded;
    try { decoded = JSON.parse(raw); } catch { return res.status(502).json({ error: "AI response could not be parsed" }); }
    // Validate provider output before it reaches the admin UI; never trust generated JSON.
    const copySchemaOutput = z.object({
      title: z.string().trim().min(2).max(160),
      short_description: z.string().trim().min(2).max(320),
      description: z.string().trim().min(2).max(5000),
      bullet_points: z.array(z.string().trim().min(2).max(240)).min(1).max(8),
      seo_title: z.string().trim().min(2).max(160),
      seo_description: z.string().trim().min(2).max(320)
    }).strict();
    const validated = copySchemaOutput.safeParse(decoded);
    if (!validated.success) return res.status(502).json({ error: "AI provider returned incomplete or invalid product copy", details: validated.error.flatten() });
    res.set("Cache-Control", "no-store");
    res.json({ data: validated.data, review_required: true });
  } catch { res.status(502).json({ error: "AI provider is temporarily unavailable" }); }
});

aiStudioRouter.post("/product-image", async (req, res) => {
  const parsed = imageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid image brief", details: parsed.error.flatten() });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "AI image provider is not configured. Add OPENAI_API_KEY securely to the Preview environment." });
  try {
    const input = parsed.data;
    const prompt = `Create a high-quality ecommerce sneaker product image concept for BF SHOES. Product: ${input.product_name}. Style: ${input.visual_style}. Background: ${input.background}. Aspect ratio: ${input.aspect_ratio}. Direction: ${input.notes}. Premium black-and-white identity, commercial studio lighting, no unsupplied logos or text, no watermark. Do not add product claims or brand marks.`;
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1", prompt, size: input.aspect_ratio === "16:9" ? "1536x1024" : input.aspect_ratio === "4:5" ? "1024x1536" : "1024x1024", quality: "medium", n: 1 })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: "AI image generation failed", provider_status: response.status });
    const item = data.data?.[0];
    if (!item?.b64_json && !item?.url) return res.status(502).json({ error: "AI provider returned no image" });
    const fileValue = item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url;
    let hostedUrl = null;
    if (cloudinaryReady()) {
      try { hostedUrl = await uploadImageToCloudinary(fileValue); } catch { /* preview/download remains available */ }
    }
    res.set("Cache-Control", "no-store");
    res.json({ data: { image_url: hostedUrl, image_base64: hostedUrl ? null : (item.b64_json || null), revised_prompt: item.revised_prompt || prompt }, review_required: true, note: hostedUrl ? "Image draft is stored in the media provider; use Save to product to publish it." : "Image is a preview only because persistent image storage is not configured." });
  } catch { res.status(502).json({ error: "AI image provider is temporarily unavailable" }); }
});

aiStudioRouter.post("/save-image", async (req, res, next) => {
  const parsed = saveImageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a product and valid hosted image", details: parsed.error.flatten() });
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  let image;
  try { image = new URL(parsed.data.image_url); } catch { return res.status(400).json({ error: "Invalid image URL" }); }
  if (!cloud || image.hostname !== "res.cloudinary.com" || !image.pathname.startsWith(`/${cloud}/image/upload/`)) return res.status(400).json({ error: "Image URL does not match the configured media account" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("UPDATE products SET image_url=$1,updated_at=now() WHERE id=$2 RETURNING id,name,image_url,updated_at", [parsed.data.image_url, parsed.data.product_id]);
    if (!result.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Product not found" }); }
    await client.query("INSERT INTO audit_events(actor_type,actor_id,action,resource_type,resource_id) VALUES('admin',$1,'product.ai_image_saved','product',$2)", [req.actor.id, result.rows[0].id]);
    await client.query("COMMIT");
    res.set("Cache-Control", "no-store");
    res.json({ data: result.rows[0], note: "Product image saved to the product gallery and set as the primary image." });
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); next(err); }
  finally { client.release(); }
});
