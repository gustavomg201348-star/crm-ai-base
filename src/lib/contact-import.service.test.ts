import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTACT_IMPORT_IDENTITY_CONFLICT_MESSAGE,
  findExistingContactIndexes,
  findFirstContactImportIdentityConflict,
  resolveContactImportIdentityForRow,
  type ExistingImportContactIndexes,
  type ImportPreviewRow
} from "./contact-import.service";

function buildIndexes({
  byCpf = [],
  byPhone = [],
  ambiguousPhones = []
}: {
  byCpf?: Array<[string, string]>;
  byPhone?: Array<[string, string]>;
  ambiguousPhones?: string[];
}): ExistingImportContactIndexes {
  return {
    byCpf: new Map(byCpf),
    byPhone: new Map(byPhone),
    ambiguousPhones: new Set(ambiguousPhones)
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

function buildContactLookupDb({
  byCpf = [],
  byNormalizedPhone = [],
  byLegacyEquivalentPhone = []
}: {
  byCpf?: Array<[string, { id: string; name?: string; phone?: string }]>;
  byNormalizedPhone?: Array<[string, { id: string; name?: string; phone?: string }]>;
  byLegacyEquivalentPhone?: Array<[string, { id: string; name?: string; phone?: string }]>;
}) {
  const cpfContacts = new Map(byCpf);
  const normalizedPhoneContacts = byNormalizedPhone;
  const legacyEquivalentContacts = byLegacyEquivalentPhone;
  const contactsById = new Map<string, { id: string; name: string; phone: string }>();

  for (const contact of [
    ...Array.from(cpfContacts.values()),
    ...normalizedPhoneContacts.map(([, contact]) => contact),
    ...legacyEquivalentContacts.map(([, contact]) => contact)
  ]) {
    contactsById.set(contact.id, {
      id: contact.id,
      name: contact.name ?? "Cliente Teste",
      phone: contact.phone ?? ""
    });
  }

  return {
    contact: {
      findFirst({ where }: { where: { normalizedPhone?: string } }) {
        if (!where.normalizedPhone) return null;
        const contact = normalizedPhoneContacts.find(
          ([normalizedPhone]) => normalizedPhone === where.normalizedPhone
        )?.[1];
        return contact
          ? {
              id: contact.id,
              name: contact.name ?? "Cliente Teste",
              phone: contact.phone ?? where.normalizedPhone
            }
          : null;
      },
      findMany({
        where,
        select
      }: {
        where: { normalizedPhone?: string; cpf?: { in: string[] } };
        select: Record<string, boolean>;
      }) {
        if (where.cpf?.in) {
          return where.cpf.in
            .map((cpf) => {
              const contact = cpfContacts.get(cpf);
              if (!contact) return null;
              return {
                ...(select.id ? { id: contact.id } : {}),
                ...(select.cpf ? { cpf } : {})
              };
            })
            .filter(Boolean);
        }
        if (!where.normalizedPhone) return [];
        return normalizedPhoneContacts
          .filter(([normalizedPhone]) => normalizedPhone === where.normalizedPhone)
          .map(([, contact]) => ({
            ...(select.id ? { id: contact.id } : {}),
            ...(select.normalizedPhone ? { normalizedPhone: where.normalizedPhone } : {})
          }));
      },
      findUnique({ where }: { where: { id: string } }) {
        return contactsById.get(where.id) ?? null;
      }
    },
    $queryRaw(_strings: TemplateStringsArray, ...values: unknown[]) {
      const phoneValues = values.filter(
        (value): value is string => typeof value === "string" && /^\d{10,13}$/.test(value)
      );
      const contacts = legacyEquivalentContacts
        .filter(([phone]) => phoneValues.includes(phone))
        .map(([, contact]) => ({ id: contact.id }));
      return contacts;
    }
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

test("resolve contato legado sem normalizedPhone usando equivalencia canonica do CRM", async () => {
  const db = buildContactLookupDb({
    byLegacyEquivalentPhone: [
      [
        "73981208676",
        { id: "contact-legacy", phone: "73981208676" }
      ]
    ]
  });

  const indexes = await findExistingContactIndexes(db as never, "company-1", [
    buildRow({ whatsapp: "5573981208676" })
  ]);

  const result = resolveContactImportIdentityForRow(
    buildRow({ whatsapp: "5573981208676" }),
    indexes
  );

  assert.deepEqual(result, {
    existingContactId: "contact-legacy",
    conflictReason: null
  });
});

test("resolve telefone sem 55 quando contato possui normalizedPhone canonico", async () => {
  const db = buildContactLookupDb({
    byNormalizedPhone: [
      [
        "5573981208676",
        { id: "contact-normalized", phone: "73981208676" }
      ]
    ]
  });

  const indexes = await findExistingContactIndexes(db as never, "company-1", [
    buildRow({ whatsapp: "5573981208676" })
  ]);

  assert.deepEqual(
    resolveContactImportIdentityForRow(
      buildRow({ whatsapp: "5573981208676" }),
      indexes
    ),
    {
      existingContactId: "contact-normalized",
      conflictReason: null
    }
  );
});

test("detecta conflito quando CPF aponta para A e telefone legado aponta para B", async () => {
  const db = buildContactLookupDb({
    byCpf: [["11111111111", { id: "contact-a", phone: "5511999999999" }]],
    byLegacyEquivalentPhone: [
      [
        "73981208676",
        { id: "contact-b", phone: "73981208676" }
      ]
    ]
  });

  const row = buildRow({ cpf: "11111111111", whatsapp: "5573981208676" });
  const indexes = await findExistingContactIndexes(db as never, "company-1", [row]);

  assert.deepEqual(resolveContactImportIdentityForRow(row, indexes), {
    existingContactId: null,
    conflictReason: CONTACT_IMPORT_IDENTITY_CONFLICT_MESSAGE
  });
});

test("resolve candidato 8 para 9 quando o match alternativo e unico", async () => {
  const db = buildContactLookupDb({
    byNormalizedPhone: [
      [
        "5573981208676",
        { id: "contact-nine-digit", phone: "5573981208676" }
      ]
    ],
    byLegacyEquivalentPhone: [
      [
        "73981208676",
        { id: "contact-nine-digit", phone: "73981208676" }
      ]
    ]
  });

  const row = buildRow({ whatsapp: "557381208676" });
  const indexes = await findExistingContactIndexes(db as never, "company-1", [row]);

  assert.deepEqual(resolveContactImportIdentityForRow(row, indexes), {
    existingContactId: "contact-nine-digit",
    conflictReason: null
  });
});

test("match exato vence mesmo quando existe candidato alternativo", async () => {
  const db = buildContactLookupDb({
    byNormalizedPhone: [
      ["557381208676", { id: "contact-exact", phone: "557381208676" }],
      ["5573981208676", { id: "contact-alternate", phone: "5573981208676" }]
    ]
  });

  const row = buildRow({ whatsapp: "557381208676" });
  const indexes = await findExistingContactIndexes(db as never, "company-1", [row]);

  assert.deepEqual(resolveContactImportIdentityForRow(row, indexes), {
    existingContactId: "contact-exact",
    conflictReason: null
  });
});

test("nao escolhe silenciosamente candidato alternativo ambiguo", async () => {
  const db = buildContactLookupDb({
    byNormalizedPhone: [
      ["5573981208676", { id: "contact-normalized", phone: "5573981208676" }]
    ],
    byLegacyEquivalentPhone: [
      ["73981208676", { id: "contact-legacy", phone: "73981208676" }]
    ]
  });

  const row = buildRow({ whatsapp: "557381208676" });
  const indexes = await findExistingContactIndexes(db as never, "company-1", [row]);

  assert.deepEqual(resolveContactImportIdentityForRow(row, indexes), {
    existingContactId: null,
    conflictReason: "CPF e telefone pertencem a contatos diferentes."
  });
});
