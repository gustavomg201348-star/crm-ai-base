import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server";
import {
  ContactImportConfirmRequestError,
  handleContactImportConfirm,
  parseContactImportConfirmBody,
  readLimitedJsonBody
} from "./contact-import-confirm-handler";
import {
  CONTACT_IMPORT_MAX_FIELD_LENGTH,
  CONTACT_IMPORT_MAX_ROWS,
  confirmContactImport,
  validateAndCanonicalizeContactImportRow
} from "./contact-import.service";

const adminSession = {
  id: "user-admin",
  companyId: "company-a",
  name: "Admin Teste",
  email: "admin@example.invalid",
  role: "ADMIN" as const
};

const validRow = {
  name: "Cliente Teste",
  cpf: "123.456.789-00",
  phone: "(33) 99999-9999"
};

function jsonRequest(value: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/imports/contacts/confirm", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(value)
  });
}

function routeDependencies(overrides: Record<string, unknown> = {}) {
  return {
    getSession: async () => ({ session: adminSession, response: null }),
    requireAdmin: () => null,
    enforceLimits: async () => null,
    confirmImport: async () => ({
      summary: { totalRows: 1, imported: 0, created: 0, updated: 0, invalid: 1 },
      contactIds: [],
      rows: [],
      errors: []
    }),
    maxRequestBytes: 6 * 1024 * 1024,
    ...overrides
  } as Parameters<typeof handleContactImportConfirm>[1];
}

test("confirm exige sessao antes do limiter e do body", async () => {
  let limiterCalls = 0;
  let bodyReads = 0;
  const request = {
    headers: new Headers(),
    get body() {
      bodyReads += 1;
      return null;
    }
  } as unknown as NextRequest;
  const response = await handleContactImportConfirm(
    request,
    routeDependencies({
      getSession: async () => ({
        session: null,
        response: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
      }),
      enforceLimits: async () => {
        limiterCalls += 1;
        return null;
      }
    })
  );

  assert.equal(response.status, 401);
  assert.equal(limiterCalls, 0);
  assert.equal(bodyReads, 0);
});

for (const role of ["AGENT", "SUPERVISOR"] as const) {
  test(`confirm rejeita role ${role} antes do limiter e do body`, async () => {
    let limiterCalls = 0;
    let bodyReads = 0;
    const request = {
      headers: new Headers(),
      get body() {
        bodyReads += 1;
        return null;
      }
    } as unknown as NextRequest;
    const response = await handleContactImportConfirm(
      request,
      routeDependencies({
        getSession: async () => ({ session: { ...adminSession, role }, response: null }),
        requireAdmin: () => NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }),
        enforceLimits: async () => {
          limiterCalls += 1;
          return null;
        }
      })
    );

    assert.equal(response.status, 403);
    assert.equal(limiterCalls, 0);
    assert.equal(bodyReads, 0);
  });
}

