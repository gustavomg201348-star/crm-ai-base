import type { Prisma, PrismaClient } from "@prisma/client";
import { createActivity } from "@/lib/activities";
import {
  findContactPhoneIdentityMatch,
  getAutomaticContactNameUpdate,
  logContactNameMutationAttempt
} from "@/lib/contacts";
import { prisma } from "@/lib/db";
import { classifyPhoneNormalization, type PhoneNormalizationReason } from "@/lib/phone-normalization.service";
import { upsertRetirementLeadForContact } from "@/lib/retirement-leads";
import {
  CONTACT_IMPORT_MAX_DATA_ROWS,
  parseContactImportSpreadsheet
} from "@/lib/contact-import-upload";
import {
  buildSpreadsheetImportColumns,
  buildSpreadsheetRawValues,
  SPREADSHEET_IMPORT_MAX_CELL_LENGTH,
  SPREADSHEET_IMPORT_MAX_HEADER_LENGTH,
  sanitizeSpreadsheetCellText,
  type SpreadsheetImportColumn,
  type SpreadsheetImportRawValues
} from "@/lib/spreadsheet-import-columns";

type DbClient = PrismaClient | Prisma.TransactionClient;

export const CONTACT_IMPORT_IDENTITY_CONFLICT_MESSAGE =
  "CPF e telefone pertencem a contatos diferentes.";

const HEADER_ALIASES = {
  cpf: ["cpf", "documento", "doc", "documento cpf", "cpf cliente"],
  name: ["nome", "cliente", "nome cliente", "nome completo"],
  phone: ["telefone", "celular", "whatsapp", "fone", "numero", "número"],
  grantDate: ["data concessao", "data de concessao", "concessao", "grant date"],
  benefitType: ["beneficio", "tipo beneficio", "tipo de beneficio", "benefit type"],
  city: ["cidade", "municipio"],
  state: ["estado", "uf"]
} as const;

export type ImportPreviewRow = {
  rowNumber: number;
  name: string;
  cpf: string;
  phone: string;
  whatsapp: string;
  rawValues?: SpreadsheetImportRawValues;
  status: "VALID" | "INVALID";
  errors: string[];
  duplicateCpf: boolean;
  duplicatePhone: boolean;
  existingContactId?: string | null;
  retirementLead?: {
    grantDate?: string | null;
    benefitType?: string | null;
    city?: string | null;
    state?: string | null;
  };
};

export const CONTACT_IMPORT_MAX_ROWS = CONTACT_IMPORT_MAX_DATA_ROWS;
export const CONTACT_IMPORT_MAX_FIELD_LENGTH = SPREADSHEET_IMPORT_MAX_CELL_LENGTH;

export type ContactImportRetirementLeadInput = {
  grantDate?: string | null;
  benefitType?: string | null;
  city?: string | null;
  state?: string | null;
};

export type ContactImportConfirmRowInput = {
  name: string;
  cpf: string;
  phone: string;
  retirementLead?: ContactImportRetirementLeadInput;
};

export type ContactImportPreview = {
  headers: string[];
  columns: SpreadsheetImportColumn[];
  rows: ImportPreviewRow[];
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateCpfs: number;
    duplicatePhones: number;
    existingContacts: number;
  };
};

export type ContactImportConfirmResult = {
  summary: {
    totalRows: number;
    imported: number;
    created: number;
    updated: number;
    invalid: number;
  };
  contactIds: string[];
  rows: Array<{
    rowNumber: number;
    contactId: string;
    phone: string;
  }>;
  errors: Array<{ rowNumber: number; reason: string }>;
};

export class ContactImportConflictError extends Error {
  readonly code = "CONTACT_IMPORT_IDENTITY_CONFLICT";
  readonly rowNumber: number;

  constructor(rowNumber: number, reason = CONTACT_IMPORT_IDENTITY_CONFLICT_MESSAGE) {
    super(`Linha ${rowNumber}: ${reason}`);
    this.name = "ContactImportConflictError";
    this.rowNumber = rowNumber;
  }
}

