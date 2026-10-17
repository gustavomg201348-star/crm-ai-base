-- CreateTable
BEGIN;

CREATE TABLE "ConversationAuthority" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "generation" BIGINT NOT NULL DEFAULT 0,
    "ownerUserId" TEXT,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundOperation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "logicalKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "actorUserId" TEXT,
    "payload" TEXT NOT NULL,
    "authorityGeneration" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "activeSlot" TEXT,
    "reservationToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "dispatchDeadline" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "resultFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorityEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "logicalKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "fromGeneration" BIGINT NOT NULL,
    "toGeneration" BIGINT NOT NULL,
    "fromOwnerUserId" TEXT,
    "toOwnerUserId" TEXT,
    "auditTransactionId" TEXT NOT NULL DEFAULT '',
    "operationId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAuthority_conversationId_key" ON "ConversationAuthority"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationAuthority_companyId_channelId_state_idx" ON "ConversationAuthority"("companyId", "channelId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAuthority_companyId_channelId_conversationId_id_key" ON "ConversationAuthority"("companyId", "channelId", "conversationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAuthority_conversationId_contactId_channelId_key" ON "ConversationAuthority"("conversationId", "contactId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundOperation_activeSlot_key" ON "OutboundOperation"("activeSlot");

-- CreateIndex
CREATE INDEX "OutboundOperation_authorityId_status_idx" ON "OutboundOperation"("authorityId", "status");

-- CreateIndex
CREATE INDEX "OutboundOperation_status_leaseUntil_idx" ON "OutboundOperation"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundOperation_companyId_channelId_conversationId_id_key" ON "OutboundOperation"("companyId", "channelId", "conversationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundOperation_companyId_channelId_logicalKey_key" ON "OutboundOperation"("companyId", "channelId", "logicalKey");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundOperation_companyId_channelId_providerMessageId_key" ON "OutboundOperation"("companyId", "channelId", "providerMessageId");

