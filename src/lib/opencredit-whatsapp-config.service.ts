import type { Channel, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { authorityStorage } from "./conversation-authority-storage";
import { BootstrapBlocked, validBootstrapChannel, type BootstrapVariableMapping, type BootstrapTemplateReason } from "./opencredit-whatsapp-policy";

export type WhatsappBootstrapConfigInput = { defaultWhatsappChannelId: string | null; initialTemplateName: string | null;
  initialTemplateLanguage: string | null; initialTemplateVariableMapping?: BootstrapVariableMapping; autoStartEnabled: boolean; expectedRevision: number };
export type BootstrapTemplateChoice = { name: string; language: string; eligible: boolean; reason: BootstrapTemplateReason | null;
  requiresImage: boolean; mediaReady: boolean; bodyVariables: number[]; supportedVariableMappings: Array<"CONTACT_NAME" | "NONE"> };
export type WhatsappConfigDependencies = { db: PrismaClient; provider: "postgresql" | "sqlite";
  credential(channel: Channel): void;
  canAutomate(input: { companyMode?: string | null }): boolean;
  templates(input: { companyId: string; channelId: string }): Promise<BootstrapTemplateChoice[]> };
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export function parseWhatsappBootstrapConfig(value: unknown): WhatsappBootstrapConfigInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).filter(k => k !== "initialTemplateVariableMapping").sort().join() !== "autoStartEnabled,defaultWhatsappChannelId,expectedRevision,initialTemplateLanguage,initialTemplateName"
    || !(v.initialTemplateVariableMapping === undefined || v.initialTemplateVariableMapping === null || v.initialTemplateVariableMapping === "CONTACT_NAME" || v.initialTemplateVariableMapping === "NONE")
    || typeof v.autoStartEnabled !== "boolean" || !Number.isSafeInteger(v.expectedRevision) || Number(v.expectedRevision) < 0
    || !(v.defaultWhatsappChannelId === null || validId(v.defaultWhatsappChannelId))
    || !(v.initialTemplateName === null || typeof v.initialTemplateName === "string" && /^[a-z0-9_]{1,512}$/.test(v.initialTemplateName))
    || !(v.initialTemplateLanguage === null || typeof v.initialTemplateLanguage === "string" && /^[a-z]{2,3}(?:_[A-Za-z]{2})?$/.test(v.initialTemplateLanguage))
    || (v.initialTemplateName === null) !== (v.initialTemplateLanguage === null)
    || (v.autoStartEnabled && (!v.defaultWhatsappChannelId || !v.initialTemplateName || !v.initialTemplateLanguage))) return null;
  return v as WhatsappBootstrapConfigInput;
}
export function createOpenCreditWhatsappConfigService(deps: WhatsappConfigDependencies) {
  const storage = authorityStorage(deps);
  async function integration(companyId: string, integrationId: string) {
    const i = await deps.db.openCreditIntegration.findFirst({ where: { id: integrationId, companyId },
      select: { id: true, companyId: true, providerScope: true, enabled: true, paused: true, materializationEnabled: true, passiveInboundEnabled: true } });
    if (!i?.providerScope) throw new BootstrapBlocked("CONFIGURATION_MISSING");
    return i;
  }
  function eligible(c: Channel | null, companyId: string) {
    if (!validBootstrapChannel(c, companyId)) return false;
    try { deps.credential(c!); return true; } catch { return false; }
  }
  return {
    async read(companyId: string, integrationId: string, requestedChannelId?: string) {
      const i = await integration(companyId, integrationId);
      const [config, rows] = await Promise.all([
        deps.db.openCreditWhatsappConfig.findFirst({ where: { integrationId, companyId, providerScope: i.providerScope! }, select: {
          defaultWhatsappChannelId: true, initialTemplateName: true, initialTemplateLanguage: true, initialTemplateVariableMapping: true, autoStartEnabled: true, revision: true,
        } }),
        deps.db.channel.findMany({ where: { companyId, provider: "meta", type: "whatsapp", status: { in: ["ACTIVE", "CONNECTED"] } }, orderBy: { id: "asc" } }),
      ]);
      const channels = rows.filter(c => eligible(c, companyId)).map(c => ({ id: c.id, name: c.name }));
      const selected = requestedChannelId ?? config?.defaultWhatsappChannelId;
      const templates = selected && channels.some(c => c.id === selected) ? await deps.templates({ companyId, channelId: selected }) : [];
      const savedTemplates = config?.defaultWhatsappChannelId && config.defaultWhatsappChannelId !== selected && channels.some(c => c.id === config.defaultWhatsappChannelId)
        ? await deps.templates({ companyId, channelId: config.defaultWhatsappChannelId }) : selected === config?.defaultWhatsappChannelId ? templates : [];
      const saved = savedTemplates.find(t => t.name === config?.initialTemplateName && t.language === config?.initialTemplateLanguage);
      const company = await deps.db.company.findUnique({ where: { id: companyId }, select: { aiMode: true } });
      const mappingReady = !!saved && (saved.bodyVariables.length ? config?.initialTemplateVariableMapping === "CONTACT_NAME"
        : saved.requiresImage ? config?.initialTemplateVariableMapping === "NONE" : !config?.initialTemplateVariableMapping);
      const channelReady = !!config?.defaultWhatsappChannelId && channels.some(c => c.id === config.defaultWhatsappChannelId);
      const automatic = !!company && deps.canAutomate({ companyMode: company.aiMode });
      const gateValid = !i.enabled && !i.paused && i.materializationEnabled && i.passiveInboundEnabled;
      const readiness = { channel: channelReady ? "READY" : "NOT_CONFIGURED", template: !config?.initialTemplateName ? "NOT_CONFIGURED" : saved?.eligible ? "READY" : "PENDING",
        media: !saved?.requiresImage ? "NOT_REQUIRED" : saved.mediaReady ? "READY" : "PENDING", variables: mappingReady ? "READY" : "PENDING",
        ai: automatic ? company!.aiMode.toUpperCase() : "NOT_AUTOMATIC", autoStart: config?.autoStartEnabled ? "ON" : "OFF", reason: saved?.reason ?? null,
        readyIfEnabled: channelReady && !!saved?.eligible && mappingReady && !!company && gateValid };
      return { config: config ?? { defaultWhatsappChannelId: null, initialTemplateName: null, initialTemplateLanguage: null,
        initialTemplateVariableMapping: null, autoStartEnabled: false, revision: 0 }, channels, templates, readiness };
    },
    async save(actor: SessionUser, integrationId: string, input: WhatsappBootstrapConfigInput) {
      if (actor.role !== "ADMIN" || !parseWhatsappBootstrapConfig(input)) throw new BootstrapBlocked("CONFIGURATION_MISSING");
      const i = await integration(actor.companyId, integrationId);
      if (input.defaultWhatsappChannelId) {
        const channel = await deps.db.channel.findFirst({ where: { id: input.defaultWhatsappChannelId, companyId: actor.companyId } });
        if (!eligible(channel, actor.companyId)) throw new BootstrapBlocked("CHANNEL_INVALID");
        if (input.initialTemplateName && !(await deps.templates({ companyId: actor.companyId, channelId: channel!.id })).some(t =>
          t.eligible && t.name === input.initialTemplateName && t.language === input.initialTemplateLanguage
          && (t.bodyVariables.length ? input.initialTemplateVariableMapping === "CONTACT_NAME" : t.requiresImage ? input.initialTemplateVariableMapping === "NONE" : !input.initialTemplateVariableMapping))) throw new BootstrapBlocked("TEMPLATE_UNAVAILABLE");
      } else if (input.initialTemplateName) throw new BootstrapBlocked("CHANNEL_INVALID");
      await storage.transaction(async tx => {
        if ((await storage.actor(tx, actor.companyId, actor.id, true)).role !== "ADMIN") throw new BootstrapBlocked("CONFIGURATION_MISSING");
        const current = await tx.openCreditWhatsappConfig.findUnique({ where: { integrationId } });
        const { expectedRevision, ...raw } = input;
        const data = { ...raw, providerScope: i.providerScope!, initialTemplateVariableMapping: input.initialTemplateVariableMapping ?? null,
          ...(current && current.autoStartEnabled === input.autoStartEnabled ? { updatedAt: current.updatedAt } : {}) };
        if ((current?.revision ?? 0) !== expectedRevision) throw new BootstrapBlocked("CONFIGURATION_MISSING");
        if (input.defaultWhatsappChannelId) {
          const c = await tx.channel.findFirst({ where: { id: input.defaultWhatsappChannelId, companyId: actor.companyId } });
          if (!eligible(c, actor.companyId)) throw new BootstrapBlocked("CHANNEL_INVALID");
        }
        if (current) await tx.openCreditWhatsappConfig.update({ where: { integrationId, companyId: actor.companyId, revision: expectedRevision },
          data: { ...data, configuredByUserId: actor.id, revision: { increment: 1 } } });
        else await tx.openCreditWhatsappConfig.create({ data: { ...data, integrationId, companyId: actor.companyId,
          providerScope: i.providerScope!, configuredByUserId: actor.id } });
      });
      return this.read(actor.companyId, integrationId);
    },
  };
}
