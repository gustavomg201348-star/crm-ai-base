import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTACT_IMPORT_IDENTITY_CONFLICT_MESSAGE,
  findFirstContactImportIdentityConflict,
  resolveContactImportIdentityForRow,
  type ExistingImportContactIndexes,
  type ImportPreviewRow
} from "./contact-import.service";

function buildIndexes({
  byCpf = [],
  byPhone = []
}: {
  byCpf?: Array<[string, string]>;
  byPhone?: Array<[string, string]>;
}): ExistingImportContactIndexes {
  return {
    byCpf: new Map(byCpf),
    byPhone: new Map(byPhone)
  };
}

function buildRow({
  rowNumber = 2,
  cpf = "",
  whatsapp = ""
}: {
  rowNumber?: number;
  cpf?: string;
  whatsapp?: string;
}): ImportPreviewRow {
  return {
    rowNumber,
    name: "Cliente Teste",
    cpf,
    phone: whatsapp,
    whatsapp,
    status: "VALID",
    errors: [],
    duplicateCpf: false,
    duplicatePhone: false,
    existingContactId: null
  };
}

test("permite update quando CPF e telefone pertencem ao mesmo contato", () => {
  const indexes = buildIndexes({
    byCpf: [["11111111111", "contact-a"]],
    byPhone: [["5533999999999", "contact-a"]]
  });

  const result = resolveContactImportIdentityForRow(
    buildRow({ cpf: "11111111111", whatsapp: "5533999999999" }),
    indexes
  );

  assert.deepEqual(result, {
    existingContactId: "contact-a",
    conflictReason: null
  });
});

test("marca conflito quando CPF encontra A e telefone pertence a B", () => {
  const indexes = buildIndexes({
    byCpf: [["11111111111", "contact-a"]],
    byPhone: [["5533999999999", "contact-b"]]
  });

  const result = resolveContactImportIdentityForRow(
    buildRow({ cpf: "11111111111", whatsapp: "5533999999999" }),
    indexes
  );

  assert.deepEqual(result, {
    existingContactId: null,
    conflictReason: CONTACT_IMPORT_IDENTITY_CONFLICT_MESSAGE
  });
});

test("marca conflito quando telefone encontra A e CPF pertence a B", () => {
  const indexes = buildIndexes({
    byCpf: [["22222222222", "contact-b"]],
    byPhone: [["5533888888888", "contact-a"]]
  });

  const conflict = findFirstContactImportIdentityConflict(
    [buildRow({ rowNumber: 4, cpf: "22222222222", whatsapp: "5533888888888" })],
    indexes
  );

  assert.deepEqual(conflict, {
    rowNumber: 4,
    reason: CONTACT_IMPORT_IDENTITY_CONFLICT_MESSAGE
  });
});

test("mantem update seguro quando apenas CPF existe", () => {
  const indexes = buildIndexes({
    byCpf: [["11111111111", "contact-a"]]
  });

  const result = resolveContactImportIdentityForRow(
    buildRow({ cpf: "11111111111", whatsapp: "5533999999999" }),
    indexes
  );

  assert.deepEqual(result, {
    existingContactId: "contact-a",
    conflictReason: null
  });
});

test("mantem update seguro quando apenas telefone existe", () => {
  const indexes = buildIndexes({
    byPhone: [["5533999999999", "contact-a"]]
  });

  const result = resolveContactImportIdentityForRow(
    buildRow({ cpf: "11111111111", whatsapp: "5533999999999" }),
    indexes
  );

  assert.deepEqual(result, {
    existingContactId: "contact-a",
    conflictReason: null
  });
});

test("preserva criacao quando CPF e telefone nao existem", () => {
  const result = resolveContactImportIdentityForRow(
    buildRow({ cpf: "11111111111", whatsapp: "5533999999999" }),
    buildIndexes({})
  );

  assert.deepEqual(result, {
    existingContactId: null,
    conflictReason: null
  });
});

test("retorna primeiro conflito para defesa do confirm burlando o preview", () => {
  const indexes = buildIndexes({
    byCpf: [["11111111111", "contact-a"]],
    byPhone: [["5533999999999", "contact-b"]]
  });

  const conflict = findFirstContactImportIdentityConflict(
    [
      buildRow({ rowNumber: 2, cpf: "00000000000", whatsapp: "5533777777777" }),
      buildRow({ rowNumber: 3, cpf: "11111111111", whatsapp: "5533999999999" })
    ],
    indexes
  );

  assert.deepEqual(conflict, {
    rowNumber: 3,
    reason: CONTACT_IMPORT_IDENTITY_CONFLICT_MESSAGE
  });
});
