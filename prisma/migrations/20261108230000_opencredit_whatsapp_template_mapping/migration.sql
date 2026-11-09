BEGIN;
ALTER TABLE "OpenCreditWhatsappConfig" ADD COLUMN "initialTemplateVariableMapping" TEXT;
ALTER TABLE "OpenCreditWhatsappConfig" ADD CONSTRAINT "OCWhatsappConfig_mapping_check"
  CHECK ("initialTemplateVariableMapping" IS NULL OR "initialTemplateVariableMapping" IN ('NONE', 'CONTACT_NAME'));
COMMIT;
