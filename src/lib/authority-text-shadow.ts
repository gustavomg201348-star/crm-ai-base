import { performance } from "node:perf_hooks";
import { ShadowReadFailure, shadowMode, validContext, type ShadowAuthority, type ShadowContext,
  type ShadowDecision, type ShadowMetric } from "./authority-text-shadow-contract";
import { evaluateTextAuthority } from "./authority-text-shadow-evaluator";

export type ShadowReader = (scope: Readonly<{ companyId: string; channelId: string; conversationId: string }>) => Promise<ShadowAuthority | null>;

export function createTextAuthorityObserver(deps: {
  mode: () => unknown;
  read: ShadowReader;
  emit: (metric: ShadowMetric) => void;
}) {
  const seen = new WeakSet<object>();
  let inFlight = 0;
  return function observe(request: object, input: ShadowContext): void {
    try {
      if (shadowMode(deps.mode()) === "OFF" || seen.has(request)) return;
      seen.add(request);
      const context = Object.freeze({ ...input });
      const start = performance.now();
      const publish = (decision: ShadowDecision) => {
        try {
          deps.emit({ event: "authority_text_shadow", source: context.source,
            result: decision.result, reason: decision.reason, state: decision.state,
            durationMs: Math.min(60_000, Math.max(0, Math.round(performance.now() - start))) });
        } catch { /* Metrics must not affect the legacy request. */ }
      };
      // Scheduling, including a synchronous reader failure, stays outside the sender's call stack.
      void Promise.resolve().then(async () => {
        if (!validContext(context)) return;
        if (!context.conversationId) { publish(evaluateTextAuthority(context, null)); return; }
        if (inFlight >= 4) { publish({ result: "EVALUATION_ERROR", reason: "CAPACITY", state: null }); return; }
        inFlight++;
        let finished = false;
        const once = (decision: ShadowDecision) => { if (!finished) { finished = true; publish(decision); } };
        const timer = setTimeout(() => once({ result: "EVALUATION_ERROR", reason: "TIME_BUDGET", state: null }), 100);
        timer.unref?.();
        try {
          const authority = await deps.read(Object.freeze({ companyId: context.companyId,
            channelId: context.channelId, conversationId: context.conversationId }));
          once(evaluateTextAuthority(context, authority));
        } catch (error) {
          once({ result: "EVALUATION_ERROR", reason: error instanceof ShadowReadFailure ? error.reason : "READ_FAILED", state: null });
        } finally {
          clearTimeout(timer);
          // A timed-out query still occupies capacity until it really settles.
          inFlight--;
        }
      }).catch(() => { /* Detached work must never reject into the route. */ });
    } catch { /* Invalid configuration/context must never break a send. */ }
  };
}
