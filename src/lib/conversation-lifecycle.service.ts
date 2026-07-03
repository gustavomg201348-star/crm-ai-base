import type { Conversation, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type DbClient = PrismaClient | Prisma.TransactionClient;
type FindOrCreateConversationForChannelOptions = {
  db?: DbClient;
  companyId: string;
  contactId: string;
  channelId: string;
  agentId?: string | null;
  status?: string;
  summary?: string | null;
  statuses?: string[];
  include?: Prisma.ConversationInclude;
  orderBy?: Prisma.ConversationOrderByWithRelationInput[];
  withCreated?: false;
};
type FindOrCreateConversationForChannelWithCreatedOptions =
  Omit<FindOrCreateConversationForChannelOptions, "withCreated"> & {
    withCreated: true;
  };

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

export async function findOrCreateConversationForChannel(
  options: FindOrCreateConversationForChannelWithCreatedOptions
): Promise<{ conversation: Conversation; created: boolean }>;
export async function findOrCreateConversationForChannel(
  options: FindOrCreateConversationForChannelOptions
): Promise<Conversation>;
export async function findOrCreateConversationForChannel({
  db = prisma,
  companyId,
  contactId,
  channelId,
  agentId,
  status = "OPEN",
  summary,
  statuses,
  include,
  orderBy,
  withCreated = false
}: FindOrCreateConversationForChannelOptions | FindOrCreateConversationForChannelWithCreatedOptions) {
  const existing = await findOpenConversationForContactChannel({
    db,
    companyId,
    contactId,
    channelId,
    statuses,
    include,
    orderBy
  });

  if (existing) {
    return withCreated ? { conversation: existing, created: false } : existing;
  }

  const created = await db.conversation.create({
    data: {
      contactId,
      agentId,
      status,
      channel: `whatsapp:${channelId}`,
      summary
    },
    ...(include ? { include } : {})
  });

  return withCreated ? { conversation: created, created: true } : created;
}
