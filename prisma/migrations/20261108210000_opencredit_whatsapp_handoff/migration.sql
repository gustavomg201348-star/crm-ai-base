BEGIN;
-- CreateTable
CREATE TABLE "OpenCreditWhatsappConfig" (
    "integrationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "providerScope" TEXT NOT NULL,
    "defaultWhatsappChannelId" TEXT,
    "initialTemplateName" TEXT,
    "initialTemplateLanguage" TEXT,
    "autoStartEnabled" BOOLEAN NOT NULL DEFAULT false,
    "configuredByUserId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenCreditWhatsappConfig_pkey" PRIMARY KEY ("integrationId")
);

-- CreateTable
CREATE TABLE "OpenCreditWhatsappHandoff" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "providerScope" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "sourceConversationId" TEXT NOT NULL,
    "metaConversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "configRevision" INTEGER NOT NULL,
    "templateName" TEXT NOT NULL,
    "templateLanguage" TEXT NOT NULL,
    "templateFingerprint" TEXT NOT NULL,
    "outboundOperationId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PREPARED',
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenCreditWhatsappHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpenCreditWhatsappHandoff_jobId_key" ON "OpenCreditWhatsappHandoff"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenCreditWhatsappHandoff_sourceConversationId_key" ON "OpenCreditWhatsappHandoff"("sourceConversationId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenCreditWhatsappHandoff_metaConversationId_key" ON "OpenCreditWhatsappHandoff"("metaConversationId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenCreditWhatsappHandoff_outboundOperationId_key" ON "OpenCreditWhatsappHandoff"("outboundOperationId");

-- CreateIndex
CREATE INDEX "OpenCreditWhatsappHandoff_companyId_integrationId_state_idx" ON "OpenCreditWhatsappHandoff"("companyId", "integrationId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "OpenCreditWhatsappHandoff_companyId_contactId_key" ON "OpenCreditWhatsappHandoff"("companyId", "contactId");

-- AddForeignKey
ALTER TABLE "OpenCreditWhatsappConfig" ADD CONSTRAINT "OpenCreditWhatsappConfig_integrationId_companyId_providerS_fkey" FOREIGN KEY ("integrationId", "companyId", "providerScope") REFERENCES "OpenCreditIntegration"("id", "companyId", "providerScope") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OpenCreditWhatsappConfig" ADD CONSTRAINT "OpenCreditWhatsappConfig_companyId_defaultWhatsappChannelI_fkey" FOREIGN KEY ("companyId", "defaultWhatsappChannelId") REFERENCES "Channel"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OpenCreditWhatsappConfig" ADD CONSTRAINT "OpenCreditWhatsappConfig_companyId_configuredByUserId_fkey" FOREIGN KEY ("companyId", "configuredByUserId") REFERENCES "User"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OpenCreditWhatsappHandoff" ADD CONSTRAINT "OpenCreditWhatsappHandoff_jobId_companyId_integrationId_pr_fkey" FOREIGN KEY ("jobId", "companyId", "integrationId", "providerScope") REFERENCES "OpenCreditLeadMaterialization"("id", "companyId", "integrationId", "providerScope") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OpenCreditWhatsappHandoff" ADD CONSTRAINT "OpenCreditWhatsappHandoff_companyId_contactId_fkey" FOREIGN KEY ("companyId", "contactId") REFERENCES "Contact"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OpenCreditWhatsappHandoff" ADD CONSTRAINT "OpenCreditWhatsappHandoff_sourceConversationId_contactId_fkey" FOREIGN KEY ("sourceConversationId", "contactId") REFERENCES "Conversation"("id", "contactId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OpenCreditWhatsappHandoff" ADD CONSTRAINT "OpenCreditWhatsappHandoff_metaConversationId_contactId_cha_fkey" FOREIGN KEY ("metaConversationId", "contactId", "channelId") REFERENCES "Conversation"("id", "contactId", "channelId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OpenCreditWhatsappHandoff" ADD CONSTRAINT "OpenCreditWhatsappHandoff_companyId_channelId_fkey" FOREIGN KEY ("companyId", "channelId") REFERENCES "Channel"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OpenCreditWhatsappHandoff" ADD CONSTRAINT "OpenCreditWhatsappHandoff_companyId_channelId_metaConversa_fkey" FOREIGN KEY ("companyId", "channelId", "metaConversationId", "outboundOperationId") REFERENCES "OutboundOperation"("companyId", "channelId", "conversationId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;


ALTER TABLE "OpenCreditWhatsappConfig" ADD CONSTRAINT "OCWhatsappConfig_enabled_check" CHECK (
 "revision">0 AND (NOT "autoStartEnabled" OR ("defaultWhatsappChannelId" IS NOT NULL AND "initialTemplateName" IS NOT NULL AND "initialTemplateLanguage" IS NOT NULL))
);
ALTER TABLE "OpenCreditWhatsappHandoff" ADD CONSTRAINT "OCWhatsappHandoff_state_check" CHECK (
 "state" IN ('PREPARED','DISPATCHING','SENT','FAILED','UNKNOWN') AND "configRevision">0
 AND "templateFingerprint" ~ '^[0-9a-f]{64}$'
 AND ("state" NOT IN ('DISPATCHING','SENT','UNKNOWN') OR "outboundOperationId" IS NOT NULL)
 AND ("state" <> 'SENT' OR "providerMessageId" IS NOT NULL)
);
COMMIT;
