import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "bf-shoes-newsletter-test-secret-at-least-32-bytes";
const { createNewsletterUnsubscribeToken, verifyNewsletterUnsubscribeToken } = await import("../src/newsletter-tokens.js");

test("newsletter unsubscribe token round-trips a normalized email", () => {
  const token = createNewsletterUnsubscribeToken(" Customer@Example.com ", 1_800_000_000_000);
  assert.equal(verifyNewsletterUnsubscribeToken(token, 1_800_000_000_000), "customer@example.com");
});

test("newsletter unsubscribe token rejects tampering and malformed tokens", () => {
  const token = createNewsletterUnsubscribeToken("customer@example.com", 1_800_000_000_000);
  assert.equal(verifyNewsletterUnsubscribeToken(token + "x", 1_800_000_000_000), null);
  assert.equal(verifyNewsletterUnsubscribeToken("not-a-token", 1_800_000_000_000), null);
});

test("newsletter unsubscribe token expires after one year", () => {
  const now = 1_800_000_000_000;
  const token = createNewsletterUnsubscribeToken("customer@example.com", now);
  assert.equal(verifyNewsletterUnsubscribeToken(token, now + 366 * 24 * 60 * 60 * 1000), null);
});

test("newsletter unsubscribe signing rejects a weak secret", () => {
  const prior = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "short";
  assert.throws(() => createNewsletterUnsubscribeToken("customer@example.com"), /32 bytes/);
  process.env.JWT_SECRET = prior;
});
