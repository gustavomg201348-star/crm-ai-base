import type { Channel } from "@prisma/client";
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
export function compatibleBootstrapTemplate(template: MetaTemplate) {
  const n = normalizeMetaTemplate(template);
  return n.status === "APPROVED" && n.totalVariables === 0 && !n.requiresHeaderMedia
    && !n.compatibility.hasUnsupportedDynamicButtons && !n.compatibility.hasUnsupportedDynamicHeader
    && n.unknownComponents.length === 0 && !!n.body.text.trim();
}
export function bootstrapTemplateFingerprint(template: MetaTemplate, wabaId: string) {
  return authorityFingerprint({ name: template.name, language: template.language, wabaId, components: template.components ?? [] });
}
