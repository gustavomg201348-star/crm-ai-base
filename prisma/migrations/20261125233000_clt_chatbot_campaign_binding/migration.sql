CREATE TABLE "CltChatbotCampaignBinding" (
  "companyId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "templateName" TEXT NOT NULL,
  "templateLanguage" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "flowId" TEXT NOT NULL,
  "flowVersionId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CltChatbotCampaignBinding_pkey" PRIMARY KEY ("companyId", "channelId", "campaignId"),
  CONSTRAINT "CltChatbotBinding_campaign_fkey" FOREIGN KEY ("companyId", "channelId", "campaignId")
    REFERENCES "Campaign"("companyId", "channelId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "CltChatbotBinding_version_fkey" FOREIGN KEY ("companyId", "flowId", "flowVersionId")
    REFERENCES "ChatbotFlowVersion"("companyId", "flowId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "CltChatbotBinding_version_idx" ON "CltChatbotCampaignBinding"("companyId", "flowId", "flowVersionId");
