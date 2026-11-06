BEGIN;

ALTER TABLE "OpenCreditLeadMaterialization"
  ADD COLUMN "contactId" TEXT,
  ADD COLUMN "channelId" TEXT,
  ADD COLUMN "conversationId" TEXT,
  ADD CONSTRAINT "OCMaterialization_domain_outcome_check" CHECK (
    ("contactId" IS NULL AND "channelId" IS NULL AND "conversationId" IS NULL)
    OR ("state" = 'COMPLETED' AND "contactId" IS NOT NULL AND "channelId" IS NOT NULL AND "conversationId" IS NOT NULL)
  ),
  ADD CONSTRAINT "OCMaterialization_contact_fkey"
    FOREIGN KEY ("companyId", "contactId") REFERENCES "Contact"("companyId", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "OCMaterialization_channel_fkey"
    FOREIGN KEY ("companyId", "channelId") REFERENCES "Channel"("companyId", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "OCMaterialization_conversation_fkey"
    FOREIGN KEY ("conversationId", "contactId", "channelId") REFERENCES "Conversation"("id", "contactId", "channelId")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  DROP CONSTRAINT "OCMaterialization_last_error_check",
  ADD CONSTRAINT "OCMaterialization_last_error_check" CHECK (
    "lastErrorCode" IN ('TRANSIENT_FAILURE', 'KEY_UNAVAILABLE', 'SERIALIZATION_CONFLICT', 'LEASE_EXPIRED', 'MODE_UNAVAILABLE')
  );

COMMIT;
