import { prisma } from "./db";
import { createCltSessionRuntime } from "./chatbot-clt-session-runtime";
import { maybeAutoAssignConversation } from "./lead-assignment";
import { safeLogWarn } from "./safe-logger";

export const cltAuthorityDatabase = {
  db: prisma,
  provider: /^postgres(?:ql)?:/.test(process.env.DATABASE_URL ?? "") ? "postgresql" as const : "sqlite" as const,
};
export const cltChatbotRuntime = createCltSessionRuntime(cltAuthorityDatabase, undefined, maybeAutoAssignConversation);

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

export function startCltChatbotWorker() {
  if (timer) return;
  const report = () => safeLogWarn("clt-chatbot", "Falha no processamento da fila CLT.");
  const tick = async () => {
    if (running) return;
    running = true;
    try { await cltChatbotRuntime.drain(report); }
    catch { report(); }
    finally { running = false; }
  };
  timer = setInterval(() => void tick(), 1000);
  timer.unref();
}
