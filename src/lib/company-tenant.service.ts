import type { Prisma } from "@prisma/client";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

const defaultOrigins = ["WhatsApp", "Trafego pago", "Carteira"];
const defaultStages: Array<[string, string, number]> = [
  ["Novo lead", "#0284c7", 1],
  ["Qualificando", "#d97706", 2],
  ["Proposta", "#0f766e", 3]
];
const defaultTags: Array<[string, string, string]> = [
  ["CLT", "#d97706", "#111827"],
  ["FGTS", "#7c3aed", "#ffffff"],
  ["INSS", "#2563eb", "#ffffff"],
  ["Em Negociacao", "#f59e0b", "#111827"]
];

async function seedTenantDefaults(tx: Prisma.TransactionClient, companyId: string) {
  await Promise.all(
    defaultOrigins.map((name) =>
      tx.origin.create({
        data: { companyId, name }
      })
    )
  );

  await Promise.all(
    defaultStages.map(([name, color, position]) =>
      tx.pipelineStage.create({
        data: { companyId, name, color, position }
      })
    )
  );

  await Promise.all(
    defaultTags.map(([name, color, textColor]) =>
      tx.tag.create({
        data: { companyId, name, color, textColor }
      })
    )
  );

  await tx.channel.create({
    data: {
      companyId,
      name: "WhatsApp Sandbox",
      type: "whatsapp",
      provider: "sandbox",
      externalId: `sandbox-${companyId}`,
      status: "ACTIVE"
    }
  });

  await tx.leadAssignmentSetting.create({
    data: {
      companyId,
      mode: "CLAIM_FIRST",
      onlineOnly: true,
      allowAttendantClaim: true
    }
  });
}

export async function listTenants() {
  const companies = await prisma.company.findMany({
    include: {
      users: {
        where: { role: "ADMIN" },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { createdAt: "asc" },
        take: 3
      },
      _count: {
        select: {
          users: true,
          contacts: true,
          channels: true,
          campaigns: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return companies.map((company) => ({
    id: company.id,
    name: company.name,
    email: company.email,
    phone: company.phone,
    segment: company.segment,
    createdAt: company.createdAt,
    admins: company.users,
    counts: {
      users: company._count.users,
      contacts: company._count.contacts,
      channels: company._count.channels,
      campaigns: company._count.campaigns
    }
  }));
}

export async function createTenantWithAdmin({
  companyName,
  companyEmail,
  companyPhone,
  segment,
  adminName,
  adminEmail,
  adminPassword
}: {
  companyName: string;
  companyEmail?: string | null;
  companyPhone?: string | null;
  segment?: string | null;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}) {
  const existing = await prisma.user.findUnique({
    where: { email: adminEmail }
  });

  if (existing) {
    throw new Error("Ja existe um usuario com este email.");
  }

  return prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: companyName,
        email: companyEmail?.trim() || null,
        phone: companyPhone?.trim() || null,
        segment: segment?.trim() || "Credito consignado"
      }
    });

    const admin = await tx.user.create({
      data: {
        companyId: company.id,
        name: adminName,
        email: adminEmail,
        passwordHash: hashPassword(adminPassword),
        role: "ADMIN"
      },
      select: { id: true, name: true, email: true, role: true }
    });

    await tx.userAvailability.create({
      data: {
        userId: admin.id,
        companyId: company.id,
        status: "OFFLINE"
      }
    });

    await seedTenantDefaults(tx, company.id);

    return {
      id: company.id,
      name: company.name,
      email: company.email,
      phone: company.phone,
      segment: company.segment,
      createdAt: company.createdAt,
      admins: [admin],
      counts: {
        users: 1,
        contacts: 0,
        channels: 1,
        campaigns: 0
      }
    };
  });
}
