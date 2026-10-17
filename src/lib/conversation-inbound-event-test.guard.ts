import os from "node:os";
import path from "node:path";

/** Must execute before PrismaClient construction. No production/environment fallback. */
export function assertInboundEventTestDatabase(env: Readonly<Record<string, string | undefined>>): "postgresql" | "sqlite" {
  const fail = (): never => { throw new Error("INBOUND_EVENT_TEST_REQUIRES_DISPOSABLE_DATABASE"); };
  if (env.INBOUND_EVENT_POSTGRES_TEST === "1") {
    if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true") fail();
    let url: URL;
    try { url = new URL(env.DATABASE_URL ?? ""); } catch { return fail(); }
    if (url.protocol !== "postgresql:" || !["localhost", "127.0.0.1"].includes(url.hostname)
      || !["5432", "55432"].includes(url.port) || url.pathname !== "/qevora_ci"
      || url.username !== "qevora_ci" || url.password !== "qevora_ci_password"
      || url.search !== "?schema=public" || url.hash) fail();
    return "postgresql";
  }
  if (env.INBOUND_EVENT_SQLITE_TEST !== "1" || !env.DATABASE_URL?.startsWith("file:")) return fail();
  const file = path.resolve(env.DATABASE_URL.slice(5));
  if (path.dirname(file).toLowerCase() !== path.resolve(os.tmpdir()).toLowerCase()
    || !/^qevora-inbound-event-[a-z0-9-]+\.db$/.test(path.basename(file))) fail();
  return "sqlite";
}
