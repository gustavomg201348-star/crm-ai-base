export type OpenCreditTemplateButtonAction = "CHECK" | "BLOCK" | null;

export const OPEN_CREDIT_CHECK_FIRST_REPLY =
  "Perfeito! Vamos verificar agora mesmo.\nAntes me conta: Você tem algum valor de parcela ou liberado que gostaria em específico?";

function normalizeButtonText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^resposta interativa:\s*/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function classifyOpenCreditTemplateButton(
  input: { type?: string | null; body?: string | null }
): OpenCreditTemplateButtonAction {
  if (!["button", "interactive"].includes(input.type ?? "")) return null;
  const text = normalizeButtonText(input.body ?? "");
  if (!text) return null;
  if (/\bbloquear\b/.test(text)) return "BLOCK";
  if (/\b(?:conferir|verificar)\b/.test(text)) return "CHECK";
  return null;
}
