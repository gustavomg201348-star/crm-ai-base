import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function findOpenConversationForContactChannel({
  db = prisma,
  companyId,
  contactId,
  channelId,
  statuses = ["OPEN", "PENDING", "BOT"],
  include,
  orderBy
}: {
  db?: DbClient;
  companyId: string;
  contactId: string;
  channelId: string;
  statuses?: string[];
  include?: Prisma.ConversationInclude;
  orderBy?: Prisma.ConversationOrderByWithRelationInput[];
}) {
  return db.conversation.findFirst({
    where: {
      contactId,
      contact: { companyId },
      channel: `whatsapp:${channelId}`,
      status: { in: statuses }
    },
    ...(include ? { include } : {}),
    ...(orderBy ? { orderBy } : {})
  });
}

export async function findOrCreateConversationForChannel({
  db = prisma,
  companyId,
  contactId,
  channelId,
  agentId,
  status = "OPEN",
  include
}: {
  db?: DbClient;
  companyId: string;
  contactId: string;
  channelId: string;
  agentId?: string | null;
  status?: string;
  include?: Prisma.ConversationInclude;
}) {
  const existing = await findOpenConversationForContactChannel({
    db,
    companyId,
    contactId,
    channelId,
    include
  });

  if (existing) return existing;

  return db.conversation.create({
    data: {
      contactId,
      agentId,
      status,
      channel: `whatsapp:${channelId}`
    },
    ...(include ? { include } : {})
  });
}
