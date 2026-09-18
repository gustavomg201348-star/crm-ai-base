import { PrismaClient } from "@prisma/client";
import {
  encryptSecret,
  isEncryptedSecretEnvelope,
  readSecret,
  SecretEncryptionError,
  type SecretEncryptionOptions
} from "@/lib/secret-encryption";
import {
  getSecretEncryptionKeyStatus,
  getSecretEncryptionOptionsFromEnv
} from "@/lib/secret-encryption-env";

export const CLT_SECRET_FIELDS = [
  "apiKey",
  "username",
  "password",
  "newcorbanIdentifier",
  "digitadorCode",
  "certifiedAgentCpf"
] as const;

type CltSecretField = (typeof CLT_SECRET_FIELDS)[number];
type SecretValue = string | null;
type CltSecretRow = { id: string } & Record<CltSecretField, SecretValue>;
type Classification =
  | { kind: "blank" }
  | { kind: "plaintext" }
  | { kind: "encrypted" }
  | { kind: "encrypted_invalid"; code: string }
  | { kind: "error"; code: string };

type FieldStats = {
  blank: number;
  plaintext: number;
  encrypted: number;
  encrypted_invalid: number;
  error: number;
};

type SafeIssue = {
  phase: "startup" | "preflight" | "apply";
  code: string;
  integrationId?: string;
  fields?: CltSecretField[];
};

type BackfillStats = {
  mode: "dry-run" | "apply";
  totalIntegrations: number;
  integrationsWithPlaintext: number;
  plaintextSecrets: number;
  integrationsFullyEncrypted: number;
  integrationsWithoutSecrets: number;
  blockers: number;
  conflicts: number;
  errors: number;
  convertedIntegrations: number;
  convertedSecrets: number;
  aborted: boolean;
  fields: Record<CltSecretField, FieldStats>;
  issues: SafeIssue[];
};

type CltIntegrationApi = {
  findMany(args: unknown): Promise<CltSecretRow[]>;
  updateMany(args: unknown): Promise<{ count: number }>;
};

type BackfillPrisma = {
  cltIntegration: CltIntegrationApi;
};

type Logger = { log(message: string): void };
type EncryptValue = (value: string, options: SecretEncryptionOptions) => string;

const DEFAULT_BATCH_SIZE = 25;
const SELECT_SECRETS = Object.fromEntries([
  ["id", true],
  ...CLT_SECRET_FIELDS.map((field) => [field, true])
]) as Record<"id" | CltSecretField, true>;

function emptyFieldStats(): FieldStats {
  return { blank: 0, plaintext: 0, encrypted: 0, encrypted_invalid: 0, error: 0 };
}

export function createCltBackfillStats(): BackfillStats {
  return {
    mode: "dry-run",
    totalIntegrations: 0,
    integrationsWithPlaintext: 0,
    plaintextSecrets: 0,
    integrationsFullyEncrypted: 0,
    integrationsWithoutSecrets: 0,
    blockers: 0,
    conflicts: 0,
    errors: 0,
    convertedIntegrations: 0,
    convertedSecrets: 0,
    aborted: false,
    fields: Object.fromEntries(
      CLT_SECRET_FIELDS.map((field) => [field, emptyFieldStats()])
    ) as Record<CltSecretField, FieldStats>,
    issues: []
  };
}

function secretErrorCode(error: unknown) {
  return error instanceof SecretEncryptionError ? error.code : "classification_error";
}

export function classifyCltBackfillSecret(
  value: SecretValue,
  options: SecretEncryptionOptions
): Classification {
  if (value === null || value === "" || value.trim() === "") {
    return { kind: "blank" };
  }

  if (!value.startsWith("enc:")) {
    return { kind: "plaintext" };
  }

  if (!isEncryptedSecretEnvelope(value)) {
    return { kind: "encrypted_invalid", code: "invalid_envelope" };
  }

  try {
    readSecret(value, options);
    return { kind: "encrypted" };
  } catch (error) {
    return { kind: "encrypted_invalid", code: secretErrorCode(error) };
  }
}

