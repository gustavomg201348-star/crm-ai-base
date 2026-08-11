import { buildCommercialObserverPrompt } from "@/lib/commercial-observer-prompt";
import {
  COMMERCIAL_OBSERVER_ACTION_VALUES,
  COMMERCIAL_OBSERVER_INTEREST_VALUES,
  COMMERCIAL_OBSERVER_JSON_SCHEMA,
  COMMERCIAL_OBSERVER_RISK_VALUES,
  COMMERCIAL_OBSERVER_STAGE_VALUES,
  UNKNOWN_COMMERCIAL_OBSERVER_RESULT,
  type CommercialObserverInterestValue,
  type CommercialObserverNextBestAction,
  type CommercialObserverResultV1,
  type CommercialObserverRiskValue,
  type CommercialObserverStageValue
} from "@/lib/commercial-observer-types";
import { prisma } from "@/lib/db";

const MESSAGE_LIMIT = 40;
const MAX_TEXT_LENGTH = 700;
const MAX_LIST_LENGTH = 5;

export type CommercialObserverModelInput = {
  version: 1;
  company: {
    segment: string | null;
    aiInstructions: string | null;
  };
  conversation: {
    id: string;
    status: string;
    channel: string;
    channelName: string | null;
    responsible: string | null;
    stage: string | null;
    createdAt: string;
    updatedAt: string;
  };
  contact: {
    name: string;
    hasPhone: boolean;
    phoneLast4: string | null;
    temperature: string | null;
    origin: string | null;
    tags: string[];
  };
  recentMessages: Array<{
    direction: string;
    senderType: string | null;
    type: string;
    body: string;
    createdAt: string;
  }>;
  tasks: Array<{
    title: string;
    status: string;
    dueAt: string;
  }>;
  proposals: Array<{
    product: string;
    status: string;
    amount: string | null;
    releasedAmount: string | null;
    paidAt: string | null;
    updatedAt: string;
  }>;
  campaigns: Array<{
    name: string;
    status: string;
    templateName: string | null;
    channel: string | null;
    occurredAt: string;
  }>;
  limitations: string[];
};

type ObserverDb = typeof prisma;

export class CommercialObserverError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "NOT_CONFIGURED"
      | "AI_REQUEST_FAILED"
      | "INVALID_MODEL_OUTPUT"
  ) {
    super(message);
    this.name = "CommercialObserverError";
  }
}

function truncateText(value: string | null | undefined, maxLength = MAX_TEXT_LENGTH) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function decimalToString(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "toString" in value) return String(value.toString());
  return String(value);
}

function lastDigits(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
}

function hasArtificialOrInsufficientContext(input: CommercialObserverModelInput) {
  const messageText = input.recentMessages.map((message) => message.body).join(" ").toLowerCase();
  const artificial = /\b(teste|sse|realtime|sino|notificacao|notification|desktop)\b/i.test(
    messageText
  );
  return input.recentMessages.length <= 2 && artificial;
}

function hasConcreteEvidence(evidence: string[]) {
  return evidence.some((item) => item.trim().length >= 8);
}

function sanitizeSummary(summary: string) {
  return summary
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email omitido]")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, "[identificador omitido]")
    .replace(/\b\d{3,}\b/g, "[identificador omitido]")
    .trim();
}

function addLimitation(
  result: CommercialObserverResultV1,
  limitation: string
): CommercialObserverResultV1 {
  if (result.limitations.includes(limitation)) return result;
  return { ...result, limitations: [...result.limitations, limitation].slice(0, 8) };
}

