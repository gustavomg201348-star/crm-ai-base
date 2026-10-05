import { prisma } from "@/lib/db";
import {
  buildReplySnapshot,
  mapQuotedReply,
  type QuotedReply
} from "@/lib/message-reply";
import { getOpportunitySummaryForConversation } from "@/lib/opportunity-summary-service";
import type { OpportunitySummary } from "@/lib/opportunity-summary-types";
import type { AuthorizedFinancialFacts } from "@/lib/ai-response-guardrails";

export const AI_RESPONSE_CONTEXT_LIMITS = {
  sourceMessages: 40,
  messages: 16,
  totalMessageCharacters: 8_000,
  messageCharacters: 1_200,
  companyInstructionsCharacters: 2_000,
  factCharacters: 500,
  promptCharacters: 16_000
} as const;

type ContextMessageRecord = {
  id: string;
  conversationId: string;
  direction: string;
  type: string | null;
  body: string | null;
  fileName: string | null;
  replyToProviderMessageId: string | null;
  replyPreviewType: string | null;
  replyPreviewBody: string | null;
  replyPreviewFileName: string | null;
  replyTo: {
    id: string;
    conversationId: string;
    direction: string | null;
    providerMessageId: string | null;
    type: string | null;
    body: string | null;
    fileName: string | null;
  } | null;
};

type ContextConversationRecord = {
  id: string;
  channelId: string | null;
  contact: {
    name: string;
    stage: { name: string } | null;
    origin: { name: string } | null;
    owner: { name: string } | null;
    tags: Array<{ tag: { name: string } }>;
  };
  agent: { name: string } | null;
  messages: ContextMessageRecord[];
};

type ContextCompanyRecord = {
  name: string;
  segment: string | null;
  aiInstructions: string | null;
};

type SelectedReplyRecord = Pick<
  ContextMessageRecord,
  "id" | "conversationId" | "direction" | "type" | "body" | "fileName"
> & {
  conversation: {
    channelId: string | null;
    contact: { companyId: string };
  };
};

export type AiResponseContextMessage = {
  direction: "customer" | "attendant";
  type: string;
  body: string | null;
  fileName: string | null;
  quotedReply: QuotedReply | null;
};

export type AiResponseContext = {
  company: {
    name: string;
    segment: string | null;
    instructions: string | null;
  };
  customer: {
    firstName: string;
    stage: string | null;
    origin: string | null;
    owner: string | null;
    tags: string[];
  };
  messages: AiResponseContextMessage[];
  selectedReply: QuotedReply | null;
  opportunity: {
    probableProduct: string | null;
    probableProductIsInference: true;
    commercialState: string | null;
    priority: string | null;
    recommendedAction: string | null;
    pendingTask: string | null;
    activeProposal: {
      product: string;
      status: string;
      amount: string | null;
    } | null;
  };
  financialFacts: AuthorizedFinancialFacts;
};

export class AiResponseContextNotFoundError extends Error {
  constructor() {
    super("Conversa nao encontrada.");
    this.name = "AiResponseContextNotFoundError";
  }
}

export class InvalidAiResponseReplyError extends Error {
  constructor() {
    super("A mensagem selecionada para resposta nao e valida.");
    this.name = "InvalidAiResponseReplyError";
  }
}

type AiResponseContextDependencies = {
  loadConversation(input: {
    companyId: string;
    conversationId: string;
  }): Promise<ContextConversationRecord | null>;
  loadCompany(companyId: string): Promise<ContextCompanyRecord | null>;
  loadSelectedReply(input: {
    companyId: string;
    conversationId: string;
    channelId: string | null;
    messageId: string;
  }): Promise<SelectedReplyRecord | null>;
  loadOpportunity(input: {
    companyId: string;
    conversationId: string;
  }): Promise<OpportunitySummary | null>;
};

