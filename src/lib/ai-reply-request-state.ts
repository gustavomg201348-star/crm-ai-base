export type AiReplyRequestState<T> = {
  analysisByConversation: Record<string, T | undefined>;
  loadingByConversation: Record<string, boolean | undefined>;
  errorByConversation: Record<string, string | undefined>;
  latestRequestIdByConversation: Record<string, number | undefined>;
};

export function createDetailedSnapshotAcceptance() {
  let issued = 0;
  let accepted = 0;
  return {
    begin(conversationId: string, epoch: number) {
      return { conversationId, epoch, sequence: ++issued };
    },
    accept(ticket: { conversationId: string; epoch: number; sequence: number },
      conversationId: string | null, epoch: number) {
      if (ticket.conversationId !== conversationId || ticket.epoch !== epoch ||
          ticket.sequence <= accepted) return false;
      accepted = ticket.sequence;
      return true;
    }
  };
}

export function isExpectedAutoDraftSkip(status: number, code: unknown) {
  return status === 409 && typeof code === "string" && [
    "AUTO_DRAFT_NOT_ELIGIBLE", "AUTO_DRAFT_ALREADY_CLAIMED", "AUTO_DRAFT_STALE"
  ].includes(code);
}

export type AiReplyRequestAction<T> =
  | { type: "invalidate"; conversationId: string }
  | { type: "begin"; conversationId: string; requestId: number }
  | { type: "success"; conversationId: string; requestId: number; analysis: T }
  | { type: "error"; conversationId: string; requestId: number; error: string }
  | { type: "finish"; conversationId: string; requestId: number };

export function createAiReplyRequestState<T>(): AiReplyRequestState<T> {
  return {
    analysisByConversation: {},
    loadingByConversation: {},
    errorByConversation: {},
    latestRequestIdByConversation: {}
  };
}

export function reduceAiReplyRequestState<T>(
  state: AiReplyRequestState<T>,
  action: AiReplyRequestAction<T>
): AiReplyRequestState<T> {
  if (action.type === "invalidate") {
    return { ...state, analysisByConversation: {
      ...state.analysisByConversation, [action.conversationId]: undefined
    } };
  }
  if (action.type === "begin") {
    return {
      ...state,
      loadingByConversation: {
        ...state.loadingByConversation,
        [action.conversationId]: true
      },
      errorByConversation: {
        ...state.errorByConversation,
        [action.conversationId]: undefined
      },
      latestRequestIdByConversation: {
        ...state.latestRequestIdByConversation,
        [action.conversationId]: action.requestId
      }
    };
  }

  if (state.latestRequestIdByConversation[action.conversationId] !== action.requestId) {
    return state;
  }

  if (action.type === "success") {
    return {
      ...state,
      analysisByConversation: {
        ...state.analysisByConversation,
        [action.conversationId]: action.analysis
      },
      errorByConversation: {
        ...state.errorByConversation,
        [action.conversationId]: undefined
      }
    };
  }

  if (action.type === "error") {
    return {
      ...state,
      errorByConversation: {
        ...state.errorByConversation,
        [action.conversationId]: action.error
      }
    };
  }

  return {
    ...state,
    loadingByConversation: {
      ...state.loadingByConversation,
      [action.conversationId]: false
    }
  };
}

export type AiReplySynchronousStartGuard = {
  tryAcquire(conversationId: string): boolean;
  release(conversationId: string): void;
};

export function createAiReplySynchronousStartGuard(): AiReplySynchronousStartGuard {
  const active = new Set<string>();
  return {
    tryAcquire(conversationId) {
      if (active.has(conversationId)) return false;
      active.add(conversationId);
      return true;
    },
    release(conversationId) {
      active.delete(conversationId);
    }
  };
}

export function startAiReplyRequestSynchronously({
  guard,
  conversationId,
  start,
  scheduleRelease = queueMicrotask
}: {
  guard: AiReplySynchronousStartGuard;
  conversationId: string;
  start: () => void;
  scheduleRelease?: (callback: () => void) => void;
}) {
  if (!guard.tryAcquire(conversationId)) return false;
  scheduleRelease(() => guard.release(conversationId));
  start();
  return true;
}

export function aiReplyErrorMessage(
  error: unknown,
  fallback = "Nao foi possivel gerar analise IA."
) {
  if (error instanceof Error && error.name === "AbortError") return null;
  return fallback;
}