export async function loadCommercialObserverContext({
  conversationId,
  companyId,
  db = prisma
}: {
  conversationId: string;
  companyId: string;
  db?: ObserverDb;
}): Promise<CommercialObserverModelInput> {
  const conversation = await db.conversation.findFirst({
    where: {
      id: conversationId,
      contact: { companyId }
    },
    include: {
      contact: {
        include: {
          origin: true,
          stage: true,
          tags: { include: { tag: true } }
        }
      },
      agent: { select: { name: true } },
      channelRef: { select: { name: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: MESSAGE_LIMIT
      }
    }
  });

  if (!conversation) {
    throw new CommercialObserverError("Conversa nao encontrada.", "NOT_FOUND");
  }

  const [company, tasks, proposals, campaigns] = await Promise.all([
    db.company.findUnique({
      where: { id: companyId },
      select: { segment: true, aiInstructions: true }
    }),
    db.task.findMany({
      where: {
        companyId,
        contactId: conversation.contactId,
        status: { in: ["PENDING", "DONE"] }
      },
      orderBy: { dueAt: "desc" },
      take: 6
    }),
    db.proposal.findMany({
      where: {
        companyId,
        contactId: conversation.contactId
      },
      orderBy: { updatedAt: "desc" },
      take: 8
    }),
    db.campaignRecipient.findMany({
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
      take: 4
    })
  ]);

  const orderedMessages = [...conversation.messages].reverse();
  const limitations: string[] = [];
  if (orderedMessages.length === 0) limitations.push("Conversa sem mensagens recentes.");
  if (conversation.messages.length >= MESSAGE_LIMIT) {
    limitations.push(`Analise limitada as ultimas ${MESSAGE_LIMIT} mensagens.`);
  }
  if (!conversation.channelId) limitations.push("Conversa sem channelId vinculado.");

  return {
    version: 1,
    company: {
      segment: company?.segment ?? null,
      aiInstructions: company?.aiInstructions ?? null
    },
    conversation: {
      id: conversation.id,
      status: conversation.status,
      channel: conversation.channel,
      channelName: conversation.channelRef?.name ?? null,
      responsible: conversation.agent?.name ?? null,
      stage: conversation.contact.stage?.name ?? null,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString()
    },
    contact: {
      name: "Cliente",
      hasPhone: Boolean(conversation.contact.phone),
      phoneLast4: lastDigits(conversation.contact.phone),
      temperature: conversation.contact.temperature,
      origin: conversation.contact.origin?.name ?? null,
      tags: conversation.contact.tags.map((item) => item.tag.name).slice(0, MAX_LIST_LENGTH)
    },
    recentMessages: orderedMessages.map((message) => ({
      direction: message.direction,
      senderType: message.senderType,
      type: message.type,
      body: truncateText(message.body),
      createdAt: message.createdAt.toISOString()
    })),
    tasks: tasks.map((task) => ({
      title: truncateText(task.title, 160),
      status: task.status,
      dueAt: task.dueAt.toISOString()
    })),
    proposals: proposals.map((proposal) => ({
      product: proposal.product,
      status: proposal.status,
      amount: decimalToString(proposal.amount),
      releasedAmount: decimalToString(proposal.releasedAmount),
      paidAt: proposal.paidAt?.toISOString() ?? null,
      updatedAt: proposal.updatedAt.toISOString()
    })),
    campaigns: campaigns.map((recipient) => ({
      name: truncateText(recipient.campaign.name, 160),
      status: recipient.status,
      templateName: recipient.campaign.templateName ?? null,
      channel: recipient.campaign.channel?.name ?? null,
      occurredAt:
        recipient.sentAt?.toISOString() ??
        recipient.deliveredAt?.toISOString() ??
        recipient.updatedAt.toISOString()
    })),
    limitations
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? truncateText(value, 900) : fallback;
}

function readNullableString(value: unknown) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && value.trim() ? truncateText(value, 500) : null;
}

function readConfidence(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => readString(item)).filter(Boolean).slice(0, MAX_LIST_LENGTH);
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function readStage(value: unknown): CommercialObserverResultV1["stage"] {
  const record = isRecord(value) ? value : {};
  return {
    value: readEnum(
      record.value,
      COMMERCIAL_OBSERVER_STAGE_VALUES,
      "UNKNOWN"
    ) as CommercialObserverStageValue,
    confidence: readConfidence(record.confidence),
    evidence: readStringArray(record.evidence)
  };
}

function readInterest(value: unknown): CommercialObserverResultV1["interest"] {
  const record = isRecord(value) ? value : {};
  return {
    value: readEnum(
      record.value,
      COMMERCIAL_OBSERVER_INTEREST_VALUES,
      "UNKNOWN"
    ) as CommercialObserverInterestValue,
    confidence: readConfidence(record.confidence),
    evidence: readStringArray(record.evidence)
  };
}

function readRisk(value: unknown): CommercialObserverResultV1["risk"] {
  const record = isRecord(value) ? value : {};
  return {
    value: readEnum(
      record.value,
      COMMERCIAL_OBSERVER_RISK_VALUES,
      "UNKNOWN"
    ) as CommercialObserverRiskValue,
    confidence: readConfidence(record.confidence),
    reasons: readStringArray(record.reasons)
  };
}

function readNextBestAction(value: unknown): CommercialObserverResultV1["nextBestAction"] {
  const record = isRecord(value) ? value : {};
  return {
    action: readEnum(
      record.action,
      COMMERCIAL_OBSERVER_ACTION_VALUES,
      "NO_ACTION"
    ) as CommercialObserverNextBestAction,
    reason: readString(record.reason, "Sem recomendacao com base suficiente."),
    suggestedAt: readNullableString(record.suggestedAt),
    confidence: readConfidence(record.confidence)
  };
}

function readNullableBlock(
  value: unknown
): CommercialObserverResultV1["objection"] | CommercialObserverResultV1["customerNeed"] {
  const record = isRecord(value) ? value : {};
  return {
    value: readNullableString(record.value),
    confidence: readConfidence(record.confidence),
    evidence: readStringArray(record.evidence)
  };
}

export function normalizeCommercialObserverResult(
  value: unknown
): CommercialObserverResultV1 | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;

  return {
    version: 1,
    summary: readString(value.summary, UNKNOWN_COMMERCIAL_OBSERVER_RESULT.summary),
    stage: readStage(value.stage),
    interest: readInterest(value.interest),
    objection: readNullableBlock(value.objection),
    customerNeed: readNullableBlock(value.customerNeed),
    risk: readRisk(value.risk),
    nextBestAction: readNextBestAction(value.nextBestAction),
    limitations: readStringArray(value.limitations)
  };
}

