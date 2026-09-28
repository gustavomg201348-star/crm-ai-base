import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse, type NextRequest } from "next/server";
import { handleContactImportPreview } from "./contact-import-preview-handler";
import { buildContactImportPreview } from "./contact-import.service";
import {
  CONTACT_IMPORT_MAX_FILE_BYTES,
  CONTACT_IMPORT_MAX_REQUEST_BYTES,
  parseContactImportSpreadsheet
} from "./contact-import-upload";

const adminSession = {
  id: "user-admin",
  companyId: "company-a",
  name: "Admin Teste",
  email: "admin@example.invalid",
  role: "ADMIN" as const
};

function fakeRequest({
  contentLength,
  formData
}: {
  contentLength?: number;
  formData?: () => Promise<FormData>;
} = {}) {
  return {
    headers: new Headers(
      contentLength === undefined ? {} : { "content-length": String(contentLength) }
    ),
    formData: formData ?? (async () => new FormData())
  } as NextRequest;
}

function routeDependencies(overrides: Record<string, unknown> = {}) {
  return {
    getSession: async () => ({ session: adminSession, response: null }),
    requireAdmin: () => null,
    enforceLimits: async () => null,
    buildPreview: async () => ({
      headers: [],
      columns: [],
      rows: [],
      summary: {
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        duplicateCpfs: 0,
        duplicatePhones: 0,
        existingContacts: 0
      }
    }),
    ...overrides
  } as Parameters<typeof handleContactImportPreview>[1];
}

test("preview exige sessao antes de rate limit e parsing", async () => {
  let limiterCalls = 0;
  let parserCalls = 0;
  const response = await handleContactImportPreview(
    fakeRequest(),
    routeDependencies({
      getSession: async () => ({
        session: null,
        response: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
      }),
      enforceLimits: async () => {
        limiterCalls += 1;
        return null;
      },
      buildPreview: async () => {
        parserCalls += 1;
        throw new Error("unexpected parser call");
      }
    })
  );

  assert.equal(response.status, 401);
  assert.equal(limiterCalls, 0);
  assert.equal(parserCalls, 0);
});

test("preview preserva role ADMIN", async () => {
  let limiterCalls = 0;
  const response = await handleContactImportPreview(
    fakeRequest(),
    routeDependencies({
      getSession: async () => ({
        session: { ...adminSession, role: "AGENT" as const },
        response: null
      }),
      requireAdmin: () => NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }),
      enforceLimits: async () => {
        limiterCalls += 1;
        return null;
      }
    })
  );

  assert.equal(response.status, 403);
  assert.equal(limiterCalls, 0);
});

test("rate limit bloqueia antes de formData e parser", async () => {
  let formDataCalls = 0;
  let parserCalls = 0;
  const response = await handleContactImportPreview(
    fakeRequest({
      formData: async () => {
        formDataCalls += 1;
        return new FormData();
      }
    }),
    routeDependencies({
      enforceLimits: async (rules: Array<{ category: string; identifiers: readonly string[] }>) => {
        assert.deepEqual(
          rules.map((rule) => rule.category),
          ["contact-import-preview-user", "contact-import-preview-ip"]
        );
        assert.deepEqual(rules[0].identifiers, ["company-a", "user-admin"]);
        return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
      },
      buildPreview: async () => {
        parserCalls += 1;
        throw new Error("unexpected parser call");
      }
    })
  );

  assert.equal(response.status, 429);
  assert.equal(formDataCalls, 0);
  assert.equal(parserCalls, 0);
});

test("Content-Length excessivo retorna 413 antes de formData e parser", async () => {
  let formDataCalls = 0;
  let parserCalls = 0;
  const response = await handleContactImportPreview(
    fakeRequest({
      contentLength: CONTACT_IMPORT_MAX_REQUEST_BYTES + 1,
      formData: async () => {
        formDataCalls += 1;
        return new FormData();
      }
    }),
    routeDependencies({
      buildPreview: async () => {
        parserCalls += 1;
        throw new Error("unexpected parser call");
      }
    })
  );

  assert.equal(response.status, 413);
  assert.equal(formDataCalls, 0);
  assert.equal(parserCalls, 0);
  const body = await response.json();
  assert.deepEqual(body, {
    error: "CONTACT_IMPORT_FILE_TOO_LARGE",
    message: "O arquivo excede o tamanho máximo permitido."
  });
});

