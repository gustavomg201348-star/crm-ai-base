import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(file: string) {
  return readFileSync(file, "utf8");
}

test("Campaign e Conversation possuem aiProfile nullable", () => {
  for (const file of [
    "prisma/schema.prisma",
    "prisma/schema.postgres.prisma"
  ]) {
    const schema = source(file);

    assert.match(
      schema,
      /model Campaign \{[\s\S]*?aiProfile\s+String\?/
    );

    assert.match(
      schema,
      /model Conversation \{[\s\S]*?aiProfile\s+String\?/
    );
  }
});

test("mappers expoem aiProfile", () => {
  const campaigns = source("src/lib/campaigns.ts");
  const conversations = source("src/lib/conversations.ts");

  assert.match(
    campaigns,
    /aiProfile:\s*campaign\.aiProfile/
  );

  assert.ok(
    (
      conversations.match(
        /aiProfile:\s*conversation\.aiProfile/g
      ) ?? []
    ).length >= 2
  );
});

test("Campaign ainda nao propaga aiProfile para Conversation", () => {
  const campaigns = source("src/lib/campaigns.ts");

  const start = campaigns.indexOf(
    "async function findOrCreateCampaignConversation"
  );

  const end = campaigns.indexOf(
    "async function refreshCampaignCounters",
    start
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const lifecycleBridge = campaigns.slice(start, end);

  assert.doesNotMatch(
    lifecycleBridge,
    /aiProfile/
  );
});

test("foundation nao altera inbound ou automatic reply", () => {
  const inbound = source("src/lib/inbound-message.ts");
  const attendant = source("src/lib/ai-attendant.service.ts");

  assert.doesNotMatch(inbound, /aiProfile/);
  assert.doesNotMatch(attendant, /aiProfile/);
});
