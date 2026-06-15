import type { Prisma } from "@prisma/client";

export const multicredClientInclude = {
  contact: true,
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true
    }
  }
} satisfies Prisma.MulticredClientInclude;

export const multicredClientDetailInclude = {
  ...multicredClientInclude,
  contact: {
    include: {
      proposals: {
        orderBy: { createdAt: "desc" }
      }
    }
  }
} satisfies Prisma.MulticredClientInclude;

export type MulticredClientWithRelations = Prisma.MulticredClientGetPayload<{
  include: typeof multicredClientInclude;
}>;

export type MulticredClientDetailWithRelations = Prisma.MulticredClientGetPayload<{
  include: typeof multicredClientDetailInclude;
}>;

export function onlyDigits(value?: string | null) {
  return value?.replace(/\D/g, "") ?? "";
}

export function normalizeCpf(value?: string | null) {
  return onlyDigits(value).slice(0, 11);
}

export function normalizePhone(value?: string | null) {
  const digits = onlyDigits(value);
  if (!digits) return null;
  if (digits.startsWith("55")) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

export function isValidCpf(value?: string | null) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calculateDigit = (base: string, factor: number) => {
    const total = base
      .split("")
      .reduce((sum, digit) => sum + Number(digit) * factor--, 0);
    const rest = (total * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  const firstDigit = calculateDigit(cpf.slice(0, 9), 10);
  const secondDigit = calculateDigit(cpf.slice(0, 10), 11);

  return firstDigit === Number(cpf[9]) && secondDigit === Number(cpf[10]);
}

export function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function readOptionalString(value: unknown) {
  const text = readString(value);
  return text || null;
}

export function readOptionalDate(value: unknown) {
  const text = readString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildMulticredClientData(body: Record<string, unknown>) {
  const cpf = normalizeCpf(readString(body.cpf));
  const phone = normalizePhone(readString(body.phone));
  const whatsapp = normalizePhone(readString(body.whatsapp));

  return {
    name: readString(body.name),
    cpf,
    rg: readOptionalString(body.rg),
    birthDate: readOptionalDate(body.birthDate),
    motherName: readOptionalString(body.motherName),
    maritalStatus: readOptionalString(body.maritalStatus),
    phone,
    whatsapp,
    email: readOptionalString(body.email),
    zipCode: onlyDigits(readString(body.zipCode)) || null,
    street: readOptionalString(body.street),
    number: readOptionalString(body.number),
    complement: readOptionalString(body.complement),
    district: readOptionalString(body.district),
    city: readOptionalString(body.city),
    state: readOptionalString(body.state)?.toUpperCase() ?? null,
    bank: readOptionalString(body.bank),
    agency: readOptionalString(body.agency),
    account: readOptionalString(body.account),
    accountType: readOptionalString(body.accountType),
    pixKey: readOptionalString(body.pixKey),
    notes: readOptionalString(body.notes)
  };
}

export function buildMulticredClientPatchData(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};

  if ("name" in body) data.name = readString(body.name);
  if ("cpf" in body) data.cpf = normalizeCpf(readString(body.cpf));
  if ("rg" in body) data.rg = readOptionalString(body.rg);
  if ("birthDate" in body) data.birthDate = readOptionalDate(body.birthDate);
  if ("motherName" in body) data.motherName = readOptionalString(body.motherName);
  if ("maritalStatus" in body) data.maritalStatus = readOptionalString(body.maritalStatus);
  if ("phone" in body) data.phone = normalizePhone(readString(body.phone));
  if ("whatsapp" in body) data.whatsapp = normalizePhone(readString(body.whatsapp));
  if ("email" in body) data.email = readOptionalString(body.email);
  if ("zipCode" in body) data.zipCode = onlyDigits(readString(body.zipCode)) || null;
  if ("street" in body) data.street = readOptionalString(body.street);
  if ("number" in body) data.number = readOptionalString(body.number);
  if ("complement" in body) data.complement = readOptionalString(body.complement);
  if ("district" in body) data.district = readOptionalString(body.district);
  if ("city" in body) data.city = readOptionalString(body.city);
  if ("state" in body) data.state = readOptionalString(body.state)?.toUpperCase() ?? null;
  if ("bank" in body) data.bank = readOptionalString(body.bank);
  if ("agency" in body) data.agency = readOptionalString(body.agency);
  if ("account" in body) data.account = readOptionalString(body.account);
  if ("accountType" in body) data.accountType = readOptionalString(body.accountType);
  if ("pixKey" in body) data.pixKey = readOptionalString(body.pixKey);
  if ("notes" in body) data.notes = readOptionalString(body.notes);

  return data;
}

function mapProposal(proposal: {
  id: string;
  bank: string;
  agreement: string;
  product: string;
  amount: Prisma.Decimal;
  commission: Prisma.Decimal;
  status: string;
  createdAt: Date;
}) {
  return {
    id: proposal.id,
    bank: proposal.bank,
    agreement: proposal.agreement,
    product: proposal.product,
    amount: proposal.amount.toString(),
    commission: proposal.commission.toString(),
    status: proposal.status,
    createdAt: proposal.createdAt
  };
}

export function mapMulticredClient(client: MulticredClientWithRelations) {
  return {
    id: client.id,
    companyId: client.companyId,
    contactId: client.contactId,
    name: client.name,
    cpf: client.cpf,
    rg: client.rg,
    birthDate: client.birthDate,
    motherName: client.motherName,
    maritalStatus: client.maritalStatus,
    phone: client.phone,
    whatsapp: client.whatsapp,
    email: client.email,
    zipCode: client.zipCode,
    street: client.street,
    number: client.number,
    complement: client.complement,
    district: client.district,
    city: client.city,
    state: client.state,
    bank: client.bank,
    agency: client.agency,
    account: client.account,
    accountType: client.accountType,
    pixKey: client.pixKey,
    notes: client.notes,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    createdBy: client.createdBy,
    contact: client.contact
      ? {
          id: client.contact.id,
          name: client.contact.name,
          phone: client.contact.phone,
          cpf: client.contact.cpf,
          email: client.contact.email
        }
      : null
  };
}

export function mapMulticredClientDetail(client: MulticredClientDetailWithRelations) {
  return {
    ...mapMulticredClient(client),
    proposals: client.contact?.proposals.map(mapProposal) ?? []
  };
}
