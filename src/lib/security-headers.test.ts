import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

test("next config exposes required security headers", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const configPath = path.resolve(here, "../../next.config.mjs");
  const source = await readFile(configPath, "utf8");

  for (const header of [
    "Content-Security-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy"
  ]) {
    assert.ok(source.includes(header), header + " must be configured");
  }

  assert.match(source, /frame-ancestors 'none'/);
  assert.match(source, /object-src 'none'/);
  assert.match(source, /base-uri 'self'/);
  assert.match(source, /X-Frame-Options[^\n]+DENY/);
  assert.match(source, /X-Content-Type-Options[^\n]+nosniff/);
});
