import { prisma } from "@/lib/db";

export async function createCltLog({
  companyId,
  userId,
  contactId,
  bankId,
  bankName,
  action,
  cpf,
  phone,
  status = "SUCCESS",
  message,
  input,
  output
}: {
  companyId: string;
  userId?: string | null;
  contactId?: string | null;
  bankId?: string | null;
  bankName?: string | null;
  action: string;
  cpf?: string | null;
  phone?: string | null;
  status?: "SUCCESS" | "ERROR";
  message?: string | null;
  input?: unknown;
  output?: unknown;
}) {
  try {
    await prisma.cltSimulationLog.create({
      data: {
        companyId,
        userId,
        contactId,
        bankId,
        bankName,
        action,
        cpf,
        phone,
        status,
        message,
        inputJson: input ? JSON.stringify(input).slice(0, 8000) : null,
        outputJson: output ? JSON.stringify(output).slice(0, 8000) : null
      }
    });
  } catch {
    // Logs should never block the operational CLT flow.
  }
}

export function mapCltLog(log: {
  id: string;
  bankId?: string | null;
  bankName?: string | null;
  action: string;
  cpf?: string | null;
  phone?: string | null;
  status: string;
  message?: string | null;
  createdAt: Date;
  user?: { name: string } | null;
  contact?: { id: string; name: string; phone: string } | null;
}) {
  return {
    id: log.id,
    bankId: log.bankId,
    bankName: log.bankName,
    action: log.action,
    cpf: log.cpf,
    phone: log.phone,
    status: log.status,
    message: log.message,
    createdAt: log.createdAt,
    userName: log.user?.name ?? null,
    contact: log.contact
  };
}
