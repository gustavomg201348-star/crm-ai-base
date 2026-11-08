import type { Channel, PrismaClient } from "@prisma/client";
import { authorityStorage } from "./conversation-authority-storage";
import { createConversationAuthorityService } from "./conversation-authority.service";
import { createOutboundOperationService } from "./outbound-operation.service";
import { findOrCreateConversationForChannel } from "./conversation-lifecycle.service";
import { isOpenCreditConversation, openCreditChannelRef } from "./conversation-channel.service";
import { BootstrapBlocked, bootstrapPhone, bootstrapTemplateFingerprint, compatibleBootstrapTemplate, validBootstrapChannel, type BootstrapState } from "./opencredit-whatsapp-policy";
import type { MetaTemplate } from "./meta-whatsapp";
import type { sendConversationTemplate } from "./whatsapp-template.service";

type Target = { companyId: string; integrationId: string; jobId: string };
type Dependencies = { db: PrismaClient; provider: "postgresql" | "sqlite";
  credential(channel: Channel): void;
  template(input: { companyId: string; wabaId: string; templateName: string; language: string }): Promise<{ template: MetaTemplate } | null>;
  sendTemplate: typeof sendConversationTemplate;
  canAutomate(input: { companyMode?: string | null; conversationMode?: string | null; aiPaused?: boolean | null; agentId?: string | null }): boolean;
  limited(input: { companyId: string; userId: string }): Promise<boolean>;
};
export function createOpenCreditWhatsappBootstrap(deps: Dependencies) {
  const storage = authorityStorage(deps), authorities = createConversationAuthorityService(deps), operations = createOutboundOperationService(deps);
  const blocked = (code: BootstrapState): never => { throw new BootstrapBlocked(code); };
  async function channelAllowed(c: Channel | null, companyId: string) {
    if (!validBootstrapChannel(c, companyId)) return blocked("CHANNEL_INVALID");
    try { deps.credential(c!); } catch { return blocked("CHANNEL_INVALID"); }
    return c!;
  }
  async function prepare(target: Target) {
    return storage.transaction(async tx => {
      const job = await tx.openCreditLeadMaterialization.findFirst({ where: { id: target.jobId, companyId: target.companyId,
        integrationId: target.integrationId, state: "COMPLETED" }, include: { contact: true,
        conversation: { include: { channelRef: openCreditChannelRef } } } });
      if (!job?.contact || !job.conversation || !isOpenCreditConversation(job.conversation)
        || job.conversation.contactId !== job.contact.id || job.conversation.channelId !== job.channelId
        || job.conversation.channel !== "OPEN_CREDIT" || job.conversation.channelRef?.type !== "OPEN_CREDIT"
        || job.conversation.channelRef.provider !== "internal") return blocked("IDENTITY_UNAVAILABLE");
      const prior = await tx.openCreditWhatsappHandoff.findUnique({ where: { companyId_contactId: { companyId: job.companyId, contactId: job.contact.id } } });
      if (prior && (prior.jobId !== job.id || prior.integrationId !== job.integrationId || prior.providerScope !== job.providerScope
        || prior.state !== "PREPARED")) return { prior: true as const, row: prior };
      const integration = await tx.openCreditIntegration.findFirst({ where: { id: job.integrationId, companyId: job.companyId,
        providerScope: job.providerScope, enabled: false, paused: false, materializationEnabled: true, passiveInboundEnabled: true } });
      const config = await tx.openCreditWhatsappConfig.findFirst({ where: { integrationId: job.integrationId, companyId: job.companyId,
        providerScope: job.providerScope, autoStartEnabled: true } });
      if (!integration || !config?.defaultWhatsappChannelId || !config.initialTemplateName || !config.initialTemplateLanguage) return blocked("CONFIGURATION_MISSING");
      await storage.actor(tx, job.companyId, config.configuredByUserId, true);
      const channel = await channelAllowed(await tx.channel.findFirst({ where: { id: config.defaultWhatsappChannelId, companyId: job.companyId } }), job.companyId);
      const phone = bootstrapPhone(job.contact); if (!phone) return blocked("IDENTITY_UNAVAILABLE");
      const template = await deps.template({ companyId: job.companyId, wabaId: channel.wabaId!, templateName: config.initialTemplateName,
        language: config.initialTemplateLanguage });
      if (!template || !compatibleBootstrapTemplate(template.template)) return blocked("TEMPLATE_UNAVAILABLE");
      const fingerprint = bootstrapTemplateFingerprint(template.template, channel.wabaId!);
      const company = await tx.company.findUniqueOrThrow({ where: { id: job.companyId }, select: { aiMode: true } });
      if (!deps.canAutomate({ companyMode: company.aiMode, agentId: null, aiPaused: false })) return blocked("AUTOMATION_NOT_ALLOWED");
      if (deps.provider === "postgresql") await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([job.companyId,job.contact.id,channel.id])}, 0))::text`;
      const meta = await findOrCreateConversationForChannel({ db: tx, companyId: job.companyId, contactId: job.contact.id, channelId: channel.id,
        agentId: null, status: "BOT", statuses: ["OPEN", "PENDING", "BOT", "SOLD"], withCreated: true });
      if (meta.conversation.agentId || meta.conversation.status === "SOLD" || !deps.canAutomate({ companyMode: company.aiMode,
        conversationMode: meta.conversation.aiMode, aiPaused: meta.conversation.aiPaused, agentId: meta.conversation.agentId })) return blocked("AUTOMATION_NOT_ALLOWED");
      if (prior && (prior.channelId !== channel.id || prior.configRevision !== config.revision || prior.templateFingerprint !== fingerprint
        || prior.metaConversationId !== meta.conversation.id)) return blocked("CONFIGURATION_MISSING");
      const row = prior ?? await tx.openCreditWhatsappHandoff.create({ data: { companyId: job.companyId, integrationId: job.integrationId,
        providerScope: job.providerScope, jobId: job.id, contactId: job.contact.id, sourceConversationId: job.conversation.id,
        metaConversationId: meta.conversation.id, channelId: channel.id, configRevision: config.revision,
        templateName: config.initialTemplateName, templateLanguage: config.initialTemplateLanguage, templateFingerprint: fingerprint } });
      return { prior: false as const, row, actorId: config.configuredByUserId, phone };
    });
  }
  return {
    async bootstrap(target: Target): Promise<{ status: BootstrapState }> {
      let row: Awaited<ReturnType<typeof prepare>>["row"] | undefined;
      let operationId: string | undefined, token: string | undefined, dispatchAttempted = false, acceptedId: string | undefined;
      try {
        const prepared = await prepare(target); row = prepared.row;
        if (prepared.prior) return { status: row.state === "FAILED" ? "SEND_FAILED" : row.state === "UNKNOWN" ? "UNKNOWN" : "ALREADY_STARTED" };
        const scope = { companyId: row.companyId, channelId: row.channelId, conversationId: row.metaConversationId };
        const logical = "oc-whatsapp:" + row.id;
        let authority = await authorities.get(scope);
        if (!authority) {
          await authorities.initialize({ ...scope, actorUserId: prepared.actorId, logicalKey: logical + ":authority",
            reason: "OPENCREDIT_WHATSAPP_BOOTSTRAP", state: "HUMAN_QUEUE" });
          authority = await authorities.get(scope);
        }
        if (!authority || !["AI", "HUMAN_QUEUE"].includes(authority.state) || authority.ownerUserId) return blocked("AUTOMATION_NOT_ALLOWED");
        const op = await operations.prepare({ ...scope, expectedGeneration: authority.generation, logicalKey: logical, origin: "CAMPAIGN",
          actorUserId: prepared.actorId, payload: { kind: "OPENCREDIT_WHATSAPP_BOOTSTRAP", templateName: row.templateName,
            language: row.templateLanguage, fingerprint: row.templateFingerprint } });
        operationId = op.id;
        await deps.db.openCreditWhatsappHandoff.updateMany({ where: { id: row.id, state: "PREPARED", outboundOperationId: null }, data: { outboundOperationId: op.id } });
        if (!["PREPARED", "RESERVED"].includes(op.status)) return { status: "ALREADY_STARTED" };
        if (await deps.limited({ companyId: row.companyId, userId: prepared.actorId })) return { status: "RATE_LIMITED" };
        const reserved = await operations.reserve({ ...scope, operationId: op.id, expectedGeneration: authority.generation });
        if (!reserved?.reservationToken) return { status: "ALREADY_STARTED" };
        token = reserved.reservationToken;
        const handoff = row;
        await deps.sendTemplate({ conversationId: row.metaConversationId, companyId: row.companyId, userId: prepared.actorId,
          templateName: row.templateName, language: row.templateLanguage, variables: [], automation: true,
          signal: AbortSignal.timeout(20000), onProviderAccepted: id => { acceptedId = id; },
          dispatchGuard: async context => {
            await storage.transaction(async tx => {
              const config = await tx.openCreditWhatsappConfig.findFirst({ where: { integrationId: handoff.integrationId, companyId: handoff.companyId,
                providerScope: handoff.providerScope, autoStartEnabled: true, revision: handoff.configRevision,
                defaultWhatsappChannelId: handoff.channelId, initialTemplateName: handoff.templateName, initialTemplateLanguage: handoff.templateLanguage } });
              const binding = await tx.openCreditLeadMaterialization.findFirst({ where: { id: handoff.jobId, companyId: handoff.companyId,
                integrationId: handoff.integrationId, providerScope: handoff.providerScope, state: "COMPLETED", contactId: handoff.contactId,
                conversationId: handoff.sourceConversationId } });
              const integration = await tx.openCreditIntegration.findFirst({ where: { id: handoff.integrationId, companyId: handoff.companyId,
                providerScope: handoff.providerScope, enabled: false, paused: false, materializationEnabled: true, passiveInboundEnabled: true } });
              const contact = await tx.contact.findFirst({ where: { id: handoff.contactId, companyId: handoff.companyId } });
              const c = await channelAllowed(await tx.channel.findFirst({ where: { id: handoff.channelId, companyId: handoff.companyId } }), handoff.companyId);
              const conversation = await tx.conversation.findFirst({ where: { id: handoff.metaConversationId, contactId: handoff.contactId,
                channelId: handoff.channelId, contact: { companyId: handoff.companyId, archivedAt: null } } });
              const company = await tx.company.findUniqueOrThrow({ where: { id: handoff.companyId }, select: { aiMode: true } });
              if (!config || !binding || !integration || !contact || !conversation || conversation.agentId || !deps.canAutomate({ companyMode: company.aiMode,
                conversationMode: conversation.aiMode, aiPaused: conversation.aiPaused, agentId: conversation.agentId })) return blocked("AUTOMATION_NOT_ALLOWED");
              if (context.channelId !== handoff.channelId || context.phoneNumberId !== c.phoneNumberId || context.wabaId !== c.wabaId
                || context.destination !== bootstrapPhone(contact) || context.destination !== prepared.phone
                || context.templateFingerprint !== handoff.templateFingerprint) return blocked("IDENTITY_UNAVAILABLE");
            });
            // This one-use durable permit is committed BEFORE the first provider call.
            dispatchAttempted = true;
            await operations.authorizeDispatch({ ...scope, operationId: op.id, token: token!, expectedGeneration: authority!.generation });
            const changed = await deps.db.openCreditWhatsappHandoff.updateMany({ where: { id: handoff.id, state: "PREPARED", outboundOperationId: op.id }, data: { state: "DISPATCHING" } });
            if (changed.count !== 1) throw new Error("BOOTSTRAP_DISPATCH_UNCERTAIN");
          } });
        if (!acceptedId) throw new Error("BOOTSTRAP_OUTCOME_UNKNOWN");
        if (await deps.db.message.count({ where: { conversationId: row.metaConversationId, providerMessageId: acceptedId,
          direction: "outbound", type: "template", status: "sent", templateName: row.templateName, templateLanguage: row.templateLanguage } }) !== 1) throw new Error("BOOTSTRAP_HISTORY_UNCONFIRMED");
        await operations.finish({ ...scope, operationId: op.id, token, status: "SENT", providerMessageId: acceptedId });
        await deps.db.openCreditWhatsappHandoff.update({ where: { id: row.id }, data: { state: "SENT", providerMessageId: acceptedId } });
        return { status: "SENT" };
      } catch (error) {
        if (dispatchAttempted && row && operationId && token) {
          const scope = { companyId: row.companyId, channelId: row.channelId, conversationId: row.metaConversationId, operationId, token };
          await operations.finish({ ...scope, status: "UNKNOWN" }).catch(() => {});
          await deps.db.openCreditWhatsappHandoff.updateMany({ where: { id: row.id, state: { not: "SENT" } },
            data: { state: "UNKNOWN", ...(acceptedId ? { providerMessageId: acceptedId } : {}) } }).catch(() => {});
          return { status: "UNKNOWN" };
        }
        return { status: error instanceof BootstrapBlocked ? error.code : "SEND_FAILED" };
      }
    },
  };
}
