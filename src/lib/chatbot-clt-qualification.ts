import { validateChatbotDefinition } from "./chatbot-definition";

export const CLT_NO_OFFER_DETAILS = "nao lembro";

export function hasNoCltOfferDetails(text: string) {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
  return /^(nao (me )?(lembro|recordo|sei)( (das|as) condicoes)?|esqueci)$/.test(normalized);
}
export function buildCltQualificationDefinition() {
  return validateChatbotDefinition({
    schemaVersion: 1,
    entryStepId: "proposal",
    steps: [
      { id: "proposal", type: "BUTTONS", variable: "proposal_status", text: "Tudo bem? Antes de verificar as melhores condições para você, me conta uma coisa: já recebeu alguma proposta de crédito pela Carteira de Trabalho Digital ou por outra empresa?", options: [
        { id: "clt_received", title: "Já recebi", next: "competitor" },
        { id: "clt_not_received", title: "Ainda não recebi", next: "need" },
        { id: "clt_human", title: "Falar com atendente", next: "final_message" }
      ] },
      { id: "competitor", type: "INPUT", text: "Perfeito! Você consegue me informar qual foi o melhor valor que te ofereceram até agora, o valor da parcela e em quantas vezes? Assim consigo verificar se temos uma condição mais vantajosa para você. Se não lembrar das condições, digite “não lembro”.", variable: "competitor_offer", maxLength: 500, next: "competitor_check" },
      { id: "competitor_check", type: "CONDITION", variable: "competitor_offer",
        branches: [{ equals: CLT_NO_OFFER_DETAILS, next: "priority" }], otherwise: "final_message" },
      { id: "priority", type: "BUTTONS", text: "Sem problema! Qual é sua prioridade?", variable: "priority", options: [
        { id: "clt_priority_amount", title: "Maior valor", next: "final_message" },
        { id: "clt_priority_installment", title: "Menor parcela", next: "final_message" },
        { id: "clt_priority_term", title: "Menor prazo", next: "final_message" }
      ] },
      { id: "need", type: "BUTTONS", variable: "credit_need", text: "Certo! Você tem algum valor específico que precisa neste momento ou prefere que eu verifique o maior valor disponível para você?", options: [
        { id: "clt_specific_amount", title: "Tenho um valor", next: "amount" },
        { id: "clt_max_amount", title: "Maior valor", next: "final_message" },
        { id: "clt_human_need", title: "Falar com atendente", next: "final_message" }
      ] },
      { id: "amount", type: "INPUT", text: "Qual valor você precisa? Assim consigo direcionar melhor sua consulta.", variable: "desired_amount", maxLength: 120, next: "final_message" },
      { id: "final_message", type: "TEXT", text: "Perfeito! Vou direcionar seu atendimento para nossa equipe verificar as melhores condições disponíveis para você. 😊", next: "handoff" },
      { id: "handoff", type: "HANDOFF", queue: "DEFAULT" }
    ]
  });
}
