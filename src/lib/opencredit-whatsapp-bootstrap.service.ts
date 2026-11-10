import type { Channel, PrismaClient } from "@prisma/client";
import { authorityStorage } from "./conversation-authority-storage";
import { createConversationAuthorityService, conversationAuthorityTransactionCore } from "./conversation-authority.service";
import { createOutboundOperationService } from "./outbound-operation.service";
import { findOrCreateConversationForChannel } from "./conversation-lifecycle.service";
import { isOpenCreditConversation, openCreditChannelRef } from "./conversation-channel.service";
import { BootstrapBlocked, bootstrapPhone, bootstrapTemplateFingerprint, analyzeOpenCreditBootstrapTemplate, resolveBootstrapVariables,
  validBootstrapChannel, type BootstrapState, type BootstrapVariableMapping } from "./opencredit-whatsapp-policy";
import type { sendConversationTemplate } from "./whatsapp-template.service";

export type BootstrapTrigger = "AUTO_MATERIALIZATION" | "ADMIN_CANARY";
export function configAllowsTrigger(config: { autoStartEnabled: boolean } | null, trigger: BootstrapTrigger) {
  return !!config && (trigger === "ADMIN_CANARY" || (trigger === "AUTO_MATERIALIZATION" && config.autoStartEnabled === true));
}
type Target = { companyId: string; integrationId: string; jobId: string } & (
  { trigger?: "AUTO_MATERIALIZATION" } | { trigger: "ADMIN_CANARY"; adminUserId: string; sourceConversationId: string }
);
type Dependencies = { db: PrismaClient; provider: "postgresql" | "sqlite";
  credential(channel: Channel): void;
  template: typeof import("./whatsapp-template.service").findReadyOpenCreditBootstrapTemplate;
  sendTemplate: typeof sendConversationTemplate;
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
  async function manualAdminValid(tx: Pick<PrismaClient, "user">, target: Target) {
    if (target.trigger === undefined || target.trigger === "AUTO_MATERIALIZATION") return true;
    if (target.trigger !== "ADMIN_CANARY" || typeof target.adminUserId !== "string" || !target.adminUserId.trim()
      || typeof target.sourceConversationId !== "string" || !target.sourceConversationId.trim()) return false;
    return !!await tx.user.findFirst({ where: {
      id: target.adminUserId, companyId: target.companyId, role: "ADMIN" }, select: { id: true } });
  }
  async function prepare(target: Target) {
    return storage.transaction(async tx => {
      if (!await manualAdminValid(tx, target)) return blocked("AUTOMATION_NOT_ALLOWED");
      const job = await tx.openCreditLeadMaterialization.findFirst({ where: { id: target.jobId, companyId: target.companyId,
        integrationId: target.integrationId, state: "COMPLETED", ...(target.trigger === "ADMIN_CANARY" ? { conversationId: target.sourceConversationId } : {}) }, include: { contact: true,
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
        providerScope: job.providerScope } });
      if (!configAllowsTrigger(config, target.trigger ?? "AUTO_MATERIALIZATION") || !integration || !config?.defaultWhatsappChannelId || !config.initialTemplateName || !config.initialTemplateLanguage) return blocked("CONFIGURATION_MISSING");
      if ((await storage.actor(tx, job.companyId, config.configuredByUserId, true)).role !== "ADMIN") return blocked("CONFIGURATION_MISSING");
      const channel = await channelAllowed(await tx.channel.findFirst({ where: { id: config.defaultWhatsappChannelId, companyId: job.companyId } }), job.companyId);
      const phone = bootstrapPhone(job.contact); if (!phone) return blocked("IDENTITY_UNAVAILABLE");
      const template = await deps.template({ companyId: job.companyId, wabaId: channel.wabaId!, templateName: config.initialTemplateName,
        language: config.initialTemplateLanguage });
      const mapping = config.initialTemplateVariableMapping as BootstrapVariableMapping;
      if (!template || !analyzeOpenCreditBootstrapTemplate(template.template, template.localTemplate, mapping, template.media).eligible) return blocked("TEMPLATE_UNAVAILABLE");
      const variables = resolveBootstrapVariables(job.contact.name, mapping); if (!variables) return blocked("IDENTITY_UNAVAILABLE");
      const fingerprint = bootstrapTemplateFingerprint(template.template, channel.wabaId!, { mapping, variables, media: template.media });
      if (deps.provider === "postgresql") await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([job.companyId,job.contact.id,channel.id])}, 0))::text`;
      const meta = await findOrCreateConversationForChannel({ db: tx, companyId: job.companyId, contactId: job.contact.id, channelId: channel.id,
        agentId: null, status: "BOT", statuses: ["OPEN", "PENDING", "BOT", "SOLD"], withCreated: true });
      if (meta.conversation.agentId || !["OPEN", "PENDING", "BOT"].includes(meta.conversation.status)) return blocked("AUTOMATION_NOT_ALLOWED");
      if (prior && (prior.channelId !== channel.id || prior.configRevision !== config.revision || prior.templateFingerprint !== fingerprint
        || prior.metaConversationId !== meta.conversation.id)) return blocked("CONFIGURATION_MISSING");
      const row = prior ?? await tx.openCreditWhatsappHandoff.create({ data: { companyId: job.companyId, integrationId: job.integrationId,
        providerScope: job.providerScope, jobId: job.id, contactId: job.contact.id, sourceConversationId: job.conversation.id,
        metaConversationId: meta.conversation.id, channelId: channel.id, configRevision: config.revision,
        templateName: config.initialTemplateName, templateLanguage: config.initialTemplateLanguage, templateFingerprint: fingerprint } });
      return { prior: false as const, row, actorId: config.configuredByUserId, sourceAgentId: job.conversation.agentId, phone, mapping, variables };
    });
  }
  async function transferSentAssignment(row: Awaited<ReturnType<typeof prepare>>["row"], actorId: string,
    sourceAgentId: string | null, expectedGeneration: bigint) {
    if (!sourceAgentId) return;
    await storage.transaction(async tx => {
      const scope = { companyId: row.companyId, channelId: row.channelId, conversationId: row.metaConversationId };
      const meta = await storage.lockConversation(tx, row.companyId, row.metaConversationId);
      const authority = await storage.lock(tx, scope);
      if (meta.agentId || meta.contactId !== row.contactId || !["OPEN", "PENDING", "BOT"].includes(meta.status)
        || authority.generation !== expectedGeneration || authority.ownerUserId || !["AI", "HUMAN_QUEUE"].includes(authority.state)) return;
      if (deps.provider === "postgresql") await tx.$queryRaw`SELECT c.id FROM "Conversation" c
        JOIN "Contact" p ON p.id = c."contactId" WHERE c.id = ${row.sourceConversationId}
        AND p."companyId" = ${row.companyId} FOR UPDATE OF c`;
      const source = await tx.conversation.findFirst({ where: { id: row.sourceConversationId, contactId: row.contactId,
        agentId: sourceAgentId, channel: "OPEN_CREDIT", status: { in: ["OPEN", "PENDING", "BOT"] },
        contact: { companyId: row.companyId, archivedAt: null }, channelRef: { companyId: row.companyId, type: "OPEN_CREDIT", provider: "internal" } } });
      const settings = await tx.leadAssignmentSetting.findUnique({ where: { companyId: row.companyId } });
      if (!source || settings?.mode !== "ROUND_ROBIN") return;
      const binding = await tx.openCreditLeadMaterialization.findFirst({ where: { id: row.jobId, companyId: row.companyId,
        integrationId: row.integrationId, providerScope: row.providerScope, state: "COMPLETED", contactId: row.contactId,
        channelId: source.channelId, conversationId: source.id } });
      const sent = await tx.openCreditWhatsappHandoff.findFirst({ where: { id: row.id, companyId: row.companyId, state: "SENT",
        outboundOperation: { is: { status: "SENT", ...scope } } } });
      const integration = await tx.openCreditIntegration.findFirst({ where: { id: row.integrationId, companyId: row.companyId,
        providerScope: row.providerScope, enabled: false, paused: false, passiveInboundEnabled: true, materializationEnabled: true } });
      const actor = await tx.user.findFirst({ where: { id: actorId, companyId: row.companyId, role: "ADMIN" } });
      const owner = await tx.user.findFirst({ where: { id: sourceAgentId, companyId: row.companyId,
        role: { in: ["ADMIN", "SUPERVISOR", "AGENT"] } } });
      if (!binding || !sent || !integration || !actor || !owner) return;
      if (deps.provider === "postgresql") await tx.$queryRaw`SELECT "userId" FROM "UserAvailability"
        WHERE "userId" = ${sourceAgentId} AND "companyId" = ${row.companyId} FOR SHARE`;
      if (!await tx.userAvailability.findFirst({ where: { companyId: row.companyId, userId: sourceAgentId, status: "ONLINE" } })) return;
      // Replace the source's occupied slot, rather than requiring a second slot.
      const otherOpen = await tx.conversation.count({ where: { id: { not: source.id }, agentId: sourceAgentId,
        status: { in: ["OPEN", "PENDING", "BOT"] }, contact: { companyId: row.companyId } } });
      if (settings.maxOpenPerAttendant !== null && otherOpen >= settings.maxOpenPerAttendant) return;
      await conversationAuthorityTransactionCore(deps).transition({ ...scope, actorUserId: actorId,
        logicalKey: "oc-whatsapp:" + row.id + ":assignment", reason: "OPENCREDIT_WHATSAPP_ASSIGNMENT_TRANSFER",
        expectedGeneration, state: "HUMAN", ownerUserId: sourceAgentId })(tx);
      const released = await tx.conversation.updateMany({ where: { id: source.id, agentId: sourceAgentId,
        contact: { companyId: row.companyId } }, data: { agentId: null } });
      const assigned = await tx.conversation.updateMany({ where: { id: meta.id, agentId: null,
        contact: { companyId: row.companyId } }, data: { agentId: sourceAgentId } });
      if (released.count !== 1 || assigned.count !== 1) throw new Error("BOOTSTRAP_ASSIGNMENT_CONFLICT");
      await tx.leadAssignmentHistory.createMany({ data: [
        { companyId: row.companyId, conversationId: source.id, assignedToUserId: null, assignedByUserId: actorId, mode: "ROUND_ROBIN", action: "UNASSIGNED" },
        { companyId: row.companyId, conversationId: meta.id, assignedToUserId: sourceAgentId, assignedByUserId: actorId, mode: "ROUND_ROBIN", action: "ASSIGNED" }
      ] });
    });
  }
  return {
    async bootstrap(target: Target): Promise<{ status: BootstrapState }> {
      let row: Awaited<ReturnType<typeof prepare>>["row"] | undefined;
      let operationId: string | undefined, token: string | undefined, dispatchAttempted = false, acceptedId: string | undefined;
      let dispatchChannel: { phoneNumberId: string; wabaId: string } | undefined;
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
          templateName: row.templateName, language: row.templateLanguage, variables: prepared.variables, variableMapping: prepared.mapping, automation: true,
          signal: AbortSignal.timeout(20000), onProviderAccepted: id => { acceptedId = id; },
          dispatchGuard: async context => {
            dispatchChannel = { phoneNumberId: context.phoneNumberId, wabaId: context.wabaId };
            await storage.transaction(async tx => {
              const config = await tx.openCreditWhatsappConfig.findFirst({ where: { integrationId: handoff.integrationId, companyId: handoff.companyId,
                providerScope: handoff.providerScope, revision: handoff.configRevision,
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
              if (!await tx.user.findFirst({ where: { id: prepared.actorId, companyId: handoff.companyId, role: "ADMIN" } })) return blocked("CONFIGURATION_MISSING");
              if (!configAllowsTrigger(config, target.trigger ?? "AUTO_MATERIALIZATION") || !await manualAdminValid(tx, target) || !config || !binding || !integration || !contact || !conversation || conversation.agentId || !["OPEN", "PENDING", "BOT"].includes(conversation.status)) return blocked("AUTOMATION_NOT_ALLOWED");
              const current = await deps.template({ companyId: handoff.companyId, wabaId: c.wabaId!, templateName: handoff.templateName, language: handoff.templateLanguage });
              const mapping = config.initialTemplateVariableMapping as BootstrapVariableMapping, variables = resolveBootstrapVariables(contact.name, mapping);
              if (!variables) return blocked("IDENTITY_UNAVAILABLE");
              if (!current || !analyzeOpenCreditBootstrapTemplate(current.template, current.localTemplate, mapping, current.media).eligible) return blocked("TEMPLATE_UNAVAILABLE");
              if (bootstrapTemplateFingerprint(current.template, c.wabaId!, { mapping, variables, media: current.media }) !== handoff.templateFingerprint) return blocked("TEMPLATE_UNAVAILABLE");
              if (context.channelId !== handoff.channelId || context.phoneNumberId !== c.phoneNumberId || context.wabaId !== c.wabaId
                || context.destination !== bootstrapPhone(contact) || context.destination !== prepared.phone
                || context.templateFingerprint !== handoff.templateFingerprint) return blocked("IDENTITY_UNAVAILABLE");
            });
            // This one-use durable permit is committed BEFORE the first provider call.
            dispatchAttempted = true;
            await operations.authorizeDispatch({ ...scope, operationId: op.id, token: token!, expectedGeneration: authority!.generation });
            const changed = await deps.db.openCreditWhatsappHandoff.updateMany({ where: { id: handoff.id, state: "PREPARED", outboundOperationId: op.id }, data: { state: "DISPATCHING" } });
            if (changed.count !== 1) throw new Error("BOOTSTRAP_DISPATCH_UNCERTAIN");
          },
          beforeMessageGuard: async () => {
            const current = await deps.template({ companyId: handoff.companyId, wabaId: (await deps.db.channel.findUniqueOrThrow({ where: { id: handoff.channelId } })).wabaId!,
              templateName: handoff.templateName, language: handoff.templateLanguage });
            const [config, contact, conversation] = await Promise.all([
              deps.db.openCreditWhatsappConfig.findFirst({ where: { companyId: handoff.companyId, integrationId: handoff.integrationId, providerScope: handoff.providerScope,
                revision: handoff.configRevision, defaultWhatsappChannelId: handoff.channelId, initialTemplateName: handoff.templateName, initialTemplateLanguage: handoff.templateLanguage } }),
              deps.db.contact.findFirst({ where: { id: handoff.contactId, companyId: handoff.companyId, archivedAt: null } }),
              deps.db.conversation.findFirst({ where: { id: handoff.metaConversationId, contactId: handoff.contactId, channelId: handoff.channelId } }),
            ]);
            const c = await channelAllowed(await deps.db.channel.findFirst({ where: { id: handoff.channelId, companyId: handoff.companyId } }), handoff.companyId);
            const variables = contact && resolveBootstrapVariables(contact.name, config?.initialTemplateVariableMapping as BootstrapVariableMapping);
            if (!configAllowsTrigger(config, target.trigger ?? "AUTO_MATERIALIZATION") || !await manualAdminValid(deps.db, target) || !config || !contact || !conversation || conversation.agentId || !["OPEN", "PENDING", "BOT"].includes(conversation.status) || !variables || !current
              || c.phoneNumberId !== dispatchChannel?.phoneNumberId || c.wabaId !== dispatchChannel?.wabaId
              || !analyzeOpenCreditBootstrapTemplate(current.template, current.localTemplate, config.initialTemplateVariableMapping as BootstrapVariableMapping, current.media).eligible
              || bootstrapPhone(contact) !== prepared.phone || bootstrapTemplateFingerprint(current.template, c.wabaId!, {
                mapping: config.initialTemplateVariableMapping as BootstrapVariableMapping, variables, media: current.media }) !== handoff.templateFingerprint) return blocked("TEMPLATE_UNAVAILABLE");
            await storage.transaction(async tx => {
              const a = await storage.lock(tx, scope);
              if (a.generation !== authority!.generation || a.ownerUserId || !["AI", "HUMAN_QUEUE"].includes(a.state)) return blocked("AUTOMATION_NOT_ALLOWED");
              const operation = await tx.outboundOperation.findFirst({ where: { id: op.id, ...scope, status: "DISPATCHING", reservationToken: token } });
              const binding = await tx.openCreditLeadMaterialization.findFirst({ where: { id: handoff.jobId, companyId: handoff.companyId,
                integrationId: handoff.integrationId, providerScope: handoff.providerScope, state: "COMPLETED", contactId: handoff.contactId, conversationId: handoff.sourceConversationId } });
              if (!operation || !binding || !await manualAdminValid(tx, target)) return blocked("AUTOMATION_NOT_ALLOWED");
              if (!await tx.user.findFirst({ where: { id: prepared.actorId, companyId: handoff.companyId, role: "ADMIN" } })) return blocked("CONFIGURATION_MISSING");
              if (!await tx.openCreditIntegration.findFirst({ where: { id: handoff.integrationId, companyId: handoff.companyId, providerScope: handoff.providerScope,
                  enabled: false, paused: false, materializationEnabled: true, passiveInboundEnabled: true } })) return blocked("AUTOMATION_NOT_ALLOWED");
            });
          } });
        if (!acceptedId) throw new Error("BOOTSTRAP_OUTCOME_UNKNOWN");
        if (await deps.db.message.count({ where: { conversationId: row.metaConversationId, providerMessageId: acceptedId,
          direction: "outbound", type: "template", status: "sent", templateName: row.templateName, templateLanguage: row.templateLanguage } }) !== 1) throw new Error("BOOTSTRAP_HISTORY_UNCONFIRMED");
        await operations.finish({ ...scope, operationId: op.id, token, status: "SENT", providerMessageId: acceptedId });
        await deps.db.openCreditWhatsappHandoff.update({ where: { id: row.id }, data: { state: "SENT", providerMessageId: acceptedId } });
        // Sending is already durably confirmed. A failed/raced transfer must never permit a resend
        // or override a human takeover; the assignment transaction rolls back independently.
        await transferSentAssignment(row, prepared.actorId, prepared.sourceAgentId, authority.generation).catch(() => {});
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
