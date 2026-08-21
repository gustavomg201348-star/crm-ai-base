-- CreateTable
CREATE TABLE "NextBestActionEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentHistoryId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "outcome" TEXT,
    "opportunityReason" TEXT,
    "recommendedAction" TEXT,
    "probableProduct" TEXT,
    "priority" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "suppressedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NextBestActionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NextBestActionEvent_assignmentHistoryId_key" ON "NextBestActionEvent"("assignmentHistoryId");

-- CreateIndex
CREATE UNIQUE INDEX "NextBestActionEvent_companyId_idempotencyKey_key" ON "NextBestActionEvent"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "NextBestActionEvent_companyId_conversationId_createdAt_idx" ON "NextBestActionEvent"("companyId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "NextBestActionEvent_companyId_contactId_createdAt_idx" ON "NextBestActionEvent"("companyId", "contactId", "createdAt");

-- CreateIndex
CREATE INDEX "NextBestActionEvent_companyId_userId_createdAt_idx" ON "NextBestActionEvent"("companyId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "NextBestActionEvent_companyId_action_createdAt_idx" ON "NextBestActionEvent"("companyId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "NextBestActionEvent_companyId_suppressedUntil_idx" ON "NextBestActionEvent"("companyId", "suppressedUntil");

-- AddForeignKey
ALTER TABLE "NextBestActionEvent" ADD CONSTRAINT "NextBestActionEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextBestActionEvent" ADD CONSTRAINT "NextBestActionEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextBestActionEvent" ADD CONSTRAINT "NextBestActionEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextBestActionEvent" ADD CONSTRAINT "NextBestActionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextBestActionEvent" ADD CONSTRAINT "NextBestActionEvent_assignmentHistoryId_fkey" FOREIGN KEY ("assignmentHistoryId") REFERENCES "LeadAssignmentHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