export type ExistingImportContactIndexes = {
  byCpf: Map<string, string>;
  byPhone: Map<string, string>;
  ambiguousPhones: Set<string>;
};

function normalizeHeader(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function onlyDigits(value: string) {
  return String(value ?? "").replace(/\D/g, "");
}

function findHeaderIndex(headers: string[], aliases: readonly string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headers.findIndex((header) => normalizedAliases.includes(header));
}

function getPhoneImportError(reason: PhoneNormalizationReason) {
  if (reason === "EMPTY") return "Telefone obrigatorio.";
  if (reason === "TOO_SHORT") return "Telefone deve conter DDD e numero valido para WhatsApp.";
  if (reason === "TOO_LONG") return "Telefone possui digitos demais para um numero WhatsApp valido.";
  if (reason === "INTERNATIONAL_UNSUPPORTED") {
    return "Telefone internacional ainda nao e suportado na importacao.";
  }
  return "Telefone deve conter DDD e numero valido para WhatsApp.";
}

function parseImportDate(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const brazilian = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (brazilian) {
    const day = brazilian[1].padStart(2, "0");
    const month = brazilian[2].padStart(2, "0");
    const year = brazilian[3].length === 2 ? `20${brazilian[3]}` : brazilian[3];
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString().slice(0, 10);
}

export function validateAndCanonicalizeContactImportRow(
  raw: ContactImportConfirmRowInput,
  rowNumber: number,
  rawValues?: SpreadsheetImportRawValues
): ImportPreviewRow {
  const name = raw.name.trim();
  const cpf = onlyDigits(raw.cpf);
  const phone = onlyDigits(raw.phone);
  const phoneClassification = classifyPhoneNormalization(phone);
  const whatsapp = phoneClassification.normalizedPhone ?? "";
  const grantDate = parseImportDate(raw.retirementLead?.grantDate ?? "");
  const benefitType = raw.retirementLead?.benefitType?.trim() ?? "";
  const city = raw.retirementLead?.city?.trim() ?? "";
  const state = raw.retirementLead?.state?.trim() ?? "";
  const errors: string[] = [];

  if (!name) errors.push("Nome obrigatorio.");
  if (!/^\d{11}$/.test(cpf)) errors.push("CPF deve conter 11 digitos.");
  if (!phoneClassification.valid) {
    errors.push(getPhoneImportError(phoneClassification.reason));
  }
  if (grantDate && Number.isNaN(new Date(grantDate).getTime())) {
    errors.push("Data Concessao invalida.");
  }

  return {
    rowNumber,
    name,
    cpf,
    phone,
    whatsapp,
    ...(rawValues ? { rawValues } : {}),
    status: errors.length ? "INVALID" : "VALID",
    errors,
    duplicateCpf: false,
    duplicatePhone: false,
    existingContactId: null,
    retirementLead:
      grantDate || benefitType || city || state
        ? { grantDate: grantDate || null, benefitType, city, state }
        : undefined
  };
}

export function renderCampaignMessage(
  template: string,
  contact: { name: string; cpf?: string | null; phone: string }
) {
  return template
    .replace(/\{\{\s*nome\s*\}\}/gi, contact.name)
    .replace(/\{\{\s*cpf\s*\}\}/gi, contact.cpf ?? "")
    .replace(/\{\{\s*telefone\s*\}\}/gi, contact.phone);
}

export async function findExistingContactIndexes(
  db: DbClient,
  companyId: string,
  rows: ImportPreviewRow[]
): Promise<ExistingImportContactIndexes> {
  const cpfs = rows.map((row) => row.cpf).filter(Boolean);
  const phones = Array.from(new Set(rows.map((row) => row.whatsapp).filter(Boolean)));

  const indexes: ExistingImportContactIndexes = {
    byCpf: new Map(),
    byPhone: new Map(),
    ambiguousPhones: new Set()
  };

  if (!cpfs.length && !phones.length) return indexes;

  const contactsByCpf = cpfs.length
    ? await db.contact.findMany({
        where: {
          companyId,
          cpf: { in: cpfs }
        },
        select: { id: true, cpf: true }
      })
    : [];
  contactsByCpf.forEach((contact) => {
    if (contact.cpf) indexes.byCpf.set(contact.cpf, contact.id);
  });

  for (const phone of phones) {
    const phoneIdentity = await findContactPhoneIdentityMatch(db, {
      companyId,
      phone,
      archived: true,
      source: "contact-import-preview",
      allowBrazilianWhatsappAlternate: true
    });
    if (phoneIdentity.contact) {
      indexes.byPhone.set(phone, phoneIdentity.contact.id);
    }
    if (phoneIdentity.matchType === "ambiguous") {
      indexes.ambiguousPhones.add(phone);
    }
  }

  return indexes;
}

export function resolveContactImportIdentityForRow(
  row: Pick<ImportPreviewRow, "cpf" | "whatsapp">,
  indexes: ExistingImportContactIndexes
) {
  const cpfContactId = row.cpf ? indexes.byCpf.get(row.cpf) ?? null : null;
  const phoneContactId = row.whatsapp
    ? indexes.byPhone.get(row.whatsapp) ?? null
    : null;

  if (row.whatsapp && indexes.ambiguousPhones.has(row.whatsapp)) {
    return {
      existingContactId: null,
      conflictReason: CONTACT_IMPORT_IDENTITY_CONFLICT_MESSAGE
    };
  }

  if (cpfContactId && phoneContactId && cpfContactId !== phoneContactId) {
    return {
      existingContactId: null,
      conflictReason: CONTACT_IMPORT_IDENTITY_CONFLICT_MESSAGE
    };
  }

  return {
    existingContactId: cpfContactId ?? phoneContactId,
    conflictReason: null
  };
}

export function findFirstContactImportIdentityConflict(
  rows: Array<Pick<ImportPreviewRow, "rowNumber" | "cpf" | "whatsapp">>,
  indexes: ExistingImportContactIndexes
) {
  for (const row of rows) {
    const identity = resolveContactImportIdentityForRow(row, indexes);
    if (identity.conflictReason) {
      return {
        rowNumber: row.rowNumber,
        reason: identity.conflictReason
      };
    }
  }

  return null;
}

export async function buildContactImportPreview({
  companyId,
  file,
  db = prisma
}: {
  companyId: string;
  file: File;
  db?: DbClient;
}): Promise<ContactImportPreview> {
  const table = await parseContactImportSpreadsheet(file);
  if (table.length < 2) {
    throw new Error("A planilha precisa ter cabecalho e pelo menos uma linha.");
  }

  const originalHeaders = table[0].map((header) =>
    sanitizeSpreadsheetCellText(header, SPREADSHEET_IMPORT_MAX_HEADER_LENGTH)
  );
  const columns = buildSpreadsheetImportColumns(originalHeaders);
  const headers = columns.map((column) => column.normalized);
  const indexes = {
    cpf: findHeaderIndex(headers, HEADER_ALIASES.cpf),
    name: findHeaderIndex(headers, HEADER_ALIASES.name),
    phone: findHeaderIndex(headers, HEADER_ALIASES.phone),
    grantDate: findHeaderIndex(headers, HEADER_ALIASES.grantDate),
    benefitType: findHeaderIndex(headers, HEADER_ALIASES.benefitType),
    city: findHeaderIndex(headers, HEADER_ALIASES.city),
    state: findHeaderIndex(headers, HEADER_ALIASES.state)
  };

  const missing = Object.entries(indexes)
    .filter(([, index]) => index < 0)
    .map(([key]) => (key === "name" ? "Nome" : key === "phone" ? "Telefone" : "CPF"));

  if (missing.length) {
    throw new Error(`Colunas obrigatorias nao encontradas: ${missing.join(", ")}.`);
  }

  const cpfCounts = new Map<string, number>();
  const phoneCounts = new Map<string, number>();

  const rows: ImportPreviewRow[] = table.slice(1).map((line, index) =>
    validateAndCanonicalizeContactImportRow(
      {
        name: String(line[indexes.name] ?? ""),
        cpf: String(line[indexes.cpf] ?? ""),
        phone: String(line[indexes.phone] ?? ""),
        retirementLead: {
          grantDate:
            indexes.grantDate >= 0 ? String(line[indexes.grantDate] ?? "") : "",
          benefitType:
            indexes.benefitType >= 0 ? String(line[indexes.benefitType] ?? "") : "",
          city: indexes.city >= 0 ? String(line[indexes.city] ?? "") : "",
          state: indexes.state >= 0 ? String(line[indexes.state] ?? "") : ""
        }
      },
      index + 2,
      buildSpreadsheetRawValues(line, columns)
    )
  );

  rows.forEach((row) => {
    if (row.cpf) cpfCounts.set(row.cpf, (cpfCounts.get(row.cpf) ?? 0) + 1);
    if (row.whatsapp) {
      phoneCounts.set(row.whatsapp, (phoneCounts.get(row.whatsapp) ?? 0) + 1);
    }
  });

  rows.forEach((row) => {
    row.duplicateCpf = Boolean(row.cpf && (cpfCounts.get(row.cpf) ?? 0) > 1);
    row.duplicatePhone = Boolean(
      row.whatsapp && (phoneCounts.get(row.whatsapp) ?? 0) > 1
    );
  });

  const existingIndexes = await findExistingContactIndexes(db, companyId, rows);
  rows.forEach((row) => {
    const identity = resolveContactImportIdentityForRow(row, existingIndexes);
    row.existingContactId = identity.existingContactId;

    if (identity.conflictReason) {
      row.status = "INVALID";
      row.existingContactId = null;
      if (!row.errors.includes(identity.conflictReason)) {
        row.errors.push(identity.conflictReason);
      }
    }
  });

  return {
    headers: originalHeaders,
    columns,
    rows,
    summary: {
      totalRows: rows.length,
      validRows: rows.filter((row) => row.status === "VALID").length,
      invalidRows: rows.filter((row) => row.status === "INVALID").length,
      duplicateCpfs: rows.filter((row) => row.duplicateCpf).length,
      duplicatePhones: rows.filter((row) => row.duplicatePhone).length,
      existingContacts: rows.filter((row) => row.existingContactId).length
    }
  };
}

async function findContactForImport(
  db: DbClient,
  companyId: string,
  row: ImportPreviewRow
) {
  if (row.cpf) {
    const contactByCpf = await db.contact.findFirst({
      where: {
        companyId,
        cpf: row.cpf
      },
      select: { id: true, name: true, phone: true }
    });

    if (contactByCpf) return { ...contactByCpf, phoneIdentityMatchType: "exact" as const };
  }

  if (!row.whatsapp) return null;

  const contactByPhone = await findContactPhoneIdentityMatch(db, {
    companyId,
    phone: row.whatsapp,
    archived: true,
    source: "contact-import-confirm",
    allowBrazilianWhatsappAlternate: true
  });

  return contactByPhone.contact
    ? {
        id: contactByPhone.contact.id,
        name: contactByPhone.contact.name,
        phone: contactByPhone.contact.phone,
        phoneIdentityMatchType: contactByPhone.matchType
      }
    : null;
}

export async function confirmContactImport({
  companyId,
  userId,
  rows,
  db = prisma
}: {
  companyId: string;
  userId: string;
  rows: ContactImportConfirmRowInput[];
  db?: PrismaClient;
}): Promise<ContactImportConfirmResult> {
  const canonicalRows = rows.map((row, index) =>
    validateAndCanonicalizeContactImportRow(row, index + 2)
  );
  const validRows = canonicalRows.filter((row) => row.status === "VALID");
  const errors = canonicalRows
    .filter((row) => row.status !== "VALID")
    .map((row) => ({
      rowNumber: row.rowNumber,
      reason: row.errors.join(" ")
    }));

  const result = await db.$transaction(async (tx) => {
    const contactIds: string[] = [];
    const confirmedRows: ContactImportConfirmResult["rows"] = [];
    let created = 0;
    let updated = 0;
    const existingIndexes = await findExistingContactIndexes(tx, companyId, validRows);
    const identityConflict = findFirstContactImportIdentityConflict(
      validRows,
      existingIndexes
    );

    if (identityConflict) {
      throw new ContactImportConflictError(
        identityConflict.rowNumber,
        identityConflict.reason
      );
    }

    for (const row of validRows) {
      const existing = await findContactForImport(tx, companyId, row);
      if (existing) {
        const isAlternatePhoneIdentityMatch =
          existing.phoneIdentityMatchType === "alternate";
        const nameUpdate = isAlternatePhoneIdentityMatch
          ? null
          : getAutomaticContactNameUpdate({
              currentName: existing.name,
              incomingName: row.name,
              phone: existing.phone || row.whatsapp
            });
        logContactNameMutationAttempt({
          origin: "importacao",
          file: "src/lib/contact-import.service.ts",
          functionName: "confirmContactImport",
          contactId: existing.id,
          phone: existing.phone || row.whatsapp,
          oldName: existing.name,
          newName: nameUpdate?.nextName ?? row.name,
          reason: nameUpdate
            ? "contato sem nome real recebeu nome da planilha"
            : "nome da planilha bloqueado porque contato ja possui nome salvo",
          allowed: Boolean(nameUpdate)
        });
        const contact = isAlternatePhoneIdentityMatch
          ? { id: existing.id }
          : await tx.contact.update({
              where: { id: existing.id },
              data: {
                ...(nameUpdate ? { name: nameUpdate.nextName } : {}),
                cpf: row.cpf,
                phone: row.whatsapp,
                normalizedPhone: row.whatsapp
              },
              select: { id: true }
            });
        updated += 1;
        contactIds.push(contact.id);
        confirmedRows.push({
          rowNumber: row.rowNumber,
          contactId: contact.id,
          phone: row.whatsapp
        });

        await createActivity(tx, {
          contactId: contact.id,
          userId,
          type: "IMPORT_PLANILHA_UPDATED",
          title: "Contato atualizado por planilha",
          detail: `Linha ${row.rowNumber}: ${row.name}`
        });

        if (nameUpdate) {
          await createActivity(tx, {
            contactId: contact.id,
            userId,
            type: "CONTACT_NAME_AUTO_FILLED",
            title: "Nome preenchido automaticamente",
            detail: `Origem: importacao de planilha. Antes: ${nameUpdate.previousName ?? "(vazio)"}. Depois: ${nameUpdate.nextName}.`
          });
        }

        if (row.retirementLead?.grantDate) {
          await upsertRetirementLeadForContact({
            db: tx,
            companyId,
            contactId: contact.id,
            userId,
            data: row.retirementLead,
            eventDescription: `Linha ${row.rowNumber}: importado por planilha.`
          });
        }
      } else {
        const contact = await tx.contact.create({
          data: {
            companyId,
            ownerId: userId,
            name: row.name,
            cpf: row.cpf,
            phone: row.whatsapp,
            normalizedPhone: row.whatsapp,
            temperature: "WARM"
          },
          select: { id: true }
        });
        created += 1;
        contactIds.push(contact.id);
        confirmedRows.push({
          rowNumber: row.rowNumber,
          contactId: contact.id,
          phone: row.whatsapp
        });

        await createActivity(tx, {
          contactId: contact.id,
          userId,
          type: "IMPORT_PLANILHA_CREATED",
          title: "Contato criado por planilha",
          detail: `Linha ${row.rowNumber}: ${row.name}`
        });

        if (row.retirementLead?.grantDate) {
          await upsertRetirementLeadForContact({
            db: tx,
            companyId,
            contactId: contact.id,
            userId,
            data: row.retirementLead,
            eventDescription: `Linha ${row.rowNumber}: importado por planilha.`
          });
        }
      }
    }

    return {
      contactIds: Array.from(new Set(contactIds)),
      rows: confirmedRows,
      created,
      updated
    };
  });

  return {
    summary: {
      totalRows: canonicalRows.length,
      imported: result.contactIds.length,
      created: result.created,
      updated: result.updated,
      invalid: errors.length
    },
    contactIds: result.contactIds,
    rows: result.rows,
    errors
  };
}
