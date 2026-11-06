BEGIN;

CREATE UNIQUE INDEX "Channel_one_opencredit_per_company"
ON "Channel" ("companyId")
WHERE "type" = 'OPEN_CREDIT';

ALTER TABLE "Channel" ADD CONSTRAINT "Channel_opencredit_internal_check" CHECK (
  "type" <> 'OPEN_CREDIT' OR (
    "provider" = 'internal'
    AND "externalId" IS NULL AND "phoneNumberId" IS NULL AND "wabaId" IS NULL
    AND "displayPhone" IS NULL AND "accessToken" IS NULL AND "verifyToken" IS NULL
    AND "appSecret" IS NULL AND "lastWebhookSubscribedAt" IS NULL AND "lastWebhookReceivedAt" IS NULL
  )
);

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_opencredit_channel_required_check"
CHECK ("channel" <> 'OPEN_CREDIT' OR "channelId" IS NOT NULL);

DROP INDEX "Conversation_open_contact_channel_unique";
CREATE UNIQUE INDEX "Conversation_open_contact_channel_unique"
ON "Conversation" ("contactId", "channelId")
WHERE "channelId" IS NOT NULL
  AND ("status" IN ('OPEN', 'PENDING', 'BOT') OR ("status" = 'SOLD' AND "channel" <> 'OPEN_CREDIT'));

COMMIT;
