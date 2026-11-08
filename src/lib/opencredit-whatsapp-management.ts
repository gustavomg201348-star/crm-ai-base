import { getSessionFromRequest } from "./auth";
import { enforceRateLimits } from "./rate-limit";
import { openCreditWhatsappBootstrap, openCreditWhatsappConfig } from "./opencredit-whatsapp-runtime";
import { createOpenCreditWhatsappManagement } from "./opencredit-whatsapp-management-handler";
export const openCreditWhatsappManagement = createOpenCreditWhatsappManagement({ getSession: getSessionFromRequest,
  config: openCreditWhatsappConfig, bootstrap: openCreditWhatsappBootstrap, enforceLimits: enforceRateLimits });
