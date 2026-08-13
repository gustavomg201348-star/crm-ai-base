import assert from "node:assert/strict";
import test from "node:test";
import {
  findContactByNormalizedPhone,
  findContactPhoneIdentityMatch
} from "./contacts";

type MockContact = {
  id: string;
  companyId: string;
  phone: string;
  normalizedPhone: string | null;
  archivedAt?: Date | null;
  updatedAt?: Date;
};

function buildContactLookupDb(contacts: MockContact[]) {
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));

  function isArchivedAllowed(where: { archivedAt?: null }, contact: MockContact) {
    return where.archivedAt === undefined || contact.archivedAt === null || contact.archivedAt === undefined;
  }

  return {
    contact: {
      findFirst({ where }: { where: { companyId: string; normalizedPhone?: string; archivedAt?: null } }) {
        return (
          contacts.find(
            (contact) =>
              contact.companyId === where.companyId &&
              contact.normalizedPhone === where.normalizedPhone &&
              isArchivedAllowed(where, contact)
          ) ?? null
        );
      },
      findMany({
        where,
        take
      }: {
        where: { companyId: string; normalizedPhone?: string; archivedAt?: null };
        take?: number;
      }) {
        return contacts
          .filter(
            (contact) =>
              contact.companyId === where.companyId &&
              contact.normalizedPhone === where.normalizedPhone &&
              isArchivedAllowed(where, contact)
          )
          .slice(0, take)
          .map((contact) => ({ id: contact.id }));
      },
      findUnique({ where }: { where: { id: string } }) {
        return contactsById.get(where.id) ?? null;
      }
    },
    $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const companyId = values.find(
        (value): value is string =>
          typeof value === "string" && value.startsWith("company-")
      );
      const phoneValues = values.filter(
        (value): value is string => typeof value === "string" && /^\d{10,13}$/.test(value)
      );

      if (!companyId) return [];

      return contacts
        .filter(
          (contact) =>
            contact.companyId === companyId &&
            phoneValues.includes(contact.phone.replace(/\D/g, ""))
        )
        .slice(0, strings.join("").includes("LIMIT 2") ? 2 : 1)
        .map((contact) => ({ id: contact.id }));
    }
  };
}

test("lookup generico 8 digitos nao encontra candidato 9 digitos", async () => {
  const db = buildContactLookupDb([
    {
      id: "contact-nine",
      companyId: "company-1",
      phone: "5573981208676",
      normalizedPhone: "5573981208676"
    }
  ]);

  const contact = await findContactByNormalizedPhone(db as never, {
    companyId: "company-1",
    phone: "557381208676"
  });

  assert.equal(contact, null);
});

test("lookup generico 9 digitos nao encontra candidato 8 digitos", async () => {
  const db = buildContactLookupDb([
    {
      id: "contact-eight",
      companyId: "company-1",
      phone: "557381208676",
      normalizedPhone: "557381208676"
    }
  ]);

  const contact = await findContactByNormalizedPhone(db as never, {
    companyId: "company-1",
    phone: "5573981208676"
  });

  assert.equal(contact, null);
});

test("lookup whatsapp opt-in 8 digitos encontra candidato 9 unico", async () => {
  const db = buildContactLookupDb([
    {
      id: "contact-nine",
      companyId: "company-1",
      phone: "5573981208676",
      normalizedPhone: "5573981208676"
    }
  ]);

  const result = await findContactPhoneIdentityMatch(db as never, {
    companyId: "company-1",
    phone: "557381208676",
    allowBrazilianWhatsappAlternate: true
  });

  assert.equal(result.contact?.id, "contact-nine");
  assert.equal(result.matchType, "alternate");
});

test("lookup whatsapp opt-in 9 digitos encontra candidato 8 unico", async () => {
  const db = buildContactLookupDb([
    {
      id: "contact-eight",
      companyId: "company-1",
      phone: "557381208676",
      normalizedPhone: "557381208676"
    }
  ]);

  const result = await findContactPhoneIdentityMatch(db as never, {
    companyId: "company-1",
    phone: "5573981208676",
    allowBrazilianWhatsappAlternate: true
  });

  assert.equal(result.contact?.id, "contact-eight");
  assert.equal(result.matchType, "alternate");
});

test("match exato vence sobre candidato alternativo", async () => {
  const db = buildContactLookupDb([
    {
      id: "contact-exact",
      companyId: "company-1",
      phone: "557381208676",
      normalizedPhone: "557381208676"
    },
    {
      id: "contact-alternate",
      companyId: "company-1",
      phone: "5573981208676",
      normalizedPhone: "5573981208676"
    }
  ]);

  const result = await findContactPhoneIdentityMatch(db as never, {
    companyId: "company-1",
    phone: "557381208676",
    allowBrazilianWhatsappAlternate: true
  });

  assert.equal(result.contact?.id, "contact-exact");
  assert.equal(result.matchType, "exact");
});

test("lookup alternativo nunca atravessa companyId", async () => {
  const db = buildContactLookupDb([
    {
      id: "contact-company-a",
      companyId: "company-a",
      phone: "5573981208676",
      normalizedPhone: "5573981208676"
    }
  ]);

  const result = await findContactPhoneIdentityMatch(db as never, {
    companyId: "company-b",
    phone: "557381208676",
    allowBrazilianWhatsappAlternate: true
  });

  assert.equal(result.contact, null);
  assert.equal(result.matchType, "none");
});

test("lookup alternativo ambiguo nao escolhe silenciosamente", async () => {
  const db = buildContactLookupDb([
    {
      id: "contact-normalized",
      companyId: "company-1",
      phone: "5573981208676",
      normalizedPhone: "5573981208676"
    },
    {
      id: "contact-legacy",
      companyId: "company-1",
      phone: "73981208676",
      normalizedPhone: null
    }
  ]);

  const result = await findContactPhoneIdentityMatch(db as never, {
    companyId: "company-1",
    phone: "557381208676",
    allowBrazilianWhatsappAlternate: true
  });

  assert.equal(result.contact, null);
  assert.equal(result.matchType, "ambiguous");
});