const defaultDependencies: AiResponseContextDependencies = {
  loadConversation: ({ companyId, conversationId }) =>
    prisma.conversation.findFirst({
      where: { id: conversationId, contact: { companyId } },
      select: {
        id: true,
        channelId: true,
        contact: {
          select: {
            name: true,
            stage: { select: { name: true } },
            origin: { select: { name: true } },
            owner: { select: { name: true } },
            tags: { select: { tag: { select: { name: true } } } }
          }
        },
        agent: { select: { name: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: AI_RESPONSE_CONTEXT_LIMITS.sourceMessages,
          select: {
            id: true,
            conversationId: true,
            direction: true,
            type: true,
            body: true,
            fileName: true,
            replyToProviderMessageId: true,
            replyPreviewType: true,
            replyPreviewBody: true,
            replyPreviewFileName: true,
            replyTo: {
              select: {
                id: true,
                conversationId: true,
                direction: true,
                providerMessageId: true,
                type: true,
                body: true,
                fileName: true
              }
            }
          }
        }
      }
    }),
  loadCompany: (companyId) =>
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, segment: true, aiInstructions: true }
    }),
  loadSelectedReply: ({ companyId, conversationId, channelId, messageId }) =>
    prisma.message.findFirst({
      where: {
        id: messageId,
        conversationId,
        conversation: {
          id: conversationId,
          channelId,
          contact: { companyId }
        }
      },
      select: {
        id: true,
        conversationId: true,
        direction: true,
        type: true,
        body: true,
        fileName: true,
        conversation: {
          select: {
            channelId: true,
            contact: { select: { companyId: true } }
          }
        }
      }
    }),
  loadOpportunity: getOpportunitySummaryForConversation
};

