import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/newsletter.js", import.meta.url), "utf8");
const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

test("newsletter unsubscribe GET only renders an explicit confirmation and never changes subscriber state", () => {
  const getRoute = source.split('newsletterRouter.get("/unsubscribe"')[1]?.split('newsletterRouter.post("/unsubscribe"')[0] || "";
  assert.match(getRoute, /Confirm unsubscribe/);
  assert.match(getRoute, /method=\\"post\\"/);
  assert.doesNotMatch(getRoute, /pool\.query\(["']UPDATE newsletter_subscribers/);
  assert.match(getRoute, /Cache-Control", "no-store/);
  assert.match(getRoute, /Referrer-Policy", "no-referrer/);
});

test("newsletter unsubscribe POST verifies the signed token before deactivating a subscriber", () => {
  const postRoute = source.split('newsletterRouter.post("/unsubscribe"')[1] || "";
  assert.match(postRoute, /verifyNewsletterUnsubscribeToken\(token\)/);
  assert.match(postRoute, /UPDATE newsletter_subscribers SET active=false WHERE email=\$1/);
  assert.ok(postRoute.indexOf("verifyNewsletterUnsubscribeToken(token)") < postRoute.indexOf("UPDATE newsletter_subscribers"));
});

test("server accepts small URL-encoded browser confirmation forms", () => {
  assert.match(server, /express\.urlencoded\(\{ extended: false, limit: "10kb" \}\)/);
});
