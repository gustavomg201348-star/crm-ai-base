import { validateChatbotDefinition } from "./chatbot-definition";

// Inert definition only: no publication, campaign binding or message sending.
export function buildCltQualificationDefinition() {
  return validateChatbotDefinition({
    schemaVersion: 1,
    entryStepId: "proposal",
    steps: [
      { id: "proposal", type: "BUTTONS", text: "Tudo bem? Antes de verificar as melhores condições para você, me conta uma coisa: já recebeu alguma proposta de crédito pela Carteira de Trabalho Digital ou por outra empresa?", options: [
        { id: "clt_received", title: "Já recebi", next: "competitor" },
        { id: "clt_not_received", title: "Ainda não recebi", next: "need" },
        { id: "clt_human", title: "Falar com atendente", next: "handoff" }
      ] },
      { id: "competitor", type: "INPUT", text: "Perfeito! Você consegue me informar qual foi o melhor valor que te ofereceram até agora, o valor da parcela e em quantas vezes? Assim consigo verificar se temos uma condição mais vantajosa para você. Se não lembrar, pode informar isso.", variable: "competitor_offer", maxLength: 500, next: "handoff" },
      { id: "need", type: "BUTTONS", text: "Certo! Você tem algum valor específico que precisa neste momento ou prefere que eu verifique o maior valor disponível para você?", options: [
        { id: "clt_specific_amount", title: "Tenho um valor", next: "amount" },
        { id: "clt_max_amount", title: "Maior valor", next: "handoff" },
        { id: "clt_human_need", title: "Falar com atendente", next: "handoff" }
      ] },
      { id: "amount", type: "INPUT", text: "Qual valor você precisa? Assim consigo direcionar melhor sua consulta.", variable: "desired_amount", maxLength: 120, next: "handoff" },
      { id: "handoff", type: "HANDOFF", queue: "DEFAULT" }
    ]
  });
}
