import test from "node:test";
import assert from "node:assert/strict";

test("next config exposes required security headers", async () => {
  const mod = await import("../../next.config.mjs");
  const headers = Object.fromEntries(mod.securityHeaders.map((entry: { key: string; value: string }) => [entry.key, entry.value]));

  for (const key of [
    "Content-Security-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy"
  ]) {
    assert.equal(typeof headers[key], "string", `${key} must be configured`);
    assert.ok(headers[key].length > 0, `${key} must not be empty`);
  }

  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(headers["Content-Security-Policy"], /object-src 'none'/);
  assert.match(headers["Content-Security-Policy"], /base-uri 'self'/);
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
});
