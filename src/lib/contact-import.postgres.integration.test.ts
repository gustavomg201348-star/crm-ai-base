import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  CONTACT_IMPORT_MAX_ROWS,
  ContactImportIdempotencyConflictError,
  confirmContactImport
} from "./contact-import.service";
import { parseContactImportConfirmBody } from "./contact-import-confirm-handler";

function contactRow(index: number) {
  return {
    name: `Import fixture ${index}`,
    cpf: String(10_000_000_000 + index),
    phone: `119${String(index).padStart(8, "0")}`
  };
}

async function holdCompanyImportLock(db: PrismaClient, companyId: string) {
  let release: () => void = () => {};
  let acquired: () => void = () => {};
  const acquiredPromise = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holding = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`contact-import:${companyId}`}, 0)
        ) IS NULL AS "acquired"
      `;
      acquired();
      await releasePromise;
    },
    { timeout: 30_000 }
  );
  await acquiredPromise;
  return { release, holding };
}

test("contact import preserves identity and transaction guarantees on disposable PostgreSQL", async (context) => {
  const configured = process.env.CONTACT_IMPORT_TEST_DATABASE_URL;
  assert.equal(
    process.env.CONTACT_IMPORT_POSTGRES_TEST,
    "1",
    "Explicit disposable PostgreSQL required; no skips"
  );
  assert(configured);
  const url = new URL(configured);
  assert(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.pathname, "/qevora_contact_import_test");
  assert(!url.searchParams.has("host"));

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl.toString() } },
    log: []
  });
  const databaseName = `qevora_contact_import_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;

  try {
    await admin.$executeRawUnsafe(
      `CREATE DATABASE "${databaseName}" TEMPLATE qevora_contact_import_test`
    );
  } catch (error) {
    await admin.$disconnect();
    throw error;
  }

  url.pathname = `/${databaseName}`;
  const databaseUrl = url.toString();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const secondDb = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const locker = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    const companyA = await db.company.create({ data: { name: "Import fixture A" } });
    const companyB = await db.company.create({ data: { name: "Import fixture B" } });
    const userA = await db.user.create({
      data: {
        companyId: companyA.id,
        name: "Import admin A",
        email: `${randomUUID()}@example.invalid`,
        passwordHash: "not-a-login",
        role: "ADMIN"
      }
    });
    const userB = await db.user.create({
      data: {
        companyId: companyB.id,
        name: "Import admin B",
        email: `${randomUUID()}@example.invalid`,
        passwordHash: "not-a-login",
        role: "ADMIN"
      }
    });

    const duplicateCpf = "11111111111";
    await db.contact.create({
      data: {
        companyId: companyA.id,
        ownerId: userA.id,
        name: "Historical duplicate A",
        cpf: duplicateCpf,
        phone: "5511999999001",
        normalizedPhone: "5511999999001"
      }
    });
    await db.contact.create({
      data: {
        companyId: companyA.id,
        ownerId: userA.id,
        name: "Historical duplicate B",
        cpf: duplicateCpf,
        phone: "5511999999002",
        normalizedPhone: "5511999999002"
      }
    });
    const historicallySelected = await db.contact.findFirst({
      where: { companyId: companyA.id, cpf: duplicateCpf },
      select: { id: true }
    });
    assert(historicallySelected);

    const duplicateBatchKey = randomUUID();
    const duplicateRows = [
      {
        name: "Historical duplicate import",
        cpf: duplicateCpf,
        phone: "11999999003",
        retirementLead: {
          grantDate: "2026-01-10",
          benefitType: "Aposentadoria",
          city: "Cidade Teste",
          state: "MG"
        }
      }
    ];
    const duplicateResult = await confirmContactImport({
      companyId: companyA.id,
      userId: userA.id,
      idempotencyKey: duplicateBatchKey,
      rows: duplicateRows,
      db,
      databaseUrl
    });
    const duplicateActivity = await db.contactActivity.findFirstOrThrow({
      where: { type: "IMPORT_PLANILHA_UPDATED", detail: { contains: "Linha 2" } },
      orderBy: { createdAt: "desc" }
    });
    const duplicateLead = await db.retirementLead.findFirstOrThrow({
      where: { companyId: companyA.id, contactId: historicallySelected.id }
    });
    assert.equal(duplicateActivity.contactId, historicallySelected.id);
    assert.equal(duplicateLead.contactId, historicallySelected.id);
    const activityCountAfterFirstImport = await db.contactActivity.count({
      where: { contactId: historicallySelected.id }
    });
    const eventCountAfterFirstImport = await db.retirementLeadEvent.count({
      where: { retirementLeadId: duplicateLead.id }
    });
    const replayResult = await confirmContactImport({
      companyId: companyA.id,
      userId: userA.id,
      idempotencyKey: duplicateBatchKey,
      rows: duplicateRows,
      db: secondDb,
      databaseUrl
    });
    assert.deepEqual(replayResult, duplicateResult);
    assert.equal(
      await db.contactActivity.count({ where: { contactId: historicallySelected.id } }),
      activityCountAfterFirstImport
    );
    assert.equal(
      await db.retirementLeadEvent.count({
        where: { retirementLeadId: duplicateLead.id }
      }),
      eventCountAfterFirstImport
    );
    assert.equal(
      await db.contactImportBatch.count({
        where: { companyId: companyA.id, idempotencyKey: duplicateBatchKey }
      }),
      1
    );
    const persistedDuplicateBatch = await db.contactImportBatch.findUniqueOrThrow({
      where: {
        companyId_idempotencyKey: {
          companyId: companyA.id,
          idempotencyKey: duplicateBatchKey
        }
      },
      select: { resultVersion: true, resultJson: true }
    });
    assert.equal(persistedDuplicateBatch.resultVersion, 1);
    assert.doesNotMatch(persistedDuplicateBatch.resultJson, /phone|cpf|11999999003/i);
    await assert.rejects(
      confirmContactImport({
        companyId: companyA.id,
        userId: userA.id,
        idempotencyKey: duplicateBatchKey,
        rows: [{ ...duplicateRows[0], name: "Different payload" }],
        db,
        databaseUrl
      }),
      ContactImportIdempotencyConflictError
    );

    const concurrentRow = contactRow(101);
    const heldConcurrent = await holdCompanyImportLock(locker, companyA.id);
    await assert.rejects(
      confirmContactImport({
        companyId: companyA.id,
        userId: userA.id,
        idempotencyKey: randomUUID(),
        rows: [concurrentRow],
        db,
        databaseUrl
      }),
      /importacao de contatos em andamento/
    );
    heldConcurrent.release();
    await heldConcurrent.holding;
    await confirmContactImport({
      companyId: companyA.id,
      userId: userA.id,
      idempotencyKey: randomUUID(),
      rows: [concurrentRow],
      db: secondDb,
      databaseUrl
    });
    assert.equal(
      await db.contact.count({
        where: { companyId: companyA.id, cpf: concurrentRow.cpf }
      }),
      1,
      "same-company imports must serialize before identity reads"
    );

    let releaseFirstLookup: () => void = () => {};
    let signalFirstLookup: () => void = () => {};
    const firstLookupReached = new Promise<void>((resolve) => {
      signalFirstLookup = resolve;
    });
    const firstLookupRelease = new Promise<void>((resolve) => {
      releaseFirstLookup = resolve;
    });
    const delayedFirstClient = db.$extends({
      query: {
        contactImportBatch: {
          async findUnique({ args, query }) {
            signalFirstLookup();
            await firstLookupRelease;
            return query(args);
          }
        }
      }
    });
    const concurrentBatchKey = randomUUID();
    const concurrentSameKeyRow = contactRow(106);
    const firstConcurrentImport = confirmContactImport({
      companyId: companyA.id,
      userId: userA.id,
      idempotencyKey: concurrentBatchKey,
      rows: [concurrentSameKeyRow],
      db: delayedFirstClient as PrismaClient,
      databaseUrl
    });
    await firstLookupReached;
    await assert.rejects(
      confirmContactImport({
        companyId: companyA.id,
        userId: userA.id,
        idempotencyKey: concurrentBatchKey,
        rows: [concurrentSameKeyRow],
        db: secondDb,
        databaseUrl
      }),
      /importacao de contatos em andamento/
    );
    releaseFirstLookup();
    const firstConcurrentResult = await firstConcurrentImport;
    const concurrentReplayResult = await confirmContactImport({
      companyId: companyA.id,
      userId: userA.id,
      idempotencyKey: concurrentBatchKey,
      rows: [concurrentSameKeyRow],
      db: secondDb,
      databaseUrl
    });
    assert.deepEqual(concurrentReplayResult, firstConcurrentResult);
    const concurrentContactId = firstConcurrentResult.contactIds[0];
    assert.equal(
      await db.contactActivity.count({ where: { contactId: concurrentContactId } }),
      1
    );

    const sharedCompanyKey = randomUUID();
    const [companyAResult, companyBResult] = await Promise.all([
      confirmContactImport({
        companyId: companyA.id,
        userId: userA.id,
        idempotencyKey: sharedCompanyKey,
        rows: [contactRow(107)],
        db,
        databaseUrl
      }),
      confirmContactImport({
        companyId: companyB.id,
        userId: userB.id,
        idempotencyKey: sharedCompanyKey,
        rows: [contactRow(108)],
        db: secondDb,
        databaseUrl
      })
    ]);
    assert.equal(companyAResult.summary.created, 1);
    assert.equal(companyBResult.summary.created, 1);
    assert.equal(
      await db.contactImportBatch.count({ where: { idempotencyKey: sharedCompanyKey } }),
      2
    );

    const heldA = await holdCompanyImportLock(locker, companyA.id);
    const blockedImport = assert.rejects(confirmContactImport({
      companyId: companyA.id,
      userId: userA.id,
      idempotencyKey: randomUUID(),
      rows: [contactRow(102)],
      db,
      databaseUrl
    }), /importacao de contatos em andamento/);
    const independentImport = confirmContactImport({
      companyId: companyB.id,
      userId: userB.id,
      idempotencyKey: randomUUID(),
      rows: [contactRow(103)],
      db: secondDb,
      databaseUrl
    });
    const independentResult = await Promise.race([
      independentImport,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("independent company import was blocked")), 5_000)
      )
    ]);
    assert.equal(independentResult.summary.created, 1);
    heldA.release();
    await heldA.holding;
    await blockedImport;

    const preWriteFailureRow = contactRow(109);
    const preWriteFailureKey = randomUUID();
    const preWriteFailureClient = db.$extends({
      query: {
        contactImportBatch: {
          async findUnique() {
            throw new Error("simulated pre-write failure");
          }
        }
      }
    });
    await assert.rejects(
      confirmContactImport({
        companyId: companyA.id,
        userId: userA.id,
        idempotencyKey: preWriteFailureKey,
        rows: [preWriteFailureRow],
        db: preWriteFailureClient as PrismaClient,
        databaseUrl
      }),
      /simulated pre-write failure/
    );
    assert.equal(
      await db.contact.count({
        where: { companyId: companyA.id, cpf: preWriteFailureRow.cpf }
      }),
      0
    );
    assert.equal(
      await db.contactImportBatch.count({
        where: { companyId: companyA.id, idempotencyKey: preWriteFailureKey }
      }),
      0
    );
    const preWriteRetry = await confirmContactImport({
      companyId: companyA.id,
      userId: userA.id,
      idempotencyKey: preWriteFailureKey,
      rows: [preWriteFailureRow],
      db,
      databaseUrl
    });
    assert.equal(preWriteRetry.summary.created, 1);

    let releaseExternalCpfRace: () => void = () => {};
    let signalExternalCpfRace: () => void = () => {};
    const externalCpfRaceReached = new Promise<void>((resolve) => {
      signalExternalCpfRace = resolve;
    });
    const externalCpfRaceRelease = new Promise<void>((resolve) => {
      releaseExternalCpfRace = resolve;
    });
    const externalCpfRaceRow = {
      ...contactRow(111),
      retirementLead: {
        grantDate: "2026-01-10",
        benefitType: "Aposentadoria",
        city: "Cidade Concorrente",
        state: "MG"
      }
    };
    let delayedExternalCpfIndex = false;
    const delayedCpfIndexClient = db.$extends({
      query: {
        contact: {
          async findMany({ args, query }) {
            const result = await query(args);
            const cpfValues = (
              args.where as { cpf?: { in?: string[] } } | undefined
            )?.cpf?.in;
            if (
              !delayedExternalCpfIndex &&
              cpfValues?.includes(externalCpfRaceRow.cpf)
            ) {
              delayedExternalCpfIndex = true;
              signalExternalCpfRace();
              await externalCpfRaceRelease;
            }
            return result;
          }
        }
      }
    });
    const externalCpfRaceKey = randomUUID();
    const racedCpfImport = confirmContactImport({
      companyId: companyA.id,
      userId: userA.id,
      idempotencyKey: externalCpfRaceKey,
      rows: [externalCpfRaceRow],
      db: delayedCpfIndexClient as PrismaClient,
      databaseUrl
    });
    await externalCpfRaceReached;
    const externalCpfContact = await secondDb.contact.create({
      data: {
        companyId: companyA.id,
        ownerId: userA.id,
        name: "External CPF race",
        phone: "5511987654111",
        normalizedPhone: "5511987654111",
        cpf: externalCpfRaceRow.cpf
      }
    });
    releaseExternalCpfRace();
    const externalCpfRaceResult = await racedCpfImport;
    assert.equal(externalCpfRaceResult.summary.created, 0);
    assert.equal(externalCpfRaceResult.summary.updated, 1);
    assert.deepEqual(externalCpfRaceResult.contactIds, [externalCpfContact.id]);
    assert.equal(
      await db.contact.count({
        where: { companyId: companyA.id, cpf: externalCpfRaceRow.cpf }
      }),
      1,
      "a live CPF lookup must observe a creator committed after the initial index"
    );
    assert.equal(
      await db.contactActivity.count({
        where: {
          contactId: externalCpfContact.id,
          type: "IMPORT_PLANILHA_UPDATED"
        }
      }),
      1
    );
    assert.equal(
      await db.retirementLead.count({
        where: { companyId: companyA.id, contactId: externalCpfContact.id }
      }),
      1
    );

    let releaseExternalPhoneRace: () => void = () => {};
    let signalExternalPhoneRace: () => void = () => {};
    const externalPhoneRaceReached = new Promise<void>((resolve) => {
      signalExternalPhoneRace = resolve;
    });
    const externalPhoneRaceRelease = new Promise<void>((resolve) => {
      releaseExternalPhoneRace = resolve;
    });
    const externalPhoneRaceRow = contactRow(110);
    const externalPhoneRaceKey = randomUUID();
    const delayedContactCreateClient = db.$extends({
      query: {
        contact: {
          async create({ args, query }) {
            if (args.data.cpf === externalPhoneRaceRow.cpf) {
              signalExternalPhoneRace();
              await externalPhoneRaceRelease;
            }
            return query(args);
          }
        }
      }
    });
    const racedImport = confirmContactImport({
      companyId: companyA.id,
      userId: userA.id,
      idempotencyKey: externalPhoneRaceKey,
      rows: [externalPhoneRaceRow],
      db: delayedContactCreateClient as PrismaClient,
      databaseUrl
    });
    await externalPhoneRaceReached;
    await secondDb.contact.create({
      data: {
        companyId: companyA.id,
        ownerId: userA.id,
        name: "External phone race",
        phone: `55${externalPhoneRaceRow.phone}`,
        normalizedPhone: `55${externalPhoneRaceRow.phone}`,
        cpf: "99999999999"
      }
    });
    releaseExternalPhoneRace();
    await assert.rejects(
      racedImport,
      (error: unknown) =>
        Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002")
    );
    assert.equal(
      await db.contact.count({
        where: {
          companyId: companyA.id,
          normalizedPhone: `55${externalPhoneRaceRow.phone}`
        }
      }),
      1
    );
    assert.equal(
      await db.contactImportBatch.count({
        where: { companyId: companyA.id, idempotencyKey: externalPhoneRaceKey }
      }),
      0
    );
    const externalPhoneRaceRetry = await confirmContactImport({
      companyId: companyA.id,
      userId: userA.id,
      idempotencyKey: externalPhoneRaceKey,
      rows: [externalPhoneRaceRow],
      db,
      databaseUrl
    });
    assert.equal(externalPhoneRaceRetry.summary.updated, 1);

    const timeoutRow = contactRow(104);
    const timeoutBatchKey = randomUUID();
    const timeoutClient = db.$extends({
      query: {
        contactActivity: {
          async create({ args, query }) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            return query(args);
          }
        }
      }
    });
    await assert.rejects(
      confirmContactImport({
        companyId: companyA.id,
        userId: userA.id,
        idempotencyKey: timeoutBatchKey,
        rows: [timeoutRow],
        db: timeoutClient as PrismaClient,
        databaseUrl,
        transactionTimeoutMs: 100
      }),
      (error: unknown) =>
        Boolean(error && typeof error === "object" && "code" in error && error.code === "P2028")
    );
    assert.equal(
      await db.contact.count({ where: { companyId: companyA.id, cpf: timeoutRow.cpf } }),
      0
    );
    assert.equal(
      await db.contactImportBatch.count({
        where: { companyId: companyA.id, idempotencyKey: timeoutBatchKey }
      }),
      0
    );

    const rollbackRow = contactRow(105);
    const rollbackBatchKey = randomUUID();
    await assert.rejects(
      confirmContactImport({
        companyId: companyA.id,
        userId: "missing-user",
        idempotencyKey: rollbackBatchKey,
        rows: [rollbackRow],
        db,
        databaseUrl
      })
    );
    assert.equal(
      await db.contact.count({ where: { companyId: companyA.id, cpf: rollbackRow.cpf } }),
      0,
      "failed activity write must roll back the contact"
    );
    const retryResult = await confirmContactImport({
      companyId: companyA.id,
      userId: userA.id,
      idempotencyKey: rollbackBatchKey,
      rows: [rollbackRow],
      db,
      databaseUrl
    });
    assert.equal(retryResult.summary.created, 1);

    const nineDigitContact = await db.contact.create({
      data: {
        companyId: companyA.id,
        ownerId: userA.id,
        name: "Nine-digit fixture",
        cpf: "22222222222",
        phone: "5573981208676",
        normalizedPhone: "5573981208676"
      }
    });
    const alternateResult = await confirmContactImport({
      companyId: companyA.id,
      userId: userA.id,
      idempotencyKey: randomUUID(),
      rows: [
        { name: "Eight-digit fixture", cpf: "33333333333", phone: "7381208676" }
      ],
      db,
      databaseUrl
    });
    assert.deepEqual(alternateResult.contactIds, [nineDigitContact.id]);

    const mediumRows = Array.from({ length: 93 }, (_, index) => ({
      ...contactRow(3_000 + index),
      retirementLead: {
        grantDate: "2026-01-10",
        benefitType: "Aposentadoria",
        city: "Cidade Benchmark 93",
        state: "MG"
      }
    }));
    const mediumStartedAt = performance.now();
    const mediumResult = await confirmContactImport({
      companyId: companyA.id,
      userId: userA.id,
      idempotencyKey: randomUUID(),
      rows: mediumRows,
      db,
      databaseUrl
    });
    const mediumDurationMs = performance.now() - mediumStartedAt;
    assert.equal(mediumResult.summary.created, mediumRows.length);
    assert.equal(
      await db.retirementLead.count({
        where: { companyId: companyA.id, contactId: { in: mediumResult.contactIds } }
      }),
      mediumRows.length
    );
    assert.ok(mediumDurationMs < 60_000);
    context.diagnostic(
      `${mediumRows.length}-row PostgreSQL retirement-lead import: ${Math.round(mediumDurationMs)} ms`
    );

    const maxRows = Array.from({ length: CONTACT_IMPORT_MAX_ROWS }, (_, index) => ({
      ...contactRow(1_000 + index),
      retirementLead: {
        grantDate: "2026-01-10",
        benefitType: "Aposentadoria",
        city: "Cidade Benchmark",
        state: "MG"
      }
    }));
    assert.throws(() =>
      parseContactImportConfirmBody({
        idempotencyKey: randomUUID(),
        rows: [...maxRows, contactRow(9_999)]
      })
    );
    const maxStartedAt = performance.now();
    const maxResult = await confirmContactImport({
      companyId: companyB.id,
      userId: userB.id,
      idempotencyKey: randomUUID(),
      rows: maxRows,
      db,
      databaseUrl
    });
    const maxDurationMs = performance.now() - maxStartedAt;
    assert.equal(maxResult.summary.created, CONTACT_IMPORT_MAX_ROWS);
    assert.equal(
      await db.retirementLead.count({
        where: { companyId: companyB.id, contactId: { in: maxResult.contactIds } }
      }),
      CONTACT_IMPORT_MAX_ROWS
    );
    assert.ok(maxDurationMs < 60_000);
    context.diagnostic(
      `${CONTACT_IMPORT_MAX_ROWS}-row PostgreSQL retirement-lead import: ${Math.round(maxDurationMs)} ms`
    );

    const rollbackMaxRows = Array.from({ length: CONTACT_IMPORT_MAX_ROWS }, (_, index) => ({
      ...contactRow(2_000 + index),
      retirementLead: {
        grantDate: "2026-01-10",
        benefitType: "Aposentadoria",
        city: "Cidade Rollback",
        state: "MG"
      }
    }));
    const rollbackMaxKey = randomUUID();
    const rollbackAtBatchClient = db.$extends({
      query: {
        contactImportBatch: {
          async create() {
            throw new Error("simulated final batch write failure");
          }
        }
      }
    });
    const rollbackMaxStartedAt = performance.now();
    await assert.rejects(
      confirmContactImport({
        companyId: companyA.id,
        userId: userA.id,
        idempotencyKey: rollbackMaxKey,
        rows: rollbackMaxRows,
        db: rollbackAtBatchClient as PrismaClient,
        databaseUrl
      }),
      /simulated final batch write failure/
    );
    const rollbackMaxDurationMs = performance.now() - rollbackMaxStartedAt;
    assert.equal(
      await db.contact.count({
        where: {
          companyId: companyA.id,
          cpf: { in: rollbackMaxRows.map((row) => row.cpf) }
        }
      }),
      0
    );
    assert.equal(
      await db.contactImportBatch.count({
        where: { companyId: companyA.id, idempotencyKey: rollbackMaxKey }
      }),
      0
    );
    assert.ok(rollbackMaxDurationMs < 60_000);
    context.diagnostic(
      `${CONTACT_IMPORT_MAX_ROWS}-row PostgreSQL retirement-lead rollback: ${Math.round(rollbackMaxDurationMs)} ms`
    );
  } finally {
    await Promise.allSettled([db.$disconnect(), secondDb.$disconnect(), locker.$disconnect()]);
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.$disconnect();
    }
  }
});
