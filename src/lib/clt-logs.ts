import { prisma } from "@/lib/db";

function summarizeLogData(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value === undefined ? null : { present: Boolean(value) };
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      count: value.length
    };
  }

  const record = value as Record<string, unknown>;

  return {
    type: "object",
    keys: Object.keys(record)
      .filter((key) => !isSensitiveCltLogKey(key))
      .slice(0, 20),
    itemCount: Array.isArray(record.items) ? record.items.length : undefined,
    offerCount: Array.isArray(record.offers) ? record.offers.length : undefined,
    hasCustomer: Boolean(record.customer),
    hasOffer: Boolean(record.offer),
    hasProvider: typeof record.provider === "string"
  };
}

function isSensitiveCltLogKey(key: string) {
  return /cpf|document|registry|matricula|phone|telefone|email|name|nome|birth|salary|salario|renda|income|margin|margem|installment|parcela|amount|valor|rate|taxa|cet|bank|banco|account|agencia|agency|contrato|contract|proposal|proposta|employer|empregador|address|zipcode|payload|body|token|secret|apikey|authorization|header/i.test(
    key
  );
}

function serializeSafeLogData(value: unknown) {
  const summary = summarizeLogData(value);
  return summary ? JSON.stringify(summary).slice(0, 8000) : null;
}

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
        bankName: bankName ? "[redacted]" : null,
        action,
        cpf: cpf ? "[redacted]" : null,
        phone: phone ? "[redacted]" : null,
        status,
        message,
        inputJson: serializeSafeLogData(input),
        outputJson: serializeSafeLogData(output)
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
  contact?: { id: string } | null;
}) {
  return {
    id: log.id,
    bankId: log.bankId,
    bankName: log.bankName ? "[redacted]" : null,
    action: log.action,
    cpf: log.cpf ? "[redacted]" : null,
    phone: log.phone ? "[redacted]" : null,
    status: log.status,
    message: log.message,
    createdAt: log.createdAt,
    userName: null,
    contact: log.contact ? { id: log.contact.id } : null
  };
}
