import { createHmac, randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export type RateLimitIncrement = {
  count: number;
  expiresAt: Date;
};

export type RateLimitStore = {
  increment(input: {
    key: string;
    windowStart: Date;
    expiresAt: Date;
    now: Date;
  }): Promise<RateLimitIncrement>;
  cleanupExpired?(input: { before: Date; limit: number }): Promise<number>;
};

export type RateLimitRule = {
  category: string;
  identifiers: readonly string[];
  limit: number;
  windowMs: number;
};

export type RateLimitDecision =
  | { status: "allowed" }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

export const rateLimitPolicies = {
  loginIp: { limit: 20, windowMs: 10 * 60_000 },
  loginIdentity: { limit: 8, windowMs: 10 * 60_000 },
  ai: { limit: 20, windowMs: 60_000 },
  messageSend: { limit: 30, windowMs: 60_000 },
  mediaUpload: { limit: 10, windowMs: 60_000 },
  campaignDispatch: { limit: 5, windowMs: 5 * 60_000 }
} as const;

function getRateLimitSecret() {
  const secret = process.env.RATE_LIMIT_SECRET || process.env.AUTH_SECRET;
  if (!secret) throw new Error("RATE_LIMIT_SECRET_UNAVAILABLE");
  return secret;
}

function rateLimitKey(rule: RateLimitRule) {
  return createHmac("sha256", getRateLimitSecret())
    .update(JSON.stringify(["v1", rule.category, ...rule.identifiers]))
    .digest("hex");
}

export function getRequestIpKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  const forwardedChain = forwarded
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return (
    forwardedChain?.at(0) ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

export const prismaRateLimitStore: RateLimitStore = {
  async increment({ key, windowStart, expiresAt, now }) {
    const rows = await prisma.$queryRaw<RateLimitIncrement[]>(Prisma.sql`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count", "expiresAt", "updatedAt")
      VALUES (${key}, ${windowStart}, 1, ${expiresAt}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "windowStart" = CASE
          WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${windowStart}
          ELSE "RateLimitBucket"."windowStart"
        END,
        "count" = CASE
          WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN 1
          ELSE "RateLimitBucket"."count" + 1
        END,
        "expiresAt" = CASE
          WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${expiresAt}
          ELSE "RateLimitBucket"."expiresAt"
        END,
        "updatedAt" = ${now}
      RETURNING "count", "expiresAt"
    `);

    const row = rows[0];
    if (!row) throw new Error("RATE_LIMIT_INCREMENT_FAILED");
    return row;
  },
  async cleanupExpired({ before, limit }) {
    return prisma.$executeRaw(Prisma.sql`
      WITH "expiredRateLimitBuckets" AS (
        SELECT "key"
        FROM "RateLimitBucket"
        WHERE "expiresAt" <= ${before}
        ORDER BY "expiresAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "RateLimitBucket" AS bucket
      USING "expiredRateLimitBuckets" AS expired
      WHERE bucket."key" = expired."key"
        AND bucket."expiresAt" <= ${before}
    `);
  }
};

const CLEANUP_SAMPLE_SIZE = 256;
const CLEANUP_BATCH_SIZE = 500;

async function cleanupExpiredBuckets(
  store: RateLimitStore,
  now: Date,
  shouldCleanup: () => boolean
) {
  if (!store.cleanupExpired || !shouldCleanup()) return;

  try {
    await store.cleanupExpired({ before: now, limit: CLEANUP_BATCH_SIZE });
  } catch {
    // Cleanup is best-effort and must not change the rate-limit decision.
  }
}

export async function consumeRateLimits(
  rules: readonly RateLimitRule[],
  options: {
    store?: RateLimitStore;
    now?: Date;
    shouldCleanup?: () => boolean;
  } = {}
): Promise<RateLimitDecision> {
  const store = options.store ?? prismaRateLimitStore;
  const now = options.now ?? new Date();
  const shouldCleanup = options.shouldCleanup ?? (() => randomInt(CLEANUP_SAMPLE_SIZE) === 0);

  try {
    for (const rule of rules) {
      const windowStartMs = Math.floor(now.getTime() / rule.windowMs) * rule.windowMs;
      const windowStart = new Date(windowStartMs);
      const expiresAt = new Date(windowStartMs + rule.windowMs);
      const result = await store.increment({
        key: rateLimitKey(rule),
        windowStart,
        expiresAt,
        now
      });

      if (result.count > rule.limit) {
        await cleanupExpiredBuckets(store, now, shouldCleanup);
        return {
          status: "limited",
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((result.expiresAt.getTime() - now.getTime()) / 1000)
          )
        };
      }
    }

    await cleanupExpiredBuckets(store, now, shouldCleanup);
    return { status: "allowed" };
  } catch {
    return { status: "unavailable" };
  }
}

export function rateLimitResponse(decision: Exclude<RateLimitDecision, { status: "allowed" }>) {
  if (decision.status === "limited") {
    return NextResponse.json(
      { error: "Muitas solicitacoes. Tente novamente mais tarde.", code: "RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(decision.retryAfterSeconds) }
      }
    );
  }

  return NextResponse.json(
    { error: "Servico temporariamente indisponivel.", code: "RATE_LIMIT_UNAVAILABLE" },
    { status: 503 }
  );
}

export async function enforceRateLimits(rules: readonly RateLimitRule[]) {
  const decision = await consumeRateLimits(rules);
  return decision.status === "allowed" ? null : rateLimitResponse(decision);
}
