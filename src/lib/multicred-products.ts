import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const defaultMulticredCatalog = [
  {
    bank: "Mercantil",
    agreement: "INSS",
    product: "Consignado INSS",
    color: "blue",
    category: "INSS",
    description: "Aposentados e pensionistas."
  },
  {
    bank: "Mercantil",
    agreement: "FGTS",
    product: "Antecipacao FGTS",
    color: "emerald",
    category: "FGTS",
    description: "Saque-aniversario e antecipacao."
  },
  {
    bank: "C6 Ficsa",
    agreement: "CLT",
    product: "Credito do Trabalhador",
    color: "violet",
    category: "CLT",
    description: "Operacao CLT."
  },
  {
    bank: "BMG",
    agreement: "INSS",
    product: "Cartao Beneficio",
    color: "amber",
    category: "INSS",
    description: "Beneficio e cartao."
  },
  {
    bank: "3RN",
    agreement: "CLT",
    product: "Credito do Trabalhador",
    color: "slate",
    category: "CLT",
    description: "Atalho CLT."
  }
] as const;

export const multicredProductInclude = {
  bank: true
} satisfies Prisma.MulticredProductInclude;

export type MulticredProductWithBank = Prisma.MulticredProductGetPayload<{
  include: typeof multicredProductInclude;
}>;

export function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function readOptionalString(value: unknown) {
  const text = readString(value);
  return text || null;
}

export function mapMulticredProduct(product: MulticredProductWithBank) {
  return {
    id: product.id,
    companyId: product.companyId,
    bankId: product.bankId,
    bankName: product.bank.name,
    bankCode: product.bank.code,
    bankColor: product.bank.color,
    bankCategory: product.bank.category,
    agreement: product.agreement,
    product: product.name,
    description: product.description,
    isActive: product.isActive,
    position: product.position,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt
  };
}

export async function ensureDefaultMulticredCatalog(companyId: string) {
  const existing = await prisma.multicredBank.count({ where: { companyId } });
  if (existing > 0) return;

  for (let index = 0; index < defaultMulticredCatalog.length; index += 1) {
    const item = defaultMulticredCatalog[index];
    const bank = await prisma.multicredBank.upsert({
      where: {
        companyId_name: {
          companyId,
          name: item.bank
        }
      },
      update: {
        isActive: true,
        color: item.color,
        category: item.category
      },
      create: {
        companyId,
        name: item.bank,
        color: item.color,
        category: item.category,
        position: index
      }
    });

    await prisma.multicredProduct.upsert({
      where: {
        companyId_bankId_agreement_name: {
          companyId,
          bankId: bank.id,
          agreement: item.agreement,
          name: item.product
        }
      },
      update: {
        description: item.description,
        isActive: true,
        position: index
      },
      create: {
        companyId,
        bankId: bank.id,
        agreement: item.agreement,
        name: item.product,
        description: item.description,
        position: index
      }
    });
  }
}

export function buildMulticredProductData(body: Record<string, unknown>) {
  return {
    bankName: readString(body.bankName || body.bank),
    bankCode: readOptionalString(body.bankCode),
    bankColor: readString(body.bankColor || body.color) || "slate",
    bankCategory: readOptionalString(body.bankCategory || body.category),
    agreement: readString(body.agreement),
    product: readString(body.product || body.name),
    description: readOptionalString(body.description),
    isActive: typeof body.isActive === "boolean" ? body.isActive : true
  };
}
