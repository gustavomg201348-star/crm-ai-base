import { prisma } from "./db";
import { getSessionFromRequest } from "./auth";
import { createOpenCreditIntegrationService } from "./opencredit-integration.service";
import { createOpenCreditManagementHandlers } from "./opencredit-management-handler";

export const openCreditManagement = createOpenCreditManagementHandlers({
  getSession: getSessionFromRequest, service: createOpenCreditIntegrationService(prisma)
});
