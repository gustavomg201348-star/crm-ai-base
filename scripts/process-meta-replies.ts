import { PrismaClient } from "@prisma/client";
import { createMetaReplyCorrelation } from "../src/lib/meta-reply-correlation.service";
import { replyProvider } from "../src/lib/meta-reply-storage";

async function main() {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  let reconcile = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--reconcile") { reconcile = true; continue; }
    if (!["--company-id", "--channel-id", "--limit", "--after-id", "--time-budget-ms"].includes(key)
      || values.has(key) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("INVALID_PROCESSOR_ARGUMENTS");
    values.set(key, args[++index]);
  }
  const provider = replyProvider();
  const db = new PrismaClient();
  try {
    const result = await createMetaReplyCorrelation(db, { provider }).processBatch({
      companyId: values.get("--company-id") ?? "", channelId: values.get("--channel-id") ?? "",
      limit: values.has("--limit") ? Number(values.get("--limit")) : 20,
      afterId: values.get("--after-id"), reconcile,
      timeBudgetMs: values.has("--time-budget-ms") ? Number(values.get("--time-budget-ms")) : 3000
    });
    console.info(JSON.stringify(result));
    if (result.errors.length) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("META_REPLY_PROCESSOR_FAILED"); process.exitCode = 1; });
