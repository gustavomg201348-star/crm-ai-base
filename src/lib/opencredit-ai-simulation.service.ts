import "server-only";
import { getSecretEncryptionKeyStatus } from "./secret-encryption-env";
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { classifyCltCustomerIntent } from "./clt-ai-classifier";
import { validateCltAiIntent, type CltAiIntent } from "./clt-ai-intent";
import { decideCltAiAction, type CltAiAction } from "./clt-ai-policy";
import { resolveConfiguredOpenCreditProviderContext } from "./opencredit-provider-scope-resolver";
import { dispatchCltSimulation, pollCltSimulation } from "./opencredit-clt-simulation.service";
import { simulationId } from "./opencredit-clt-simulation";
import { validateAiSimulationPermit, validateAiSimulationReply, simulationTokenHash } from "./opencredit-ai-simulation-guard";
import { protectCltFinancialFacts, readCltFinancialFacts, renderCltFinancialFacts } from "./opencredit-ai-financial-facts";

export type CltAiInboundContext = Readonly<{ companyId: string; conversationId: string; channelId: string; inboundEventId: string; generation: bigint }>;
type Telemetry = { event: "clt_ai_simulation"; stage: "INTENT"|"GATE"|"AUTHORIZATION"|"REPLY"|"OPERATION"|"DISPATCH"|"POLL"|"RESULT"|"CANCELLATION";
  state: CltAiIntent|CltAiAction|"PREPARED"|"ATTEMPT"|"COMPLETED"|"PENDING"|"WAITING_AUTHORIZATION"|"UNKNOWN"|"CANCELLED"|"FAIL_CLOSED"|"ACTIVE"|"MISSING"|"AUTHORIZED" };
type Options = { classify?: typeof classifyCltCustomerIntent; resolve?: typeof resolveConfiguredOpenCreditProviderContext;
  simulation?: Parameters<typeof dispatchCltSimulation>[2]; bankId?: string; wait?(ms: number): Promise<void>;
  log?(event: Telemetry): unknown };