async function expectOversizedCsvResponse(contentLength?: number) {
  const formData = new FormData();
  formData.set(
    "file",
    new File([new Uint8Array(CONTACT_IMPORT_MAX_FILE_BYTES + 1)], "grande.csv", {
      type: "text/csv"
    })
  );
  const response = await handleContactImportPreview(
    fakeRequest({ contentLength, formData: async () => formData }),
    routeDependencies({
      buildPreview: async ({ file }: { file: File }) => {
        await parseContactImportSpreadsheet(file);
        throw new Error("unexpected successful CSV parse");
      }
    })
  );
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: "CONTACT_IMPORT_FILE_TOO_LARGE",
    message: "O arquivo excede o tamanho máximo permitido."
  });
}

test("CSV sem Content-Length continua protegido por File.size", async () => {
  await expectOversizedCsvResponse();
});

test("Content-Length falsamente menor nao ignora limite real do CSV", async () => {
  await expectOversizedCsvResponse(1);
});

test("preview passa somente companyId da sessao ao parser", async () => {
  const formData = new FormData();
  formData.set("file", new File(["CPF,Nome,Telefone\n1,Teste,2"], "contatos.csv", { type: "text/csv" }));
  let receivedCompanyId: string | null = null;
  const response = await handleContactImportPreview(
    fakeRequest({ formData: async () => formData }),
    routeDependencies({
      buildPreview: async ({ companyId }: { companyId: string }) => {
        receivedCompanyId = companyId;
        return {
          headers: [],
          columns: [],
          rows: [],
          summary: {
            totalRows: 0,
            validRows: 0,
            invalidRows: 0,
            duplicateCpfs: 0,
            duplicatePhones: 0,
            existingContacts: 0
          }
        };
      }
    })
  );

  assert.equal(response.status, 200);
  assert.equal(receivedCompanyId, "company-a");
});

test("preview nao executa mutations funcionais e mantem leituras tenant-scoped", async () => {
  const mutationCalls: string[] = [];
  const readCompanyIds: string[] = [];
  const forbiddenMutation = (name: string) => async () => {
    mutationCalls.push(name);
    throw new Error(`unexpected mutation: ${name}`);
  };
  const db = {
    contact: {
      findMany: async ({ where }: { where: { companyId: string } }) => {
        readCompanyIds.push(where.companyId);
        return [];
      },
      findFirst: async ({ where }: { where: { companyId: string } }) => {
        readCompanyIds.push(where.companyId);
        return null;
      },
      findUnique: async () => null,
      create: forbiddenMutation("Contact.create"),
      update: forbiddenMutation("Contact.update"),
      updateMany: forbiddenMutation("Contact.updateMany"),
      upsert: forbiddenMutation("Contact.upsert"),
      delete: forbiddenMutation("Contact.delete"),
      deleteMany: forbiddenMutation("Contact.deleteMany")
    },
    $queryRaw: async () => [],
    $executeRaw: forbiddenMutation("$executeRaw"),
    $executeRawUnsafe: forbiddenMutation("$executeRawUnsafe")
  };
  const csv = new File(
    [
      "CPF,Nome,Telefone,Data Concessao,Beneficio,Cidade,Estado\n" +
        "12345678900,Cliente Teste,5533999999999,01/01/2026,Aposentadoria,Cidade Teste,MG"
    ],
    "contatos.csv",
    { type: "text/csv" }
  );

  await buildContactImportPreview({
    companyId: "company-a",
    file: csv,
    db: db as never
  });

  assert.deepEqual(mutationCalls, []);
  assert.ok(readCompanyIds.length > 0);
  assert.ok(readCompanyIds.every((companyId) => companyId === "company-a"));
});
