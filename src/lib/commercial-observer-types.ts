export type CommercialObserverStageValue =
  | "NEW"
  | "INTEREST"
  | "SIMULATION"
  | "NEGOTIATION"
  | "FORMALIZATION"
  | "CLOSED_WON"
  | "CLOSED_LOST"
  | "UNKNOWN";

export type CommercialObserverInterestValue = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export type CommercialObserverRiskValue = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export type CommercialObserverNextBestAction =
  | "RESPOND"
  | "CALL"
  | "SEND_SIMULATION"
  | "FOLLOW_UP"
  | "REQUEST_DOCUMENTS"
  | "FORMALIZE"
  | "WAIT"
  | "CLOSE_LOST"
  | "NO_ACTION";

export type CommercialObserverResultV1 = {
  version: 1;
  summary: string;
  stage: {
    value: CommercialObserverStageValue;
    confidence: number;
    evidence: string[];
  };
  interest: {
    value: CommercialObserverInterestValue;
    confidence: number;
    evidence: string[];
  };
  objection: {
    value: string | null;
    confidence: number;
    evidence: string[];
  };
  customerNeed: {
    value: string | null;
    confidence: number;
    evidence: string[];
  };
  risk: {
    value: CommercialObserverRiskValue;
    confidence: number;
    reasons: string[];
  };
  nextBestAction: {
    action: CommercialObserverNextBestAction;
    reason: string;
    suggestedAt: string | null;
    confidence: number;
  };
  limitations: string[];
};

export const COMMERCIAL_OBSERVER_STAGE_VALUES: CommercialObserverStageValue[] = [
  "NEW",
  "INTEREST",
  "SIMULATION",
  "NEGOTIATION",
  "FORMALIZATION",
  "CLOSED_WON",
  "CLOSED_LOST",
  "UNKNOWN"
];

export const COMMERCIAL_OBSERVER_INTEREST_VALUES: CommercialObserverInterestValue[] = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "UNKNOWN"
];

export const COMMERCIAL_OBSERVER_RISK_VALUES: CommercialObserverRiskValue[] = [
  "NONE",
  "LOW",
  "MEDIUM",
  "HIGH",
  "UNKNOWN"
];

export const COMMERCIAL_OBSERVER_ACTION_VALUES: CommercialObserverNextBestAction[] = [
  "RESPOND",
  "CALL",
  "SEND_SIMULATION",
  "FOLLOW_UP",
  "REQUEST_DOCUMENTS",
  "FORMALIZE",
  "WAIT",
  "CLOSE_LOST",
  "NO_ACTION"
];

export const UNKNOWN_COMMERCIAL_OBSERVER_RESULT: CommercialObserverResultV1 = {
  version: 1,
  summary: "Nao ha evidencias suficientes para interpretar a negociacao.",
  stage: {
    value: "UNKNOWN",
    confidence: 0,
    evidence: []
  },
  interest: {
    value: "UNKNOWN",
    confidence: 0,
    evidence: []
  },
  objection: {
    value: null,
    confidence: 0,
    evidence: []
  },
  customerNeed: {
    value: null,
    confidence: 0,
    evidence: []
  },
  risk: {
    value: "UNKNOWN",
    confidence: 0,
    reasons: ["Contexto insuficiente."]
  },
  nextBestAction: {
    action: "NO_ACTION",
    reason: "Nao ha base suficiente para recomendar uma acao.",
    suggestedAt: null,
    confidence: 0
  },
  limitations: ["Sem evidencias comerciais suficientes."]
};

export const COMMERCIAL_OBSERVER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "summary",
    "stage",
    "interest",
    "objection",
    "customerNeed",
    "risk",
    "nextBestAction",
    "limitations"
  ],
  properties: {
    version: { type: "number", const: 1 },
    summary: { type: "string" },
    stage: {
      type: "object",
      additionalProperties: false,
      required: ["value", "confidence", "evidence"],
      properties: {
        value: { type: "string", enum: COMMERCIAL_OBSERVER_STAGE_VALUES },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        evidence: { type: "array", items: { type: "string" }, maxItems: 5 }
      }
    },
    interest: {
      type: "object",
      additionalProperties: false,
      required: ["value", "confidence", "evidence"],
      properties: {
        value: { type: "string", enum: COMMERCIAL_OBSERVER_INTEREST_VALUES },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        evidence: { type: "array", items: { type: "string" }, maxItems: 5 }
      }
    },
    objection: {
      type: "object",
      additionalProperties: false,
      required: ["value", "confidence", "evidence"],
      properties: {
        value: { type: ["string", "null"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        evidence: { type: "array", items: { type: "string" }, maxItems: 5 }
      }
    },
    customerNeed: {
      type: "object",
      additionalProperties: false,
      required: ["value", "confidence", "evidence"],
      properties: {
        value: { type: ["string", "null"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        evidence: { type: "array", items: { type: "string" }, maxItems: 5 }
      }
    },
    risk: {
      type: "object",
      additionalProperties: false,
      required: ["value", "confidence", "reasons"],
      properties: {
        value: { type: "string", enum: COMMERCIAL_OBSERVER_RISK_VALUES },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        reasons: { type: "array", items: { type: "string" }, maxItems: 5 }
      }
    },
    nextBestAction: {
      type: "object",
      additionalProperties: false,
      required: ["action", "reason", "suggestedAt", "confidence"],
      properties: {
        action: { type: "string", enum: COMMERCIAL_OBSERVER_ACTION_VALUES },
        reason: { type: "string" },
        suggestedAt: { type: ["string", "null"] },
        confidence: { type: "number", minimum: 0, maximum: 1 }
      }
    },
    limitations: { type: "array", items: { type: "string" }, maxItems: 8 }
  }
} as const;
