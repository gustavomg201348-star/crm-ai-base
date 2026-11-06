ALTER TABLE "OpenCreditIntegration"
ADD CONSTRAINT "OpenCreditIntegration_domain_mode_exclusive_check"
CHECK (NOT ("enabled" AND "materializationEnabled"));