export function enforceCommercialObserverResultSafety({
  result,
  input
}: {
  result: CommercialObserverResultV1;
  input: CommercialObserverModelInput;
}): CommercialObserverResultV1 {
  let safeResult: CommercialObserverResultV1 = {
    ...result,
    summary: sanitizeSummary(result.summary)
  };

  if (!safeResult.summary) {
    safeResult.summary = UNKNOWN_COMMERCIAL_OBSERVER_RESULT.summary;
  }

  if (safeResult.stage.value !== "UNKNOWN" && !hasConcreteEvidence(safeResult.stage.evidence)) {
    safeResult = addLimitation(
      {
        ...safeResult,
        stage: { value: "UNKNOWN", confidence: 0.2, evidence: [] }
      },
      "Classificacao de etapa rebaixada por falta de evidencia concreta."
    );
  }

  if (
    safeResult.interest.value !== "UNKNOWN" &&
    !hasConcreteEvidence(safeResult.interest.evidence)
  ) {
    safeResult = addLimitation(
      {
        ...safeResult,
        interest: { value: "UNKNOWN", confidence: 0.2, evidence: [] }
      },
      "Classificacao de interesse rebaixada por falta de evidencia concreta."
    );
  }

  if (safeResult.interest.value === "HIGH" && input.recentMessages.length < 3) {
    safeResult = addLimitation(
      {
        ...safeResult,
        interest: { ...safeResult.interest, value: "MEDIUM", confidence: 0.55 }
      },
      "Interesse alto rebaixado porque ha poucas interacoes no contexto."
    );
  }

  if (safeResult.objection.value && !hasConcreteEvidence(safeResult.objection.evidence)) {
    safeResult = addLimitation(
      {
        ...safeResult,
        objection: { value: null, confidence: 0, evidence: [] }
      },
      "Objeção removida por falta de evidencia concreta."
    );
  }

  if (safeResult.customerNeed.value && !hasConcreteEvidence(safeResult.customerNeed.evidence)) {
    safeResult = addLimitation(
      {
        ...safeResult,
        customerNeed: { value: null, confidence: 0, evidence: [] }
      },
      "Necessidade do cliente removida por falta de evidencia concreta."
    );
  }

  if (hasArtificialOrInsufficientContext(input)) {
    safeResult = addLimitation(
      {
        ...safeResult,
        stage: { value: "UNKNOWN", confidence: 0.2, evidence: [] },
        interest: { value: "UNKNOWN", confidence: 0.2, evidence: [] },
        customerNeed: { value: null, confidence: 0, evidence: [] },
        nextBestAction: {
          action: "NO_ACTION",
          reason: "Contexto insuficiente para recomendacao comercial confiavel.",
          suggestedAt: null,
          confidence: 0.2
        }
      },
      "Contexto insuficiente para classificacao comercial confiavel."
    );
  }

  if (
    ["FORMALIZE", "SEND_SIMULATION", "REQUEST_DOCUMENTS", "CLOSE_LOST"].includes(
      safeResult.nextBestAction.action
    ) &&
    safeResult.nextBestAction.confidence < 0.5
  ) {
    safeResult = addLimitation(
      {
        ...safeResult,
        nextBestAction: {
          action: "NO_ACTION",
          reason: "Sem evidencia suficiente para recomendar acao comercial especifica.",
          suggestedAt: null,
          confidence: 0.2
        }
      },
      "Acao comercial especifica removida por baixa confianca."
    );
  }

  return safeResult;
}

