import type { AiMode } from "./ai-attendant.service";

export type CompanyAiSettings = {
  mode: AiMode;
  instructions: string;
  checkAutoReplyOverride: boolean | null;
  checkAutoReplyEnabled: boolean;
  providerConfigured: boolean;
};

export function resolveCltCheckAutoReply(override: boolean | null | undefined, legacyValue: string | undefined) {
  return override ?? legacyValue === "true";
}

export function parseCompanyAiSettingsUpdate(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !["mode", "instructions", "checkAutoReplyOverride"].includes(key))) return null;
  const { mode, instructions, checkAutoReplyOverride } = value as Record<string, unknown>;
  if ("mode" in value && (typeof mode !== "string" || !["OFF", "COPILOT", "AUTO", "HYBRID"].includes(mode))) return null;
  if ("instructions" in value && typeof instructions !== "string") return null;
  if ("checkAutoReplyOverride" in value && checkAutoReplyOverride !== null && typeof checkAutoReplyOverride !== "boolean") return null;
  return {
    ...(typeof mode === "string" ? { aiMode: mode } : {}),
    ...(typeof instructions === "string" ? { aiInstructions: instructions.trim() || null } : {}),
    ...(typeof checkAutoReplyOverride === "boolean" || checkAutoReplyOverride === null ? { cltCheckAutoReplyEnabled: checkAutoReplyOverride } : {})
  };
}
