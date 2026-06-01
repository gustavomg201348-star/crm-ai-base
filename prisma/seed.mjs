import { PrismaClient } from "@prisma/client";
import { pbkdf2Sync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

async function main() {
  const company = await prisma.company.upsert({
    where: { id: "seed-company" },
    update: {},
    create: {
      id: "seed-company",
      name: "Operacao Inteligente",
      email: "contato@crm.local",
      phone: "+55 11 99999-9999",
      segment: "Correspondente bancario com foco em FGTS, CLT e INSS"
    }
  });

  const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD;
  const existingAdmin = await prisma.user.findUnique({
    where: { email: "admin@crm.local" }
  });

  if (process.env.NODE_ENV === "production" && !seedAdminPassword && !existingAdmin) {
    throw new Error("Defina SEED_ADMIN_PASSWORD em producao antes de criar o admin inicial.");
  }

  const adminPasswordHash = seedAdminPassword
    ? hashPassword(seedAdminPassword)
    : existingAdmin?.passwordHash ?? hashPassword("admin123");

  const admin = await prisma.user.upsert({
    where: { email: "admin@crm.local" },
    update: {
      companyId: company.id,
      name: "Administrador",
      ...(seedAdminPassword ? { passwordHash: adminPasswordHash } : {}),
      role: "ADMIN"
    },
    create: {
      companyId: company.id,
      name: "Administrador",
      email: "admin@crm.local",
      passwordHash: adminPasswordHash,
      role: "ADMIN"
    }
  });

  await prisma.channel.upsert({
    where: { id: "channel-whatsapp-sandbox" },
    update: {},
    create: {
      id: "channel-whatsapp-sandbox",
      companyId: company.id,
      name: "WhatsApp Sandbox",
      type: "whatsapp",
      provider: "sandbox",
      externalId: "sandbox-local",
      status: "ACTIVE"
    }
  });

  const [trafego, whatsapp, carteira] = await Promise.all(
    ["Trafego pago", "WhatsApp", "Carteira"].map((name) =>
      prisma.origin.upsert({
        where: { id: `origin-${name.toLowerCase().replaceAll(" ", "-")}` },
        update: {},
        create: {
          id: `origin-${name.toLowerCase().replaceAll(" ", "-")}`,
          companyId: company.id,
          name
        }
      })
    )
  );

  const [novo, qualificando, proposta] = await Promise.all(
    [
      ["stage-novo", "Novo lead", "#0284c7", 1],
      ["stage-qualificando", "Qualificando", "#d97706", 2],
      ["stage-proposta", "Proposta", "#0f766e", 3]
    ].map(([id, name, color, position]) =>
      prisma.pipelineStage.upsert({
        where: { id },
        update: {},
        create: {
          id,
          companyId: company.id,
          name,
          color,
          position: Number(position)
        }
      })
    )
  );

  await Promise.all(
    [
      ["tag-fgts", "FGTS", "#0f766e"],
      ["tag-clt", "CLT", "#d97706"],
      ["tag-inss", "INSS", "#be185d"]
    ].map(([id, name, color]) =>
      prisma.tag.upsert({
        where: { id },
        update: {},
        create: { id, companyId: company.id, name, color }
      })
    )
  );

  const samples = [
    {
      name: "Mariana Alves",
      phone: "(11) 98840-1201",
      email: "mariana@example.com",
      temperature: "HOT",
      originId: trafego.id,
      stageId: novo.id,
      lastMessage: "Cliente perguntou sobre liberacao e prazo."
    },
    {
      name: "Carlos Mendes",
      phone: "(31) 97718-8840",
      email: "carlos@example.com",
      temperature: "WARM",
      originId: whatsapp.id,
      stageId: qualificando.id,
      lastMessage: "Aguardando envio de documento."
    },
    {
      name: "Sueli Barbosa",
      phone: "(61) 99630-0021",
      email: "sueli@example.com",
      temperature: "COLD",
      originId: carteira.id,
      stageId: proposta.id,
      lastMessage: "Fluxo de qualificacao em andamento."
    }
  ];

  for (const contact of samples) {
    const existing = await prisma.contact.findFirst({
      where: { companyId: company.id, phone: contact.phone }
    });

    const savedContact =
      existing ??
      (await prisma.contact.create({
        data: {
          ...contact,
          companyId: company.id,
          ownerId: admin.id
        }
      }));

    const existingConversation = await prisma.conversation.findFirst({
      where: {
        contactId: savedContact.id
      }
    });

    if (!existingConversation) {
      const conversation = await prisma.conversation.create({
        data: {
          contactId: savedContact.id,
          agentId: admin.id,
          status:
            contact.temperature === "HOT"
              ? "OPEN"
              : contact.temperature === "WARM"
                ? "PENDING"
                : "BOT",
          summary: contact.lastMessage
        }
      });

      await prisma.message.createMany({
        data: [
          {
            conversationId: conversation.id,
            direction: "inbound",
            body: contact.lastMessage
          },
          {
            conversationId: conversation.id,
            direction: "outbound",
            body: "Recebido. Vou verificar as melhores opcoes e te retorno por aqui."
          }
        ]
      });
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