function extractOutputText(data: unknown) {
  if (!isRecord(data)) return "";
  if (typeof data.output_text === "string") return data.output_text;

  const output = Array.isArray(data.output) ? data.output : [];
  return output
    .flatMap((item) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
    .map((content) => (isRecord(content) && typeof content.text === "string" ? content.text : ""))
    .filter(Boolean)
    .join("\n");
}

function extractJson(text: string) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) return cleaned.slice(firstBrace, lastBrace + 1);
  return cleaned;
}

export async function callCommercialObserverModel({
  input,
  fetchImpl = fetch
}: {
  input: CommercialObserverModelInput;
  fetchImpl?: typeof fetch;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new CommercialObserverError("OPENAI_API_KEY nao configurada.", "NOT_CONFIGURED");
  }

  const prompt = buildCommercialObserverPrompt(input);
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "commercial_observer_result_v1",
          strict: true,
          schema: COMMERCIAL_OBSERVER_JSON_SCHEMA
        }
      },
      temperature: 0.2
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new CommercialObserverError("Falha ao consultar IA.", "AI_REQUEST_FAILED");
  }

  const output = extractOutputText(data);
  if (!output) {
    throw new CommercialObserverError("IA retornou resposta vazia.", "INVALID_MODEL_OUTPUT");
  }

  try {
    const parsed = JSON.parse(extractJson(output));
    const normalized = normalizeCommercialObserverResult(parsed);
    if (normalized) return enforceCommercialObserverResultSafety({ result: normalized, input });
  } catch {
    // Tratado abaixo como saida invalida.
  }

  return {
    ...UNKNOWN_COMMERCIAL_OBSERVER_RESULT,
    limitations: [
      ...UNKNOWN_COMMERCIAL_OBSERVER_RESULT.limitations,
      "A IA retornou uma saida fora do contrato estruturado."
    ]
  };
}

export async function analyzeConversationWithCommercialObserver({
  conversationId,
  companyId,
  db = prisma,
  fetchImpl = fetch
}: {
  conversationId: string;
  companyId: string;
  db?: ObserverDb;
  fetchImpl?: typeof fetch;
}) {
  const input = await loadCommercialObserverContext({ conversationId, companyId, db });
  const analysis = await callCommercialObserverModel({ input, fetchImpl });
  return { analysis, input };
}
