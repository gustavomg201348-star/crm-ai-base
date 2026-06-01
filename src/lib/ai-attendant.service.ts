import { analyzeConversation } from "@/lib/ai-analysis";
import {
  getConversationIntegration,
  saveOutboundMessage
} from "@/lib/conversation-message.service";
import { conversationInclude, mapConversation } from "@/lib/conversations";
import { prisma } from "@/lib/db";
import { readMetaMessageId, sendMetaTextMessage } from "@/lib/meta-whatsapp";

export type AiMode = "OFF" | "COPILOT" | "AUTO" | "HYBRID";

export type AiSuggestion = {
  summary: string;
  temperature: "HOT" | "WARM" | "COLD";
  nextAction: string;
  suggestedReply: string;
  confidence: number;
  tags: string[];
  shouldTransferToHuman: boolean;
  source: "openai" | "fallback";
};

const allowedModes = new Set<AiMode>(["OFF", "COPILOT", "AUTO", "HYBRID"]);

export function normalizeAiMode(value?: string | null): AiMode {
  const normalized = String(value ?? "COPILOT").toUpperCase() as AiMode;
  return allowedModes.has(normalized) ? normalized : "COPILOT";
}

export function shouldAutoReply({
  companyMode,
  conversationMode,
  aiPaused,
  agentId
}: {
  companyMode?: string | null;
  conversationMode?: string | null;
  aiPaused?: boolean | null;
  agentId?: string | null;
}) {
  if (aiPaused) return false;

  const mode = normalizeAiMode(conversationMode || companyMode);
  if (mode === "AUTO") return true;

  // Hibrido deixa a IA conduzir somente leads ainda sem responsavel humano.
  return mode === "HYBRID" && !agentId;
}

function extractJson(text: string) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

function fallbackSuggestion(conversation: Awaited<ReturnType<typeof loadAiContext>>) {
  const analysis = analyzeConversation(conversation);
  return {
    ...analysis,
    tags: [],
    shouldTransferToHuman: false,
    source: "fallback" as const
  };
}

async function loadAiContext(conversationId: string, companyId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, contact: { companyId } },
    include: conversationInclude
  });

  if (!conversation) throw new Error("Conversa nao encontrada.");
  return conversation;
}

function buildPrompt({
  companyName,
  segment,
  instructions,
  contactName,
  contactPhone,
  transcript
}: {
  companyName: string;
  segment?: string | null;
  instructions?: string | null;
  contactName: string;
  contactPhone: string;
  transcript: string;
}) {
  return [
    "Voce e um copiloto de atendimento para um CRM brasileiro de credito consignado/CLT.",
    "Responda em portugues do Brasil, com linguagem curta, educada, humana e boa para WhatsApp.",
    "Regras obrigatorias:",
    "- Nunca prometa aprovacao, margem, liberacao, taxa ou prazo sem dados reais do sistema.",
    "- Nao invente simulacao, banco, valor liberado ou proposta.",
    "- Se faltar dado essencial, faca apenas uma pergunta por vez.",
    "- Se o cliente demonstrar irritacao, duvida juridica, pedido sensivel ou caso complexo, sinalize transferencia humana.",
    "- CPF so deve ser pedido quando for necessario para consulta/simulacao.",
    "- Nao use emojis em excesso.",
    "Retorne somente JSON valido com as chaves: summary, temperature, nextAction, suggestedReply, confidence, tags, shouldTransferToHuman.",
    `Empresa: ${companyName}`,
    `Contexto comercial: ${segment || "Correspondente bancario com foco em consignado e CLT."}`,
    instructions ? `Instrucoes internas: ${instructions}` : "",
    `Cliente: ${contactName} (${contactPhone})`,
    "Transcricao recente:",
    transcript || "Sem mensagens recentes."
  ]
    .filter(Boolean)
    .join("\n");
}

async function callOpenAi(prompt: string): Promise<Partial<AiSuggestion> | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      input: prompt,
      temperature: 0.35
    })
  });

  const data = (await response.json().catch(() => null)) as
    | { output_text?: string; error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(data?.error?.message || "Falha ao consultar IA.");
  }

  const output = data?.output_text;
  if (!output) return null;

  try {
    return JSON.parse(extractJson(output)) as Partial<AiSuggestion>;
  } catch {
    return {
      suggestedReply: output.slice(0, 1200),
      source: "openai"
    };
  }
}

