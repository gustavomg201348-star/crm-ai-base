import { decodeOpportunityQueueCursor } from "@/lib/opportunity-queue-rules";
import type {
  OpportunityPriorityLevel,
  OpportunityProductType
} from "@/lib/opportunity-summary-types";

const MAX_LIMIT = 100;
const PRIORITIES = new Set<OpportunityPriorityLevel>(["URGENT", "HIGH", "NORMAL", "LOW"]);
const PRODUCT_TYPES = new Set<OpportunityProductType>([
  "UNKNOWN",
  "FGTS",
  "CLT",
  "INSS",
  "MULTICRED",
  "PORTABILITY",
  "INSURANCE",
  "OTHER"
]);

export class OpportunityQueueQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpportunityQueueQueryValidationError";
  }
}

function parseLimit(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new OpportunityQueueQueryValidationError("Limit invalido.");
  }

  return Math.min(MAX_LIMIT, parsed);
}

function parsePriority(value: string | null) {
  if (!value) return null;
  const normalized = value.toUpperCase() as OpportunityPriorityLevel;

  if (!PRIORITIES.has(normalized)) {
    throw new OpportunityQueueQueryValidationError("Prioridade invalida.");
  }

  return normalized;
}

function parseProductType(value: string | null) {
  if (!value) return null;
  const normalized = value.toUpperCase() as OpportunityProductType;

  if (!PRODUCT_TYPES.has(normalized)) {
    throw new OpportunityQueueQueryValidationError("Produto invalido.");
  }

  return normalized;
}

function parseCursor(value: string | null) {
  if (!value) return null;

  if (!decodeOpportunityQueueCursor(value)) {
    throw new OpportunityQueueQueryValidationError("Cursor invalido.");
  }

  return value;
}

export function parseOpportunityQueueSearchParams(searchParams: URLSearchParams) {
  return {
    ownerId: searchParams.get("ownerId"),
    priority: parsePriority(searchParams.get("priority")),
    productType: parseProductType(searchParams.get("productType")),
    limit: parseLimit(searchParams.get("limit")),
    cursor: parseCursor(searchParams.get("cursor"))
  };
}
