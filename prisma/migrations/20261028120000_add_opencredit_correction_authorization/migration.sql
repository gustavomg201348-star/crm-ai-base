-- No data rewrite: historical UPSERT authorizations and events remain unchanged.
BEGIN;
ALTER TABLE "OpenCreditConsumerAuthorization" DROP CONSTRAINT "OCConsumerAuth_purpose_check";
ALTER TABLE "OpenCreditConsumerAuthorization" ADD CONSTRAINT "OCConsumerAuth_purpose_check"
CHECK ("purpose" IN ('CLIENT_PROFILE_UPSERT', 'CLIENT_PROFILE_CORRECTION'));
COMMIT;
