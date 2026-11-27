import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { analyticsFilters, analyticsRatio } from "./campaign-analytics-policy";
import { analyticsCte } from "./campaign-analytics-query";
import { campaignMetrics } from "./campaign-analytics.service";

const now = new Date("2026-11-27T02:59:59Z");
test("cohort begins at Sao Paulo midnight with inclusive presets", () => {
  assert.equal(
    analyticsFilters(
      new URLSearchParams("period=today"),
      now,
    ).from.toISOString(),
    "2026-11-26T03:00:00.000Z",
  );
  assert.equal(
    analyticsFilters(new URLSearchParams("period=7d"), now).from.toISOString(),
    "2026-11-20T03:00:00.000Z",
  );
  assert.equal(
    analyticsFilters(new URLSearchParams("period=30d"), now).from.toISOString(),
    "2026-10-28T03:00:00.000Z",
  );
});
test("filters and page bounds are closed", () => {
  for (const q of [
    "period=year",
    "status=OTHER",
    "interaction=TEXT",
    "page=-1",
    "page=1.1",
    "groupPage=10001",
    "search=" + "a".repeat(101),
  ])
    assert.throws(() => analyticsFilters(new URLSearchParams(q), now));
});
test("ratios are finite and bounded including no eligible sends", () => {
  assert.equal(analyticsRatio(1, 0), 0);
  assert.equal(analyticsRatio(2, 3), 66.7);
  assert.equal(analyticsRatio(2, 1), 100);
  assert.equal(analyticsRatio(-1, 2), 0);
});
test("send and unique recipient denominators remain separate", () => {
  const m = campaignMetrics({
    sent: 4,
    read: 1,
    identifiedReads: 3,
    eligibleRecipients: 2,
    clicks: 1,
    interactedRecipients: 2,
  });
  assert.equal(m.readRate, 25);
  assert.equal(m.identifiedReadRate, 75);
  assert.equal(m.clickRate, 50);
  assert.equal(m.interactionRate, 100);
});
test("scope/search values remain SQL parameters in both database dialects", () => {
  for (const provider of ["postgresql", "sqlite"] as const) {
    const cte = analyticsCte(
      "tenant-'unsafe",
      analyticsFilters(new URLSearchParams("search=%25_%27"), now),
      provider,
    ).sql;
    assert(!cte.sql.includes("tenant-'unsafe"));
    assert(cte.values.includes("tenant-'unsafe"));
    assert(cte.sql.includes('"ConversationInboundEvent"'));
    assert(
      cte.values.includes("$.contextProviderMessageId") ||
        cte.values.includes("{contextProviderMessageId}"),
    );
  }
});
test("analytics only reads, never dispatches, updates receipts or starts automation", () => {
  const source =
    readFileSync("src/lib/campaign-analytics.service.ts", "utf8") +
    readFileSync("src/lib/campaign-analytics-query.ts", "utf8");
  assert(
    !/\.(create|update|delete|upsert|createMany|updateMany)\(/.test(source),
  );
  assert(
    !/from ["'][^"']*(chatbot|inbound-message|campaigns|whatsapp)["']/.test(
      source,
    ),
  );
  assert(source.includes("READ ONLY"));
  assert(source.includes("ROW_NUMBER()"));
  assert(source.includes('b."readAt" IS NOT NULL'));
});
test("legacy operational CSV and official read writer remain outside analytics", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  assert(page.includes("downloadCampaignReport"));
  const route = readFileSync(
    "src/app/api/campaigns/analytics/route.ts",
    "utf8",
  );
  assert(route.includes("requireCompanyAdmin"));
  const exporter = readFileSync(
    "src/app/api/campaigns/analytics/export/route.ts",
    "utf8",
  );
  assert(exporter.includes("serializeCsvCell"));
  assert(exporter.includes("campaign-analytics-v1.csv"));
});
