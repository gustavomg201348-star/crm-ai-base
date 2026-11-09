import "server-only";
import { createHash } from "node:crypto";
import type { OpenCreditAiSimulation, Prisma } from "@prisma/client";
import { hasUsableCpf } from "./ai-response-facts";
import { shouldAutoReply } from "./ai-attendant.service";

export type AiSimulationPermit = Readonly<{ workflowId: string; token: string }>;
export const simulationTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
/** This is a narrow server-side capability, not a browser/admin impersonation path. */
export async function validateAiSimulationPermit(tx: Prisma.TransactionClient, permit: AiSimulationPermit,
  input: { companyId: string; contactId: string; actor: { id: string } }, providerScope: string, settled = false) {
  if (!permit || typeof permit.token !== "string" || !/^[a-f0-9]{64}$/.test(permit.token)) throw Error("AI_SIMULATION_DENIED");
  const w = await tx.openCreditAiSimulation.findFirst({ where: { id: permit.workflowId, companyId: input.companyId,
    contactId: input.contactId, providerScope, tokenHash: simulationTokenHash(permit.token),
    state: settled ? { in: ["COMPLETED", "PENDING", "WAITING_AUTHORIZATION", "UNKNOWN"] } : "RUNNING", deadlineAt: { gt: new Date() } } });
  if (!w) throw Error("AI_SIMULATION_DENIED");
  return validateBindings(tx,w,input,providerScope,settled);
}
async function validateBindings(tx: Prisma.TransactionClient, w: OpenCreditAiSimulation,
  input: {companyId:string;contactId:string;actor:{id:string}},providerScope:string,settled:boolean) {
  if (process.env.OPENCREDIT_CLT_AI_ENABLED !== "true") throw Error("AI_SIMULATION_DISABLED");
  // Same row-lock ordering as human takeover: Conversation -> ConversationAuthority.
  if (!settled) {
    await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${w.conversationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "ConversationAuthority" WHERE "conversationId" = ${w.conversationId} FOR UPDATE`;
  } // Settled validation runs inside the native outbound authority lock.
  await tx.$queryRaw`SELECT "id" FROM "OpenCreditConsumerAuthorization" WHERE "id" = ${w.authorizationId} FOR SHARE`;
  const c = await tx.conversation.findFirst({ where: { id: w.conversationId, contactId: w.contactId, channelId: w.channelId,
    contact: { companyId: w.companyId, archivedAt: null }, channelRef: { companyId: w.companyId, type: "whatsapp", provider: "meta", status: { in: ["ACTIVE", "CONNECTED"] } } }, include: { contact: {select:{cpf:true}} } });
  const a = await tx.conversationAuthority.findFirst({ where: { companyId: w.companyId, conversationId: w.conversationId,
    channelId: w.channelId, generation: w.authorityGeneration, ownerUserId: null, state: { in: ["AI", "HUMAN_QUEUE"] } } });
  const company = await tx.company.findUnique({ where: { id: w.companyId }, select: { aiMode: true } });
  const h = await tx.openCreditWhatsappHandoff.findFirst({ where: { companyId: w.companyId, providerScope,
    contactId: w.contactId, channelId: w.channelId, metaConversationId: w.conversationId, state: "SENT" } });
  const config = h && await tx.openCreditWhatsappConfig.findFirst({ where: { companyId: w.companyId, integrationId: h.integrationId, providerScope } });
  const event = await tx.conversationInboundEvent.findFirst({ where: { companyId: w.companyId, conversationId: w.conversationId,
    channelId: w.channelId, contactId: w.contactId }, orderBy: { sequence: "desc" }, include: { message: true } });
  const auth = await tx.openCreditConsumerAuthorization.findFirst({ where: { id: w.authorizationId, companyId: w.companyId,
    providerScope, contactId: w.contactId, purpose: "CREDIT_SIMULATION", active: true, revision: w.authorizationRevision }, include: { remoteIdentity: true, evidence: true } });
  const normalized=c?.contact.cpf?.replace(/[.\-\s]/g,"");
  const formatted=normalized && normalized.slice(0,3)+"."+normalized.slice(3,6)+"."+normalized.slice(6,9)+"-"+normalized.slice(9);
  const matches=normalized && formatted ? await tx.contact.findMany({where:{companyId:w.companyId,cpf:{in:[normalized,formatted]}},select:{id:true},take:2}):[];
  const actor = await tx.user.findFirst({where:{id:input.actor.id,companyId:w.companyId,role:"ADMIN"},select:{id:true}});
  const access = await tx.openCreditCommercialAccess.findUnique({ where: { companyId_providerScope: { companyId: w.companyId, providerScope } } });
  if (matches.length !== 1 || matches[0].id !== w.contactId || !c || !a || c.agentId || !["OPEN", "PENDING", "BOT"].includes(c.status) || !hasUsableCpf(c.contact.cpf) || !company
    || !shouldAutoReply({ companyMode: company.aiMode, conversationMode: c.aiMode, aiPaused: c.aiPaused, agentId: c.agentId })
    || !actor || !h || !config || config.configuredByUserId !== input.actor.id || !auth || !access?.enabled || !auth.remoteIdentity.enabled
    || auth.remoteIdentity.contactId !== w.contactId || auth.remoteIdentity.normalizedCpf !== c.contact.cpf?.replace(/[.\-\s]/g, "")
    || auth.evidence.companyId !== w.companyId || auth.evidence.contactId !== w.contactId || auth.evidence.conversationId !== w.conversationId
    || auth.evidence.channelId !== w.channelId || auth.evidence.createdAt < h.createdAt
    || auth.evidence.provenanceKind !== "META_WEBHOOK_HMAC_SHA256_VERIFIED" || auth.evidence.provenanceVersion !== 1
    || !event || event.id !== w.inboundEventId
    || event.provenanceKind !== "META_WEBHOOK_HMAC_SHA256_VERIFIED" || event.provenanceVersion !== 1
    || event.createdAt < h.createdAt || event.message.direction !== "inbound" || event.message.type !== "text"
    || !event.message.body.trim() || event.message.conversationId !== c.id
    || !await tx.openCreditIntegration.findFirst({ where: { id: h.integrationId, companyId: w.companyId, providerScope,
      enabled: false, paused: false, passiveInboundEnabled: true, materializationEnabled: true } })) throw Error("AI_SIMULATION_DENIED");
  return w;
}

/** Read-only presentation capability: never accepted by the financial dispatcher. */
export async function validateAiSimulationReply(tx:Prisma.TransactionClient,workflowId:string,ctx:{companyId:string;conversationId:string;channelId:string;inboundEventId:string;generation:bigint}) {
  const w=await tx.openCreditAiSimulation.findFirst({where:{id:workflowId,companyId:ctx.companyId,conversationId:ctx.conversationId,channelId:ctx.channelId,
    authorityGeneration:ctx.generation,state:"COMPLETED",deadlineAt:{gt:new Date()}}});
  if(!w)throw Error("AI_SIMULATION_DENIED");
  const h=await tx.openCreditWhatsappHandoff.findFirstOrThrow({where:{companyId:w.companyId,metaConversationId:w.conversationId,providerScope:w.providerScope,state:"SENT"}});
  const config=await tx.openCreditWhatsappConfig.findFirstOrThrow({where:{companyId:w.companyId,integrationId:h.integrationId,providerScope:w.providerScope}});
  const actor=await tx.user.findFirst({where:{id:config.configuredByUserId,companyId:w.companyId,role:"ADMIN"},select:{id:true}});
  if(!actor)throw Error("AI_SIMULATION_DENIED");
  await validateBindings(tx,{...w,inboundEventId:ctx.inboundEventId},{companyId:w.companyId,contactId:w.contactId,actor},w.providerScope,true);
}
