import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./db";
import { consumeRateLimits, prismaRateLimitStore } from "./rate-limit";

process.env.AUTH_SECRET = "rate-limit-postgres-integration-test";

function assertDisposableDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required");
  const parsed = new URL(databaseUrl);
  assert.ok(
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost",
    "integration test only accepts a local disposable PostgreSQL"
  );
  assert.equal(parsed.pathname, "/qevora_ci");
}

const rule = (category: string, limit: number, windowMs = 60_000) => ({
  category,
  identifiers: ["company-ci", "user-ci"],
  limit,
  windowMs
});

test("migration e rate limiter funcionam materialmente em PostgreSQL descartavel", async () => {
  assertDisposableDatabase();

  try {
    const columns = await prisma.$queryRaw<
      Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>
    >`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'RateLimitBucket'
      ORDER BY ordinal_position
    `;
    assert.deepEqual(
      columns.map(({ column_name, data_type, is_nullable }) => ({
        column_name,
        data_type,
        is_nullable
      })),
      [
        { column_name: "key", data_type: "text", is_nullable: "NO" },
        { column_name: "windowStart", data_type: "timestamp without time zone", is_nullable: "NO" },
        { column_name: "count", data_type: "integer", is_nullable: "NO" },
        { column_name: "expiresAt", data_type: "timestamp without time zone", is_nullable: "NO" },
        { column_name: "updatedAt", data_type: "timestamp without time zone", is_nullable: "NO" }
      ]
    );
    assert.match(columns.find((column) => column.column_name === "count")?.column_default ?? "", /0/);

    const primaryKey = await prisma.$queryRaw<Array<{ columns: string[] }>>`
      SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)::text[] AS columns
      FROM pg_constraint AS constraint_record
      JOIN unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
        ON true
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = constraint_record.conrelid
       AND attribute.attnum = key_column.attnum
      WHERE constraint_record.conrelid = '"RateLimitBucket"'::regclass
        AND constraint_record.contype = 'p'
      GROUP BY constraint_record.oid
    `;
    assert.deepEqual(primaryKey, [{ columns: ["key"] }]);

    const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'RateLimitBucket'
    `;
    assert.ok(indexes.some((index) => index.indexname === "RateLimitBucket_pkey"));
    assert.ok(
      indexes.some(
        (index) =>
          index.indexname === "RateLimitBucket_expiresAt_idx" &&
          index.indexdef.includes('(\"expiresAt\")')
      )
    );

    await prisma.rateLimitBucket.deleteMany();
    const start = new Date("2026-09-23T12:00:00.000Z");
    assert.equal(
      (await consumeRateLimits([rule("postgres-counter", 2)], {
        now: start,
        shouldCleanup: () => false
      })).status,
      "allowed"
    );
    assert.equal(
      (await consumeRateLimits([rule("postgres-counter", 2)], {
        now: start,
        shouldCleanup: () => false
      })).status,
      "allowed"
    );
    assert.equal(
      (await consumeRateLimits([rule("postgres-counter", 2)], {
        now: start,
        shouldCleanup: () => false
      })).status,
      "limited"
    );
    assert.equal(
      (await consumeRateLimits([rule("postgres-counter", 2)], {
        now: new Date(start.getTime() + 60_001),
        shouldCleanup: () => false
      })).status,
      "allowed"
    );

    const parallel = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeRateLimits([rule("postgres-concurrency", 5)], {
          now: start,
          shouldCleanup: () => false
        })
      )
    );
    assert.equal(parallel.filter((decision) => decision.status === "allowed").length, 5);
    assert.equal(parallel.filter((decision) => decision.status === "limited").length, 15);

    const cleanupTime = new Date("2026-09-23T14:00:00.000Z");
    await prisma.rateLimitBucket.createMany({
      data: [
        {
          key: "expired-integration-bucket",
          windowStart: new Date(cleanupTime.getTime() - 120_000),
          count: 1,
          expiresAt: new Date(cleanupTime.getTime() - 60_000),
          updatedAt: new Date(cleanupTime.getTime() - 60_000)
        },
        {
          key: "active-integration-bucket",
          windowStart: cleanupTime,
          count: 1,
          expiresAt: new Date(cleanupTime.getTime() + 60_000),
          updatedAt: cleanupTime
        }
      ]
    });
    assert.ok(prismaRateLimitStore.cleanupExpired);
    await prismaRateLimitStore.cleanupExpired({ before: cleanupTime, limit: 500 });
    assert.equal(
      await prisma.rateLimitBucket.count({ where: { key: "expired-integration-bucket" } }),
      0
    );
    assert.equal(
      await prisma.rateLimitBucket.count({ where: { key: "active-integration-bucket" } }),
      1
    );
  } finally {
    await prisma.$disconnect();
  }
});
