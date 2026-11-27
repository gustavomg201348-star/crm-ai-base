-- NULL preserves the process-wide setting for existing companies during rollout.
ALTER TABLE "Company" ADD COLUMN "cltCheckAutoReplyEnabled" BOOLEAN;
