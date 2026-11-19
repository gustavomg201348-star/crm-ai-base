export type OpenCreditTemplateButtonAction = "CHECK" | "BLOCK" | null;

export const OPEN_CREDIT_CHECK_FIRST_REPLY =
  "Perfeito! Vamos verificar agora mesmo.\nAntes me conta: Você tem algum valor de parcela ou liberado que gostaria em específico?";

export const OPEN_CREDIT_BLOCK_FIRST_REPLY =
  "Tudo bem! Não vamos prosseguir com a consulta. Se mudar de ideia depois, é só me chamar.";

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
  const type = input.type ?? "";
  const text = normalizeButtonText(input.body ?? "");
  if (!text) return null;

  // Some Meta template quick replies arrive as plain text. In that case, accept
  // only the exact configured command words so ordinary customer sentences are untouched.
  if (type === "text") {
    if (text === "bloquear") return "BLOCK";
    if (text === "conferir" || text === "verificar") return "CHECK";
    return null;
  }

  if (!["button", "interactive"].includes(type)) return null;
  if (/\bbloquear\b/.test(text)) return "BLOCK";
  if (/\b(?:conferir|verificar)\b/.test(text)) return "CHECK";
  return null;
}
