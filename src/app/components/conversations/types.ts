export type ConversationStatus = "OPEN" | "PENDING" | "BOT" | "SOLD" | "RESOLVED";

export type AiMode = "OFF" | "COPILOT" | "AUTO" | "HYBRID";

export type ConversationStatusCounts = Record<ConversationStatus, number>;

export type ConversationFilters = {
  search: string;
  status: string;
  tagIds: string[];
  assignedTo: string;
};

export type TagRow = {
  id: string;
  name: string;
  color: string;
  textColor?: string | null;
  category?: string | null;
  isActive?: boolean;
};

export type AttendantRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  availabilityStatus?: string;
  lastSeenAt?: string | null;
  openConversations?: number;
};

export type ConversationRow = {
  id: string;
  status: ConversationStatus;
  channelId?: string | null;
  channel: string;
  summary?: string | null;
  aiMode?: AiMode | null;
  aiPaused?: boolean;
  aiLastSuggestion?: string | null;
  unreadCount: number;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  lastInboundMessageAt?: string | null;
  lastReadAt?: string | null;
  createdAt: string;
  updatedAt: string;
  agent: { id: string; name: string; email: string; role?: string } | null;
  assignmentStatus: "ASSIGNED" | "UNASSIGNED";
  contact: {
    id: string;
    name: string;
    phone: string;
    email?: string | null;
    cpf?: string | null;
    internalNote?: string | null;
    origin: string;
    stage: string;
    temperature: string;
    owner: string;
    ownerId?: string | null;
    lastMessage?: string | null;
    tags: Array<{ id: string; name: string; color: string }>;
  };
  tags: TagRow[];
  lastMessage: {
    id: string;
    direction: string;
    body: string;
    createdAt: string;
    type?: string;
    mediaUrl?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    templateName?: string | null;
    status?: string;
    readAt?: string | null;
    senderType?: string | null;
  } | null;
  messages: Array<{
    id: string;
    direction: string;
    body: string;
    createdAt: string;
    type?: string;
    mediaUrl?: string | null;
    mediaId?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    templateName?: string | null;
    templateLanguage?: string | null;
    templateVariables?: string | null;
    status?: string;
    providerMessageId?: string | null;
    readAt?: string | null;
    senderType?: string | null;
  }>;
};