function addIssue(stats: BackfillStats, issue: SafeIssue) {
  stats.issues.push(issue);
}

function analyzeIntegration(
  integration: CltSecretRow,
  options: SecretEncryptionOptions,
  stats?: BackfillStats
) {
  const classifications = {} as Record<CltSecretField, Classification>;
  const plaintextFields: CltSecretField[] = [];
  const blockerFields: CltSecretField[] = [];
  let encryptedCount = 0;
  let blankCount = 0;

  for (const field of CLT_SECRET_FIELDS) {
    let classification: Classification;
    try {
      classification = classifyCltBackfillSecret(integration[field], options);
    } catch {
      classification = { kind: "error", code: "classification_error" };
    }
    classifications[field] = classification;

    if (stats) stats.fields[field][classification.kind] += 1;
    if (classification.kind === "blank") blankCount += 1;
    if (classification.kind === "encrypted") encryptedCount += 1;
    if (classification.kind === "plaintext") plaintextFields.push(field);
    if (classification.kind === "encrypted_invalid" || classification.kind === "error") {
      blockerFields.push(field);
      if (stats) {
        stats.blockers += 1;
        if (classification.kind === "error") stats.errors += 1;
        addIssue(stats, {
          phase: "preflight",
          integrationId: integration.id,
          code: classification.code,
          fields: [field]
        });
      }
    }
  }

  if (stats) {
    stats.totalIntegrations += 1;
    if (plaintextFields.length > 0) {
      stats.integrationsWithPlaintext += 1;
      stats.plaintextSecrets += plaintextFields.length;
    }
    if (blankCount === CLT_SECRET_FIELDS.length) stats.integrationsWithoutSecrets += 1;
    if (encryptedCount > 0 && encryptedCount + blankCount === CLT_SECRET_FIELDS.length) {
      stats.integrationsFullyEncrypted += 1;
    }
  }

  return { classifications, plaintextFields, blockerFields };
}

function concurrentSafeWhere(integration: CltSecretRow) {
  return {
    id: integration.id,
    ...Object.fromEntries(
      CLT_SECRET_FIELDS.map((field) => [field, integration[field] ?? null])
    )
  };
}

async function findBatch(prisma: BackfillPrisma, cursor: string | null, batchSize: number) {
  return prisma.cltIntegration.findMany({
    where: cursor ? { id: { gt: cursor } } : {},
    orderBy: { id: "asc" },
    take: batchSize,
    select: SELECT_SECRETS
  });
}

async function scanAll(
  prisma: BackfillPrisma,
  batchSize: number,
  options: SecretEncryptionOptions,
  stats: BackfillStats
) {
  let cursor: string | null = null;
  for (;;) {
    const rows = await findBatch(prisma, cursor, batchSize);
    if (rows.length === 0) return;
    for (const row of rows) analyzeIntegration(row, options, stats);
    cursor = rows.at(-1)!.id;
  }
}

async function applyIntegration({
  prisma,
  integration,
  options,
  stats,
  encryptValue
}: {
  prisma: BackfillPrisma;
  integration: CltSecretRow;
  options: SecretEncryptionOptions;
  stats: BackfillStats;
  encryptValue: EncryptValue;
}) {
  const analysis = analyzeIntegration(integration, options);
  if (analysis.blockerFields.length > 0) {
    stats.blockers += analysis.blockerFields.length;
    addIssue(stats, {
      phase: "apply",
      integrationId: integration.id,
      code: "integration_blocked",
      fields: analysis.blockerFields
    });
    return;
  }
  if (analysis.plaintextFields.length === 0) return;

  const data: Partial<Record<CltSecretField, string>> = {};
  try {
    for (const field of analysis.plaintextFields) {
      data[field] = encryptValue(integration[field]!, options);
    }
  } catch (error) {
    stats.errors += 1;
    addIssue(stats, {
      phase: "apply",
      integrationId: integration.id,
      code: secretErrorCode(error),
      fields: analysis.plaintextFields
    });
    return;
  }

  const result = await prisma.cltIntegration.updateMany({
    where: concurrentSafeWhere(integration),
    data
  });

  if (result.count !== 1) {
    stats.conflicts += 1;
    addIssue(stats, {
      phase: "apply",
      integrationId: integration.id,
      code: "concurrent_update_detected",
      fields: analysis.plaintextFields
    });
    return;
  }

  stats.convertedIntegrations += 1;
  stats.convertedSecrets += analysis.plaintextFields.length;
}

