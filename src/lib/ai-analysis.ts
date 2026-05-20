import type { ConversationWithRelations } from "@/lib/conversations";
import type { LeadTemperature } from "@/lib/contacts";

const hotWords = ["quero", "pode", "sim", "saldo", "liberacao", "proposta", "hoje"];
const coldWords = ["depois", "talvez", "nao", "sem interesse", "parar"];

function scoreMessages(text: string) {
  const lower = text.toLowerCase();
  const hotScore = hotWords.filter((word) => lower.includes(word)).length;
  const coldScore = coldWords.filter((word) => lower.includes(word)).length;

  return hotScore - coldScore;
}

export function analyzeConversation(conversation: ConversationWithRelations) {
  const messages = conversation.messages.map((message) => message.body);
  const transcript = messages.join(" ");
  const score = scoreMessages(transcript);
  const lastInbound = [...conversation.messages]
    .reverse()
    .find((message) => message.direction === "inbound");

  const temperature: LeadTemperature =
    score >= 2 ? "HOT" : score <= -1 ? "COLD" : "WARM";

  const summary =
    messages.length === 0
      ? "Conversa ainda sem mensagens registradas."
      : `${conversation.contact.name} demonstrou interesse via ${conversation.channel}. ${lastInbound ? `Ultimo ponto do cliente: "${lastInbound.body}".` : "Ainda nao houve nova resposta do cliente."}`;

  const nextAction =
    temperature === "HOT"
      ? "Priorizar atendimento e conduzir para proposta ou simulacao."
      : temperature === "WARM"
        ? "Fazer follow-up objetivo, removendo duvidas e pedindo confirmacao."
        : "Colocar em nutricao e retomar com abordagem curta em outro momento.";

  const suggestedReply =
    temperature === "HOT"
      ? "Perfeito. Vou te passar uma opcao objetiva agora e, se fizer sentido, ja seguimos para formalizar."
      : temperature === "WARM"
        ? "Consigo te ajudar com isso. Me confirma por favor qual opcao voce prefere avaliar primeiro?"
        : "Tudo bem. Posso deixar seu contato salvo e te chamar quando tivermos uma condicao melhor?";

  return {
    summary,
    temperature,
    nextAction,
    suggestedReply,
    confidence: Math.min(95, Math.max(58, 70 + score * 8))
  };
}
