import process from "node:process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const WHATSAPP_PREFIX = "whatsapp:";
const LEGACY_GENERIC_WHATSAPP = "whatsapp";
const APPLY_FLAG = "--apply";

function maskDatabaseUrl(url) {
  if (!url) return "(DATABASE_URL nao definida)";

  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    if (parsed.username) parsed.username = parsed.username ? "***" : "";
    return parsed.toString();
  } catch {
    return "[DATABASE_URL_MASKED]";
  }
}

function parseConversationChannel(channel) {
  const normalized = channel?.trim();
  if (!normalized || normalized === LEGACY_GENERIC_WHATSAPP) return null;
  if (!normalized.startsWith(WHATSAPP_PREFIX)) return null;

  const channelId = normalized.slice(WHATSAPP_PREFIX.length).trim();
  return channelId || null;
}

function groupEligibleConversations(conversations, channelsById) {
  const groups = new Map();

  for (const conversation of conversations) {
    const channel = channelsById.get(conversation.newChannelId);
    const key = [
      conversation.newChannelId,
      channel.provider,
      channel.status,
      channel.companyId
    ].join("|");

    const current = groups.get(key) ?? {
      channelId: conversation.newChannelId,
      provider: channel.provider,
      status: channel.status,
      companyId: channel.companyId,
      count: 0,
      conversationIds: []
    };

    current.count += 1;
    current.conversationIds.push(conversation.id);
    groups.set(key, current);
  }

  return [...groups.values()].sort((a, b) => a.channelId.localeCompare(b.channelId));
}

function isMissingChannelIdColumn(error) {
  if (error?.code === "P2022") {
    const column = String(error?.meta?.column ?? "");
    return column.includes("Conversation.channelId") || column.includes("channelId");
  }

  const message = error instanceof Error ? error.message : String(error);
  return /Conversation\.channelId|no such column.*channelId|column.*channelId.*does not exist/i.test(
    message
  );
}

async function loadBackfillContext() {
  const [conversations, channels] = await Promise.all([
    prisma.conversation.findMany({
      select: {
        id: true,
        channel: true,
        channelId: true,
        status: true,
        contact: {
          select: {
            id: true,
            companyId: true
          }
        }
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.channel.findMany({
      select: {
        id: true,
        companyId: true,
        type: true,
        provider: true,
        status: true,
        name: true
      },
      orderBy: { createdAt: "asc" }
    })
  ]);

  return { conversations, channels };
}

function buildReport({ conversations, channels }) {
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const eligible = [];
  const skipped = {
    alreadyHasChannelId: [],
    genericWhatsapp: [],
    invalidChannel: [],
    missingChannel: [],
    companyMismatch: []
  };

  for (const conversation of conversations) {
    const previousChannelId = conversation.channelId ?? null;

    if (previousChannelId) {
      skipped.alreadyHasChannelId.push({
        id: conversation.id,
        previousChannelId,
        channel: conversation.channel
      });
      continue;
    }

    const normalizedChannel = conversation.channel?.trim();
    const parsedChannelId = parseConversationChannel(conversation.channel);

    if (normalizedChannel === LEGACY_GENERIC_WHATSAPP) {
      skipped.genericWhatsapp.push({ id: conversation.id, channel: conversation.channel });
      continue;
    }

    if (!parsedChannelId) {
      skipped.invalidChannel.push({ id: conversation.id, channel: conversation.channel });
      continue;
    }

    const channel = channelsById.get(parsedChannelId);
    if (!channel) {
      skipped.missingChannel.push({
        id: conversation.id,
        channel: conversation.channel,
        parsedChannelId
      });
      continue;
    }

    if (channel.companyId !== conversation.contact?.companyId) {
      skipped.companyMismatch.push({
        id: conversation.id,
        channel: conversation.channel,
        parsedChannelId,
        conversationCompanyId: conversation.contact?.companyId ?? null,
        channelCompanyId: channel.companyId
      });
      continue;
    }

    eligible.push({
      id: conversation.id,
      previousChannelId,
      newChannelId: parsedChannelId,
      channel: conversation.channel,
      companyId: conversation.contact.companyId
    });
  }

  const skippedTotal = Object.values(skipped).reduce(
    (total, conversations) => total + conversations.length,
    0
  );

  return {
    totals: {
      conversations: conversations.length,
      eligible: eligible.length,
      notEligible: skippedTotal,
      alreadyHasChannelId: skipped.alreadyHasChannelId.length,
      genericWhatsapp: skipped.genericWhatsapp.length,
      invalidChannel: skipped.invalidChannel.length,
      missingChannel: skipped.missingChannel.length,
      companyMismatch: skipped.companyMismatch.length
    },
    eligible,
    groupedEligible: groupEligibleConversations(eligible, channelsById),
    skipped
  };
}

async function applyBackfill(eligible) {
  const updated = [];

  for (const conversation of eligible) {
    const result = await prisma.conversation.updateMany({
      where: {
        id: conversation.id,
        channelId: null
      },
      data: {
        channelId: conversation.newChannelId
      }
    });

    updated.push({
      id: conversation.id,
      previousChannelId: conversation.previousChannelId,
      newChannelId: conversation.newChannelId,
      updated: result.count === 1
    });
  }

  return updated;
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);

  console.log("Backfill Conversation.channelId");
  console.log(`Modo: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Datasource: ${maskDatabaseUrl(process.env.DATABASE_URL)}`);

  if (!apply) {
    console.log("Nenhuma alteracao sera executada sem a flag --apply.");
  }

  const context = await loadBackfillContext();
  const report = buildReport(context);

  console.log("\nResumo:");
  console.log(JSON.stringify(report.totals, null, 2));

  console.log("\nElegiveis agrupados por channelId/provider/status/companyId:");
  console.log(JSON.stringify(report.groupedEligible, null, 2));

  console.log("\nIDs elegiveis com previousChannelId/newChannelId:");
  console.log(JSON.stringify(report.eligible, null, 2));

  console.log("\nNao elegiveis:");
  console.log(JSON.stringify(report.skipped, null, 2));

  if (!apply) {
    console.log("\nDRY-RUN concluido. Nenhuma conversa foi alterada.");
    return;
  }

  const updated = await applyBackfill(report.eligible);
  console.log("\nAPPLY concluido:");
  console.log(JSON.stringify(updated, null, 2));
}

main()
  .catch((error) => {
    if (isMissingChannelIdColumn(error)) {
      console.error(
        [
          "Nao foi possivel executar o backfill porque a coluna Conversation.channelId ainda nao existe no banco atual.",
          "Aplique primeiro a estrutura nullable aprovada na Fase 4.2A no ambiente correto.",
          "Nenhuma alteracao foi executada."
        ].join("\n")
      );
      process.exitCode = 1;
      return;
    }

    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
