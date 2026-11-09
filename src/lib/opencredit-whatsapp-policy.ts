import type { Channel, MediaAsset } from "@prisma/client";
import type { MetaTemplate } from "./meta-whatsapp";
import { normalizeMetaTemplate } from "./meta-template-normalizer";
import { classifyPhoneNormalization } from "./phone-normalization.service";
import { authorityFingerprint } from "./conversation-authority-contract";

export type BootstrapState = "READY_TO_SEND" | "SENT" | "ALREADY_STARTED" | "CONFIGURATION_MISSING" | "CHANNEL_INVALID"
  | "TEMPLATE_UNAVAILABLE" | "IDENTITY_UNAVAILABLE" | "AUTOMATION_NOT_ALLOWED" | "SEND_FAILED" | "UNKNOWN" | "RATE_LIMITED";
export class BootstrapBlocked extends Error {
  constructor(readonly code: BootstrapState) { super(code); }
}
export function validBootstrapChannel(channel: Channel | null, companyId: string) {
  return !!channel && channel.companyId === companyId && channel.type === "whatsapp" && channel.provider === "meta"
    && ["ACTIVE", "CONNECTED"].includes(channel.status) && /^[0-9]{5,40}$/.test(channel.phoneNumberId ?? "") && !!channel.wabaId?.trim();
}
export function bootstrapPhone(contact: { phone: string; normalizedPhone: string | null; archivedAt: Date | null }) {
  if (contact.archivedAt) return null;
  const normalized = classifyPhoneNormalization(contact.phone).normalizedPhone;
  return normalized && (!contact.normalizedPhone || contact.normalizedPhone === normalized) ? normalized : null;
}
export type BootstrapVariableMapping = "CONTACT_NAME" | "NONE" | null;
export type BootstrapTemplateReason = "NOT_APPROVED" | "NOT_READY" | "UNSUPPORTED_HEADER" | "MEDIA_REQUIRED" | "MEDIA_NOT_READY"
  | "UNSUPPORTED_COMPONENT" | "VARIABLE_MAPPING_REQUIRED" | "TOO_MANY_VARIABLES" | "UNSUPPORTED_VARIABLE";
export type BootstrapMediaBinding = { assetId: string; fingerprint: string };
export type BootstrapLocalTemplate = { companyId: string; wabaId: string; isActive: boolean; operationalStatus: string; defaultHeaderMediaAssetId: string | null };
export function analyzeOpenCreditBootstrapTemplate(template: MetaTemplate, local: BootstrapLocalTemplate, mapping: BootstrapVariableMapping,
  media: BootstrapMediaBinding | null = null) {
  let n: ReturnType<typeof normalizeMetaTemplate>;
  try { n = normalizeMetaTemplate(template); } catch {
    return { eligible: false, reason: "UNSUPPORTED_COMPONENT" as const, requiresImage: false, bodyVariables: [] as number[], supportedVariableMappings: [] as Array<"CONTACT_NAME" | "NONE"> };
  }
  const bodyVariables = n.body.variables;
  const base = { requiresImage: n.header.format === "IMAGE", bodyVariables, supportedVariableMappings: bodyVariables.length === 1 && bodyVariables[0] === 1
    ? ["CONTACT_NAME" as const] : n.header.format === "IMAGE" && bodyVariables.length === 0 ? ["NONE" as const] : [] };
  const reject = (reason: BootstrapTemplateReason) => ({ ...base, eligible: false, reason });
  if (n.status !== "APPROVED") return reject("NOT_APPROVED");
  if (!local.isActive || local.operationalStatus !== "READY") return reject("NOT_READY");
  if (n.header.present && !["TEXT", "IMAGE"].includes(n.header.format ?? "")) return reject("UNSUPPORTED_HEADER");
  if (n.header.variables.length || /{{|}}/.test(n.header.text)) return reject("UNSUPPORTED_HEADER");
  if (n.unknownComponents.length || n.unknownButtonTypes.length || n.compatibility.hasUnsupportedDynamicButtons
    || /{{|}}/.test(n.footer.text) || n.buttons.some(b => /{{|}}/.test(JSON.stringify([b.text, b.url, b.phoneNumber])))) return reject("UNSUPPORTED_COMPONENT");
  const types = (template.components ?? []).map(c => typeof c.type === "string" ? c.type.toUpperCase() : "");
  if (types.some(t => !["HEADER", "BODY", "FOOTER", "BUTTONS"].includes(t)) || types.filter(t => t === "BODY").length !== 1
    || types.some(t => types.filter(v => v === t).length !== 1) || !n.body.text.trim()) return reject("UNSUPPORTED_COMPONENT");
  if (/{{|}}/.test(n.body.text.replace(/\{\{1\}\}/g, ""))) {
    if (bodyVariables.length > 1) return reject("TOO_MANY_VARIABLES");
    return reject("UNSUPPORTED_VARIABLE");
  }
  if (bodyVariables.length > 1) return reject("TOO_MANY_VARIABLES");
  if (bodyVariables.length ? mapping !== "CONTACT_NAME" : base.requiresImage ? mapping !== "NONE" : mapping !== null) return reject("VARIABLE_MAPPING_REQUIRED");
  if (base.requiresImage && !local.defaultHeaderMediaAssetId) return reject("MEDIA_REQUIRED");
  if (base.requiresImage && (!media || media.assetId !== local.defaultHeaderMediaAssetId)) return reject("MEDIA_NOT_READY");
  return { ...base, eligible: true, reason: null };
}
export function resolveBootstrapVariables(name: string, mapping: BootstrapVariableMapping): string[] | null {
  if (mapping === null || mapping === "NONE") return [];
  const value = name.normalize("NFKC").trim().replace(/ +/g, " ");
  if (value.length > 120 || !new RegExp("^[\\p{L}\\p{M} .'’-]+$", "u").test(value) || (value.match(new RegExp("\\p{L}", "gu"))?.length ?? 0) < 2
    || /^(?:cliente|contato|sem nome|whatsapp)$/i.test(value)) return null;
  return [value];
}
export function validBootstrapMediaAsset(asset: MediaAsset | null, companyId: string) {
  return !!asset && asset.companyId === companyId && asset.status === "READY" && asset.type === "TEMPLATE_HEADER_IMAGE"
    && ["image/jpeg", "image/png"].includes(asset.mimeType) && asset.sizeBytes > 0 && asset.sizeBytes <= 5 * 1024 * 1024
    && !!asset.storageProvider && !!asset.storageKey;
}
export function bootstrapTemplateFingerprint(template: MetaTemplate, wabaId: string, binding?: {
  mapping: BootstrapVariableMapping; variables: readonly string[]; media: BootstrapMediaBinding | null;
}) {
  if (binding && (binding.mapping || binding.media)) return authorityFingerprint({ version: 2, name: template.name, language: template.language,
    wabaId, components: template.components ?? [], ...binding });
  return authorityFingerprint({ name: template.name, language: template.language, wabaId, components: template.components ?? [] });
}