async function applyAll(
  prisma: BackfillPrisma,
  batchSize: number,
  options: SecretEncryptionOptions,
  stats: BackfillStats,
  encryptValue: EncryptValue
) {
  let cursor: string | null = null;
  for (;;) {
    const rows = await findBatch(prisma, cursor, batchSize);
    if (rows.length === 0) return;
    for (const row of rows) {
      await applyIntegration({ prisma, integration: row, options, stats, encryptValue });
    }
    cursor = rows.at(-1)!.id;
  }
}

function safeSummary(stats: BackfillStats) {
  return { ...stats };
}

function printSafeSummary(stats: BackfillStats, logger: Logger) {
  logger.log(JSON.stringify(safeSummary(stats), null, 2));
}

export async function runCltSecretBackfill({
  prisma,
  env = process.env,
  mode = "dry-run",
  batchSize = DEFAULT_BATCH_SIZE,
  logger = console,
  encryptValue = encryptSecret
}: {
  prisma: BackfillPrisma;
  env?: Record<string, string | undefined>;
  mode?: "dry-run" | "apply";
  batchSize?: number;
  logger?: Logger;
  encryptValue?: EncryptValue;
}) {
  const stats = createCltBackfillStats();
  stats.mode = mode;

  const keyStatus = getSecretEncryptionKeyStatus(env);
  const options = getSecretEncryptionOptionsFromEnv(env);
  if (keyStatus.status !== "configured" || !options) {
    stats.aborted = true;
    stats.blockers = 1;
    addIssue(stats, { phase: "startup", code: "missing_or_invalid_key" });
    printSafeSummary(stats, logger);
    return stats;
  }

  await scanAll(prisma, batchSize, options, stats);
  if (mode === "apply" && stats.blockers === 0 && stats.errors === 0) {
    await applyAll(prisma, batchSize, options, stats, encryptValue);
  } else if (mode === "apply" && (stats.blockers > 0 || stats.errors > 0)) {
    stats.aborted = true;
  }

  printSafeSummary(stats, logger);
  return stats;
}

export function parseCltBackfillArgs(argv: string[]) {
  let mode: "dry-run" | "apply" = "dry-run";
  let batchSize = DEFAULT_BATCH_SIZE;
  let help = false;

  for (const arg of argv) {
    if (arg === "--dry-run") mode = "dry-run";
    else if (arg === "--apply") mode = "apply";
    else if (arg === "--help") help = true;
    else if (arg.startsWith("--batch-size=")) {
      const parsed = Number(arg.slice("--batch-size=".length));
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        throw new Error("INVALID_BATCH_SIZE");
      }
      batchSize = parsed;
    } else throw new Error("UNKNOWN_ARGUMENT");
  }

  return { mode, batchSize, help };
}

export function sanitizeCltBackfillCliError(error: unknown) {
  if (error instanceof Error && ["INVALID_BATCH_SIZE", "UNKNOWN_ARGUMENT"].includes(error.message)) {
    return error.message;
  }
  return "UNEXPECTED_ERROR";
}

export async function runCltBackfillCli(argv = process.argv.slice(2)) {
  const args = parseCltBackfillArgs(argv);
  if (args.help) {
    console.log("Usage: npm run clt:secrets:backfill -- [--dry-run|--apply] [--batch-size=25]");
    return;
  }

  const prisma = new PrismaClient();
  try {
    await runCltSecretBackfill({ prisma, ...args });
  } finally {
    await prisma.$disconnect();
  }
}