function truncate(value: string, maxLength: number) {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters.slice(0, Math.max(0, maxLength - 1)).join("")}…`;
}

export function redactAiSensitiveText(value?: string | null, maxLength = 1_200) {
  if (!value) return null;
  const redacted = value
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF OMITIDO]")
    .replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}/g, "[TELEFONE OMITIDO]")
    .replace(
      /\b(access[_ -]?token|verify[_ -]?token|app[_ -]?secret|authorization)\s*[:=]\s*\S+/gi,
      "$1=[SEGREDO OMITIDO]"
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [SEGREDO OMITIDO]")
    .trim();
  return redacted ? truncate(redacted, maxLength) : null;
}

function firstName(name: string) {
  return redactAiSensitiveText(name, 80)?.split(/\s+/)[0] || "Cliente";
}

function sanitizeQuotedReply(reply: QuotedReply | null): QuotedReply | null {
  if (!reply) return null;
  return {
    id: null,
    providerMessageId: null,
    ...(reply.direction ? { direction: reply.direction } : {}),
    type: redactAiSensitiveText(reply.type, 40),
    body:
      reply.type === "audio"
        ? null
        : redactAiSensitiveText(reply.body, AI_RESPONSE_CONTEXT_LIMITS.factCharacters),
    fileName: redactAiSensitiveText(reply.fileName, 160)
  };
}

function sanitizeMessage(message: ContextMessageRecord): AiResponseContextMessage {
  const type = redactAiSensitiveText(message.type, 40) || "text";
  return {
    direction: message.direction === "inbound" ? "customer" : "attendant",
    type,
    body:
      type === "audio"
        ? null
        : redactAiSensitiveText(
            message.body,
            AI_RESPONSE_CONTEXT_LIMITS.messageCharacters
          ),
    fileName: redactAiSensitiveText(message.fileName, 160),
    quotedReply: sanitizeQuotedReply(mapQuotedReply(message))
  };
}

function limitMessages(messages: ContextMessageRecord[]) {
  const selected: AiResponseContextMessage[] = [];
  let characters = 0;

  for (const message of messages) {
    if (selected.length >= AI_RESPONSE_CONTEXT_LIMITS.messages) break;
    const sanitized = sanitizeMessage(message);
    const size = JSON.stringify(sanitized).length;
    if (
      selected.length > 0 &&
      characters + size > AI_RESPONSE_CONTEXT_LIMITS.totalMessageCharacters
    ) {
      break;
    }
    selected.push(sanitized);
    characters += size;
  }

  return selected.reverse();
}

function opportunityContext(summary: OpportunitySummary | null) {
  const activeProposal = summary?.activeProposal
    ? {
        product:
          redactAiSensitiveText(summary.activeProposal.product, 120) || "Produto nao informado",
        status:
          redactAiSensitiveText(summary.activeProposal.status, 80) || "Status nao informado",
        amount: redactAiSensitiveText(summary.activeProposal.amount, 80)
      }
    : null;

  return {
    opportunity: {
      probableProduct: redactAiSensitiveText(summary?.probableProduct.label, 120),
      probableProductIsInference: true as const,
      commercialState: redactAiSensitiveText(summary?.commercialState.label, 120),
      priority: redactAiSensitiveText(summary?.priority.label, 80),
      recommendedAction: redactAiSensitiveText(
        summary?.recommendedAction.label,
        AI_RESPONSE_CONTEXT_LIMITS.factCharacters
      ),
      pendingTask: redactAiSensitiveText(
        summary?.pendingReturn?.title,
        AI_RESPONSE_CONTEXT_LIMITS.factCharacters
      ),
      activeProposal
    },
    financialFacts: {
      proposalAmounts: activeProposal?.amount ? [activeProposal.amount] : [],
      proposalStatuses: activeProposal?.status ? [activeProposal.status] : [],
      proposalProducts: activeProposal?.product ? [activeProposal.product] : [],
      proposalBanks: [],
      installmentAmounts: [],
      installmentCounts: [],
      rates: [],
      cets: [],
      margins: [],
      limits: [],
      paymentDates: [],
      discountDates: []
    }
  };
}

export async function buildAiResponseContext(
  {
    companyId,
    conversationId,
    replyToMessageId
  }: {
    companyId: string;
    conversationId: string;
    replyToMessageId?: string | null;
  },
  dependencies: AiResponseContextDependencies = defaultDependencies
): Promise<AiResponseContext> {
  const conversation = await dependencies.loadConversation({ companyId, conversationId });
  if (!conversation) throw new AiResponseContextNotFoundError();

  const selectedMessageId = replyToMessageId?.trim() || null;
  const [company, opportunity, selectedReplyRecord] = await Promise.all([
    dependencies.loadCompany(companyId),
    dependencies.loadOpportunity({ companyId, conversationId }),
    selectedMessageId
      ? dependencies.loadSelectedReply({
          companyId,
          conversationId,
          channelId: conversation.channelId,
          messageId: selectedMessageId
        })
      : Promise.resolve(null)
  ]);

  if (!company) throw new AiResponseContextNotFoundError();
  const selectedReplyIsValid = Boolean(
    !selectedMessageId ||
      (selectedReplyRecord &&
        selectedReplyRecord.id === selectedMessageId &&
        selectedReplyRecord.conversationId === conversationId &&
        selectedReplyRecord.conversation.contact.companyId === companyId &&
        selectedReplyRecord.conversation.channelId === conversation.channelId)
  );
  if (!selectedReplyIsValid) {
    throw new InvalidAiResponseReplyError();
  }

  const selectedReplySnapshot = selectedReplyRecord
    ? buildReplySnapshot(selectedReplyRecord)
    : null;
  const selectedReply = selectedReplyRecord && selectedReplySnapshot
    ? sanitizeQuotedReply({
        id: selectedReplyRecord.id,
        providerMessageId: null,
        direction: selectedReplyRecord.direction,
        type: selectedReplySnapshot.replyPreviewType,
        body: selectedReplySnapshot.replyPreviewBody,
        fileName: selectedReplySnapshot.replyPreviewFileName
      })
    : null;
  const opportunityFacts = opportunityContext(opportunity);

  return {
    company: {
      name: redactAiSensitiveText(company.name, 160) || "CRM",
      segment: redactAiSensitiveText(company.segment, 240),
      instructions: redactAiSensitiveText(
        company.aiInstructions,
        AI_RESPONSE_CONTEXT_LIMITS.companyInstructionsCharacters
      )
    },
    customer: {
      firstName: firstName(conversation.contact.name),
      stage: redactAiSensitiveText(conversation.contact.stage?.name, 120),
      origin: redactAiSensitiveText(conversation.contact.origin?.name, 120),
      owner: redactAiSensitiveText(
        conversation.contact.owner?.name ?? conversation.agent?.name,
        120
      ),
      tags: conversation.contact.tags
        .map((item) => redactAiSensitiveText(item.tag.name, 80))
        .filter((tag): tag is string => Boolean(tag))
        .slice(0, 12)
    },
    messages: limitMessages(conversation.messages),
    selectedReply,
    ...opportunityFacts
  };
}
