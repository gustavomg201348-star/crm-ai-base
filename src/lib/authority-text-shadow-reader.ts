import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";
import { ShadowReadFailure, validReference } from "./authority-text-shadow-contract";
import type { ShadowReader } from "./authority-text-shadow";

export function shadowReadScope(scope: Parameters<ShadowReader>[0]) {
  const snapshot = { ...scope };
  if (!validReference(snapshot.companyId) || !validReference(snapshot.channelId) ||
      !validReference(snapshot.conversationId)) throw new Error("INVALID_SHADOW_SCOPE");
  return Object.freeze({ companyId: snapshot.companyId, channelId: snapshot.channelId, conversationId: snapshot.conversationId });
}

export function shadowConnection(value: unknown) {
  try {
    if (typeof value !== "string" || !value) throw new Error();
    const url = new URL(value);
    if (!["postgresql:", "postgres:", "file:"].includes(url.protocol)) throw new Error();
    url.searchParams.set("connection_limit", "1");
    url.searchParams.set("pool_timeout", "1");
    url.searchParams.set("connect_timeout", "1");
    if (url.protocol === "file:") url.searchParams.set("socket_timeout", "1");
    const connectionUrl = url.protocol === "file:"
      ? `file:${fileURLToPath(url).replace(/\\/g, "/")}?${url.searchParams}`
      : url.toString();
    return { url: connectionUrl, postgres: url.protocol !== "file:" };
  } catch { throw new ShadowReadFailure("CONFIG_UNAVAILABLE"); }
}

export function createShadowAuthorityReader(connection: () => unknown) {
  let client: PrismaClient | null = null;
  let postgres = false;
  let active: ReturnType<ShadowReader> | null = null;
  let closing: Promise<void> | null = null;
  const read: ShadowReader = scope => {
    const where = shadowReadScope(scope);
    if (active || closing) return Promise.reject(new ShadowReadFailure("CAPACITY"));
    const operation = (async () => {
      try {
        if (!client) {
          const config = shadowConnection(connection());
          // Never import db.ts or inherit its pool/loggers. No client is constructed in OFF.
          client = new PrismaClient({ datasources: { db: { url: config.url } }, log: [], errorFormat: "minimal" });
          postgres = config.postgres;
        }
        return await client.$transaction(async tx => {
          if (postgres) {
            await tx.$executeRaw`SET TRANSACTION READ ONLY`;
            await tx.$queryRaw`SELECT set_config('statement_timeout', '100ms', true), set_config('lock_timeout', '75ms', true)`;
          }
          return tx.conversationAuthority.findFirst({ where, select: { companyId: true, channelId: true,
            conversationId: true, ownerUserId: true, state: true, generation: true } });
        }, { maxWait: 1000, timeout: 1000 });
      } catch (error) {
        // Neither raw Prisma exceptions nor their causes leave this private reader.
        throw error instanceof ShadowReadFailure ? error : new ShadowReadFailure("READ_FAILED");
      }
    })();
    active = operation;
    void operation.finally(() => { if (active === operation) active = null; }).catch(() => {});
    return operation;
  };
  function close(): Promise<void> {
    if (closing) return closing;
    closing = (async () => {
      try {
        await active?.catch(() => {});
        await client?.$disconnect();
        client = null;
      } finally { closing = null; }
    })();
    return closing;
  }
  return { read, close };
}
