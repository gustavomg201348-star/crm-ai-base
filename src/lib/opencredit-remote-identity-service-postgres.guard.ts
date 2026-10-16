/** Test-only; must precede client construction and service import. */
export function assertOpenCreditRemoteIdentityServiceTestDatabase(env: Readonly<Record<string, string | undefined>>): void {
  const fail = () => { throw new Error("OPENCREDIT_REMOTE_IDENTITY_SERVICE_TEST_REQUIRES_DISPOSABLE_CI"); };
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || env.OPENCREDIT_REMOTE_IDENTITY_SERVICE_POSTGRES_TEST !== "1") fail();
  let url: URL;
  try { url = new URL(env.DATABASE_URL ?? ""); } catch { return fail(); }
  if (url.protocol !== "postgresql:" || !["localhost", "127.0.0.1"].includes(url.hostname)
    || !["5432", "55432"].includes(url.port) || url.pathname !== "/qevora_ci"
    || url.username !== "qevora_ci" || url.password !== "qevora_ci_password"
    || url.search !== "?schema=public" || url.hash) fail();
}
