import { latestUnansweredAutoDraftMessage, type AutoDraftSnapshot } from "@/lib/ai-auto-draft-policy";

export type AutoDraftTrigger = { conversationId: string; triggerMessageId: string };
export const AUTO_DRAFT_RECENT_ID_LIMIT = 256;

export function createAutoDraftController(options: {
  run(trigger: AutoDraftTrigger, isCurrent: () => boolean): Promise<void>;
  invalidate(conversationId: string): void;
  isBusy?: (trigger: AutoDraftTrigger) => boolean;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let conversationId: string | null = null;
  let epoch = 0;
  let initialized = false;
  const seen = new Set<string>();
  const attempted = new Set<string>();
  let pending: AutoDraftTrigger | null = null;
  let latestId: string | null = null;
  let running = false;
  // Strict timestamp advancement blocks replay even after an ID is evicted.
  // Equal timestamps fail closed, just like ambiguous timestamps in the policy.
  let watermark = Number.NEGATIVE_INFINITY;
  function remember(ids: Set<string>, id: string) {
    ids.add(id);
    if (ids.size > AUTO_DRAFT_RECENT_ID_LIMIT) ids.delete(ids.values().next().value!);
  }
  function resetTransient() {
    stopTimer();
    epoch++;
    initialized = false;
    seen.clear();
    attempted.clear();
    watermark = Number.NEGATIVE_INFINITY;
    latestId = null;
    pending = null;
    // An outstanding run owns this lock until its finally, even across selection.
  }
  function stopTimer() {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  }
  function arm() {
    stopTimer();
    if (running || !pending || options.isBusy?.(pending)) return;
    timer = schedule(() => {
      timer = undefined;
      const trigger = pending;
      if (!trigger || running || options.isBusy?.(trigger)) return;
      pending = null;
      remember(attempted, trigger.triggerMessageId);
      const startEpoch = epoch;
      running = true;
      const isCurrent = () => epoch === startEpoch &&
        conversationId === trigger.conversationId && latestId === trigger.triggerMessageId;
      void Promise.resolve().then(() => options.run(trigger, isCurrent)).catch(() => {
        // Failed triggers remain attempted; never loop automatically.
      }).finally(() => {
        running = false;
        arm();
      });
    }, 3000);
  }
  return {
    notifyIdle: arm,
    retainedState() {
      return { seen: seen.size, attempted: attempted.size, initialized,
        pending: pending !== null, timer: timer !== undefined, running };
    },
    select(id: string | null) {
      if (id === conversationId) return;
      resetTransient();
      conversationId = id;
    },
    observe(snapshot: AutoDraftSnapshot, companyMode: string, enabled: boolean) {
      if (snapshot.id !== conversationId) return;
      const candidate = enabled ? latestUnansweredAutoDraftMessage(snapshot, companyMode) : null;
      const nextId = candidate?.id ?? null;
      const newCandidate = candidate && !seen.has(candidate.id) &&
        new Date(candidate.createdAt).getTime() > watermark;
      snapshot.messages.forEach((message) => {
        remember(seen, message.id);
        const time = new Date(message.createdAt).getTime();
        if (Number.isFinite(time)) watermark = Math.max(watermark, time);
      });
      if (!initialized) {
        options.invalidate(snapshot.id);
        initialized = true;
        latestId = nextId;
        return;
      }
      if (latestId !== nextId) {
        options.invalidate(snapshot.id);
        latestId = nextId;
        pending = null;
        stopTimer();
      }
      if (newCandidate && !attempted.has(candidate.id)) {
        pending = { conversationId: snapshot.id, triggerMessageId: candidate.id };
        arm();
      }
    },
    suspend() {
      resetTransient();
    },
    dispose() {
      resetTransient();
      conversationId = null;
    }
  };
}
