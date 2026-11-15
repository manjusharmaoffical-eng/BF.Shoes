import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../frontend/admin.html", import.meta.url), "utf8");
const admin = await readFile(new URL("../frontend/admin.js", import.meta.url), "utf8");
const studio = await readFile(new URL("../src/ai-studio.js", import.meta.url), "utf8");

test("product creation supports a direct primary photo upload through signed Cloudinary storage", () => {
  assert.ok(html.includes('name="image_file" type="file"'));
  assert.ok(admin.includes("async function uploadProductPhoto(productId,file)"));
  assert.ok(admin.includes("req('/ai-studio/product-images/signature'"));
  assert.ok(admin.includes("make_primary:true"));
  assert.ok(admin.includes("photo upload failed:"));
  assert.ok(studio.includes('aiStudioRouter.post("/product-images/signature"'));
  assert.ok(studio.includes("isOwnedCloudinaryImage"));
});
