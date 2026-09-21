import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  validateContactReferences,
  type ContactReferenceDb
} from "./contact-reference-validation";

type ReferenceFixture = { id: string; companyId: string };

function createDb({
  stages = [],
  origins = []
}: {
  stages?: ReferenceFixture[];
  origins?: ReferenceFixture[];
}) {
  const lookups = { stages: 0, origins: 0 };
  const db: ContactReferenceDb = {
    pipelineStage: {
      async findFirst(args) {
        lookups.stages += 1;
        return (
          stages.find(
            (stage) =>
              stage.id === args.where.id && stage.companyId === args.where.companyId
          ) ?? null
        );
      }
    },
    origin: {
      async findFirst(args) {
        lookups.origins += 1;
        return (
          origins.find(
            (origin) =>
              origin.id === args.where.id && origin.companyId === args.where.companyId
          ) ?? null
        );
      }
    }
  };
  return { db, lookups };
}

const fixtures = {
  stages: [
    { id: "stage-a", companyId: "company-a" },
    { id: "stage-b", companyId: "company-b" }
  ],
  origins: [
    { id: "origin-a", companyId: "company-a" },
    { id: "origin-b", companyId: "company-b" }
  ]
};

test("CREATE aceita Stage A e Origin A", async () => {
  const { db } = createDb(fixtures);
  const result = await validateContactReferences({
    db,
    companyId: "company-a",
    stageId: "stage-a",
    originId: "origin-a"
  });
  assert.deepEqual(result, { ok: true, stageId: "stage-a", originId: "origin-a" });
});

test("CREATE rejeita Stage B cross-tenant", async () => {
  const { db } = createDb(fixtures);
  const result = await validateContactReferences({
    db,
    companyId: "company-a",
    stageId: "stage-b"
  });
  assert.deepEqual(result, { ok: false, field: "stageId" });
});

test("CREATE rejeita Origin B cross-tenant", async () => {
  const { db } = createDb(fixtures);
  const result = await validateContactReferences({
    db,
    companyId: "company-a",
    originId: "origin-b"
  });
  assert.deepEqual(result, { ok: false, field: "originId" });
});

test("IDs inexistentes sao rejeitados", async () => {
  const { db } = createDb(fixtures);
  const stage = await validateContactReferences({
    db,
    companyId: "company-a",
    stageId: "missing-stage"
  });
  const origin = await validateContactReferences({
    db,
    companyId: "company-a",
    originId: "missing-origin"
  });
  assert.deepEqual(stage, { ok: false, field: "stageId" });
  assert.deepEqual(origin, { ok: false, field: "originId" });
});

test("null explicito preserva remocao e ausencia preserva campo", async () => {
  const { db, lookups } = createDb(fixtures);
  const result = await validateContactReferences({
    db,
    companyId: "company-a",
    stageId: null
  });
  assert.deepEqual(result, { ok: true, stageId: null, originId: undefined });
  assert.deepEqual(lookups, { stages: 0, origins: 0 });
});

test("UPDATE aceita Stage A do tenant", async () => {
  const { db } = createDb(fixtures);
  const result = await validateContactReferences({
    db,
    companyId: "company-a",
    stageId: "stage-a"
  });
  assert.deepEqual(result, { ok: true, stageId: "stage-a", originId: undefined });
});

test("UPDATE rejeita Stage B e Origin B sem write parcial", async () => {
  const { db } = createDb(fixtures);
  let writes = 0;
  const result = await validateContactReferences({
    db,
    companyId: "company-a",
    stageId: "stage-a",
    originId: "origin-b"
  });
  if (result.ok) writes += 1;
  assert.deepEqual(result, { ok: false, field: "originId" });
  assert.equal(writes, 0);
});

test("AGENT usa a mesma validacao tenant-scoped", () => {
  const source = readFileSync("src/app/api/contacts/[id]/route.ts", "utf8");
  assert.ok(source.includes('agentAllowedPatchFields = new Set(["name", "cpf", "stageId"'));
  assert.ok(source.includes("await validateContactReferences"));
  assert.ok(source.indexOf("await validateContactReferences") < source.indexOf("tx.contact.update"));
});

test("CREATE e UPDATE validam referencias antes de persistir", () => {
  const createSource = readFileSync("src/app/api/contacts/route.ts", "utf8");
  const updateSource = readFileSync("src/app/api/contacts/[id]/route.ts", "utf8");
  assert.ok(createSource.indexOf("await validateContactReferences") < createSource.indexOf("tx.contact.create"));
  assert.ok(updateSource.indexOf("await validateContactReferences") < updateSource.indexOf("tx.contact.update"));
});

test("import defaults e bulk stage usam validacao tenant-scoped antes de writes", () => {
  const importSource = readFileSync("src/app/api/contacts/import/route.ts", "utf8");
  const bulkSource = readFileSync("src/app/api/contacts/bulk/route.ts", "utf8");
  assert.ok(importSource.indexOf("await validateContactReferences") < importSource.indexOf("prisma.contact.create"));
  assert.ok(bulkSource.indexOf("await validateContactReferences") < bulkSource.indexOf("tx.contact.updateMany"));
});

test("mapContact nao expoe Stage ou Origin de tenant diferente", () => {
  const source = readFileSync("src/lib/contacts.ts", "utf8");
  assert.ok(source.includes("contact.origin?.companyId === contact.companyId"));
  assert.ok(source.includes("contact.stage?.companyId === contact.companyId"));
  assert.ok(source.includes("originId: origin?.id ?? null"));
  assert.ok(source.includes("stageId: stage?.id ?? null"));
});
