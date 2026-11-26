import type { AuthorityDatabase, AuthorityTx } from "./conversation-authority-storage";
import { authorityStorage } from "./conversation-authority-storage";
import { ChatbotError } from "./chatbot-definition";

// Shared company row lock fences every new authorization against the emergency stop.
// Disable takes an exclusive row lock; it never locks conversation rows.
export async function lockCltCompanyGate(tx: AuthorityTx, provider: AuthorityDatabase["provider"], companyId: string) {
  if (provider === "postgresql") {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR SHARE`;
  }
  return (await tx.company.findUnique({ where: { id: companyId }, select: { cltChatbotEnabled: true } }))?.cltChatbotEnabled === true;
}
export async function setCltCompanyEnabled(database: AuthorityDatabase, input: { companyId: string; actorUserId: string; enabled: boolean }) {
  const { companyId, actorUserId, enabled } = input;
  if (typeof enabled !== "boolean") throw new ChatbotError("INVALID_CONFIG");
  return authorityStorage(database).transaction(async tx => {
    const actor = await tx.user.findFirst({ where: { id: actorUserId, companyId, role: "ADMIN" }, select: { id: true } });
    if (!actor) throw new ChatbotError("FORBIDDEN");
    if (database.provider === "postgresql") await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`;
    const company = await tx.company.update({ where: { id: companyId }, data: { cltChatbotEnabled: enabled }, select: { cltChatbotEnabled: true } });
    // Re-enabling never reactivates old campaigns; each needs explicit activation.
    if (!enabled) await tx.cltChatbotCampaignBinding.updateMany({ where: { companyId, enabled: true }, data: { enabled: false } });
    return { enabled: company.cltChatbotEnabled };
  });
}
