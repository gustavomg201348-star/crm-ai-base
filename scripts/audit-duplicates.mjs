import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";

const defaultPrisma = new PrismaClient();

async function collectDuplicateGroups(prisma, field) {
  const where =
    field === "cpf"
      ? {
          cpf: { not: null },
          NOT: { cpf: "" },
        }
      : {
          NOT: { phone: "" },
        };

  const groups = await prisma.contact.groupBy({
    by: ["companyId", field],
    where,
    _count: { _all: true },
  });

  const duplicatedGroups = groups.filter((group) => group._count._all > 1);

  return Promise.all(
    duplicatedGroups.map(async (group) => {
      const value = group[field];
      const contacts = await prisma.contact.findMany({
        where: {
          companyId: group.companyId,
          [field]: value,
        },
        select: {
          id: true,
          name: true,
          phone: true,
          cpf: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      });

      return {
        companyId: group.companyId,
        field,
        value,
        count: group._count._all,
        ids: contacts.map((contact) => contact.id),
        contacts,
      };
    }),
  );
}

async function collectDuplicateEmptyCpfGroups(prisma) {
  const groups = await prisma.contact.groupBy({
    by: ["companyId", "cpf"],
    where: { cpf: "" },
    _count: { _all: true },
  });

  const duplicatedGroups = groups.filter((group) => group._count._all > 1);

  return Promise.all(
    duplicatedGroups.map(async (group) => {
      const contacts = await prisma.contact.findMany({
        where: {
          companyId: group.companyId,
          cpf: "",
        },
        select: {
          id: true,
          name: true,
          phone: true,
          cpf: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      });

      return {
        companyId: group.companyId,
        field: "cpf",
        value: "(cpf vazio)",
        count: group._count._all,
        ids: contacts.map((contact) => contact.id),
        contacts,
      };
    }),
  );
}

export async function collectDuplicateDiagnostics(prisma = defaultPrisma) {
  const [duplicatePhones, duplicateCpfs, duplicateEmptyCpfs, emptyPhonesCount, emptyCpfsCount] =
    await Promise.all([
      collectDuplicateGroups(prisma, "phone"),
      collectDuplicateGroups(prisma, "cpf"),
      collectDuplicateEmptyCpfGroups(prisma),
      prisma.contact.count({ where: { phone: "" } }),
      prisma.contact.count({ where: { cpf: "" } }),
    ]);

  return {
    duplicatePhones,
    duplicateCpfs,
    duplicateEmptyCpfs,
    emptyPhonesCount,
    emptyCpfsCount,
  };
}

function printSection(title, groups) {
  console.log(`\n=== ${title} ===`);

  if (groups.length === 0) {
    console.log("OK: nenhum grupo duplicado encontrado.");
    return;
  }

  for (const group of groups) {
    console.log(
      `- companyId=${group.companyId} ${group.field}=${group.value} quantidade=${group.count} ids=${group.ids.join(", ")}`,
    );
  }
}

export function printDuplicateReport(diagnostics) {
  console.log("Diagnostico de duplicidades de contatos");
  console.log("Este script e somente leitura. Nenhum contato sera alterado.");

  printSection("Duplicados por telefone dentro da empresa", diagnostics.duplicatePhones);
  printSection("Duplicados por CPF dentro da empresa", diagnostics.duplicateCpfs);
  printSection("CPFs vazios duplicados dentro da empresa", diagnostics.duplicateEmptyCpfs);

  console.log("\n=== Campos vazios ===");
  console.log(`Telefones vazios: ${diagnostics.emptyPhonesCount}`);
  console.log(`CPFs vazios: ${diagnostics.emptyCpfsCount}`);
}

async function main() {
  const diagnostics = await collectDuplicateDiagnostics(defaultPrisma);
  printDuplicateReport(diagnostics);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .catch((error) => {
      console.error("Falha ao auditar duplicidades:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await defaultPrisma.$disconnect();
    });
}
