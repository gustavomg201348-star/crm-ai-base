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
  catch { await queue.retryOrFail(lease, "CONFIGURATION"); return "RETRY" as const; }

  let initial: Awaited<ReturnType<typeof target>>;
  try { initial = await target(db, lease, config.providerScope); }
  catch { await queue.fail(lease, "CONFIGURATION"); return "FAILED" as const; }

  let catalog: Awaited<ReturnType<typeof readSimulationBanks>>;
  try {
    catalog = await (options.banks ?? readSimulationBanks)();
  } catch {
    await queue.retryOrFail(lease, "PROVIDER_UNAVAILABLE");
    return "RETRY" as const;
  }
  const eligible = catalog.filter(bank => bank.enabled !== false && bank.capabilities.simulacaoAtiva === true);
  if (!eligible.length || eligible.length > 100) {
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
      await queue.fail(lease, "PROVIDER_UNAVAILABLE");
      return "FAILED" as const;
    }
    const raw = await readOpenCreditStrictJsonResponse(execution.response);
    const result = parsePrequalificationProviderResponse(raw, {
      cpf: initial.cpf,
      banks: eligible.map(bank => ({ bankId: bank.bankId, bankName: bank.bankName })),
      observedAt: new Date().toISOString(),
    });
    const protectedResult = protectCltPrequalificationResult(lease.id, result);
    if (!await queue.complete(lease, protectedResult)) return "LEASE_LOST" as const;
    return "COMPLETED" as const;
  } catch (error) {
    if (!dispatched) {
      await queue.retryOrFail(lease, readOpenCreditApiErrorCode(error) === "CONFIGURATION" ? "CONFIGURATION" : "PROVIDER_UNAVAILABLE");
      return "RETRY" as const;
    }
    const api = readOpenCreditApiErrorCode(error);
    const invalid = error instanceof OpenCreditHttpJsonBoundaryError && error.code === "INVALID_JSON";
    await queue.fail(lease, invalid ? "INVALID_RESPONSE" : api === "CONFIGURATION" ? "CONFIGURATION" : "PROVIDER_UNAVAILABLE");
    return "FAILED" as const;
  }
}
