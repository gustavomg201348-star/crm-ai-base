import type { PrismaClient } from "@prisma/client";
import { buildCltQualificationDefinition } from "./chatbot-clt-qualification";
import { validateChatbotDefinition } from "./chatbot-definition";

export async function readChatbotCenter(db: PrismaClient, companyId: string) {
  const runtimeSessions = { companyId, runtimeActorId: { not: null } };
  const [company, flows, campaigns, total, active, handoff, sessions] = await db.$transaction([
    db.company.findUniqueOrThrow({ where: { id: companyId }, select: { cltChatbotEnabled: true } }),
    db.chatbotFlow.findMany({
      where: { companyId }, orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true, name: true, isActive: true,
        publishedVersion: { select: { number: true, definition: true } }
      }
    }),
    db.cltChatbotCampaignBinding.findMany({
      where: { companyId }, orderBy: [{ updatedAt: "desc" }, { campaignId: "asc" }],
      select: {
        campaignId: true, flowId: true, optionId: true, templateName: true, enabled: true,
        campaign: { select: { name: true } },
        version: { select: { number: true } }
      }
    }),
    db.chatbotSession.count({ where: runtimeSessions }),
    db.chatbotSession.count({ where: { ...runtimeSessions, status: "ACTIVE" } }),
    db.chatbotSession.count({ where: { ...runtimeSessions, closureReason: "HUMAN_HANDOFF" } }),
    db.chatbotSession.findMany({
      where: runtimeSessions, take: 20, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true, status: true, closureReason: true, currentStepId: true, createdAt: true,
        campaign: { select: { name: true } },
        version: { select: { number: true, flow: { select: { name: true } } } }
      }
    })
  ], { isolationLevel: "Serializable" });

  return {
    enabled: company.cltChatbotEnabled,
    cltDefinition: buildCltQualificationDefinition(),
    flows: flows.map(({ publishedVersion, ...flow }) => ({
      ...flow,
      version: publishedVersion?.number ?? null,
      definition: readDefinition(publishedVersion?.definition)
    })),
    campaigns,
    metrics: { total, active, handoff },
    sessions: sessions.map((session) => ({
      ...session,
      createdAt: session.createdAt.toISOString()
    }))
  };
}

function readDefinition(value?: string) {
  if (!value) return null;
  try {
    return validateChatbotDefinition(JSON.parse(value));
  } catch {
    return null;
  }
}

export type ChatbotCenterData = Awaited<ReturnType<typeof readChatbotCenter>>;
