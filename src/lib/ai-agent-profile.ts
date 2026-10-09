export const AI_AGENT_PROFILES = ["CLT"] as const;

export type AiAgentProfile =
  (typeof AI_AGENT_PROFILES)[number];

export class InvalidAiAgentProfileError extends Error {
  constructor(value: unknown) {
    super(
      `Perfil de Agente IA invalido: ${String(value ?? "")}.`
    );
    this.name = "InvalidAiAgentProfileError";
  }
}

export function parseAiAgentProfile(
  value: unknown
): AiAgentProfile | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (typeof value !== "string") {
    throw new InvalidAiAgentProfileError(value);
  }

  const candidate = value.trim();

  if (!candidate) {
    return null;
  }

  if (candidate === "CLT") {
    return "CLT";
  }

  throw new InvalidAiAgentProfileError(value);
}
