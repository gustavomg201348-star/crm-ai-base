-- AlterTable
ALTER TABLE "Message" ADD COLUMN "replyToMessageId" TEXT;
ALTER TABLE "Message" ADD COLUMN "replyToProviderMessageId" TEXT;
ALTER TABLE "Message" ADD COLUMN "replyPreviewType" TEXT;
ALTER TABLE "Message" ADD COLUMN "replyPreviewBody" TEXT;
ALTER TABLE "Message" ADD COLUMN "replyPreviewFileName" TEXT;

-- CreateIndex
CREATE INDEX "Message_replyToMessageId_idx" ON "Message"("replyToMessageId");

-- CreateIndex
CREATE INDEX "Message_replyToProviderMessageId_idx" ON "Message"("replyToProviderMessageId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToMessageId_fkey"
FOREIGN KEY ("replyToMessageId") REFERENCES "Message"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
