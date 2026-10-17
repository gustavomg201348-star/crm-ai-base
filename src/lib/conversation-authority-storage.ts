import { Prisma, type PrismaClient } from "@prisma/client";
import { authorityScope, requireAuthority, requireReference, type AuthorityScope } from "./conversation-authority-contract";

export type AuthorityTx = Prisma.TransactionClient;
export type AuthorityDatabase = { db: PrismaClient; provider: "sqlite" | "postgresql" };

export function authorityStorage({ db, provider }: AuthorityDatabase) {
  requireAuthority(db && ["sqlite", "postgresql"].includes(provider), "INVALID_DATABASE_PROVIDER");
  async function transaction<T>(fn: (tx: AuthorityTx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async tx => {
          if (provider === "postgresql") {
            await tx.$queryRaw`SELECT set_config('lock_timeout', '1000ms', true), set_config('statement_timeout', '2000ms', true)`;
          }
          const result = await fn(tx);
          // Prisma 5.22 can resolve COMMIT errors without error_code as success.
          // Flush deferred checks through the query path before handing COMMIT to Prisma.
          if (provider === "postgresql") await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
          return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 });
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError &&
          (["P2002", "P2034", "P1008"].includes(error.code) ||
            (error.code === "P2010" && ["40001", "40P01"].includes(String(error.meta?.code))));
        if (attempt >= 3 || !retryable) throw error;
        await new Promise(resolve => setTimeout(resolve, 15 * (attempt + 1)));
      }
    }
  }
  async function lock(tx: AuthorityTx, input: AuthorityScope) {
    const scope = authorityScope(input);
    if (provider === "postgresql") {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "ConversationAuthority" WHERE "companyId" = ${scope.companyId}
        AND "channelId" = ${scope.channelId} AND "conversationId" = ${scope.conversationId} FOR UPDATE`);
    }
    const row = await tx.conversationAuthority.findFirst({ where: scope });
    requireAuthority(row, "AUTHORITY_NOT_FOUND");
    return row;
  }
  async function actor(tx: AuthorityTx, companyId: string, userId: string, admin = false) {
    requireReference(companyId); requireReference(userId);
    const user = await tx.user.findFirst({ where: { id: userId, companyId } });
    requireAuthority(user && ["ADMIN", "SUPERVISOR", "AGENT"].includes(user.role), "FORBIDDEN");
    requireAuthority(!admin || ["ADMIN", "SUPERVISOR"].includes(user.role), "FORBIDDEN");
    return user;
  }
  async function now(tx: AuthorityTx) {
    if (provider === "postgresql") {
      const [result] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      return result.now;
    }
    return new Date();
  }
  return { transaction, lock, actor, now };
}
