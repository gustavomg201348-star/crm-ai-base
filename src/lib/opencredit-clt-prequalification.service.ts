import "server-only";
import { type PrismaClient } from "@prisma/client";
import { canonicalizeOpenCreditOwnershipCpf } from "./opencredit-commercial-identity-policy";
import { resolveConfiguredOpenCreditProviderContext } from "./opencredit-provider-scope-resolver";
import { openCreditApiClient, readOpenCreditApiErrorCode } from "./opencredit-api-client";
import { readOpenCreditStrictJsonResponse, OpenCreditHttpJsonBoundaryError } from "./opencredit-http-json-boundary";
import { readSimulationBanks } from "./opencredit-clt-simulation.service";
import { buildPrequalificationPayload, parsePrequalificationProviderResponse } from "./opencredit-clt-prequalification";
import { protectCltPrequalificationResult } from "./opencredit-clt-prequalification-store";
import { classifyOpenCreditTemplateButton } from "./opencredit-whatsapp-button-policy";
import type { CltPrequalificationLease } from "./opencredit-clt-prequalification-queue.service";

type Queue = {
  complete(lease: CltPrequalificationLease, protectedResult: string): Promise<boolean>;
  retryOrFail(lease: CltPrequalificationLease, errorCode: "PROVIDER_UNAVAILABLE" | "INVALID_RESPONSE" | "CONFIGURATION"): Promise<boolean>;
  fail(lease: CltPrequalificationLease, errorCode: "PROVIDER_UNAVAILABLE" | "INVALID_RESPONSE" | "CONFIGURATION"): Promise<boolean>;
};
type Options = {
  api?: Pick<typeof openCreditApiClient, "simulateJsonAfterCommit">;
  banks?: typeof readSimulationBanks;
  resolve?: typeof resolveConfiguredOpenCreditProviderContext;
};

function safeProviderShape(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { rootType: Array.isArray(raw) ? "array" : typeof raw };
  const root = raw as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : null;
  const banks = Array.isArray(data?.banks) ? data!.banks : [];
  return {
    rootKeys: Object.keys(root).sort().slice(0, 30),
    dataKeys: data ? Object.keys(data).sort().slice(0, 50) : [],
    blockedType: data ? typeof data.blocked : "missing",
    fromCacheType: data ? typeof data.fromCache : "missing",
    barriersType: Array.isArray(data?.barriers) ? "array" : data && Object.hasOwn(data, "barriers") ? typeof data.barriers : "missing",
    banksCount: banks.length,
    bankShapes: banks.slice(0, 20).map(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return { type: Array.isArray(value) ? "array" : typeof value };
      const bank = value as Record<string, unknown>;
      return {
        keys: Object.keys(bank).sort().slice(0, 40),
        status: typeof bank.status === "string" ? bank.status : typeof bank.status,
        reasonType: bank.reasonType === null ? null : typeof bank.reasonType === "string" ? bank.reasonType : typeof bank.reasonType,
        simulationType: bank.simulationType === null ? null : typeof bank.simulationType === "string" ? bank.simulationType : typeof bank.simulationType,
        offersType: Array.isArray(bank.offers) ? "array" : typeof bank.offers,
        offersCount: Array.isArray(bank.offers) ? bank.offers.length : null,
        simulationIdType: bank.simulationId === null ? "null" : typeof bank.simulationId
      };
    })
  };
}

function logPrequalificationOutcome(event: Record<string, unknown>) {
  console.info(JSON.stringify({ event: "opencredit_clt_prequalification_result", ...event }));
}

async function target(db: PrismaClient, lease: CltPrequalificationLease, providerScope: string) {
  const job = await db.openCreditCltPrequalification.findUnique({
    where: { id: lease.id },
    include: {
      contact: true,
      evidence: { include: { message: { select: { direction: true, type: true, body: true, providerMessageId: true } } } },
      conversation: { select: { id: true, contactId: true, channelId: true } },
    }
  });
  if (!job || job.state !== "PROCESSING" || job.leaseToken !== lease.leaseToken || !job.leaseUntil || job.leaseUntil <= new Date()
    || job.providerScope !== providerScope || job.conversation.id !== job.conversationId || job.conversation.contactId !== job.contactId
    || job.conversation.channelId !== job.channelId
    || job.evidence.provenanceKind !== "META_WEBHOOK_HMAC_SHA256_VERIFIED" || job.evidence.provenanceVersion !== 1
    || job.evidence.companyId !== job.companyId || job.evidence.contactId !== job.contactId || job.evidence.conversationId !== job.conversationId
    || job.evidence.channelId !== job.channelId || job.evidence.message.direction !== "inbound"
    || !job.evidence.message.providerMessageId || classifyOpenCreditTemplateButton(job.evidence.message) !== "CHECK") throw Error("PREQUALIFICATION_TARGET_NOT_READY");
  let cpf: string;
  try { cpf = canonicalizeOpenCreditOwnershipCpf(job.contact.cpf); } catch { throw Error("PREQUALIFICATION_TARGET_NOT_READY"); }
  const access = await db.openCreditCommercialAccess.findUnique({
    where: { companyId_providerScope: { companyId: job.companyId, providerScope } }, select: { enabled: true }
  });
  if (access?.enabled !== true) throw Error("PREQUALIFICATION_TARGET_NOT_READY");
  return { job, cpf };
}

