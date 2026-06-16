import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SEED_COMPANY_ID = "seed-company";
const ADMIN_EMAIL = "admin@crm.local";

function companyScore(company) {
  return (
    company._count.contacts * 10 +
    company._count.channels * 5 +
    company._count.proposals * 3 +
    company._count.users +
    company._count.stages
  );
}

async function main() {
  if (process.env.NODE_ENV !== "production") {
    console.log("[admin-company-repair] Skipped outside production.");
    return;
  }

  const admin = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: {
      id: true,
      email: true,
      companyId: true
    }
  });

  if (!admin) {
    console.log(`[admin-company-repair] ${ADMIN_EMAIL} not found.`);
    return;
  }

  if (admin.companyId !== SEED_COMPANY_ID) {
    console.log(`[admin-company-repair] ${ADMIN_EMAIL} already belongs to ${admin.companyId}.`);
    return;
  }

  const companies = await prisma.company.findMany({
    where: { id: { not: SEED_COMPANY_ID } },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          users: true,
          contacts: true,
          channels: true,
          proposals: true,
          stages: true
        }
      }
    }
  });

  const target = companies
    .map((company) => ({
      ...company,
      score: companyScore(company)
    }))
    .filter((company) => company.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  if (!target) {
    console.log("[admin-company-repair] No data-bearing company found.");
    return;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: admin.id },
      data: { companyId: target.id }
    }),
    prisma.userAvailability.updateMany({
      where: { userId: admin.id },
      data: { companyId: target.id }
    })
  ]);

  console.warn(
    `[admin-company-repair] Moved ${ADMIN_EMAIL} from ${SEED_COMPANY_ID} to ${target.id} (${target.name}).`
  );
}

main()
  .catch((error) => {
    console.error("[admin-company-repair] Failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
