import type {
  OpportunityEvidence,
  OpportunityPrimaryAction,
  OpportunityPriorityLevel,
  OpportunityProductType,
  OpportunitySummary
} from "@/lib/opportunity-summary-types";

export type OpportunityQueueFilters = {
  companyId: string;
  requesterId: string;
  requesterRole: string;
  ownerId?: string | null;
  priority?: OpportunityPriorityLevel | null;
  productType?: OpportunityProductType | null;
  limit?: number | null;
  cursor?: string | null;
};

export type OpportunityQueueOwner = {
  id: string;
  name: string;
} | null;

export type OpportunityQueueContact = {
  id: string;
  name: string;
  phone: string | null;
};

export type OpportunityQueueItem = {
  id: string;
  companyId: string;
  conversationId: string;
  contact: OpportunityQueueContact;
  owner: OpportunityQueueOwner;
  priority: OpportunitySummary["priority"];
  product: OpportunitySummary["probableProduct"];
  commercialState: OpportunitySummary["commercialState"];
  queueReason: string;
  situationTitle: string;
  situationExplanation: string;
  primaryAction: OpportunityPrimaryAction;
  displayEvidences: OpportunityEvidence[];
  lastRelevantInteraction: OpportunitySummary["lastRelevantInteraction"];
  pendingReturn: OpportunitySummary["pendingReturn"];
  activeProposal: OpportunitySummary["activeProposal"];
  updatedAt: Date;
};

export type OpportunityQueueResult = {
  items: OpportunityQueueItem[];
  nextCursor: string | null;
  total: number;
  scanned: number;
};