test("ADMIN usa companyId e userId somente da sessao", async () => {
  let received: { companyId: string; userId: string } | null = null;
  const response = await handleContactImportConfirm(
    jsonRequest({ rows: [validRow] }),
    routeDependencies({
      confirmImport: async (input: { companyId: string; userId: string }) => {
        received = { companyId: input.companyId, userId: input.userId };
        return {
          summary: { totalRows: 1, imported: 0, created: 0, updated: 0, invalid: 1 },
          contactIds: [],
          rows: [],
          errors: []
        };
      }
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(received, { companyId: "company-a", userId: "user-admin" });
});

test("rate limit usa company/user e company/IP antes de ler body", async () => {
  let bodyReads = 0;
  const request = {
    headers: new Headers({ "x-forwarded-for": "203.0.113.10" }),
    get body() {
      bodyReads += 1;
      return null;
    }
  } as unknown as NextRequest;
  const response = await handleContactImportConfirm(
    request,
    routeDependencies({
      enforceLimits: async (
        rules: Array<{
          category: string;
          identifiers: readonly string[];
          limit: number;
          windowMs: number;
        }>
      ) => {
        assert.deepEqual(
          rules.map((rule) => rule.category),
          ["contact-import-confirm-user", "contact-import-confirm-ip"]
        );
        assert.deepEqual(rules[0].identifiers, ["company-a", "user-admin"]);
        assert.deepEqual(rules[1].identifiers, ["company-a", "203.0.113.10"]);
        assert.deepEqual(
          rules.map(({ limit, windowMs }) => ({ limit, windowMs })),
          [
            { limit: 5, windowMs: 60_000 },
            { limit: 10, windowMs: 60_000 }
          ]
        );
        return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
      }
    })
  );

  assert.equal(response.status, 429);
  assert.equal(bodyReads, 0);
});

test("body normal e aceito sem confiar em campos derivados", async () => {
  assert.deepEqual(parseContactImportConfirmBody({ rows: [validRow] }), {
    rows: [validRow]
  });
});

test("campos derivados e IDs client-side sao rejeitados", () => {
  for (const extra of [
    { status: "VALID" },
    { errors: [] },
    { whatsapp: "5533999999999" },
    { rowNumber: 999 },
    { existingContactId: "contact-other-company" },
    { rawValues: {} },
    { contactId: "contact-other-company" },
    { action: "UPDATE" },
    { unexpected: true }
  ]) {
    assert.throws(
      () => parseContactImportConfirmBody({ rows: [{ ...validRow, ...extra }] }),
      ContactImportConfirmRequestError
    );
  }
});

test("retirementLead aceita somente allowlist do import", () => {
  const allowed = {
    grantDate: "01/01/2026",
    benefitType: "Aposentadoria",
    city: "Cidade Teste",
    state: "MG"
  };
  assert.deepEqual(
    parseContactImportConfirmBody({
      rows: [{ ...validRow, retirementLead: allowed }]
    }).rows[0].retirementLead,
    allowed
  );

  for (const field of [
    "benefitNumber",
    "desiredAmount",
    "interestLevel",
    "hasCorrespondent",
    "score",
    "journeyStatus",
    "nextContactDate",
    "lastContactDate",
    "notes"
  ]) {
    assert.throws(
      () =>
        parseContactImportConfirmBody({
          rows: [{ ...validRow, retirementLead: { ...allowed, [field]: "forged" } }]
        }),
      ContactImportConfirmRequestError
    );
  }
});

test("servidor recalcula status, errors, rowNumber, CPF e telefone", () => {
  const valid = validateAndCanonicalizeContactImportRow(validRow, 2);
  assert.equal(valid.status, "VALID");
  assert.equal(valid.rowNumber, 2);
  assert.equal(valid.cpf, "12345678900");
  assert.equal(valid.whatsapp, "5533999999999");

  const invalid = validateAndCanonicalizeContactImportRow(
    { name: "", cpf: "invalid", phone: "1" },
    3
  );
  assert.equal(invalid.status, "INVALID");
  assert.equal(invalid.rowNumber, 3);
  assert.ok(invalid.errors.length >= 3);
});

test("linha invalida em direct confirm gera zero writes funcionais", async () => {
  const mutations: string[] = [];
  const tx = {
    contact: {
      create: async () => mutations.push("Contact.create"),
      update: async () => mutations.push("Contact.update")
    },
    contactActivity: {
      create: async () => mutations.push("ContactActivity.create")
    },
    retirementLead: {
      upsert: async () => mutations.push("RetirementLead.upsert")
    },
    retirementLeadEvent: {
      create: async () => mutations.push("RetirementLeadEvent.create")
    }
  };
  const db = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
  };

  const result = await confirmContactImport({
    companyId: "company-a",
    userId: "user-admin",
    rows: [{ name: "", cpf: "invalid", phone: "1" }],
    db: db as never
  });

  assert.equal(result.summary.invalid, 1);
  assert.deepEqual(mutations, []);
});

test("lookup e create do confirm permanecem tenant-scoped pela sessao", async () => {
  const scopedCompanyIds: string[] = [];
  let createdData: Record<string, unknown> | null = null;
  const contact = {
    findMany: async ({ where }: { where: { companyId: string } }) => {
      scopedCompanyIds.push(where.companyId);
      return [];
    },
    findFirst: async ({ where }: { where: { companyId: string } }) => {
      scopedCompanyIds.push(where.companyId);
      return null;
    },
    findUnique: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      createdData = data;
      return { id: "contact-new" };
    }
  };
  const tx = {
    contact,
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      assert.equal(values[0], "company-a");
      return [];
    },
    contactActivity: { create: async () => ({ id: "activity-new" }) }
  };
  const db = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
  };

  await confirmContactImport({
    companyId: "company-a",
    userId: "user-admin",
    rows: [validRow],
    db: db as never
  });

  assert.ok(scopedCompanyIds.length > 0);
  assert.ok(scopedCompanyIds.every((companyId) => companyId === "company-a"));
  assert.ok(createdData);
  assert.equal((createdData as Record<string, unknown>).companyId, "company-a");
  assert.equal((createdData as Record<string, unknown>).ownerId, "user-admin");
});

