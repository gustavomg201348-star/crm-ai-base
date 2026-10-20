import "server-only";
import { createHash } from "node:crypto";
import { configuredOpenCreditId } from "./opencredit-access-summary";
import { parseOpenCreditProviderScope, type OpenCreditProviderScope } from "./opencredit-commercial-identity-policy";

export class OpenCreditProviderScopeResolverError extends Error {
  readonly code = "CONFIGURATION" as const;
  constructor() {
    super("OPENCREDIT_PROVIDER_SCOPE_CONFIGURATION");
    this.name = "OpenCreditProviderScopeResolverError";
    this.stack = this.name + ": " + this.message;
  }
}

// Reuse the integration's ID contract; reject the final-newline exception of `$`.
function validExactId(value: unknown): value is string {
  return configuredOpenCreditId(value) && !/[^A-Za-z0-9_-]/.test(value);
}

/** Trusted server configuration only. This namespace is NOT authorization or a secret. */
export type OpenCreditConfiguredProviderContext = Readonly<{ tenantId: string; providerScope: OpenCreditProviderScope }>;

export function resolveOpenCreditProviderContext(
  config: Readonly<{ tenantId: string; partnerId: string }>,
): OpenCreditConfiguredProviderContext {
  try {
    if (typeof window !== "undefined" || !config || typeof config !== "object" || Array.isArray(config)) {
      throw new OpenCreditProviderScopeResolverError();
    }
    // Own data properties only: never invoke configuration accessors or read unrelated fields.
    const tenant = Object.getOwnPropertyDescriptor(config, "tenantId");
    const partner = Object.getOwnPropertyDescriptor(config, "partnerId");
    if (!tenant || !partner || !("value" in tenant) || !("value" in partner)
      || !validExactId(tenant.value) || !validExactId(partner.value)) {
      throw new OpenCreditProviderScopeResolverError();
    }
    const digest = createHash("sha256")
      .update("qevora/opencredit/provider-scope/v1\0", "utf8")
      .update(JSON.stringify([tenant.value, partner.value]), "utf8")
      .digest("hex");
    // 220 digest bits, five fixed separators: at most ten consecutive decimal digits.
    const scope = "ocp-" + digest.slice(0, 10) + "f" + digest.slice(10, 20) + "f"
      + digest.slice(20, 30) + "f" + digest.slice(30, 40) + "f"
      + digest.slice(40, 50) + "f" + digest.slice(50, 55);
    return { tenantId: tenant.value, providerScope: parseOpenCreditProviderScope(scope) };
  } catch {
    // Never retain raw configuration, causes, parser errors or detailed internal stacks.
    throw new OpenCreditProviderScopeResolverError();
  }
}

export function resolveOpenCreditProviderScope(config: Readonly<{ tenantId: string; partnerId: string }>): OpenCreditProviderScope {
  return resolveOpenCreditProviderContext(config).providerScope;
}

/** No credentials, JWT claims, request data or database configuration are consulted. */
export function resolveConfiguredOpenCreditProviderScope(): OpenCreditProviderScope {
  return resolveConfiguredOpenCreditProviderContext().providerScope;
}

export function resolveConfiguredOpenCreditProviderContext(): OpenCreditConfiguredProviderContext {
  try {
    return resolveOpenCreditProviderContext({
      tenantId: process.env.OPENCREDIT_TENANT_ID as string,
      partnerId: process.env.OPENCREDIT_PARTNER_ID as string,
    });
  } catch {
    throw new OpenCreditProviderScopeResolverError();
  }
}
