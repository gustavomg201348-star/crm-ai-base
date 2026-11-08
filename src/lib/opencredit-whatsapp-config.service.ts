import type { Channel, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { authorityStorage } from "./conversation-authority-storage";
import { BootstrapBlocked, validBootstrapChannel } from "./opencredit-whatsapp-policy";

export type WhatsappBootstrapConfigInput = { defaultWhatsappChannelId: string | null; initialTemplateName: string | null;
  initialTemplateLanguage: string | null; autoStartEnabled: boolean; expectedRevision: number };
export type BootstrapTemplateChoice = { name: string; language: string };
export type WhatsappConfigDependencies = { db: PrismaClient; provider: "postgresql" | "sqlite";
  credential(channel: Channel): void;
  templates(input: { companyId: string; channelId: string }): Promise<BootstrapTemplateChoice[]> };
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export function parseWhatsappBootstrapConfig(value: unknown): WhatsappBootstrapConfigInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "autoStartEnabled,defaultWhatsappChannelId,expectedRevision,initialTemplateLanguage,initialTemplateName"
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
      select: { id: true, companyId: true, providerScope: true } });
    if (!i?.providerScope) throw new BootstrapBlocked("CONFIGURATION_MISSING");
    return i;
  }
  function eligible(c: Channel | null, companyId: string) {
    if (!validBootstrapChannel(c, companyId)) return false;
    try { deps.credential(c!); return true; } catch { return false; }
  }
  return {
    async read(companyId: string, integrationId: string, requestedChannelId?: string) {
      await integration(companyId, integrationId);
      const [config, rows] = await Promise.all([
        deps.db.openCreditWhatsappConfig.findFirst({ where: { integrationId, companyId }, select: {
          defaultWhatsappChannelId: true, initialTemplateName: true, initialTemplateLanguage: true, autoStartEnabled: true, revision: true,
        } }),
        deps.db.channel.findMany({ where: { companyId, provider: "meta", type: "whatsapp", status: { in: ["ACTIVE", "CONNECTED"] } }, orderBy: { id: "asc" } }),
      ]);
      const channels = rows.filter(c => eligible(c, companyId)).map(c => ({ id: c.id, name: c.name }));
      const selected = requestedChannelId ?? config?.defaultWhatsappChannelId;
      const templates = selected && channels.some(c => c.id === selected) ? await deps.templates({ companyId, channelId: selected }) : [];
      return { config: config ?? { defaultWhatsappChannelId: null, initialTemplateName: null, initialTemplateLanguage: null,
        autoStartEnabled: false, revision: 0 }, channels, templates };
    },
    async save(actor: SessionUser, integrationId: string, input: WhatsappBootstrapConfigInput) {
      if (actor.role !== "ADMIN" || !parseWhatsappBootstrapConfig(input)) throw new BootstrapBlocked("CONFIGURATION_MISSING");
      const i = await integration(actor.companyId, integrationId);
      if (input.defaultWhatsappChannelId) {
        const channel = await deps.db.channel.findFirst({ where: { id: input.defaultWhatsappChannelId, companyId: actor.companyId } });
        if (!eligible(channel, actor.companyId)) throw new BootstrapBlocked("CHANNEL_INVALID");
        if (input.initialTemplateName && !(await deps.templates({ companyId: actor.companyId, channelId: channel!.id })).some(t =>
          t.name === input.initialTemplateName && t.language === input.initialTemplateLanguage)) throw new BootstrapBlocked("TEMPLATE_UNAVAILABLE");
      } else if (input.initialTemplateName) throw new BootstrapBlocked("CHANNEL_INVALID");
      await storage.transaction(async tx => {
        await storage.actor(tx, actor.companyId, actor.id, true);
        const current = await tx.openCreditWhatsappConfig.findUnique({ where: { integrationId } });
        const { expectedRevision, ...data } = input;
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