-- CreateIndex
CREATE INDEX "AuthorityEvent_authorityId_createdAt_idx" ON "AuthorityEvent"("authorityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorityEvent_companyId_channelId_logicalKey_key" ON "AuthorityEvent"("companyId", "channelId", "logicalKey");

-- CreateIndex
CREATE UNIQUE INDEX "User_companyId_id_key" ON "User"("companyId", "id");

-- AddForeignKey
ALTER TABLE "ConversationAuthority" ADD CONSTRAINT "ConversationAuthority_companyId_ownerUserId_fkey" FOREIGN KEY ("companyId", "ownerUserId") REFERENCES "User"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ConversationAuthority" ADD CONSTRAINT "ConversationAuthority_companyId_contactId_fkey" FOREIGN KEY ("companyId", "contactId") REFERENCES "Contact"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ConversationAuthority" ADD CONSTRAINT "ConversationAuthority_companyId_channelId_fkey" FOREIGN KEY ("companyId", "channelId") REFERENCES "Channel"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ConversationAuthority" ADD CONSTRAINT "ConversationAuthority_conversationId_contactId_channelId_fkey" FOREIGN KEY ("conversationId", "contactId", "channelId") REFERENCES "Conversation"("id", "contactId", "channelId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OutboundOperation" ADD CONSTRAINT "OutboundOperation_companyId_actorUserId_fkey" FOREIGN KEY ("companyId", "actorUserId") REFERENCES "User"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OutboundOperation" ADD CONSTRAINT "OutboundOperation_companyId_channelId_conversationId_autho_fkey" FOREIGN KEY ("companyId", "channelId", "conversationId", "authorityId") REFERENCES "ConversationAuthority"("companyId", "channelId", "conversationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuthorityEvent" ADD CONSTRAINT "AuthorityEvent_companyId_actorUserId_fkey" FOREIGN KEY ("companyId", "actorUserId") REFERENCES "User"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuthorityEvent" ADD CONSTRAINT "AuthorityEvent_companyId_channelId_conversationId_operatio_fkey" FOREIGN KEY ("companyId", "channelId", "conversationId", "operationId") REFERENCES "OutboundOperation"("companyId", "channelId", "conversationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuthorityEvent" ADD CONSTRAINT "AuthorityEvent_companyId_channelId_conversationId_authorit_fkey" FOREIGN KEY ("companyId", "channelId", "conversationId", "authorityId") REFERENCES "ConversationAuthority"("companyId", "channelId", "conversationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- Passive ledger: no triggers write existing CRM entities or call external systems.
ALTER TABLE "ConversationAuthority" ADD CONSTRAINT "authority_state_check"
  CHECK ("state" IN ('HUMAN_QUEUE','HUMAN','AI','CLOSED'));
ALTER TABLE "ConversationAuthority" ADD CONSTRAINT "authority_generation_check" CHECK ("generation" >= 0 AND "policyVersion" > 0);
ALTER TABLE "ConversationAuthority" ADD CONSTRAINT "authority_owner_check" CHECK (("state" = 'HUMAN') = ("ownerUserId" IS NOT NULL));
ALTER TABLE "OutboundOperation" ADD CONSTRAINT "outbound_origin_check"
  CHECK ("origin" IN ('HUMAN','AI','CAMPAIGN') AND (("origin" = 'AI') = ("actorUserId" IS NULL)));
ALTER TABLE "OutboundOperation" ADD CONSTRAINT "outbound_generation_check" CHECK ("authorityGeneration" >= 0);
ALTER TABLE "OutboundOperation" ADD CONSTRAINT "outbound_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');
ALTER TABLE "OutboundOperation" ADD CONSTRAINT "outbound_slot_check" CHECK (
  ("status" = 'PREPARED' AND "activeSlot" IS NULL AND "reservationToken" IS NULL AND "leaseUntil" IS NULL AND "dispatchDeadline" IS NULL) OR
  ("status" = 'RESERVED' AND "activeSlot" IS NOT NULL AND "activeSlot" = "authorityId" AND "reservationToken" IS NOT NULL AND "leaseUntil" IS NOT NULL AND "dispatchDeadline" IS NULL) OR
  ("status" = 'DISPATCHING' AND "activeSlot" IS NOT NULL AND "activeSlot" = "authorityId" AND "reservationToken" IS NOT NULL AND "leaseUntil" IS NULL AND "dispatchDeadline" IS NOT NULL) OR
  ("status" = 'UNKNOWN' AND "activeSlot" IS NOT NULL AND "activeSlot" = "authorityId" AND "reservationToken" IS NOT NULL AND "leaseUntil" IS NULL AND "dispatchDeadline" IS NULL) OR
  ("status" IN ('SENT','FAILED','CANCELED') AND "activeSlot" IS NULL AND "reservationToken" IS NULL AND "leaseUntil" IS NULL AND "dispatchDeadline" IS NULL)
);
ALTER TABLE "OutboundOperation" ADD CONSTRAINT "outbound_provider_check"
  CHECK (("status" = 'SENT' AND "providerMessageId" IS NOT NULL AND length("providerMessageId") > 0) OR ("status" <> 'SENT' AND "providerMessageId" IS NULL));
ALTER TABLE "AuthorityEvent" ADD CONSTRAINT "authority_event_check" CHECK (
  "fromGeneration" >= 0 AND "toGeneration" >= "fromGeneration" AND "fingerprint" ~ '^[0-9a-f]{64}$' AND length("reason") > 0
  AND "kind" IN ('INITIALIZE','TRANSITION','RECONCILE_UNKNOWN')
  AND (("kind" = 'RECONCILE_UNKNOWN') = ("operationId" IS NOT NULL))
  AND (("toState" = 'HUMAN') = ("toOwnerUserId" IS NOT NULL))
  AND (("fromState" IS NOT DISTINCT FROM 'HUMAN') = ("fromOwnerUserId" IS NOT NULL))
  AND "auditTransactionId" ~ '^[0-9]+$'
);

-- Always overwrite caller input with the epoch-aware top-level transaction ID.
-- Unlike xmin, pg_current_xact_id() is stable inside real savepoints.
CREATE FUNCTION qevora_authority_event_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."auditTransactionId" := pg_current_xact_id()::text;
  RETURN NEW;
END $$;
CREATE TRIGGER authority_event_transaction_stamp BEFORE INSERT ON "AuthorityEvent"
  FOR EACH ROW EXECUTE FUNCTION qevora_authority_event_stamp();

CREATE FUNCTION qevora_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id",NEW."companyId",NEW."channelId",NEW."conversationId",NEW."contactId",NEW."createdAt",NEW."policyVersion")
     IS DISTINCT FROM ROW(OLD."id",OLD."companyId",OLD."channelId",OLD."conversationId",OLD."contactId",OLD."createdAt",OLD."policyVersion") THEN
    RAISE EXCEPTION 'AUTHORITY_SCOPE_IMMUTABLE'; END IF;
  IF NOT (CASE OLD."state"
    WHEN 'HUMAN_QUEUE' THEN NEW."state" IN ('HUMAN_QUEUE','HUMAN','AI','CLOSED')
    WHEN 'HUMAN' THEN NEW."state" IN ('HUMAN','HUMAN_QUEUE','AI','CLOSED')
    WHEN 'AI' THEN NEW."state" IN ('AI','HUMAN','HUMAN_QUEUE','CLOSED')
    WHEN 'CLOSED' THEN NEW."state" IN ('CLOSED','HUMAN_QUEUE','HUMAN')
    ELSE FALSE END) THEN RAISE EXCEPTION 'AUTHORITY_INVALID_TRANSITION'; END IF;
  IF ROW(NEW."state",NEW."ownerUserId",NEW."policyVersion") IS DISTINCT FROM ROW(OLD."state",OLD."ownerUserId",OLD."policyVersion") THEN
    IF OLD."generation" = 9223372036854775807 OR NEW."generation" <> OLD."generation" + 1 THEN
      RAISE EXCEPTION 'AUTHORITY_GENERATION_CONFLICT'; END IF;
  ELSIF NEW."generation" <> OLD."generation" THEN RAISE EXCEPTION 'AUTHORITY_GENERATION_CONFLICT'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER authority_immutable_scope BEFORE UPDATE ON "ConversationAuthority" FOR EACH ROW EXECUTE FUNCTION qevora_authority_guard();

-- The audit must be inserted in the same transaction, with the exact old/new snapshots.
-- The database stamp identifies the top-level transaction, including its subtransactions.
CREATE FUNCTION qevora_authority_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."generation" <> 0 OR NEW."state" = 'AI' OR NOT EXISTS (
      SELECT 1 FROM "AuthorityEvent" e WHERE e."authorityId" = NEW.id
        AND e."companyId" = NEW."companyId" AND e."channelId" = NEW."channelId" AND e."conversationId" = NEW."conversationId"
        AND e."auditTransactionId" = pg_current_xact_id()::text
        AND e.kind = 'INITIALIZE' AND e."fromState" IS NULL AND e."toState" = NEW."state"
        AND e."fromGeneration" = 0 AND e."toGeneration" = 0
        AND e."fromOwnerUserId" IS NULL AND e."toOwnerUserId" IS NOT DISTINCT FROM NEW."ownerUserId"
    ) THEN RAISE EXCEPTION 'AUTHORITY_INITIALIZATION_AUDIT_REQUIRED'; END IF;
  ELSIF ROW(NEW."state", NEW."ownerUserId", NEW."generation") IS DISTINCT FROM ROW(OLD."state", OLD."ownerUserId", OLD."generation") THEN
    IF NOT EXISTS (
      SELECT 1 FROM "AuthorityEvent" e WHERE e."authorityId" = NEW.id
        AND e."companyId" = NEW."companyId" AND e."channelId" = NEW."channelId" AND e."conversationId" = NEW."conversationId"
        AND e."auditTransactionId" = pg_current_xact_id()::text
        AND e.kind = 'TRANSITION' AND e."fromState" = OLD."state" AND e."toState" = NEW."state"
        AND e."fromGeneration" = OLD."generation" AND e."toGeneration" = NEW."generation"
        AND e."fromOwnerUserId" IS NOT DISTINCT FROM OLD."ownerUserId"
        AND e."toOwnerUserId" IS NOT DISTINCT FROM NEW."ownerUserId"
    ) THEN RAISE EXCEPTION 'AUTHORITY_TRANSITION_AUDIT_REQUIRED'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER authority_requires_audit AFTER INSERT OR UPDATE ON "ConversationAuthority"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qevora_authority_audit_guard();

CREATE FUNCTION qevora_authority_ledger_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AUTHORITY_LEDGER_DELETE_FORBIDDEN'; END $$;
CREATE TRIGGER outbound_no_delete BEFORE DELETE ON "OutboundOperation" FOR EACH ROW EXECUTE FUNCTION qevora_authority_ledger_retention();
CREATE TRIGGER authority_no_delete BEFORE DELETE ON "ConversationAuthority" FOR EACH ROW EXECUTE FUNCTION qevora_authority_ledger_retention();
CREATE TRIGGER outbound_no_truncate BEFORE TRUNCATE ON "OutboundOperation" FOR EACH STATEMENT EXECUTE FUNCTION qevora_authority_ledger_retention();
CREATE TRIGGER authority_no_truncate BEFORE TRUNCATE ON "ConversationAuthority" FOR EACH STATEMENT EXECUTE FUNCTION qevora_authority_ledger_retention();
CREATE TRIGGER authority_event_no_truncate BEFORE TRUNCATE ON "AuthorityEvent" FOR EACH STATEMENT EXECUTE FUNCTION qevora_authority_ledger_retention();

CREATE FUNCTION qevora_outbound_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id",NEW."companyId",NEW."channelId",NEW."conversationId",NEW."authorityId",NEW."logicalKey",NEW."fingerprint",NEW."origin",NEW."actorUserId",NEW."payload",NEW."authorityGeneration",NEW."createdAt")
    IS DISTINCT FROM ROW(OLD."id",OLD."companyId",OLD."channelId",OLD."conversationId",OLD."authorityId",OLD."logicalKey",OLD."fingerprint",OLD."origin",OLD."actorUserId",OLD."payload",OLD."authorityGeneration",OLD."createdAt") THEN
    RAISE EXCEPTION 'OUTBOUND_INTENT_IMMUTABLE'; END IF;
  IF OLD."status" IN ('SENT','FAILED','CANCELED') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'OUTBOUND_TERMINAL_IMMUTABLE'; END IF;
  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'PREPARED' AND NEW."status" IN ('RESERVED','CANCELED')) OR
    (OLD."status" = 'RESERVED' AND NEW."status" IN ('PREPARED','DISPATCHING','CANCELED')) OR
    (OLD."status" = 'DISPATCHING' AND NEW."status" IN ('SENT','FAILED','UNKNOWN')) OR
    (OLD."status" = 'UNKNOWN' AND NEW."status" IN ('SENT','FAILED'))
  ) THEN RAISE EXCEPTION 'OUTBOUND_INVALID_TRANSITION'; END IF;
  IF OLD."status" IN ('DISPATCHING','UNKNOWN') AND NEW."status" IN ('DISPATCHING','UNKNOWN')
     AND NEW."reservationToken" IS DISTINCT FROM OLD."reservationToken" THEN RAISE EXCEPTION 'OUTBOUND_DISPATCH_TOKEN_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbound_immutable_intent BEFORE UPDATE ON "OutboundOperation" FOR EACH ROW EXECUTE FUNCTION qevora_outbound_guard();

CREATE FUNCTION qevora_authority_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AUTHORITY_EVENT_APPEND_ONLY'; END $$;
CREATE TRIGGER authority_event_append_only BEFORE UPDATE OR DELETE ON "AuthorityEvent" FOR EACH ROW EXECUTE FUNCTION qevora_authority_event_append_only();

CREATE FUNCTION qevora_unknown_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'UNKNOWN' AND NEW."status" <> 'UNKNOWN' AND NOT EXISTS (
    SELECT 1 FROM "AuthorityEvent" e WHERE e."operationId" = NEW.id AND e."authorityId" = NEW."authorityId"
      AND e."companyId" = NEW."companyId" AND e."channelId" = NEW."channelId" AND e."conversationId" = NEW."conversationId"
      AND e.kind = 'RECONCILE_UNKNOWN'
      AND e."auditTransactionId" = pg_current_xact_id()::text
  ) THEN RAISE EXCEPTION 'UNKNOWN_RECONCILIATION_AUDIT_REQUIRED'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER unknown_requires_audit AFTER UPDATE ON "OutboundOperation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qevora_unknown_audit_guard();
COMMIT;
