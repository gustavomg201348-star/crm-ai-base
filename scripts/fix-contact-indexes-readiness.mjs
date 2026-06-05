import { PrismaClient } from "@prisma/client";
import {
  collectDuplicateDiagnostics,
  printDuplicateReport,
} from "./audit-duplicates.mjs";

const prisma = new PrismaClient();

function formatStatus(isReady) {
  return isReady ? "PRONTO" : "PENDENTE";
}

async function main() {
  const diagnostics = await collectDuplicateDiagnostics(prisma);

  printDuplicateReport(diagnostics);

  const phoneReady =
    diagnostics.duplicatePhones.length === 0 && diagnostics.emptyPhonesCount === 0;
  const cpfReady =
    diagnostics.duplicateCpfs.length === 0 && diagnostics.duplicateEmptyCpfs.length === 0;
  const tagDuplicates = await prisma.tag.groupBy({
    by: ["companyId", "name"],
    _count: { _all: true },
  });
  const duplicatedTags = tagDuplicates.filter((group) => group._count._all > 1);
  const tagReady = duplicatedTags.length === 0;

  console.log("\n=== Prontidao para constraints unique ===");
  console.log(`Contact companyId + phone: ${formatStatus(phoneReady)}`);
  console.log(`Contact companyId + cpf: ${formatStatus(cpfReady)}`);
  console.log(`Tag companyId + name: ${formatStatus(tagReady)}`);

  if (!phoneReady) {
    console.log(
      "- Telefone nao esta pronto: resolva telefones duplicados/vazios antes de aplicar unique.",
    );
  }

  if (!cpfReady) {
    console.log(
      "- CPF nao esta pronto: resolva CPFs duplicados e normalize CPFs vazios para null antes de aplicar unique.",
    );
  }

  if (!tagReady) {
    console.log("- Tags nao estao prontas: existem nomes repetidos dentro da mesma empresa.");
    for (const group of duplicatedTags) {
      console.log(
        `  companyId=${group.companyId} name=${group.name} quantidade=${group._count._all}`,
      );
    }
  }

  if (phoneReady && cpfReady && tagReady) {
    console.log("\nOK: banco pronto para unique composto em contatos e tags.");
  } else {
    console.log("\nACAO NECESSARIA: nao aplique unique composto antes de limpar os conflitos acima.");
  }
}

main()
  .catch((error) => {
    console.error("Falha ao verificar prontidao dos indices:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
