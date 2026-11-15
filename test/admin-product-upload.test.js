import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../frontend/admin.html", import.meta.url), "utf8");
const admin = await readFile(new URL("../frontend/admin.js", import.meta.url), "utf8");
const studio = await readFile(new URL("../src/ai-studio.js", import.meta.url), "utf8");

test("product creation supports a direct primary photo upload through signed Cloudinary storage", () => {
  assert.match(html, /name="image_file" type="file" accept="image\\/jpeg,image\\/png,image\\/webp"/);
  assert.match(admin, /async function uploadProductPhoto\\(productId,file\\)/);
  assert.match(admin, /\\/ai-studio\\/product-images\\/signature/);
  assert.match(admin, /make_primary:true/);
  assert.match(admin, /photo upload failed:[\\s\\S]*Product photo gallery/);
  assert.match(studio, /aiStudioRouter\\.post\\("\\/product-images\\/signature"/);
  assert.match(studio, /isOwnedCloudinaryImage/);
});
