import "server-only";
import { prisma } from "./db";
import { resolveChannelAccessToken } from "./channel-secrets";
import { enforceRateLimits, rateLimitPolicies } from "./rate-limit";
import { shouldAutoReply } from "./ai-attendant.service";
import { findReadyOpenCreditBootstrapTemplate, getApprovedBootstrapTemplatesForChannel, sendConversationTemplate } from "./whatsapp-template.service";
import { createOpenCreditWhatsappConfigService } from "./opencredit-whatsapp-config.service";
import { createOpenCreditWhatsappBootstrap } from "./opencredit-whatsapp-bootstrap.service";
import type { Channel } from "@prisma/client";

const provider = /^postgres(?:ql)?:/.test(process.env.DATABASE_URL ?? "") ? "postgresql" as const : "sqlite" as const;
const credential = (channel: Channel) => {
  if (!resolveChannelAccessToken(channel.accessToken, { channelId: channel.id })) throw new Error("CHANNEL_UNAVAILABLE");
};
export const openCreditWhatsappConfig = createOpenCreditWhatsappConfigService({ db: prisma, provider, credential,
  templates: getApprovedBootstrapTemplatesForChannel, canAutomate: shouldAutoReply });
export const openCreditWhatsappBootstrap = createOpenCreditWhatsappBootstrap({ db: prisma, provider, credential,
  template: findReadyOpenCreditBootstrapTemplate, sendTemplate: sendConversationTemplate, canAutomate: shouldAutoReply,
  limited: async input => !!await enforceRateLimits([{ category: "message-send", identifiers: [input.companyId, input.userId], ...rateLimitPolicies.messageSend }]),
});

/** Called only for a job completed by this worker invocation; never scans historical jobs. */
export async function bootstrapNewlyCompletedOpenCreditJob(jobId: string) {
  const job = await prisma.openCreditLeadMaterialization.findUnique({ where: { id: jobId },
    select: { companyId: true, integrationId: true, providerScope: true, state: true } });
  if (!job || job.state !== "COMPLETED") return;
  if (!await prisma.openCreditWhatsappConfig.findFirst({ where: { integrationId: job.integrationId, companyId: job.companyId,
    providerScope: job.providerScope, autoStartEnabled: true }, select: { integrationId: true } })) return;
  return openCreditWhatsappBootstrap.bootstrap({ jobId, companyId: job.companyId, integrationId: job.integrationId });
}
