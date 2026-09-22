import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  consumeRateLimits,
  getRequestIpKey,
  rateLimitResponse,
  type RateLimitStore
} from "./rate-limit";

process.env.AUTH_SECRET = "rate-limit-test-secret";

function memoryStore(): RateLimitStore {
  const buckets = new Map<string, { count: number; expiresAt: Date }>();
  return {
    async increment({ key, expiresAt, now }) {
      const current = buckets.get(key);
      const next = !current || current.expiresAt <= now
        ? { count: 1, expiresAt }
        : { count: current.count + 1, expiresAt: current.expiresAt };
      buckets.set(key, next);
      return next;
    }
  };
}

const rule = (tenant = "company-a", user = "user-a") => ({
  category: "ai",
  identifiers: [tenant, user],
  limit: 2,
  windowMs: 60_000
});

test("chamadas dentro da cota passam e excesso retorna limite", async () => {
  const store = memoryStore();
  const now = new Date("2026-09-22T12:00:00.000Z");
  assert.equal((await consumeRateLimits([rule()], { store, now })).status, "allowed");
  assert.equal((await consumeRateLimits([rule()], { store, now })).status, "allowed");
  const blocked = await consumeRateLimits([rule()], { store, now });
  assert.equal(blocked.status, "limited");
  if (blocked.status === "limited") {
    const response = rateLimitResponse(blocked);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "60");
  }
});

test("janela expirada reinicia a cota", async () => {
  const store = memoryStore();
  const start = new Date("2026-09-22T12:00:00.000Z");
  await consumeRateLimits([rule()], { store, now: start });
  await consumeRateLimits([rule()], { store, now: start });
  assert.equal((await consumeRateLimits([rule()], { store, now: start })).status, "limited");
  const nextWindow = new Date(start.getTime() + 60_001);
  assert.equal((await consumeRateLimits([rule()], { store, now: nextWindow })).status, "allowed");
});

test("tenant e usuario possuem cotas isoladas", async () => {
  const store = memoryStore();
  const now = new Date("2026-09-22T12:00:00.000Z");
  await consumeRateLimits([rule("company-a", "user-a")], { store, now });
  await consumeRateLimits([rule("company-a", "user-a")], { store, now });
  assert.equal(
    (await consumeRateLimits([rule("company-a", "user-a")], { store, now })).status,
    "limited"
  );
  assert.equal(
    (await consumeRateLimits([rule("company-b", "user-a")], { store, now })).status,
    "allowed"
  );
  assert.equal(
    (await consumeRateLimits([rule("company-a", "user-b")], { store, now })).status,
    "allowed"
  );
});

test("requests paralelos nao furam contador atomico do store", async () => {
  let count = 0;
  const store: RateLimitStore = {
    async increment({ expiresAt }) {
      count += 1;
      return { count, expiresAt };
    }
  };
  const now = new Date("2026-09-22T12:00:00.000Z");
  const results = await Promise.all(
    Array.from({ length: 10 }, () => consumeRateLimits([rule()], { store, now }))
  );
  assert.equal(results.filter((result) => result.status === "allowed").length, 2);
  assert.equal(results.filter((result) => result.status === "limited").length, 8);
});

test("falha do mecanismo retorna indisponivel sem vazar detalhes", async () => {
  const store: RateLimitStore = {
    async increment() {
      throw new Error("database credentials must not leak");
    }
  };
  const decision = await consumeRateLimits([rule()], { store });
  assert.equal(decision.status, "unavailable");
  if (decision.status === "unavailable") {
    const response = rateLimitResponse(decision);
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes("credentials"), false);
  }
});

test("IP usa cabecalho confiavel preferencial e nunca precisa ser logado", () => {
  const request = new NextRequest("http://localhost/api/test", {
    headers: {
      "x-real-ip": "203.0.113.9",
      "x-forwarded-for": "198.51.100.1, 192.0.2.4"
    }
  });
  assert.equal(getRequestIpKey(request), "203.0.113.9");

  const forwardedOnly = new NextRequest("http://localhost/api/test", {
    headers: { "x-forwarded-for": "198.51.100.1, 192.0.2.4" }
  });
  assert.equal(getRequestIpKey(forwardedOnly), "198.51.100.1");
});
