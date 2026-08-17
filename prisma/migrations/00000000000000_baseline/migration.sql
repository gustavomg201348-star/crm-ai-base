-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "segment" TEXT,
    "aiMode" TEXT NOT NULL DEFAULT 'COPILOT',
    "aiInstructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'whatsapp',
    "provider" TEXT NOT NULL DEFAULT 'sandbox',
    "externalId" TEXT,
    "phoneNumberId" TEXT,
    "wabaId" TEXT,
    "displayPhone" TEXT,
    "accessToken" TEXT,
    "verifyToken" TEXT,
    "appSecret" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastWebhookSubscribedAt" TIMESTAMP(3),
    "lastWebhookReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "metaTemplateId" TEXT,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT,
    "metaStatus" TEXT,
    "operationalStatus" TEXT NOT NULL,
    "requiresHeaderMedia" BOOLEAN NOT NULL DEFAULT false,
    "headerFormat" TEXT,
    "components" TEXT NOT NULL,
    "rawPayload" TEXT,
    "supportFlags" TEXT,
    "defaultHeaderMediaAssetId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "syncError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageProvider" TEXT,
    "storageKey" TEXT,
    "publicUrl" TEXT,
    "metaMediaId" TEXT,
    "headerHandle" TEXT,
    "metaExpiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "checksum" TEXT,
    "metadata" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "validationError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'AGENT',
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAvailability" (
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAvailability_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "LeadAssignmentSetting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'CLAIM_FIRST',
    "onlineOnly" BOOLEAN NOT NULL DEFAULT true,
    "maxOpenPerAttendant" INTEGER,
    "allowAttendantClaim" BOOLEAN NOT NULL DEFAULT true,
    "redistributeWhenOffline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadAssignmentSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAssignmentHistory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "assignedByUserId" TEXT,
    "mode" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ownerId" TEXT,
    "stageId" TEXT,
    "originId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "normalizedPhone" TEXT,
    "email" TEXT,
    "cpf" TEXT,
    "internalNote" TEXT,
    "temperature" TEXT NOT NULL DEFAULT 'WARM',
    "lastMessage" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MulticredClient" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "rg" TEXT,
    "birthDate" TIMESTAMP(3),
    "motherName" TEXT,
    "maritalStatus" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "zipCode" TEXT,
    "street" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "district" TEXT,
    "city" TEXT,
    "state" TEXT,
    "bank" TEXT,
    "agency" TEXT,
    "account" TEXT,
    "accountType" TEXT,
    "pixKey" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MulticredClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MulticredBank" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "category" TEXT,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MulticredBank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MulticredProduct" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "agreement" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MulticredProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetirementLead" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "grantDate" TIMESTAMP(3),
    "estimatedUnlockDate" TIMESTAMP(3),
    "daysToUnlock" INTEGER,
    "benefitType" TEXT,
    "benefitNumber" TEXT,
    "state" TEXT,
    "city" TEXT,
    "desiredAmount" DECIMAL(65,30),
    "interestLevel" TEXT NOT NULL DEFAULT 'NONE',
    "hasCorrespondent" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL DEFAULT 0,
    "journeyStatus" TEXT NOT NULL DEFAULT 'IMPORTED',
    "nextContactDate" TIMESTAMP(3),
    "lastContactDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetirementLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetirementLeadEvent" (
    "id" TEXT NOT NULL,
    "retirementLeadId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "description" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetirementLeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactActivity" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "textColor" TEXT DEFAULT '#ffffff',
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTag" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateTable
CREATE TABLE "Origin" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Origin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "agentId" TEXT,
    "channelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "summary" TEXT,
    "aiMode" TEXT,
    "aiPaused" BOOLEAN NOT NULL DEFAULT false,
    "aiLastSuggestion" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "lastInboundMessageAt" TIMESTAMP(3),
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTag" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "mediaUrl" TEXT,
    "mediaId" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "templateName" TEXT,
    "templateLanguage" TEXT,
    "templateVariables" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "providerMessageId" TEXT,
    "readAt" TIMESTAMP(3),
    "senderType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT,
    "channelId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'NEW_INBOUND_MESSAGE',
    "channelLabel" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'TEXT',
    "templateName" TEXT,
    "templateLanguage" TEXT,
    "templateVariables" TEXT,
    "templateVariableMapping" TEXT,
    "imagePath" TEXT,
    "imageName" TEXT,
    "imageMime" TEXT,
    "imageSize" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "resolvedTemplateVariables" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "multicredClientId" TEXT,
    "assignedUserId" TEXT,
    "bank" TEXT NOT NULL,
    "agreement" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "operation" TEXT,
    "proposalNumber" TEXT,
    "contractNumber" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "financedAmount" DECIMAL(65,30),
    "releasedAmount" DECIMAL(65,30),
    "installmentAmount" DECIMAL(65,30),
    "term" INTEGER,
    "commission" DECIMAL(65,30) NOT NULL,
    "commissionReceived" DECIMAL(65,30),
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalHistory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CltIntegration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "baseUrl" TEXT,
    "authType" TEXT NOT NULL DEFAULT 'none',
    "apiKey" TEXT,
    "username" TEXT,
    "password" TEXT,
    "newcorbanIdentifier" TEXT,
    "digitadorCode" TEXT,
    "certifiedAgentCpf" TEXT,
    "actingUf" TEXT,
    "smsStatus" TEXT,
    "smsRequestedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'MANUAL',
    "lastTestAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastTestMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CltIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CltSimulationLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "contactId" TEXT,
    "bankId" TEXT,
    "bankName" TEXT,
    "action" TEXT NOT NULL,
    "cpf" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "message" TEXT,
    "inputJson" TEXT,
    "outputJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CltSimulationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Channel_companyId_idx" ON "Channel"("companyId");

-- CreateIndex
CREATE INDEX "MetaTemplate_companyId_idx" ON "MetaTemplate"("companyId");

-- CreateIndex
CREATE INDEX "MetaTemplate_companyId_wabaId_idx" ON "MetaTemplate"("companyId", "wabaId");

-- CreateIndex
CREATE INDEX "MetaTemplate_companyId_operationalStatus_idx" ON "MetaTemplate"("companyId", "operationalStatus");

-- CreateIndex
CREATE INDEX "MetaTemplate_companyId_defaultHeaderMediaAssetId_idx" ON "MetaTemplate"("companyId", "defaultHeaderMediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaTemplate_companyId_wabaId_name_language_key" ON "MetaTemplate"("companyId", "wabaId", "name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "MetaTemplate_companyId_wabaId_metaTemplateId_key" ON "MetaTemplate"("companyId", "wabaId", "metaTemplateId");

-- CreateIndex
CREATE INDEX "MediaAsset_companyId_idx" ON "MediaAsset"("companyId");

-- CreateIndex
CREATE INDEX "MediaAsset_companyId_type_idx" ON "MediaAsset"("companyId", "type");

-- CreateIndex
CREATE INDEX "MediaAsset_companyId_status_idx" ON "MediaAsset"("companyId", "status");

-- CreateIndex
CREATE INDEX "MediaAsset_companyId_metaMediaId_idx" ON "MediaAsset"("companyId", "metaMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_companyId_id_key" ON "MediaAsset"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "UserAvailability_companyId_idx" ON "UserAvailability"("companyId");

-- CreateIndex
CREATE INDEX "UserAvailability_status_idx" ON "UserAvailability"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LeadAssignmentSetting_companyId_key" ON "LeadAssignmentSetting"("companyId");

-- CreateIndex
CREATE INDEX "LeadAssignmentHistory_companyId_idx" ON "LeadAssignmentHistory"("companyId");

-- CreateIndex
CREATE INDEX "LeadAssignmentHistory_conversationId_idx" ON "LeadAssignmentHistory"("conversationId");

-- CreateIndex
CREATE INDEX "LeadAssignmentHistory_assignedToUserId_idx" ON "LeadAssignmentHistory"("assignedToUserId");

-- CreateIndex
CREATE INDEX "LeadAssignmentHistory_assignedByUserId_idx" ON "LeadAssignmentHistory"("assignedByUserId");

-- CreateIndex
CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");

-- CreateIndex
CREATE INDEX "Contact_companyId_phone_idx" ON "Contact"("companyId", "phone");

-- CreateIndex
CREATE INDEX "Contact_companyId_normalizedPhone_idx" ON "Contact"("companyId", "normalizedPhone");

-- CreateIndex
CREATE INDEX "Contact_companyId_cpf_idx" ON "Contact"("companyId", "cpf");

-- CreateIndex
CREATE INDEX "Contact_companyId_updatedAt_idx" ON "Contact"("companyId", "updatedAt");

-- CreateIndex
CREATE INDEX "Contact_companyId_createdAt_idx" ON "Contact"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Contact_ownerId_idx" ON "Contact"("ownerId");

-- CreateIndex
CREATE INDEX "Contact_stageId_idx" ON "Contact"("stageId");

-- CreateIndex
CREATE INDEX "Contact_originId_idx" ON "Contact"("originId");

-- CreateIndex
CREATE INDEX "MulticredClient_companyId_idx" ON "MulticredClient"("companyId");

-- CreateIndex
CREATE INDEX "MulticredClient_companyId_updatedAt_idx" ON "MulticredClient"("companyId", "updatedAt");

-- CreateIndex
CREATE INDEX "MulticredClient_contactId_idx" ON "MulticredClient"("contactId");

-- CreateIndex
CREATE INDEX "MulticredClient_createdById_idx" ON "MulticredClient"("createdById");

-- CreateIndex
CREATE INDEX "MulticredClient_phone_idx" ON "MulticredClient"("phone");

-- CreateIndex
CREATE INDEX "MulticredClient_whatsapp_idx" ON "MulticredClient"("whatsapp");

-- CreateIndex
CREATE UNIQUE INDEX "MulticredClient_companyId_cpf_key" ON "MulticredClient"("companyId", "cpf");

-- CreateIndex
CREATE INDEX "MulticredBank_companyId_idx" ON "MulticredBank"("companyId");

-- CreateIndex
CREATE INDEX "MulticredBank_companyId_name_idx" ON "MulticredBank"("companyId", "name");

-- CreateIndex
CREATE INDEX "MulticredBank_companyId_isActive_idx" ON "MulticredBank"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "MulticredBank_companyId_position_idx" ON "MulticredBank"("companyId", "position");

-- CreateIndex
CREATE INDEX "MulticredProduct_companyId_idx" ON "MulticredProduct"("companyId");

-- CreateIndex
CREATE INDEX "MulticredProduct_bankId_idx" ON "MulticredProduct"("bankId");

-- CreateIndex
CREATE INDEX "MulticredProduct_companyId_isActive_idx" ON "MulticredProduct"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "MulticredProduct_companyId_position_idx" ON "MulticredProduct"("companyId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "MulticredProduct_companyId_bankId_agreement_name_key" ON "MulticredProduct"("companyId", "bankId", "agreement", "name");

-- CreateIndex
CREATE INDEX "RetirementLead_companyId_idx" ON "RetirementLead"("companyId");

-- CreateIndex
CREATE INDEX "RetirementLead_contactId_idx" ON "RetirementLead"("contactId");

-- CreateIndex
CREATE INDEX "RetirementLead_estimatedUnlockDate_idx" ON "RetirementLead"("estimatedUnlockDate");

-- CreateIndex
CREATE INDEX "RetirementLead_daysToUnlock_idx" ON "RetirementLead"("daysToUnlock");

-- CreateIndex
CREATE INDEX "RetirementLead_score_idx" ON "RetirementLead"("score");

-- CreateIndex
CREATE INDEX "RetirementLead_journeyStatus_idx" ON "RetirementLead"("journeyStatus");

-- CreateIndex
CREATE INDEX "RetirementLead_nextContactDate_idx" ON "RetirementLead"("nextContactDate");

-- CreateIndex
CREATE UNIQUE INDEX "RetirementLead_companyId_contactId_key" ON "RetirementLead"("companyId", "contactId");

-- CreateIndex
CREATE INDEX "RetirementLeadEvent_retirementLeadId_idx" ON "RetirementLeadEvent"("retirementLeadId");

-- CreateIndex
CREATE INDEX "RetirementLeadEvent_eventType_idx" ON "RetirementLeadEvent"("eventType");

-- CreateIndex
CREATE INDEX "RetirementLeadEvent_createdByUserId_idx" ON "RetirementLeadEvent"("createdByUserId");

-- CreateIndex
CREATE INDEX "RetirementLeadEvent_createdAt_idx" ON "RetirementLeadEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ContactActivity_contactId_idx" ON "ContactActivity"("contactId");

-- CreateIndex
CREATE INDEX "ContactActivity_userId_idx" ON "ContactActivity"("userId");

-- CreateIndex
CREATE INDEX "Task_companyId_idx" ON "Task"("companyId");

-- CreateIndex
CREATE INDEX "Task_companyId_status_dueAt_idx" ON "Task"("companyId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_contactId_idx" ON "Task"("contactId");

-- CreateIndex
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_dueAt_idx" ON "Task"("assigneeId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_dueAt_idx" ON "Task"("dueAt");

-- CreateIndex
CREATE INDEX "Tag_companyId_idx" ON "Tag"("companyId");

-- CreateIndex
CREATE INDEX "Tag_companyId_name_idx" ON "Tag"("companyId", "name");

-- CreateIndex
CREATE INDEX "Origin_companyId_idx" ON "Origin"("companyId");

-- CreateIndex
CREATE INDEX "PipelineStage_companyId_idx" ON "PipelineStage"("companyId");

-- CreateIndex
CREATE INDEX "PipelineStage_companyId_position_idx" ON "PipelineStage"("companyId", "position");

-- CreateIndex
CREATE INDEX "Conversation_contactId_idx" ON "Conversation"("contactId");

-- CreateIndex
CREATE INDEX "Conversation_channelId_idx" ON "Conversation"("channelId");

-- CreateIndex
CREATE INDEX "Conversation_contactId_channelId_status_idx" ON "Conversation"("contactId", "channelId", "status");

-- CreateIndex
CREATE INDEX "Conversation_agentId_idx" ON "Conversation"("agentId");

-- CreateIndex
CREATE INDEX "Conversation_agentId_status_updatedAt_idx" ON "Conversation"("agentId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_status_idx" ON "Conversation"("status");

-- CreateIndex
CREATE INDEX "ConversationTag_companyId_idx" ON "ConversationTag"("companyId");

-- CreateIndex
CREATE INDEX "ConversationTag_conversationId_idx" ON "ConversationTag"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationTag_tagId_idx" ON "ConversationTag"("tagId");

-- CreateIndex
CREATE INDEX "ConversationTag_createdByUserId_idx" ON "ConversationTag"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTag_conversationId_tagId_key" ON "ConversationTag"("conversationId", "tagId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_status_idx" ON "Message"("status");

-- CreateIndex
CREATE INDEX "Message_direction_idx" ON "Message"("direction");

-- CreateIndex
CREATE INDEX "Message_providerMessageId_idx" ON "Message"("providerMessageId");

-- CreateIndex
CREATE INDEX "Notification_companyId_createdAt_idx" ON "Notification"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_companyId_readAt_idx" ON "Notification"("companyId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_conversationId_idx" ON "Notification"("conversationId");

-- CreateIndex
CREATE INDEX "Notification_contactId_idx" ON "Notification"("contactId");

-- CreateIndex
CREATE INDEX "Campaign_companyId_idx" ON "Campaign"("companyId");

-- CreateIndex
CREATE INDEX "Campaign_channelId_idx" ON "Campaign"("channelId");

-- CreateIndex
CREATE INDEX "Campaign_createdById_idx" ON "Campaign"("createdById");

-- CreateIndex
CREATE INDEX "CampaignRecipient_contactId_idx" ON "CampaignRecipient"("contactId");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignRecipient_contactId_status_idx" ON "CampaignRecipient"("contactId", "status");

-- CreateIndex
CREATE INDEX "CampaignRecipient_conversationId_idx" ON "CampaignRecipient"("conversationId");

-- CreateIndex
CREATE INDEX "CampaignRecipient_providerMessageId_idx" ON "CampaignRecipient"("providerMessageId");

-- CreateIndex
CREATE INDEX "CampaignRecipient_status_idx" ON "CampaignRecipient"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_contactId_key" ON "CampaignRecipient"("campaignId", "contactId");

-- CreateIndex
CREATE INDEX "Proposal_companyId_createdAt_idx" ON "Proposal"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Proposal_companyId_status_createdAt_idx" ON "Proposal"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Proposal_companyId_bank_idx" ON "Proposal"("companyId", "bank");

-- CreateIndex
CREATE INDEX "Proposal_companyId_product_idx" ON "Proposal"("companyId", "product");

-- CreateIndex
CREATE INDEX "Proposal_assignedUserId_idx" ON "Proposal"("assignedUserId");

-- CreateIndex
CREATE INDEX "Proposal_multicredClientId_idx" ON "Proposal"("multicredClientId");

-- CreateIndex
CREATE INDEX "ProposalHistory_companyId_idx" ON "ProposalHistory"("companyId");

-- CreateIndex
CREATE INDEX "ProposalHistory_proposalId_createdAt_idx" ON "ProposalHistory"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "ProposalHistory_userId_idx" ON "ProposalHistory"("userId");

-- CreateIndex
CREATE INDEX "CltIntegration_companyId_idx" ON "CltIntegration"("companyId");

-- CreateIndex
CREATE INDEX "CltIntegration_status_idx" ON "CltIntegration"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CltIntegration_companyId_bankId_key" ON "CltIntegration"("companyId", "bankId");

-- CreateIndex
CREATE INDEX "CltSimulationLog_companyId_createdAt_idx" ON "CltSimulationLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "CltSimulationLog_userId_idx" ON "CltSimulationLog"("userId");

-- CreateIndex
CREATE INDEX "CltSimulationLog_contactId_idx" ON "CltSimulationLog"("contactId");

-- CreateIndex
CREATE INDEX "CltSimulationLog_bankId_idx" ON "CltSimulationLog"("bankId");

-- CreateIndex
CREATE INDEX "CltSimulationLog_status_idx" ON "CltSimulationLog"("status");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaTemplate" ADD CONSTRAINT "MetaTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaTemplate" ADD CONSTRAINT "MetaTemplate_companyId_defaultHeaderMediaAssetId_fkey" FOREIGN KEY ("companyId", "defaultHeaderMediaAssetId") REFERENCES "MediaAsset"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAvailability" ADD CONSTRAINT "UserAvailability_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAvailability" ADD CONSTRAINT "UserAvailability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignmentSetting" ADD CONSTRAINT "LeadAssignmentSetting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignmentHistory" ADD CONSTRAINT "LeadAssignmentHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignmentHistory" ADD CONSTRAINT "LeadAssignmentHistory_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignmentHistory" ADD CONSTRAINT "LeadAssignmentHistory_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignmentHistory" ADD CONSTRAINT "LeadAssignmentHistory_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_originId_fkey" FOREIGN KEY ("originId") REFERENCES "Origin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MulticredClient" ADD CONSTRAINT "MulticredClient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MulticredClient" ADD CONSTRAINT "MulticredClient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MulticredClient" ADD CONSTRAINT "MulticredClient_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MulticredBank" ADD CONSTRAINT "MulticredBank_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MulticredProduct" ADD CONSTRAINT "MulticredProduct_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MulticredProduct" ADD CONSTRAINT "MulticredProduct_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "MulticredBank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetirementLead" ADD CONSTRAINT "RetirementLead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetirementLead" ADD CONSTRAINT "RetirementLead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetirementLeadEvent" ADD CONSTRAINT "RetirementLeadEvent_retirementLeadId_fkey" FOREIGN KEY ("retirementLeadId") REFERENCES "RetirementLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetirementLeadEvent" ADD CONSTRAINT "RetirementLeadEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactActivity" ADD CONSTRAINT "ContactActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactActivity" ADD CONSTRAINT "ContactActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Origin" ADD CONSTRAINT "Origin_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTag" ADD CONSTRAINT "ConversationTag_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTag" ADD CONSTRAINT "ConversationTag_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTag" ADD CONSTRAINT "ConversationTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTag" ADD CONSTRAINT "ConversationTag_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_multicredClientId_fkey" FOREIGN KEY ("multicredClientId") REFERENCES "MulticredClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalHistory" ADD CONSTRAINT "ProposalHistory_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalHistory" ADD CONSTRAINT "ProposalHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CltIntegration" ADD CONSTRAINT "CltIntegration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CltSimulationLog" ADD CONSTRAINT "CltSimulationLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CltSimulationLog" ADD CONSTRAINT "CltSimulationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CltSimulationLog" ADD CONSTRAINT "CltSimulationLog_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Baseline manual PostgreSQL objects
-- These partial unique indexes exist in production and are not representable by
-- the current Prisma schema DSL. They are part of the production baseline and
-- must be preserved when moving from prisma db push to prisma migrate deploy.

-- Contact phone identity: one non-null normalized phone per company.
CREATE UNIQUE INDEX "Contact_companyId_normalizedPhone_unique"
ON "Contact" ("companyId", "normalizedPhone")
WHERE "normalizedPhone" IS NOT NULL;

-- Conversation identity: one active/open channel conversation per contact.
CREATE UNIQUE INDEX "Conversation_open_contact_channel_unique"
ON "Conversation" ("contactId", "channelId")
WHERE "channelId" IS NOT NULL
  AND "status" IN ('OPEN', 'PENDING', 'BOT', 'SOLD');

-- Meta webhook idempotency: providerMessageId is unique when present.
CREATE UNIQUE INDEX "Message_providerMessageId_unique"
ON "Message" ("providerMessageId")
WHERE "providerMessageId" IS NOT NULL;

-- Campaign delivery idempotency: providerMessageId is unique when present.
CREATE UNIQUE INDEX "CampaignRecipient_providerMessageId_unique"
ON "CampaignRecipient" ("providerMessageId")
WHERE "providerMessageId" IS NOT NULL;

-- Meta channel routing: phoneNumberId is globally unique for Meta channels.
CREATE UNIQUE INDEX "Channel_meta_phoneNumberId_unique"
ON "Channel" ("phoneNumberId")
WHERE "provider" = 'meta'
  AND "phoneNumberId" IS NOT NULL;

-- Meta channel routing: externalId is globally unique for Meta channels.
CREATE UNIQUE INDEX "Channel_meta_externalId_unique"
ON "Channel" ("externalId")
WHERE "provider" = 'meta'
  AND "externalId" IS NOT NULL;
