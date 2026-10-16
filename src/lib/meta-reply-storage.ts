import { Prisma, type PrismaClient } from "@prisma/client";

export type ReplyProvider = "postgresql" | "sqlite";
export function replyProvider(url = process.env.DATABASE_URL): ReplyProvider {
  if (url?.startsWith("file:")) return "sqlite";
  if (/^postgres(?:ql)?:\/\//.test(url ?? "")) return "postgresql";
  throw new Error("INVALID_REPLY_DATABASE_PROVIDER");
}

export function replyTransaction<T>(db: PrismaClient, provider: ReplyProvider, operation: (tx: Prisma.TransactionClient) => Promise<T>, ingestion = false) {
  if (!["sqlite", "postgresql"].includes(provider)) throw new Error("INVALID_REPLY_DATABASE_PROVIDER");
  return db.$transaction(async (tx) => {
    if (provider === "postgresql") {
      await tx.$queryRawUnsafe(ingestion
        ? "SELECT set_config('statement_timeout','75ms',true), set_config('lock_timeout','50ms',true)"
        : "SELECT set_config('statement_timeout','250ms',true), set_config('lock_timeout','100ms',true)");
    }
    return operation(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: ingestion ? 50 : 100, timeout: ingestion ? 200 : 2000 });
}
