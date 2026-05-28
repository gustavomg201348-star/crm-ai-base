import type { Prisma, PrismaClient } from "@prisma/client";
import { createActivity } from "@/lib/activities";
import { prisma } from "@/lib/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

const HEADER_ALIASES = {
  cpf: ["cpf", "documento", "doc", "documento cpf", "cpf cliente"],
  name: ["nome", "cliente", "nome cliente", "nome completo"],
  phone: ["telefone", "celular", "whatsapp", "fone", "numero", "número"]
} as const;

export type ImportPreviewRow = {
  rowNumber: number;
  name: string;
  cpf: string;
  phone: string;
  whatsapp: string;
  status: "VALID" | "INVALID";
  errors: string[];
  duplicateCpf: boolean;
  duplicatePhone: boolean;
  existingContactId?: string | null;
};

export type ContactImportPreview = {
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
  errors: Array<{ rowNumber: number; reason: string }>;
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

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if ((char === "," || char === ";") && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text: string) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  return lines.map(parseCsvLine);
}

async function parseSpreadsheet(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv" || file.type.includes("csv")) {
    return parseCsv(bytes.toString("utf8"));
  }

  if (extension === "xlsx" || file.type.includes("spreadsheetml")) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(bytes, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      defval: ""
    });
  }

  throw new Error("Arquivo deve ser CSV ou Excel .xlsx.");
}

function normalizePhone(rawPhone: string) {
  const digits = onlyDigits(rawPhone);
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function validatePhone(whatsapp: string) {
  return /^55\d{10,11}$/.test(whatsapp);
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

async function findExistingContacts(companyId: string, rows: ImportPreviewRow[]) {
  const cpfs = rows.map((row) => row.cpf).filter(Boolean);
  const phones = rows.map((row) => row.whatsapp).filter(Boolean);

  if (!cpfs.length && !phones.length) return new Map<string, string>();

  const contacts = await prisma.contact.findMany({
    where: {
      companyId,
      OR: [
        ...(cpfs.length ? [{ cpf: { in: cpfs } }] : []),
        ...(phones.length ? [{ phone: { in: phones } }] : [])
      ]
    },
    select: { id: true, cpf: true, phone: true }
  });

  const map = new Map<string, string>();
  contacts.forEach((contact) => {
    if (contact.cpf) map.set(`cpf:${contact.cpf}`, contact.id);
    if (contact.phone) map.set(`phone:${contact.phone}`, contact.id);
  });
  return map;
}

export async function buildContactImportPreview({
  companyId,
  file
}: {
  companyId: string;
  file: File;
}): Promise<ContactImportPreview> {
  const table = await parseSpreadsheet(file);
  if (table.length < 2) {
    throw new Error("A planilha precisa ter cabecalho e pelo menos uma linha.");
  }

  const headers = table[0].map((header) => normalizeHeader(String(header ?? "")));
  const indexes = {
    cpf: findHeaderIndex(headers, HEADER_ALIASES.cpf),
    name: findHeaderIndex(headers, HEADER_ALIASES.name),
    phone: findHeaderIndex(headers, HEADER_ALIASES.phone)
  };

  const missing = Object.entries(indexes)
    .filter(([, index]) => index < 0)
    .map(([key]) => (key === "name" ? "Nome" : key === "phone" ? "Telefone" : "CPF"));

  if (missing.length) {
    throw new Error(`Colunas obrigatorias nao encontradas: ${missing.join(", ")}.`);
  }

  const cpfCounts = new Map<string, number>();
  const phoneCounts = new Map<string, number>();

  const rows: ImportPreviewRow[] = table.slice(1).map((line, index) => {
    const name = String(line[indexes.name] ?? "").trim();
    const cpf = onlyDigits(String(line[indexes.cpf] ?? ""));
    const phone = onlyDigits(String(line[indexes.phone] ?? ""));
    const whatsapp = normalizePhone(phone);
    const errors: string[] = [];

    if (!name) errors.push("Nome obrigatorio.");
    if (!/^\d{11}$/.test(cpf)) errors.push("CPF deve conter 11 digitos.");
    if (!validatePhone(whatsapp)) {
      errors.push("Telefone deve conter DDD e numero valido para WhatsApp.");
    }

    if (cpf) cpfCounts.set(cpf, (cpfCounts.get(cpf) ?? 0) + 1);
    if (whatsapp) phoneCounts.set(whatsapp, (phoneCounts.get(whatsapp) ?? 0) + 1);

    return {
      rowNumber: index + 2,
      name,
      cpf,
      phone,
      whatsapp,
      status: errors.length ? "INVALID" : "VALID",
      errors,
      duplicateCpf: false,
      duplicatePhone: false,
      existingContactId: null
    };
  });

  rows.forEach((row) => {
    row.duplicateCpf = Boolean(row.cpf && (cpfCounts.get(row.cpf) ?? 0) > 1);
    row.duplicatePhone = Boolean(
      row.whatsapp && (phoneCounts.get(row.whatsapp) ?? 0) > 1
    );
  });

  const existingMap = await findExistingContacts(companyId, rows);
  rows.forEach((row) => {
    row.existingContactId =
      existingMap.get(`cpf:${row.cpf}`) ?? existingMap.get(`phone:${row.whatsapp}`) ?? null;
  });

  return {
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
  return db.contact.findFirst({
    where: {
      companyId,
      OR: [{ cpf: row.cpf }, { phone: row.whatsapp }]
    },
    select: { id: true }
  });
}

export async function confirmContactImport({
  companyId,
  userId,
  rows
}: {
  companyId: string;
  userId: string;
  rows: ImportPreviewRow[];
}): Promise<ContactImportConfirmResult> {
  const validRows = rows.filter((row) => row.status === "VALID");
  const errors = rows
    .filter((row) => row.status !== "VALID")
    .map((row) => ({
      rowNumber: row.rowNumber,
      reason: row.errors.join(" ")
    }));

  const result = await prisma.$transaction(async (tx) => {
    const contactIds: string[] = [];
    let created = 0;
    let updated = 0;

    for (const row of validRows) {
      const existing = await findContactForImport(tx, companyId, row);
      if (existing) {
        const contact = await tx.contact.update({
          where: { id: existing.id },
          data: {
            name: row.name,
            cpf: row.cpf,
            phone: row.whatsapp
          },
          select: { id: true }
        });
        updated += 1;
        contactIds.push(contact.id);

        await createActivity(tx, {
          contactId: contact.id,
          userId,
          type: "IMPORT_PLANILHA_UPDATED",
          title: "Contato atualizado por planilha",
          detail: `Linha ${row.rowNumber}: ${row.name}`
        });
      } else {
        const contact = await tx.contact.create({
          data: {
            companyId,
            ownerId: userId,
            name: row.name,
            cpf: row.cpf,
            phone: row.whatsapp,
            temperature: "WARM"
          },
          select: { id: true }
        });
        created += 1;
        contactIds.push(contact.id);

        await createActivity(tx, {
          contactId: contact.id,
          userId,
          type: "IMPORT_PLANILHA_CREATED",
          title: "Contato criado por planilha",
          detail: `Linha ${row.rowNumber}: ${row.name}`
        });
      }
    }

    return { contactIds: Array.from(new Set(contactIds)), created, updated };
  });

  return {
    summary: {
      totalRows: rows.length,
      imported: result.contactIds.length,
      created: result.created,
      updated: result.updated,
      invalid: errors.length
    },
    contactIds: result.contactIds,
    errors
  };
}