export async function generateAiSuggestion({
  conversationId,
  companyId
}: {
  conversationId: string;
  companyId: string;
}): Promise<{ suggestion: AiSuggestion; conversation: ReturnType<typeof mapConversation> }> {
  const conversation = await loadAiContext(conversationId, companyId);
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, segment: true, aiInstructions: true }
  });
  const recentMessages = conversation.messages.slice(-16);
  const transcript = recentMessages
    .map((message) =>
      `${message.direction === "inbound" ? "Cliente" : "Atendente"}: ${message.body}`
    )
    .join("\n");

  const fallback = fallbackSuggestion(conversation);
  const prompt = buildPrompt({
    companyName: company?.name ?? "CRM",
    segment: company?.segment,
    instructions: company?.aiInstructions,
    contactName: conversation.contact.name,
    contactPhone: conversation.contact.phone,
    transcript
  });

  const openAiSuggestion = await callOpenAi(prompt).catch(() => null);
  const suggestion: AiSuggestion = {
    summary: String(openAiSuggestion?.summary || fallback.summary),
    temperature: normalizeTemperature(openAiSuggestion?.temperature, fallback.temperature),
    nextAction: String(openAiSuggestion?.nextAction || fallback.nextAction),
    suggestedReply: String(openAiSuggestion?.suggestedReply || fallback.suggestedReply),
    confidence: normalizeConfidence(openAiSuggestion?.confidence, fallback.confidence),
    tags: Array.isArray(openAiSuggestion?.tags)
      ? openAiSuggestion.tags.map(String).slice(0, 4)
      : [],
    shouldTransferToHuman: Boolean(openAiSuggestion?.shouldTransferToHuman),
    source: openAiSuggestion ? "openai" : "fallback"
  };

  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      aiLastSuggestion: suggestion.suggestedReply,
      summary: `${suggestion.summary}\n\nProxima acao: ${suggestion.nextAction}`,
      contact: {
        update: {
          temperature: suggestion.temperature,
          lastMessage: suggestion.nextAction
        }
      }
    },
    include: conversationInclude
  });

  return { suggestion, conversation: mapConversation(updated) };
}

function normalizeTemperature(value: unknown, fallback: AiSuggestion["temperature"]) {
  const normalized = String(value || fallback).toUpperCase();
  if (normalized === "HOT" || normalized === "WARM" || normalized === "COLD") {
    return normalized;
  }
  return fallback;
}

function normalizeConfidence(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(99, Math.max(1, Math.round(number)));
}

export async function updateConversationAiMode({
  conversationId,
  companyId,
  mode,
  paused
}: {
  conversationId: string;
  companyId: string;
  mode?: string | null;
  paused?: boolean;
}) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, contact: { companyId } }
  });

  if (!conversation) throw new Error("Conversa nao encontrada.");

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      ...(mode !== undefined ? { aiMode: mode ? normalizeAiMode(mode) : null } : {}),
      ...(paused !== undefined ? { aiPaused: paused } : {})
    },
    include: conversationInclude
  });

  return mapConversation(updated);
}

export async function maybeSendAutomaticAiReply({
  conversationId,
  companyId
}: {
  conversationId: string;
  companyId: string;
}) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, contact: { companyId } },
    include: { contact: true }
  });
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { aiMode: true }
  });

  if (!conversation || !company) return null;
  if (
    !shouldAutoReply({
      companyMode: company.aiMode,
      conversationMode: conversation.aiMode,
      aiPaused: conversation.aiPaused,
      agentId: conversation.agentId
    })
  ) {
    return null;
  }

  // Sem chave de IA, o automatico fica protegido para nao enviar resposta generica.
  if (!process.env.OPENAI_API_KEY) return null;

  const { suggestion } = await generateAiSuggestion({ conversationId, companyId });
  if (!suggestion.suggestedReply || suggestion.shouldTransferToHuman) return null;

  const { channel } = await getConversationIntegration({ conversationId, companyId });
  const metaResponse = await sendMetaTextMessage({
    phoneNumberId: channel.phoneNumberId!,
    accessToken: channel.accessToken!,
    to: conversation.contact.phone,
    body: suggestion.suggestedReply
  });

  return saveOutboundMessage({
    conversationId,
    body: suggestion.suggestedReply,
    type: "text",
    providerMessageId: readMetaMessageId(metaResponse),
    status: "sent",
    senderType: "ai"
  });
}