export type CltAiResponse = { reply: string; handoff?: boolean; handoffAfterReply?: boolean; onAuthorized?(): void; validateFinancial?(tx: Prisma.TransactionClient): Promise<void> };
const settings = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 } as const;
const human = "Para realizar a simulação, precisamos que um atendente valide sua autorização e o cadastro. Não vou consultar crédito sem essa validação.";
const intakeCpfPrompt = "Para continuar, me informe seu CPF, por favor. Depois disso, um atendente dará sequência ao seu atendimento.";
const intakeHandoffReply = "Perfeito! Já recebi as informações iniciais. Vou encaminhar seu atendimento para um especialista continuar por aqui.";
function intakeOnlyMode() {
  return process.env.OPENCREDIT_CLT_AI_MODE === "INTAKE_ONLY";
}
export async function runOpenCreditAiSimulation(db: PrismaClient, ctx: CltAiInboundContext, options: Options = {}): Promise<CltAiResponse | null> {
  const log = (stage: Telemetry["stage"], state: Telemetry["state"]) => { try { const result = options.log?.({ event: "clt_ai_simulation", stage, state });
    if (result && typeof (result as Promise<unknown>).then === "function") void Promise.resolve(result).catch(() => {}); } catch {} };
  const c = await db.conversation.findFirst({ where: { id: ctx.conversationId, channelId: ctx.channelId, contact: { companyId: ctx.companyId } }, include: { contact: {select:{cpf:true}} } });
  const event = await db.conversationInboundEvent.findFirst({ where: { id: ctx.inboundEventId, companyId: ctx.companyId,
    conversationId: ctx.conversationId, channelId: ctx.channelId, contactId: c?.contactId }, include: { message: true } });
  const latest = await db.conversationInboundEvent.findFirst({ where: { companyId: ctx.companyId, conversationId: ctx.conversationId }, orderBy: { sequence: "desc" } });
  if (!c || !event || latest?.id !== event.id || event.provenanceKind !== "META_WEBHOOK_HMAC_SHA256_VERIFIED" || event.provenanceVersion !== 1
    || event.message.direction !== "inbound" || event.message.type !== "text") return null;
  const intent = validateCltAiIntent(await (options.classify ?? classifyCltCustomerIntent)(event.message.body), event.message.body);
  log("INTENT", intent.intent);
  let config: ReturnType<typeof resolveConfiguredOpenCreditProviderContext>;
  try { config = (options.resolve ?? resolveConfiguredOpenCreditProviderContext)(); } catch { return { reply: human }; }
  const h = await db.openCreditWhatsappHandoff.findFirst({ where: { companyId: ctx.companyId, providerScope: config.providerScope,
    contactId: c.contactId, channelId: ctx.channelId, metaConversationId: c.id, state: "SENT" } });
  const a = await db.conversationAuthority.findFirst({ where: { companyId: ctx.companyId, conversationId: c.id,
    channelId: ctx.channelId, generation: ctx.generation, ownerUserId: null, state: { in: ["AI", "HUMAN_QUEUE"] } } });
  if (!a || (h && event.createdAt < h.createdAt) || c.agentId || c.aiPaused || !["OPEN","PENDING","BOT"].includes(c.status)) return null;
  const access = await db.openCreditCommercialAccess.findFirst({ where: { companyId: ctx.companyId, providerScope: config.providerScope, enabled: true } });
  const identity = await db.openCreditRemoteIdentity.findFirst({ where: { companyId: ctx.companyId, providerScope: config.providerScope, contactId: c.contactId, enabled: true } });
  const auth = await db.openCreditConsumerAuthorization.findFirst({ where: { companyId: ctx.companyId, providerScope: config.providerScope,
    contactId: c.contactId, purpose: "CREDIT_SIMULATION", active: true } });
  log("AUTHORIZATION",auth ? "ACTIVE" : "MISSING");
  const prior = auth && await db.openCreditAiSimulation.findFirst({where:{companyId:ctx.companyId,conversationId:c.id,channelId:ctx.channelId,
    providerScope:config.providerScope,contactId:c.contactId,authorizationId:auth.id,authorizationRevision:auth.revision,
    authorityGeneration:ctx.generation,state:"COMPLETED",deadlineAt:{gt:new Date()}}});
  let bankId: string | null = null;
  try { bankId = simulationId(options.bankId ?? process.env.OPENCREDIT_CLT_AI_BANK_ID); } catch {}
  const decision = decideCltAiAction(intent, { currentVerifiedInbound: true, bindingValid: true, authorityCurrent: true, unassigned: true,
    conversationOpen: true, contactCpf: c.contact.cpf, commercialAccess: !!access, remoteIdentity: !!identity,
    simulationAuthorization: !!auth, explicitBankConfigured: !!bankId, existingOperation: prior ? "COMPLETED" : "NONE", persistedOfferFactsReady: !!prior?.protectedFacts });
  log("GATE", decision.nextAction);
  if (intakeOnlyMode()) {
    if (decision.nextAction === "TRANSFER_HUMAN") {
      log("CANCELLATION", intent.intent);
      return { reply: "", handoff: true };
    }
    const priorCpfPrompt = !c.contact.cpf && await db.message.findFirst({
      where: { conversationId: c.id, direction: "outbound", senderType: "ai", body: intakeCpfPrompt },
      orderBy: { createdAt: "desc" }, select: { id: true }
    });
    if (!c.contact.cpf && !priorCpfPrompt) return { reply: intakeCpfPrompt };
    return { reply: intakeHandoffReply, handoffAfterReply: true };
  }
  if (decision.nextAction === "STOP" || decision.nextAction === "TRANSFER_HUMAN") { log("CANCELLATION",intent.intent); return { reply: "", handoff: true }; }
  if (decision.nextAction === "ASK_CPF") return { reply: "Consigo verificar para você. Me informe seu CPF, por favor. Um atendente fará a validação do cadastro." };
  if (decision.nextAction === "NEED_HUMAN_AUTHORIZATION") return { reply: human, handoffAfterReply: true };
  if (decision.nextAction === "PRESENT_OFFERS" && prior?.protectedFacts) return {
    reply: renderCltFinancialFacts(readCltFinancialFacts(prior.id,prior.protectedFacts)),
    onAuthorized: () => log("REPLY","AUTHORIZED"), validateFinancial: async tx => {await validateAiSimulationReply(tx,prior.id,ctx);},
  };
  if (decision.nextAction !== "PREPARE_SIMULATION" || !auth || !bankId) return { reply: intent.intent === "GENERAL_INFO"
    ? "O crédito CLT depende de análise do banco e de autorização para a consulta. Posso ajudar com informações ou chamar um atendente."
    : "Posso ajudar com informações sobre crédito CLT. Para verificar condições reais, precisamos de cadastro e autorização válidos." };
  if (getSecretEncryptionKeyStatus().status !== "configured") return {reply:human,handoffAfterReply:true};
  const configured = h ? await db.openCreditWhatsappConfig.findFirst({ where: {
    companyId: ctx.companyId, providerScope: config.providerScope, integrationId: h.integrationId
  } }) : null;
  const actorId = h ? configured?.configuredByUserId : auth.changedByUserId;
  const actor = actorId && await db.user.findFirst({ where: { id: actorId, companyId: ctx.companyId, role: "ADMIN" },
    select: { id: true, companyId: true, name: true, email: true } });
  if (!actor || (h && configured?.configuredByUserId !== actor.id)) return { reply: human };
  const session = { ...actor, role: "ADMIN" as const }, input = { actor: session, companyId: ctx.companyId, contactId: c.contactId };
  const id = createHash("sha256").update(JSON.stringify([ctx.companyId, c.id, event.id,"CREDIT_SIMULATION",1])).digest("hex");
  const token = randomBytes(32).toString("hex"), permit = { workflowId: id, token };
  try {
    await db.$transaction(async tx => {
      await tx.openCreditAiSimulation.create({ data: { id, companyId: ctx.companyId, contactId: c.contactId, conversationId: c.id,
        channelId: ctx.channelId, inboundEventId: event.id, providerScope: config.providerScope, authorizationId: auth.id,
        authorizationRevision: auth.revision, authorityGeneration: ctx.generation, intent: intent.intent, tokenHash: simulationTokenHash(token),
        deadlineAt: new Date(Date.now()+240000) } });
      await validateAiSimulationPermit(tx, permit, input, config.providerScope);
    }, settings);
  } catch { return null; } // Concurrent/restarted executors never steal ownership or restart polling.
  log("OPERATION", "PREPARED");
  const simulationOptions = { ...options.simulation, automationSignal: AbortSignal.timeout(240000), resolve: options.resolve, automation: permit };
  let response: Awaited<ReturnType<typeof dispatchCltSimulation>> | Awaited<ReturnType<typeof pollCltSimulation>>;
  try {
    log("DISPATCH", "ATTEMPT");
    response = await dispatchCltSimulation(db, { ...input, bankId, mode: "maximum", amountBRL: "" }, simulationOptions);
    await db.openCreditAiSimulation.update({ where: { id }, data: { operationId: response.operation.operationId } });
    for (let attempt=0; response.result?.status === "pendente" && attempt<3; attempt++) {
      await (options.wait ?? (ms => new Promise(resolve=>setTimeout(resolve,ms))))(1000 * 2**attempt);
      await db.$transaction(async tx => {
        await validateAiSimulationPermit(tx, permit, input, config.providerScope);
        const changed = await tx.openCreditAiSimulation.updateMany({ where: { id, tokenHash: simulationTokenHash(token), pollCount: { lt: 3 } }, data: { pollCount: { increment: 1 } } });
        if (changed.count !== 1) throw Error();
      }, settings);
      log("POLL", "ATTEMPT");
      response = await pollCltSimulation(db, input, simulationOptions);
      if ("pollUnavailable" in response && response.pollUnavailable) break;
    }
    const result = response.result;
    const state = !result ? response.operation.state === "UNKNOWN" ? "UNKNOWN" : "PENDING"
      : result.status === "pendente" ? "PENDING" : result.status === "waiting_authorization" ? "WAITING_AUTHORIZATION" : "COMPLETED";
    // Store only whitelisted financial facts, encrypted with workflow binding. No raw provider payload or identity.
    const protectedFacts = result && state === "COMPLETED" ? protectCltFinancialFacts(id,result,response.operation.diagnostic ?? {}) : null;
    await db.openCreditAiSimulation.update({ where: { id }, data: { state, protectedFacts } });
    log("RESULT", state);
    const validateFinancial = async (tx: Prisma.TransactionClient) => { await validateAiSimulationPermit(tx, permit, input, config.providerScope, true); };
    if (state === "COMPLETED" && protectedFacts) {
      const persisted = await db.openCreditAiSimulation.findUniqueOrThrow({ where: { id } });
      return { reply: renderCltFinancialFacts(readCltFinancialFacts(id,persisted.protectedFacts!)), validateFinancial, onAuthorized: () => log("REPLY","AUTHORIZED") };
    }
    return { onAuthorized: () => log("REPLY","AUTHORIZED"), handoffAfterReply: state !== "COMPLETED", reply: state === "UNKNOWN" ? "Não foi possível confirmar o resultado da consulta. Um atendente precisa verificar antes de qualquer nova tentativa."
      : state === "WAITING_AUTHORIZATION" ? "O banco exige uma autorização adicional. Um atendente vai orientar essa etapa; ainda não há aprovação confirmada."
      : "A consulta ainda não tem resultado confirmado. Um atendente poderá acompanhar, sem repetir a simulação.", validateFinancial };
  } catch {
    // Dispatch can commit before the workflow's operation link or settlement is saved.
    // Reconcile only by the existing grant key; this path never dispatches or retries.
    let state: "UNKNOWN"|"CANCELLED" = "UNKNOWN", operationId: string|undefined;
    try {
      const grant=await db.openCreditConsumerAuthorizationEvent.findUnique({where:{authorizationId_revision:{authorizationId:auth.id,revision:auth.revision}},select:{id:true}});
      if(grant && identity) {
        const op=await db.openCreditCommercialOperation.findFirst({where:{companyId:ctx.companyId,providerScope:config.providerScope,
          intentKey:"simulation-"+grant.id,remoteIdentityId:identity.id,operationKind:"CREDIT_SIMULATION"},select:{id:true,state:true}});
        operationId=op?.id;
        state=op && ["IN_FLIGHT","UNKNOWN","SUCCEEDED"].includes(op.state) ? "UNKNOWN" : "CANCELLED";
      }
    } catch {} // Unknown storage outcome remains UNKNOWN, never permission to replay.
    await db.openCreditAiSimulation.updateMany({ where: { id }, data: { state,...(operationId?{operationId}:{}) } }).catch(()=>{});
    log("CANCELLATION", "FAIL_CLOSED"); return null;
  }
}