test("Content-Length acima do limite retorna 413 antes da leitura", async () => {
  let bodyReads = 0;
  const request = {
    headers: new Headers({ "content-length": "65" }),
    get body() {
      bodyReads += 1;
      return null;
    }
  } as unknown as NextRequest;

  await assert.rejects(readLimitedJsonBody(request, 64), (error: unknown) => {
    assert.ok(error instanceof ContactImportConfirmRequestError);
    assert.equal(error.status, 413);
    return true;
  });
  assert.equal(bodyReads, 0);
});

test("sem Content-Length bytes reais continuam limitados", async () => {
  const request = jsonRequest({ rows: [validRow] });
  await assert.rejects(readLimitedJsonBody(request, 16), ContactImportConfirmRequestError);
});

test("Content-Length falsamente baixo nao ignora bytes reais", async () => {
  const request = jsonRequest({ rows: [validRow] }, { "content-length": "1" });
  await assert.rejects(readLimitedJsonBody(request, 16), (error: unknown) => {
    assert.ok(error instanceof ContactImportConfirmRequestError);
    assert.equal(error.status, 413);
    return true;
  });
});

test("5000 rows sao aceitas e 5001 sao rejeitadas antes da transaction", () => {
  const rows = Array.from({ length: CONTACT_IMPORT_MAX_ROWS }, () => validRow);
  assert.equal(parseContactImportConfirmBody({ rows }).rows.length, CONTACT_IMPORT_MAX_ROWS);
  assert.throws(
    () => parseContactImportConfirmBody({ rows: [...rows, validRow] }),
    (error: unknown) => {
      assert.ok(error instanceof ContactImportConfirmRequestError);
      assert.equal(error.status, 413);
      return true;
    }
  );
});

test("strings acima do limite sao rejeitadas", () => {
  assert.throws(
    () =>
      parseContactImportConfirmBody({
        rows: [{ ...validRow, name: "x".repeat(CONTACT_IMPORT_MAX_FIELD_LENGTH + 1) }]
      }),
    ContactImportConfirmRequestError
  );
});

test("JSON malformado retorna erro 400 sanitizado", async () => {
  const request = new NextRequest("http://localhost/api/imports/contacts/confirm", {
    method: "POST",
    body: "{not-json"
  });
  const response = await handleContactImportConfirm(request, routeDependencies());
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "CONTACT_IMPORT_INVALID_PAYLOAD");
  assert.doesNotMatch(JSON.stringify(body), /stack|SyntaxError|not-json/i);
});

test("falha em write intermediario propaga erro da transaction", async () => {
  const calls: string[] = [];
  const contact = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    create: async () => {
      calls.push("Contact.create");
      return { id: "contact-new" };
    }
  };
  const tx = {
    contact,
    $queryRaw: async () => [],
    contactActivity: {
      create: async () => {
        calls.push("ContactActivity.create");
        throw new Error("simulated write failure");
      }
    }
  };
  const db = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
  };

  await assert.rejects(
    confirmContactImport({
      companyId: "company-a",
      userId: "user-admin",
      rows: [validRow],
      db: db as never
    }),
    /simulated write failure/
  );
  assert.deepEqual(calls, ["Contact.create", "ContactActivity.create"]);
});