export async function processCltPrequalification(
  db: PrismaClient,
  queue: Queue,
  lease: CltPrequalificationLease,
  options: Options = {}
) {
  let config: ReturnType<typeof resolveConfiguredOpenCreditProviderContext>;
  try { config = (options.resolve ?? resolveConfiguredOpenCreditProviderContext)(); }
  catch {
    logPrequalificationOutcome({ workflowId: lease.id, outcome: "RETRY", errorCode: "CONFIGURATION", stage: "RESOLVE_CONFIG" });
    await queue.retryOrFail(lease, "CONFIGURATION"); return "RETRY" as const;
  }

  let initial: Awaited<ReturnType<typeof target>>;
  try { initial = await target(db, lease, config.providerScope); }
  catch {
    logPrequalificationOutcome({ workflowId: lease.id, outcome: "FAILED", errorCode: "CONFIGURATION", stage: "TARGET" });
    await queue.fail(lease, "CONFIGURATION"); return "FAILED" as const;
  }

  let catalog: Awaited<ReturnType<typeof readSimulationBanks>>;
  try {
    catalog = await (options.banks ?? readSimulationBanks)();
  } catch {
    logPrequalificationOutcome({ workflowId: lease.id, outcome: "RETRY", errorCode: "PROVIDER_UNAVAILABLE", stage: "BANK_CATALOG" });
    await queue.retryOrFail(lease, "PROVIDER_UNAVAILABLE");
    return "RETRY" as const;
  }
  const eligible = catalog.filter(bank => bank.enabled !== false && bank.capabilities.simulacaoAtiva === true);
  if (!eligible.length || eligible.length > 100) {
    logPrequalificationOutcome({ workflowId: lease.id, outcome: "FAILED", errorCode: "CONFIGURATION", stage: "ELIGIBLE_BANKS", eligibleBanks: eligible.length });
    await queue.fail(lease, "CONFIGURATION");
    return "FAILED" as const;
  }

  const payload = JSON.stringify(buildPrequalificationPayload(initial.cpf, eligible.map(bank => bank.bankId)));
  let dispatched = false;
  try {
    const execution = await (options.api ?? openCreditApiClient).simulateJsonAfterCommit(
      `/api/tenants/${config.tenantId}/integration/simulate`,
      async () => {
        const currentConfig = (options.resolve ?? resolveConfiguredOpenCreditProviderContext)();
        if (currentConfig.tenantId !== config.tenantId || currentConfig.providerScope !== config.providerScope) throw Error("PREQUALIFICATION_CONFIGURATION_CHANGED");
        const current = await target(db, lease, config.providerScope);
        if (current.cpf !== initial.cpf || current.job.companyId !== initial.job.companyId || current.job.contactId !== initial.job.contactId) throw Error("PREQUALIFICATION_TARGET_CHANGED");
        dispatched = true;
        return { body: payload, committed: lease.id };
      }
    );
    if (execution.response.status !== 200) {
      void execution.response.body?.cancel().catch(() => {});
      logPrequalificationOutcome({ workflowId: lease.id, outcome: "FAILED", errorCode: "PROVIDER_UNAVAILABLE", stage: "HTTP_STATUS", httpStatus: execution.response.status });
      await queue.fail(lease, "PROVIDER_UNAVAILABLE");
      return "FAILED" as const;
    }
    const raw = await readOpenCreditStrictJsonResponse(execution.response);
    let result;
    try {
      result = parsePrequalificationProviderResponse(raw, {
        cpf: initial.cpf,
        banks: eligible.map(bank => ({ bankId: bank.bankId, bankName: bank.bankName })),
        observedAt: new Date().toISOString(),
      });
    } catch {
      logPrequalificationOutcome({
        workflowId: lease.id,
        outcome: "FAILED",
        errorCode: "INVALID_RESPONSE",
        stage: "PARSE_PROVIDER_RESPONSE",
        providerShape: safeProviderShape(raw)
      });
      await queue.fail(lease, "INVALID_RESPONSE");
      return "FAILED" as const;
    }
    const protectedResult = protectCltPrequalificationResult(lease.id, result);
    if (!await queue.complete(lease, protectedResult)) {
      logPrequalificationOutcome({ workflowId: lease.id, outcome: "LEASE_LOST", stage: "COMPLETE" });
      return "LEASE_LOST" as const;
    }
    logPrequalificationOutcome({ workflowId: lease.id, outcome: "COMPLETED", stage: "COMPLETE", requestedBanks: result.requestedBanks, returnedBanks: result.banks.length });
    return "COMPLETED" as const;
  } catch (error) {
    if (!dispatched) {
      const code = readOpenCreditApiErrorCode(error) === "CONFIGURATION" ? "CONFIGURATION" : "PROVIDER_UNAVAILABLE";
      logPrequalificationOutcome({ workflowId: lease.id, outcome: "RETRY", errorCode: code, stage: "PRE_DISPATCH" });
      await queue.retryOrFail(lease, code);
      return "RETRY" as const;
    }
    const api = readOpenCreditApiErrorCode(error);
    const invalid = error instanceof OpenCreditHttpJsonBoundaryError && error.code === "INVALID_JSON";
    const code = invalid ? "INVALID_RESPONSE" : api === "CONFIGURATION" ? "CONFIGURATION" : "PROVIDER_UNAVAILABLE";
    logPrequalificationOutcome({ workflowId: lease.id, outcome: "FAILED", errorCode: code, stage: invalid ? "READ_JSON" : "POST_DISPATCH" });
    await queue.fail(lease, code);
    return "FAILED" as const;
  }
}
