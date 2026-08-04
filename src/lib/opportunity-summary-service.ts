import { prisma } from "@/lib/db";
import { buildOpportunitySummary } from "@/lib/opportunity-summary-rules";
import type { OpportunitySummary } from "@/lib/opportunity-summary-types";

export async function getOpportunitySummaryForConversation({
  companyId,
  conversationId
}: {
  companyId: string;
  conversationId: string;
}): Promise<OpportunitySummary | null> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      contact: { companyId, archivedAt: null }
    },
    include: {
      contact: {
        include: {
          stage: true,
          tags: {
            include: {
              tag: true
            }
          }
        }
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 12
      }
    }
  });

  if (!conversation) return null;

  const [pendingTasks, proposals, campaignRecipients, retirementLead, recentCltSimulation] =
    await Promise.all([
      prisma.task.findMany({
        where: {
          companyId,
          contactId: conversation.contactId,
          status: "PENDING"
        },
        include: {
          assignee: { select: { id: true, name: true } }
        },
        orderBy: { dueAt: "asc" },
        take: 5
      }),
      prisma.proposal.findMany({
        where: {
          companyId,
          contactId: conversation.contactId
        },
        include: {
          assignedUser: { select: { id: true, name: true } }
        },
        orderBy: { updatedAt: "desc" },
        take: 8
      }),
      prisma.campaignRecipient.findMany({
        where: {
          contactId: conversation.contactId,
          campaign: { companyId }
        },
        include: {
          campaign: {
            include: {
              channel: { select: { name: true } }
            }
          }
        },
        orderBy: { updatedAt: "desc" },
        take: 3
      }),
      prisma.retirementLead.findFirst({
        where: {
          companyId,
          contactId: conversation.contactId
        },
        orderBy: { updatedAt: "desc" }
      }),
      prisma.cltSimulationLog.findFirst({
        where: {
          companyId,
          contactId: conversation.contactId,
          status: "SUCCESS"
        },
        orderBy: { createdAt: "desc" }
      })
    ]);

  return buildOpportunitySummary({
    conversation: {
      ...conversation,
      messages: [...conversation.messages].reverse()
    },
    pendingTasks,
    proposals,
    campaignRecipients,
    retirementLead,
    recentCltSimulation
  });
}
