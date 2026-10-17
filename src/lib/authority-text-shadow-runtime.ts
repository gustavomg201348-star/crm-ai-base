import { createTextAuthorityObserver, type ShadowReader } from "./authority-text-shadow";
import { createShadowAuthorityReader, shadowReadScope } from "./authority-text-shadow-reader";

const globalShadow = globalThis as typeof globalThis & {
  qevoraTextShadowReader?: ReturnType<typeof createShadowAuthorityReader>;
};

export function readTextAuthority(scope: Parameters<ShadowReader>[0]) {
  const snapshot = shadowReadScope(scope);
  if (!globalShadow.qevoraTextShadowReader) {
    globalShadow.qevoraTextShadowReader = createShadowAuthorityReader(() => process.env.QEVORA_TEXT_AUTHORITY_DATABASE_URL);
    process.once("beforeExit", () => { void closeTextAuthorityShadow().catch(() => {}); });
  }
  return globalShadow.qevoraTextShadowReader.read(snapshot);
}

// Hosts with a managed graceful-shutdown hook can await this; no signal handlers are replaced.
export async function closeTextAuthorityShadow() {
  await globalShadow.qevoraTextShadowReader?.close();
}

export const observeTextOutboundAuthority = createTextAuthorityObserver({
  mode: () => process.env.QEVORA_TEXT_AUTHORITY_MODE,
  read: readTextAuthority,
  emit: metric => console.info(JSON.stringify(metric))
});
