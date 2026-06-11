"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";
import clsx from "clsx";
import {
  aiActions,
  navItems,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Tags
} from "@/lib/mock-data";
import {
  ArrowRight,
  Archive,
  Activity,
  AlertTriangle,
  Banknote,
  Bell,
  BriefcaseBusiness,
  Check,
  CheckCheck,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Download,
  Edit3,
  File as FileIcon,
  FileText,
  Filter,
  Image as ImageIcon,
  Loader2,
  Menu,
  MessageCircle,
  Mic,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  Smile,
  Square,
  TrendingUp,
  Trash2,
  Upload,
  UserRound,
  X
} from "lucide-react";

type Section = (typeof navItems)[number]["id"];

type Session = {
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  };
  company: {
    id: string;
    name: string;
    segment?: string | null;
  };
};

type CompanyTenantRow = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  segment?: string | null;
  createdAt: string;
  admins: Array<{ id: string; name: string; email: string; role: string }>;
  counts: {
    users: number;
    contacts: number;
    channels: number;
    campaigns: number;
  };
};

type ContactRow = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  cpf?: string | null;
  origin: string;
  owner: string;
  stage: string;
  ownerId?: string | null;
  originId?: string | null;
  stageId?: string | null;
  temperature: "HOT" | "WARM" | "COLD";
  lastMessage?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  tags: Array<{ id: string; name: string; color: string }>;
  conversations: Array<{
    id: string;
    status: string;
    channel: string;
    summary?: string | null;
    updatedAt: string;
    messages: Array<{
      id: string;
      direction: string;
      body: string;
      createdAt: string;
    }>;
  }>;
  proposals: Array<{
    id: string;
    bank: string;
    agreement: string;
    product: string;
    amount: string;
    commission: string;
    status: string;
    createdAt: string;
  }>;
};

type ReferenceData = {
  origins: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; name: string; color?: string; position?: number }>;
  tags: Array<{
    id: string;
    name: string;
    color: string;
    textColor?: string | null;
    category?: string | null;
    isActive?: boolean;
  }>;
  users: Array<{ id: string; name: string; email: string; role: UserRole }>;
};

type SettingsTagRow = {
  id: string;
  name: string;
  color: string;
  textColor?: string | null;
  category?: string | null;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  conversationCount: number;
};

type UserRole = "ADMIN" | "SUPERVISOR" | "AGENT";

type AvailabilityStatus = "ONLINE" | "BUSY" | "OFFLINE" | "PAUSED";

type AttendantRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  availabilityStatus: AvailabilityStatus;
  lastSeenAt?: string | null;
  openConversations: number;
};

type LeadAssignmentSettings = {
  mode: "CLAIM_FIRST" | "ROUND_ROBIN" | "ADMIN_MANUAL";
  onlineOnly: boolean;
  maxOpenPerAttendant: number | null;
  allowAttendantClaim: boolean;
  redistributeWhenOffline: boolean;
  fallback?: boolean;
};

type AiMode = "OFF" | "COPILOT" | "AUTO" | "HYBRID";

type AiSettings = {
  mode: AiMode;
  instructions: string;
};

type KanbanStage = {
  id: string;
  name: string;
  color: string;
  position: number;
  contacts: ContactRow[];
};

type ConversationRow = {
  id: string;
  status: "OPEN" | "PENDING" | "BOT" | "SOLD" | "RESOLVED";
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
    origin: string;
    stage: string;
    temperature: string;
    owner: string;
    lastMessage?: string | null;
    tags: Array<{ id: string; name: string; color: string }>;
  };
  tags: Array<{
    id: string;
    name: string;
    color: string;
    textColor?: string | null;
    category?: string | null;
    isActive?: boolean;
  }>;
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

type ConversationStatusCounts = Record<ConversationRow["status"], number>;
type ConversationMessageRow = ConversationRow["messages"][number];

const emptyConversationStatusCounts: ConversationStatusCounts = {
  OPEN: 0,
  PENDING: 0,
  BOT: 0,
  SOLD: 0,
  RESOLVED: 0
};

type WhatsAppTemplateRow = {
  id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  preview: string;
  variableCount: number;
};

type ChannelRow = {
  id: string;
  name: string;
  type: string;
  provider: string;
  externalId?: string | null;
  phoneNumberId?: string | null;
  wabaId?: string | null;
  displayPhone?: string | null;
  hasAccessToken?: boolean;
  hasVerifyToken?: boolean;
  hasAppSecret?: boolean;
  status: string;
  lastWebhookSubscribedAt?: string | null;
  lastWebhookReceivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ChannelStatusRow = {
  id: string;
  name: string;
  provider: string;
  status: string;
  displayPhone?: string | null;
  phoneNumberId?: string | null;
  wabaId?: string | null;
  webhookUrl: string;
  lastWebhookSubscribedAt?: string | null;
  lastWebhookReceivedAt?: string | null;
  ready: boolean;
  checks: Record<string, boolean>;
  meta: {
    ok: boolean;
    verifiedName?: string | null;
    qualityRating?: string | null;
    error?: string | null;
  };
  metrics: {
    inboundCount: number;
    outboundCount: number;
    lastActivityAt?: string | null;
    lastDirection?: string | null;
    lastMessagePreview?: string | null;
    lastMessageStatus?: string | null;
    lastContactName?: string | null;
    lastContactPhone?: string | null;
  };
  warnings: string[];
};

type ChannelStatusData = {
  webhookUrl: string;
  summary: { total: number; ready: number; withWarnings: number };
  channels: ChannelStatusRow[];
};

type MetaChannelDiagnostics = {
  ok: boolean;
  tokenPreview?: string | null;
  token: {
    ok: boolean;
    id?: string | null;
    name?: string | null;
    appId?: string | null;
    tokenType?: string | null;
    expiresAt?: number | null;
    error?: string | null;
  };
  permissions: {
    ok: boolean;
    detected: string[];
    required: string[];
    missing: string[];
    optionalMissing: string[];
    error?: string | null;
  };
  waba: {
    ok: boolean;
    id?: string | null;
    name?: string | null;
    error?: string | null;
  };
  phone: {
    ok: boolean;
    id?: string | null;
    displayPhone?: string | null;
    verifiedName?: string | null;
    qualityRating?: string | null;
    wabaId?: string | null;
    belongsToWaba?: boolean;
    error?: string | null;
  };
  checklist: {
    tokenValid: boolean;
    permissionsChecked: boolean;
    wabaAccessible: boolean;
    phoneFound: boolean;
    phoneBelongsToWaba: boolean;
  };
};

type MessageLogRow = {
  id: string;
  conversationId: string;
  contact: { id: string; name: string; phone: string };
  channelId?: string | null;
  type: string;
  status: string;
  body: string;
  fileName?: string | null;
  mimeType?: string | null;
  templateName?: string | null;
  errorMessage?: string | null;
  providerMessageId?: string | null;
  createdAt: string;
  readAt?: string | null;
};

type CltBankRow = {
  id: string;
  name: string;
  provider: string;
  products: string[];
  tags: string[];
};

type CltCustomerData = {
  cpf: string;
  name: string;
  birthDate: string;
  phone?: string;
  gender: string;
  registry: string;
  employerDocument: string;
  employerName: string;
  admissionDate: string;
  income: number;
  availableMargin: number;
  zipCode: string;
  state: string;
  city: string;
  district: string;
  address: string;
  number: string;
};

type CltSimulationOffer = {
  id: string;
  bankId: string;
  bankName: string;
  product: string;
  tableCode: string;
  tableName: string;
  installments: number;
  monthlyRate: number;
  installmentAmount: number;
  financedAmount: number;
  releasedAmount: number;
  availableMargin: number;
  includeInsurance: boolean;
};

type CltSimulationDraft = {
  contactId?: string;
  cpf?: string | null;
  phone?: string | null;
  name?: string | null;
};

type CltIntegrationRow = {
  id: string;
  bankId: string;
  bankName: string;
  provider: string;
  baseUrl?: string | null;
  authType: string;
  hasApiKey: boolean;
  apiKeyPreview?: string | null;
  username?: string | null;
  hasPassword: boolean;
  newcorbanIdentifier?: string | null;
  digitadorCode?: string | null;
  certifiedAgentCpf?: string | null;
  actingUf?: string | null;
  smsStatus?: string | null;
  smsRequestedAt?: string | null;
  status: string;
  lastTestAt?: string | null;
  lastTestStatus?: string | null;
  lastTestMessage?: string | null;
  updatedAt: string;
};

type CltLogRow = {
  id: string;
  bankId?: string | null;
  bankName?: string | null;
  action: string;
  cpf?: string | null;
  phone?: string | null;
  status: string;
  message?: string | null;
  createdAt: string;
  userName?: string | null;
  contact?: { id: string; name: string; phone: string } | null;
};

type AiAnalysis = {
  summary: string;
  temperature: ContactRow["temperature"];
  nextAction: string;
  suggestedReply: string;
  confidence: number;
  tags?: string[];
  shouldTransferToHuman?: boolean;
  source?: "openai" | "fallback";
};

type ProposalStatus = "DRAFT" | "FORMALIZING" | "PAID" | "CANCELED" | "REWORK";

type ProposalRow = {
  id: string;
  contactId: string;
  bank: string;
  agreement: string;
  product: string;
  amount: string;
  commission: string;
  status: ProposalStatus;
  createdAt: string;
  contact: {
    id: string;
    name: string;
    phone: string;
    email?: string | null;
    cpf?: string | null;
    origin: string;
    stage: string;
    temperature: string;
    owner: string;
    lastMessage?: string | null;
    tags: Array<{ id: string; name: string; color: string }>;
  };
};

type ProposalMetrics = {
  count: number;
  totalAmount: number;
  paidAmount: number;
  formalizingAmount: number;
  commissionForecast: number;
  ticketAverage: number;
};

type CampaignRow = {
  id: string;
  name: string;
  message: string;
  messageType?: string;
  templateName?: string | null;
  templateLanguage?: string | null;
  templateVariables?: string | null;
  status: string;
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  imageName?: string | null;
  imageMime?: string | null;
  imageSize?: number | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  channel: {
    id: string;
    name: string;
    provider: string;
    displayPhone?: string | null;
  };
  recipients: Array<{
    id: string;
    contactId: string;
    contactName: string;
    phone: string;
    status: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    sentAt?: string | null;
    deliveredAt?: string | null;
    failedAt?: string | null;
  }>;
};

type NotificationRow = {
  id: string;
  conversationId: string;
  contactId?: string | null;
  customerName?: string | null;
  phone?: string | null;
  title: string;
  message: string;
  type: string;
  channelId?: string | null;
  channelLabel?: string | null;
  readAt?: string | null;
  createdAt: string;
};

type DashboardData = {
  metrics: {
    activeContacts: number;
    newContacts: number;
    hotContacts: number;
    openConversations: number;
    staleConversations: number;
    proposals: number;
    formalizingProposals: number;
    paidProposals: number;
    totalProposalAmount: number;
    paidAmount: number;
    commissionForecast: number;
    conversionRate: number;
  };
  funnel: Array<{ id: string; label: string; color: string; count: number }>;
  proposalStatus: Array<{ status: ProposalStatus; count: number }>;
  tasks: TaskRow[];
  priorities: Array<{
    id: string;
    type: string;
    title: string;
    detail: string;
    meta: string;
    severity: "high" | "medium" | "low";
  }>;
};

type TaskRow = {
  id: string;
  contactId?: string;
  assigneeId?: string | null;
  title: string;
  note?: string | null;
  dueAt: string;
  status: "PENDING" | "DONE";
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  contact: { id: string; name: string; phone: string };
  assignee: { id: string; name: string; email: string } | null;
};

type ImportResult = {
  summary: {
    totalRows: number;
    created: number;
    ignored: number;
    errors: number;
  };
  ignored: Array<{ row: number; reason: string }>;
  errors: Array<{ row: number; reason: string }>;
};

type SpreadsheetImportRow = {
  rowNumber: number;
  name: string;
  cpf: string;
  phone: string;
  whatsapp: string;
  status: "VALID" | "INVALID";
  errors: string[];
  duplicateCpf: boolean;
  duplicatePhone: boolean;
  existingContactId?: string | null;
};

type SpreadsheetImportPreview = {
  rows: SpreadsheetImportRow[];
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateCpfs: number;
    duplicatePhones: number;
    existingContacts: number;
  };
};

type SpreadsheetImportConfirm = {
  summary: {
    totalRows: number;
    imported: number;
    created: number;
    updated: number;
    invalid: number;
  };
  contactIds: string[];
  errors: Array<{ rowNumber: number; reason: string }>;
};

type RetirementLeadRow = {
  id: string;
  contactId: string;
  grantDate?: string | null;
  estimatedUnlockDate?: string | null;
  daysToUnlock?: number | null;
  benefitType?: string | null;
  benefitNumber?: string | null;
  state?: string | null;
  city?: string | null;
  desiredAmount?: string | null;
  interestLevel: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  hasCorrespondent: boolean;
  score: number;
  journeyStatus:
    | "IMPORTED"
    | "FIRST_CONTACT"
    | "RESPONDED"
    | "INTERESTED"
    | "NURTURING"
    | "PRE_UNLOCK"
    | "READY_TO_CONVERT"
    | "CONVERTED"
    | "LOST";
  nextContactDate?: string | null;
  lastContactDate?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  contact: {
    id: string;
    name: string;
    phone: string;
    cpf?: string | null;
    owner: string;
    tags: Array<{ id: string; name: string; color: string; textColor?: string | null }>;
  };
  events: Array<{
    id: string;
    eventType: string;
    description?: string | null;
    createdAt: string;
    createdBy: { id: string; name: string; email: string } | null;
  }>;
};

type RetirementLeadDashboard = {
  totalImported: number;
  until90: number;
  until60: number;
  until30: number;
  until15: number;
  readyToConvert: number;
  hotLeads: number;
  coldLeads: number;
};

type RetirementLeadFilters = {
  search: string;
  state: string;
  city: string;
  maxDaysToUnlock: string;
  minScore: string;
  interestLevel: string;
  journeyStatus: string;
  hasCorrespondent: string;
  nextAction: string;
  page: number;
};

type ContactActivityRow = {
  id: string;
  contactId: string;
  type: string;
  title: string;
  detail?: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
};

const temperatureLabels = {
  HOT: "Quente",
  WARM: "Morno",
  COLD: "Frio"
} as const;

const proposalStatusLabels: Record<ProposalStatus, string> = {
  DRAFT: "Rascunho",
  FORMALIZING: "Formalizacao",
  PAID: "Pago",
  CANCELED: "Cancelado",
  REWORK: "Pendencia"
};

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));

  if (minutes < 60) return `ha ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `ha ${hours} h`;

  return `ha ${Math.floor(hours / 24)} dia(s)`;
}

function minutesSince(value?: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
}

function getConversationAttention(item: ConversationRow) {
  const lastInboundAge = minutesSince(item.lastInboundMessageAt);
  const lastInboundAt = item.lastInboundMessageAt ? new Date(item.lastInboundMessageAt).getTime() : 0;
  const lastReadAt = item.lastReadAt ? new Date(item.lastReadAt).getTime() : 0;
  const hasUnread = (item.unreadCount ?? 0) > 0;
  const waitingCustomer =
    item.lastMessage?.direction === "inbound" ||
    Boolean(lastInboundAt && (!lastReadAt || lastInboundAt > lastReadAt));

  if (hasUnread) {
    return {
      label: "Nova mensagem",
      tone: "green" as const,
      pulse: true
    };
  }

  if (!item.agent) {
    return {
      label: "Sem responsavel",
      tone: "amber" as const,
      pulse: false
    };
  }

  if (waitingCustomer && lastInboundAge !== null && lastInboundAge >= 30) {
    return {
      label: lastInboundAge >= 120 ? "Resposta atrasada" : "Aguardando resposta",
      tone: lastInboundAge >= 120 ? ("rose" as const) : ("amber" as const),
      pulse: false
    };
  }

  return {
    label: "Em dia",
    tone: "slate" as const,
    pulse: false
  };
}

function formatMessagePreview(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || "Sem mensagens.";
}

function formatConversationPreview(item: ConversationRow) {
  const preview = formatMessagePreview(
    item.lastMessagePreview ?? item.lastMessage?.body ?? item.summary
  );

  return item.lastMessage?.direction === "outbound" && preview !== "Sem mensagens."
    ? `Você: ${preview}`
    : preview;
}

function formatConversationChannelLine(item: ConversationRow) {
  const channelName = item.channel?.toLowerCase().includes("whatsapp")
    ? "WhatsApp"
    : item.channel || "Canal";
  const responsible = item.agent?.name ?? "Sem responsavel";

  return `${channelName} • ${responsible}`;
}

function getConversationBadgeClass(label: string, kind: "tag" | "status" | "agent" = "tag") {
  const normalized = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (kind === "agent") {
    return "bg-slate-100 text-slate-500 ring-slate-200";
  }

  if (["clt", "credito clt"].some((value) => normalized.includes(value))) {
    return "bg-blue-50 text-blue-700 ring-blue-100";
  }

  if (normalized.includes("fgts")) {
    return "bg-violet-50 text-violet-700 ring-violet-100";
  }

  if (normalized.includes("inss")) {
    return "bg-cyan-50 text-cyan-700 ring-cyan-100";
  }

  if (normalized.includes("negociacao") || normalized.includes("proposta")) {
    return "bg-amber-50 text-amber-700 ring-amber-100";
  }

  if (normalized.includes("sem resposta") || normalized.includes("pendente")) {
    return "bg-orange-50 text-orange-700 ring-orange-100";
  }

  if (normalized.includes("quente")) {
    return "bg-rose-50 text-rose-700 ring-rose-100";
  }

  if (normalized.includes("morno")) {
    return "bg-slate-100 text-slate-600 ring-slate-200";
  }

  if (normalized.includes("frio")) {
    return "bg-sky-50 text-sky-700 ring-sky-100";
  }

  if (kind === "status") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  }

  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function getConversationMessageTime(conversation: ConversationRow) {
  const value = conversation.lastMessageAt ?? conversation.lastMessage?.createdAt;
  return value ? new Date(value).getTime() : 0;
}

function compareConversationsByActivity(a: ConversationRow, b: ConversationRow) {
  const aMessageTime = getConversationMessageTime(a);
  const bMessageTime = getConversationMessageTime(b);

  if (aMessageTime || bMessageTime) {
    if (!aMessageTime) return 1;
    if (!bMessageTime) return -1;
    if (aMessageTime !== bMessageTime) return bMessageTime - aMessageTime;
  }

  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function formatCurrency(value: number | string) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function formatCpf(value?: string | null) {
  const digits = value?.replace(/\D/g, "").slice(0, 11) ?? "";
  if (digits.length !== 11) return value?.trim() ?? "";
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function formatContactNameForUi(name?: string | null) {
  const trimmed = name?.trim().replace(/\s+/g, " ") ?? "";

  if (!trimmed) {
    return "Cliente";
  }

  return trimmed
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|[\s'-])(\S)/g, (_match, prefix: string, letter: string) => {
      return `${prefix}${letter.toLocaleUpperCase("pt-BR")}`;
    });
}

function userIsAdmin(session?: Session | null) {
  return session?.user.role === "ADMIN";
}

function userCanManageOperation(session?: Session | null) {
  return session?.user.role === "ADMIN" || session?.user.role === "SUPERVISOR";
}

function userIsPlatformAdmin(session?: Session | null) {
  return session?.user.role === "ADMIN" && session.user.email === "admin@crm.local";
}

function availabilityLabel(status: AvailabilityStatus) {
  return {
    ONLINE: "Disponivel",
    BUSY: "Ocupado",
    OFFLINE: "Indisponivel",
    PAUSED: "Pausado"
  }[status];
}

function assignmentModeLabel(mode: LeadAssignmentSettings["mode"]) {
  return {
    CLAIM_FIRST: "Quem clicar primeiro pega",
    ROUND_ROBIN: "Automatico igualitario",
    ADMIN_MANUAL: "Manual pelo administrador"
  }[mode];
}

function aiModeLabel(mode: AiMode) {
  return {
    OFF: "Desligada",
    COPILOT: "Copiloto",
    AUTO: "Automatica",
    HYBRID: "Hibrida"
  }[mode];
}

function logConversationRenderDebug({
  origin,
  previous,
  next
}: {
  origin: string;
  previous?: ConversationRow | null;
  next: ConversationRow;
}) {
  const previousName = previous?.contact.name ?? null;
  const nextName = next.contact.name;

  if (previousName === nextName) {
    return;
  }

  console.warn(
    `[conversation-render-debug] ${JSON.stringify({
      origin,
      conversationId: next.id,
      contactId: next.contact.id,
      phone: next.contact.phone,
      previousName,
      nextName
    })}`
  );
}

function withStableConversationContactName({
  previous,
  next,
  origin
}: {
  previous?: ConversationRow | null;
  next: ConversationRow;
  origin: string;
}) {
  const sameConversation = previous?.id === next.id;
  const sameContact = previous?.contact.id === next.contact.id;

  if (
    !previous ||
    (!sameConversation && !sameContact) ||
    previous.contact.name === next.contact.name
  ) {
    return next;
  }

  const previousName = previous.contact.name.trim();
  const nextName = next.contact.name.trim();

  if (!previousName || !nextName) {
    return next;
  }

  console.warn(
    `[conversation-render-debug] ${JSON.stringify({
      origin: `${origin}:preserve-stable-contact-name`,
      conversationId: next.id,
      contactId: next.contact.id,
      previousConversationId: previous.id,
      previousContactId: previous.contact.id,
      phone: next.contact.phone,
      previousPhone: previous.contact.phone,
      previousName,
      nextName,
      matchedBy: sameConversation ? "conversationId" : "contactId",
      decision: "mantendo nome anterior na UI porque conversa ou contato correspondem"
    })}`
  );

  return {
    ...next,
    contact: {
      ...next.contact,
      name: previous.contact.name
    }
  };
}

function mergeConversationListItem({
  current,
  conversation,
  origin
}: {
  current: ConversationRow[];
  conversation: ConversationRow;
  origin: string;
}) {
  const previous =
    current.find((item) => item.id === conversation.id) ??
    current.find((item) => item.contact.id === conversation.contact.id) ??
    null;
  const stableConversation = withStableConversationContactName({
    previous,
    next: conversation,
    origin
  });
  logConversationRenderDebug({ origin, previous, next: stableConversation });

  const next = previous
    ? current.map((item) =>
        item.id === stableConversation.id ? stableConversation : item
      )
    : [stableConversation, ...current];

  return [...next].sort(compareConversationsByActivity);
}

function mergeConversationListSnapshot({
  current,
  incoming,
  origin
}: {
  current: ConversationRow[];
  incoming: ConversationRow[];
  origin: string;
}) {
  const previousById = new Map(current.map((item) => [item.id, item]));
  const previousByContactId = new Map(current.map((item) => [item.contact.id, item]));

  return incoming.map((conversation) => {
    const previous =
      previousById.get(conversation.id) ??
      previousByContactId.get(conversation.contact.id) ??
      null;
    const stableConversation = withStableConversationContactName({
      previous,
      next: conversation,
      origin
    });
    logConversationRenderDebug({
      origin,
      previous,
      next: stableConversation
    });
    return stableConversation;
  });
}

function emptyDashboardData(): DashboardData {
  return {
    metrics: {
      activeContacts: 0,
      newContacts: 0,
      hotContacts: 0,
      openConversations: 0,
      staleConversations: 0,
      proposals: 0,
      formalizingProposals: 0,
      paidProposals: 0,
      totalProposalAmount: 0,
      paidAmount: 0,
      commissionForecast: 0,
      conversionRate: 0
    },
    funnel: [],
    proposalStatus: [],
    tasks: [],
    priorities: []
  };
}

export default function Home() {
  const [active, setActive] = useState<Section>("dashboard");
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [kanbanStages, setKanbanStages] = useState<KanbanStage[]>([]);
  const [conversationList, setConversationList] = useState<ConversationRow[]>([]);
  const [conversationStatusCounts, setConversationStatusCounts] =
    useState<ConversationStatusCounts>(emptyConversationStatusCounts);
  const [attendants, setAttendants] = useState<AttendantRow[]>([]);
  const [leadAssignmentSettings, setLeadAssignmentSettings] =
    useState<LeadAssignmentSettings>({
      mode: "CLAIM_FIRST",
      onlineOnly: true,
      maxOpenPerAttendant: null,
      allowAttendantClaim: true,
      redistributeWhenOffline: false
    });
  const [aiSettings, setAiSettings] = useState<AiSettings>({
    mode: "COPILOT",
    instructions: ""
  });
  const [myAvailability, setMyAvailability] = useState<AvailabilityStatus>("OFFLINE");
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [channelStatus, setChannelStatus] = useState<ChannelStatusData | null>(null);
  const [messageLogs, setMessageLogs] = useState<MessageLogRow[]>([]);
  const [messageLogFilters, setMessageLogFilters] = useState({
    channelId: "",
    status: "ALL",
    type: "ALL"
  });
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboardData);
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationRow | null>(null);
  const [cltDraft, setCltDraft] = useState<CltSimulationDraft | null>(null);
  const selectedConversationRef = useRef<string | null>(null);
  const conversationListRef = useRef<ConversationRow[]>([]);
  const knownNotificationIdsRef = useRef<Set<string>>(new Set());
  const notificationsLoadedRef = useRef(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [newConversationSaving, setNewConversationSaving] = useState(false);
  const [newConversationError, setNewConversationError] = useState("");
  const [newConversationForm, setNewConversationForm] = useState({
    search: "",
    contactId: "",
    name: "",
    phone: "",
    cpf: ""
  });
  const [desktopPermission, setDesktopPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [conversationFilters, setConversationFilters] = useState({
    search: "",
    status: "OPEN",
    tagIds: [] as string[],
    assignedTo: "default"
  });
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [contactFilters, setContactFilters] = useState({
    search: "",
    status: "active",
    originId: "",
    stageId: "",
    ownerId: "",
    tagId: "",
    temperature: ""
  });
  const [proposalFilters, setProposalFilters] = useState({
    search: "",
    status: ""
  });
  const [dashboardFilters, setDashboardFilters] = useState({
    period: "30d",
    originId: "",
    ownerId: ""
  });
  const [retirementLeads, setRetirementLeads] = useState<RetirementLeadRow[]>([]);
  const [selectedRetirementLead, setSelectedRetirementLead] =
    useState<RetirementLeadRow | null>(null);
  const [retirementDashboard, setRetirementDashboard] =
    useState<RetirementLeadDashboard>({
      totalImported: 0,
      until90: 0,
      until60: 0,
      until30: 0,
      until15: 0,
      readyToConvert: 0,
      hotLeads: 0,
      coldLeads: 0
    });
  const [retirementPagination, setRetirementPagination] = useState({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1
  });
  const [retirementFilters, setRetirementFilters] = useState<RetirementLeadFilters>({
    search: "",
    state: "",
    city: "",
    maxDaysToUnlock: "",
    minScore: "",
    interestLevel: "",
    journeyStatus: "",
    hasCorrespondent: "",
    nextAction: "",
    page: 1
  });
  const [proposalMetrics, setProposalMetrics] = useState<ProposalMetrics>({
    count: 0,
    totalAmount: 0,
    paidAmount: 0,
    formalizingAmount: 0,
    commissionForecast: 0,
    ticketAverage: 0
  });
  const [reference, setReference] = useState<ReferenceData>({
    origins: [],
    stages: [],
    tags: [],
    users: []
  });
  const [settingsTags, setSettingsTags] = useState<SettingsTagRow[]>([]);
  const [companies, setCompanies] = useState<CompanyTenantRow[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [kanbanLoading, setKanbanLoading] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelStatusLoading, setChannelStatusLoading] = useState(false);
  const [messageLogsLoading, setMessageLogsLoading] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [retirementLoading, setRetirementLoading] = useState(false);
  const [appError, setAppError] = useState("");
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);

  useEffect(() => {
    selectedConversationRef.current = selectedConversation?.id ?? null;
  }, [selectedConversation?.id]);

  useEffect(() => {
    conversationListRef.current = conversationList;
  }, [conversationList]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("crm.leftSidebarCollapsed");
    if (stored === "true" || stored === "false") {
      setLeftSidebarCollapsed(stored === "true");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "crm.leftSidebarCollapsed",
      String(leftSidebarCollapsed)
    );
  }, [leftSidebarCollapsed]);

  const pageTitle = useMemo(() => {
    return navItems.find((item) => item.id === active)?.label ?? "Dashboard";
  }, [active]);

  const visibleNavItems = useMemo(() => {
    if (userIsAdmin(session)) {
      return navItems.filter((item) =>
        item.id === "empresas" ? userIsPlatformAdmin(session) : true
      );
    }

    if (session?.user.role === "SUPERVISOR") {
      return navItems.filter((item) =>
        [
          "dashboard",
          "atendimento",
          "kanban",
          "contatos",
          "tags",
          "simulacao-clt",
          "recem-aposentados"
        ].includes(item.id)
      );
    }

    return navItems.filter((item) =>
      ["atendimento", "contatos", "kanban", "simulacao-clt"].includes(item.id)
    );
  }, [session]);

  const atendimentoUnread = useMemo(
    () =>
      conversationList.reduce(
        (total, conversation) => total + (conversation.unreadCount ?? 0),
        0
      ),
    [conversationList]
  );

  async function loadSession() {
    setSessionLoading(true);
    const response = await fetch("/api/auth/session");

    if (response.ok) {
      setSession((await response.json()) as Session);
    } else {
      setSession(null);
    }

    setSessionLoading(false);
  }

  const loadContacts = useCallback(async (filters = contactFilters) => {
    setContactsLoading(true);
    setAppError("");

    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    const response = await fetch(`/api/contacts?${params.toString()}`);
    if (response.ok) {
      const data = (await response.json()) as { contacts: ContactRow[] };
      setContacts(data.contacts);
    } else {
      setAppError("Nao foi possivel carregar contatos. Confira banco e login.");
    }

    setContactsLoading(false);
  }, [contactFilters]);

  async function loadReference() {
    const response = await fetch("/api/reference");
    if (response.ok) {
      setReference((await response.json()) as ReferenceData);
    }
  }

  const loadAttendants = useCallback(async () => {
    const response = await fetch("/api/users/attendants");
    if (!response.ok) return;

    const data = (await response.json()) as { attendants: AttendantRow[] };
    setAttendants(data.attendants);
    const mine = data.attendants.find((attendant) => attendant.id === session?.user.id);
    if (mine) setMyAvailability(mine.availabilityStatus);
  }, [session?.user.id]);

  const loadLeadAssignmentSettings = useCallback(async () => {
    if (!userIsAdmin(session)) return;

    const response = await fetch("/api/settings/lead-assignment");
    if (!response.ok) return;

    const data = (await response.json()) as { settings: LeadAssignmentSettings };
    setLeadAssignmentSettings(data.settings);
  }, [session]);

  const loadAiSettings = useCallback(async () => {
    if (!session) return;

    const response = await fetch("/api/settings/ai");
    if (!response.ok) return;

    const data = (await response.json()) as { settings: AiSettings };
    setAiSettings(data.settings);
  }, [session]);

  const loadRetirementLeads = useCallback(async (filters = retirementFilters) => {
    setRetirementLoading(true);

    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });

    const response = await fetch(`/api/retirement-leads?${params.toString()}`);
    if (response.ok) {
      const data = (await response.json()) as {
        leads: RetirementLeadRow[];
        pagination: {
          page: number;
          pageSize: number;
          total: number;
          totalPages: number;
        };
        dashboard: RetirementLeadDashboard;
      };
      setRetirementLeads(data.leads);
      setRetirementPagination(data.pagination);
      setRetirementDashboard(data.dashboard);
      setSelectedRetirementLead((current) => {
        if (!current) return data.leads[0] ?? null;
        return data.leads.find((lead) => lead.id === current.id) ?? current;
      });
    } else {
      console.warn("Nao foi possivel carregar recem-aposentados.");
    }

    setRetirementLoading(false);
  }, [retirementFilters]);

  async function updateRetirementLead(
    id: string,
    payload: Partial<RetirementLeadRow>
  ) {
    const response = await fetch(`/api/retirement-leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel atualizar o lead.");
      return;
    }

    const data = (await response.json()) as { lead: RetirementLeadRow };
    setSelectedRetirementLead(data.lead);
    await loadRetirementLeads(retirementFilters);
  }

  async function createRetirementLeadEvent(
    retirementLeadId: string,
    description: string
  ) {
    if (!description.trim()) return;

    const response = await fetch(`/api/retirement-leads/${retirementLeadId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "NOTE", description })
    });

    if (!response.ok) {
      setAppError("Nao foi possivel registrar nota na timeline.");
      return;
    }

    const detailResponse = await fetch(`/api/retirement-leads/${retirementLeadId}`);
    if (detailResponse.ok) {
      const data = (await detailResponse.json()) as { lead: RetirementLeadRow };
      setSelectedRetirementLead(data.lead);
    }
  }

  async function updateMyAvailability(status: AvailabilityStatus) {
    setMyAvailability(status);
    await fetch("/api/users/me/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    void loadAttendants();
  }

  async function updateAttendantStatus(userId: string, status: AvailabilityStatus) {
    await fetch(`/api/users/${userId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    void loadAttendants();
  }

  async function saveLeadAssignmentSettings(settings: LeadAssignmentSettings) {
    const response = await fetch("/api/settings/lead-assignment", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });

    if (response.ok) {
      const data = (await response.json()) as { settings: LeadAssignmentSettings };
      setLeadAssignmentSettings(data.settings);
    }
  }

  async function saveAiSettings(settings: AiSettings) {
    const response = await fetch("/api/settings/ai", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });

    if (!response.ok) {
      setAppError("Nao foi possivel salvar configuracoes da IA.");
      return;
    }

    const data = (await response.json()) as { settings: AiSettings };
    setAiSettings(data.settings);
  }

  const loadSettingsTags = useCallback(async () => {
    setTagsLoading(true);
    const response = await fetch("/api/settings/tags");

    if (response.ok) {
      const data = (await response.json()) as { tags: SettingsTagRow[] };
      setSettingsTags(data.tags);
    } else {
      setAppError("Nao foi possivel carregar tags.");
    }

    setTagsLoading(false);
  }, []);

  async function refreshOperationalViews() {
    await loadReference();
    await loadSettingsTags();
    await loadKanban();
    void loadDashboard(dashboardFilters);
    void loadContacts(contactFilters);
    void loadConversations(conversationFilters);
  }

  async function loadKanban() {
    setKanbanLoading(true);
    setAppError("");

    const response = await fetch("/api/kanban");
    if (response.ok) {
      const data = (await response.json()) as { stages: KanbanStage[] };
      setKanbanStages(data.stages);
    } else {
      setAppError("Nao foi possivel carregar o Kanban.");
    }

    setKanbanLoading(false);
  }

  const loadConversations = useCallback(
    async (
      filters = conversationFilters,
      options: { silent?: boolean } = {}
    ) => {
      if (!options.silent) {
        setConversationLoading(true);
        setAppError("");
      }

      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((item) => {
            if (item) params.append(key === "tagIds" ? "tagId" : key, item);
          });
          return;
        }

        if (key === "assignedTo" && value === "default") return;
        if (value) params.set(key, value);
      });

      const response = await fetch(`/api/conversations?${params.toString()}`);
      if (response.ok) {
        const data = (await response.json()) as {
          conversations: ConversationRow[];
          statusCounts?: Partial<ConversationStatusCounts>;
        };
        setConversationStatusCounts({
          ...emptyConversationStatusCounts,
          ...data.statusCounts
        });
        const origin = options.silent ? "polling" : "initial-load";
        const nextConversations = mergeConversationListSnapshot({
          current: conversationListRef.current,
          incoming: data.conversations,
          origin
        });
        setConversationList(nextConversations);
        setSelectedConversation((current) => {
          if (!current) return null;
          const next =
            nextConversations.find((conversation) => conversation.id === current.id) ??
            current;
          logConversationRenderDebug({
            origin: "selected-conversation-load-sync",
            previous: current,
            next
          });
          return next;
        });
      } else {
        if (!options.silent) {
          setAppError("Nao foi possivel carregar conversas.");
        }
      }

      if (!options.silent) {
        setConversationLoading(false);
      }
    },
    [conversationFilters]
  );

  const mergeConversation = useCallback((conversation: ConversationRow, origin = "merge") => {
    setSelectedConversation((current) =>
      current?.id === conversation.id
        ? (() => {
            const stableConversation = withStableConversationContactName({
              previous: current,
              next: conversation,
              origin: `${origin}:selected-conversation`
            });
            logConversationRenderDebug({
              origin: `${origin}:selected-conversation`,
              previous: current,
              next: stableConversation
            });
            return stableConversation;
          })()
        : current
    );
    setConversationList((current) =>
      mergeConversationListItem({ current, conversation, origin })
    );
  }, []);

  const refreshConversation = useCallback(
    async (conversationId?: string | null) => {
      const id = conversationId ?? selectedConversationRef.current;
      if (!id) return null;

      const response = await fetch(`/api/conversations/${id}`);
      if (!response.ok) return null;

      const data = (await response.json()) as { conversation: ConversationRow };
      mergeConversation(data.conversation, "refresh");
      return data.conversation;
    },
    [mergeConversation]
  );

  const markConversationRead = useCallback(
    async (conversationId: string) => {
      const response = await fetch(`/api/conversations/${conversationId}/read`, {
        method: "POST"
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { conversation: ConversationRow };
      mergeConversation(data.conversation, "click-read");
      return data.conversation;
    },
    [mergeConversation]
  );

  const markNotificationsRead = useCallback(
    async (payload: { id?: string; conversationId?: string; all?: boolean }) => {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = (await response.json()) as { unreadCount: number };
        setUnreadNotifications(data.unreadCount);
        setNotifications((current) =>
          current.map((notification) => {
            const shouldMark =
              payload.all ||
              notification.id === payload.id ||
              notification.conversationId === payload.conversationId;

            return shouldMark
              ? { ...notification, readAt: notification.readAt ?? new Date().toISOString() }
              : notification;
          })
        );
      }
    },
    []
  );

  const openConversationById = useCallback(
    async (conversationId: string) => {
      const response = await fetch(`/api/conversations/${conversationId}`);

      if (response.ok) {
        const data = (await response.json()) as { conversation: ConversationRow };
        setActive("atendimento");
        mergeConversation(data.conversation, "open-notification");
        await markConversationRead(conversationId);
        await markNotificationsRead({ conversationId });
      }
    },
    [markConversationRead, markNotificationsRead, mergeConversation]
  );

  const showDesktopNotification = useCallback((notification: NotificationRow) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (window.Notification.permission !== "granted") return;

    const desktop = new window.Notification(
      `Nova mensagem de ${notification.customerName || notification.phone || "cliente"}`,
      {
        body: notification.message,
        tag: notification.conversationId,
        requireInteraction: false
      }
    );

    desktop.onclick = () => {
      window.focus();
      void openConversationById(notification.conversationId);
      desktop.close();
    };
  }, [openConversationById]);

  const handleIncomingNotification = useCallback(
    (notification: NotificationRow) => {
      if (knownNotificationIdsRef.current.has(notification.id)) return;

      knownNotificationIdsRef.current.add(notification.id);

      if (notification.conversationId === selectedConversationRef.current) {
        void markNotificationsRead({ conversationId: notification.conversationId });
        void markConversationRead(notification.conversationId);
        void loadConversations(conversationFilters, { silent: true });
        return;
      }

      setNotifications((current) => [notification, ...current].slice(0, 20));
      setUnreadNotifications((current) => current + 1);
      showDesktopNotification(notification);
      void loadConversations(conversationFilters, { silent: true });
    },
    [
      conversationFilters,
      loadConversations,
      markConversationRead,
      markNotificationsRead,
      showDesktopNotification
    ]
  );

  const loadNotifications = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const response = await fetch("/api/notifications?limit=20");

      if (!response.ok) return;

      const data = (await response.json()) as {
        notifications: NotificationRow[];
        unreadCount: number;
      };
      const previousIds = knownNotificationIdsRef.current;
      const activeConversationId = selectedConversationRef.current;

      setNotifications(data.notifications);
      setUnreadNotifications(data.unreadCount);

      const unreadNewNotifications = data.notifications.filter(
        (notification) => !notification.readAt && !previousIds.has(notification.id)
      );

      data.notifications.forEach((notification) => previousIds.add(notification.id));

      if (!notificationsLoadedRef.current) {
        notificationsLoadedRef.current = true;
        return;
      }

      for (const notification of unreadNewNotifications) {
        if (notification.conversationId === activeConversationId) {
          void markNotificationsRead({ conversationId: notification.conversationId });
          void markConversationRead(notification.conversationId);
          continue;
        }

        if (!options.silent) {
          showDesktopNotification(notification);
        }
      }
    },
    [markConversationRead, markNotificationsRead, showDesktopNotification]
  );

  async function requestDesktopNotifications() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setDesktopPermission("unsupported");
      return;
    }

    const permission = await window.Notification.requestPermission();
    setDesktopPermission(permission);
  }

  async function handleSelectConversation(conversation: ConversationRow) {
    setSelectedConversation(conversation);
    void markConversationRead(conversation.id);
    await markNotificationsRead({ conversationId: conversation.id });
  }

  async function handleAssignConversation(conversationId: string, userId?: string) {
    const response = await fetch(`/api/conversations/${conversationId}/assign`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userId ? { userId } : {})
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setAppError(data?.error ?? "Nao foi possivel assumir atendimento.");
      return;
    }

    const data = (await response.json()) as { conversation: ConversationRow };
    mergeConversation(data.conversation, "assign");
    setSelectedConversation(data.conversation);
    if (conversationFilters.assignedTo === "unassigned") {
      setConversationFilters((current) => ({
        ...current,
        assignedTo: userId ? "default" : "me"
      }));
    }
    void loadAttendants();
  }

  async function handleUnassignConversation(conversationId: string) {
    const response = await fetch(`/api/conversations/${conversationId}/unassign`, {
      method: "PATCH"
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setAppError(data?.error ?? "Nao foi possivel devolver atendimento.");
      return;
    }

    const data = (await response.json()) as { conversation: ConversationRow };
    mergeConversation(data.conversation, "unassign");
    setSelectedConversation(data.conversation);
    void loadAttendants();
  }

  async function handleTransferConversation(conversationId: string, userId: string) {
    const response = await fetch(`/api/conversations/${conversationId}/transfer`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      const message = data?.error ?? "Nao foi possivel transferir atendimento.";
      setAppError(message);
      throw new Error(message);
    }

    const data = (await response.json()) as { conversation: ConversationRow };
    mergeConversation(data.conversation, "transfer");
    setSelectedConversation(data.conversation);
    void loadAttendants();
  }

  async function handleStartNewConversation() {
    const selectedContact = contacts.find(
      (contact) => contact.id === newConversationForm.contactId
    );
    const payload = selectedContact
      ? {
          contactId: selectedContact.id,
          cpf: newConversationForm.cpf.trim(),
          status: "OPEN"
        }
      : {
          name: newConversationForm.name.trim(),
          phone: newConversationForm.phone.trim(),
          cpf: newConversationForm.cpf.trim(),
          status: "OPEN"
        };

    if (!payload.contactId && (!payload.name || !payload.phone)) {
      setNewConversationError("Escolha um contato ou informe nome e telefone.");
      return;
    }

    setNewConversationSaving(true);
    setNewConversationError("");

    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setNewConversationError(data?.error ?? "Nao foi possivel iniciar conversa.");
      setNewConversationSaving(false);
      return;
    }

    const data = (await response.json()) as { conversation: ConversationRow };
    setActive("atendimento");
    setConversationFilters({
      search: "",
      status: data.conversation.status,
      tagIds: [],
      assignedTo: "default"
    });
    mergeConversation(data.conversation, "new-conversation");
    setSelectedConversation(data.conversation);
    setNewConversationOpen(false);
    setNewConversationForm({ search: "", contactId: "", name: "", phone: "", cpf: "" });
    setNewConversationSaving(false);
    void loadContacts(contactFilters);
    void markConversationRead(data.conversation.id);
  }

  useEffect(() => {
    if (!session || active !== "atendimento" || !selectedConversation?.id) return;
    void markConversationRead(selectedConversation.id);
    void markNotificationsRead({ conversationId: selectedConversation.id });
  }, [
    active,
    markConversationRead,
    markNotificationsRead,
    selectedConversation?.id,
    selectedConversation?.unreadCount,
    session
  ]);

  async function loadChannels() {
    setChannelsLoading(true);
    setAppError("");

    const response = await fetch("/api/channels");
    if (response.ok) {
      const data = (await response.json()) as { channels: ChannelRow[] };
      setChannels(data.channels);
    } else {
      setAppError("Nao foi possivel carregar canais.");
    }

    setChannelsLoading(false);
  }

  async function loadChannelStatus() {
    setChannelStatusLoading(true);
    setAppError("");

    const response = await fetch("/api/channels/status");
    if (response.ok) {
      const data = (await response.json()) as ChannelStatusData;
      setChannelStatus(data);
    } else {
      setAppError("Nao foi possivel carregar status dos canais.");
    }

    setChannelStatusLoading(false);
  }

  const loadMessageLogs = useCallback(async (filters: {
    channelId: string;
    status: string;
    type: string;
  }) => {
    setMessageLogsLoading(true);
    setAppError("");

    const params = new URLSearchParams({ take: "50" });
    if (filters.channelId) params.set("channelId", filters.channelId);
    if (filters.status && filters.status !== "ALL") params.set("status", filters.status);
    if (filters.type && filters.type !== "ALL") params.set("type", filters.type);

    const response = await fetch(`/api/messages/logs?${params.toString()}`);
    if (response.ok) {
      const data = (await response.json()) as { logs: MessageLogRow[] };
      setMessageLogs(data.logs);
    } else {
      setAppError("Nao foi possivel carregar logs de mensagens.");
    }

    setMessageLogsLoading(false);
  }, []);

  async function loadCampaigns() {
    setCampaignsLoading(true);
    setAppError("");

    const response = await fetch("/api/campaigns");
    if (response.ok) {
      const data = (await response.json()) as { campaigns: CampaignRow[] };
      setCampaigns(data.campaigns);
    } else {
      setAppError("Nao foi possivel carregar disparos.");
    }

    setCampaignsLoading(false);
  }

  const loadCompanies = useCallback(async () => {
    if (!userIsPlatformAdmin(session)) return;
    setCompaniesLoading(true);
    setAppError("");

    const response = await fetch("/api/admin/companies");
    if (response.ok) {
      const data = (await response.json()) as { companies: CompanyTenantRow[] };
      setCompanies(data.companies);
    } else {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel carregar empresas.");
    }

    setCompaniesLoading(false);
  }, [session]);

  async function handleCreateCompanyTenant(payload: {
    companyName: string;
    companyEmail: string;
    companyPhone: string;
    segment: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
  }) {
    const response = await fetch("/api/admin/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel criar empresa.");
      return null;
    }

    const data = (await response.json()) as { company: CompanyTenantRow };
    setCompanies((current) => [data.company, ...current]);
    return data.company;
  }

  async function handleCreateCampaign(payload: {
    channelId: string;
    contactIds: string[];
    message: string;
    image?: File | null;
    messageType?: string;
    templateName?: string;
    templateLanguage?: string;
    templateVariables?: string[];
  }) {
    const formData = new FormData();
    formData.set("channelId", payload.channelId);
    formData.set("message", payload.message);
    formData.set("contactIds", JSON.stringify(payload.contactIds));
    formData.set("messageType", payload.messageType ?? "TEXT");
    if (payload.templateName) formData.set("templateName", payload.templateName);
    if (payload.templateLanguage) {
      formData.set("templateLanguage", payload.templateLanguage);
    }
    if (payload.templateVariables) {
      formData.set("templateVariables", JSON.stringify(payload.templateVariables));
    }
    if (payload.image) formData.set("image", payload.image);

    const response = await fetch("/api/campaigns", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel enviar disparo.");
      return null;
    }

    const data = (await response.json()) as { campaign: CampaignRow };
    setCampaigns((current) => [data.campaign, ...current]);
    await loadContacts(contactFilters);
    await loadConversations(conversationFilters);
    void loadDashboard(dashboardFilters);
    return data.campaign;
  }

  async function handleCreateChannel(payload: {
    name: string;
    displayPhone: string;
    phoneNumberId: string;
    wabaId: string;
    accessToken: string;
    verifyToken: string;
    appSecret: string;
  }) {
    const response = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, provider: "meta" })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel criar canal.");
      return;
    }

    await loadChannels();
    await loadChannelStatus();
    await loadMessageLogs(messageLogFilters);
  }

  async function handleUpdateChannel(
    id: string,
    payload: {
      name: string;
      type: string;
      provider: string;
      displayPhone: string;
      phoneNumberId: string;
      wabaId: string;
      accessToken: string;
      verifyToken: string;
      appSecret: string;
      status: string;
    }
  ) {
    const response = await fetch(`/api/channels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel atualizar canal.");
      return false;
    }

    setAppError("");
    await loadChannels();
    await loadChannelStatus();
    await loadMessageLogs(messageLogFilters);
    return true;
  }

  async function handleSubscribeChannelWebhook(id: string) {
    const response = await fetch(`/api/channels/${id}/subscribe-webhook`, {
      method: "POST"
    });
    const data = (await response.json().catch(() => null)) as
      | { message?: string; error?: string }
      | null;

    if (!response.ok) {
      setAppError(data?.error ?? "Nao foi possivel assinar o webhook.");
      return null;
    }

    setAppError("");
    await loadChannels();
    await loadChannelStatus();
    await loadMessageLogs(messageLogFilters);
    return data?.message ?? "Webhook assinado com sucesso.";
  }

  const loadProposals = useCallback(async (filters = proposalFilters) => {
    setProposalsLoading(true);
    setAppError("");

    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    const response = await fetch(`/api/proposals?${params.toString()}`);
    if (response.ok) {
      const data = (await response.json()) as {
        proposals: ProposalRow[];
        metrics: ProposalMetrics;
      };
      setProposals(data.proposals);
      setProposalMetrics(data.metrics);
    } else {
      setAppError("Nao foi possivel carregar propostas.");
    }

    setProposalsLoading(false);
  }, [proposalFilters]);

  const loadDashboard = useCallback(async (filters = dashboardFilters) => {
    setDashboardLoading(true);
    setAppError("");

    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    const response = await fetch(`/api/dashboard?${params.toString()}`);
    if (response.ok) {
      setDashboard((await response.json()) as DashboardData);
    } else {
      setAppError("Nao foi possivel carregar dashboard.");
    }

    setDashboardLoading(false);
  }, [dashboardFilters]);

  async function handleLogin(email: string, password: string) {
    setAppError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel entrar.");
      return;
    }

    setSession((await response.json()) as Session);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
    setContacts([]);
  }

  async function handleCreateContact(payload: {
    name: string;
    phone: string;
    email: string;
    cpf: string;
    originId: string;
    stageId: string;
    ownerId: string;
    tagIds?: string[];
    temperature: ContactRow["temperature"];
  }) {
    const response = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel criar contato.");
      return;
    }

    const data = (await response.json()) as { contact: ContactRow };
    setContacts((current) => [data.contact, ...current]);
  }

  async function handleImportContacts(payload: {
    csv: string;
    defaults: { originId: string; stageId: string; ownerId: string };
  }) {
    const response = await fetch("/api/contacts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel importar contatos.");
      return null;
    }

    const data = (await response.json()) as ImportResult;
    await loadContacts(contactFilters);
    await loadReference();
    await loadKanban();
    void loadDashboard(dashboardFilters);
    return data;
  }

  async function handleUpdateContact(
    id: string,
    payload: Partial<{
      name: string;
      phone: string;
      email: string;
      cpf: string;
      originId: string;
      stageId: string;
      ownerId: string;
      tagIds: string[];
      temperature: ContactRow["temperature"];
      lastMessage: string;
      archived: boolean;
    }>
  ) {
    const response = await fetch(`/api/contacts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel atualizar contato.");
      return null;
    }

    const data = (await response.json()) as { contact: ContactRow };
    setContacts((current) =>
      current.map((contact) => (contact.id === id ? data.contact : contact))
    );
    return data.contact;
  }

  async function handleArchiveContact(id: string) {
    const response = await fetch(`/api/contacts/${id}`, { method: "DELETE" });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel arquivar contato.");
      return;
    }

    setContacts((current) => current.filter((contact) => contact.id !== id));
    setKanbanStages((current) =>
      current.map((stage) => ({
        ...stage,
        contacts: stage.contacts.filter((contact) => contact.id !== id)
      }))
    );
  }

  async function handleBulkContacts(payload: {
    contactIds: string[];
    ownerId?: string;
    stageId?: string;
    tagId?: string;
    archived?: boolean;
  }) {
    const response = await fetch("/api/contacts/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel aplicar acao em massa.");
      return;
    }

    await loadContacts(contactFilters);
    await loadKanban();
    void loadDashboard(dashboardFilters);
  }

  async function handleCreateContactNote(contactId: string, detail: string) {
    const response = await fetch(`/api/contacts/${contactId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ detail })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel salvar anotacao.");
      return null;
    }

    const data = (await response.json()) as { activity: ContactActivityRow };
    return data.activity;
  }

  async function handleCreateTask(payload: {
    contactId: string;
    assigneeId: string;
    title: string;
    note: string;
    dueAt: string;
  }) {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel criar tarefa.");
      return null;
    }

    const data = (await response.json()) as { task: TaskRow };
    void loadDashboard(dashboardFilters);
    return data.task;
  }

  async function handleCompleteTask(taskId: string) {
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DONE" })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel concluir tarefa.");
      return null;
    }

    const data = (await response.json()) as { task: TaskRow };
    void loadDashboard(dashboardFilters);
    return data.task;
  }

  async function handleMoveKanbanContact(contactId: string, stageId: string) {
    const response = await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel mover o lead.");
      return;
    }

    await loadKanban();
    void loadContacts(contactFilters);
  }

  async function handleConversationStatus(
    conversationId: string,
    status: ConversationRow["status"]
  ) {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });

    if (!response.ok) {
      setAppError("Nao foi possivel atualizar status da conversa.");
      return;
    }

    const data = (await response.json()) as { conversation: ConversationRow };
    mergeConversation(data.conversation, "status-change");
    void loadConversations(conversationFilters);
  }

  async function handleSendMessage(conversationId: string, body: string) {
    const messageBody = body.trim();
    const now = new Date().toISOString();
    const conversation =
      selectedConversation?.id === conversationId
        ? selectedConversation
        : conversationList.find((item) => item.id === conversationId);

    if (!conversation || !messageBody) return;

    const optimisticConversation: ConversationRow = {
      ...conversation,
      updatedAt: now,
      unreadCount: 0,
      lastReadAt: now,
      lastMessageAt: now,
      lastMessagePreview: messageBody,
      contact: {
        ...conversation.contact,
        lastMessage: messageBody
      },
      lastMessage: {
        id: `optimistic-${now}`,
        direction: "outbound",
        body: messageBody,
        createdAt: now,
        status: "sending"
      },
      messages: [
        ...conversation.messages,
        {
          id: `optimistic-${now}`,
          direction: "outbound",
          body: messageBody,
          createdAt: now,
          status: "sending"
        }
      ]
    };

    mergeConversation(optimisticConversation, "send-message-optimistic");

    const channelId = conversation?.channel.startsWith("whatsapp:")
      ? conversation.channel.replace("whatsapp:", "")
      : null;
    const response =
      channelId && conversation?.contact.phone
        ? await fetch(`/api/channels/${channelId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId,
              to: conversation.contact.phone,
              body: messageBody
            })
          })
        : await fetch(`/api/conversations/${conversationId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: messageBody, direction: "outbound" })
          });

    if (!response.ok) {
      setAppError("Nao foi possivel enviar mensagem.");
      void refreshConversation(conversationId);
      return;
    }

    const data = (await response.json()) as { conversation: ConversationRow };
    mergeConversation(data.conversation, "send-message-response");
  }

  async function handleSendMedia(conversationId: string, file: File, caption?: string) {
    const formData = new FormData();
    formData.set("file", file);
    if (caption?.trim()) formData.set("caption", caption.trim());

    const response = await fetch(`/api/conversations/${conversationId}/messages/media`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(data?.error ?? "Nao foi possivel enviar arquivo.");
    }

    const data = (await response.json()) as { conversation: ConversationRow };
    mergeConversation(data.conversation, "send-media-response");
  }

  async function handleLoadTemplates(conversationId: string) {
    const response = await fetch(`/api/whatsapp/templates?conversationId=${conversationId}`);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(data?.error ?? "Nao foi possivel buscar templates.");
    }

    const data = (await response.json()) as { templates: WhatsAppTemplateRow[] };
    return data.templates;
  }

  async function handleSendTemplate(
    conversationId: string,
    payload: { templateName: string; language: string; variables: string[] }
  ) {
    const response = await fetch(`/api/conversations/${conversationId}/messages/template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(data?.error ?? "Nao foi possivel enviar template.");
    }

    const data = (await response.json()) as { conversation: ConversationRow };
    mergeConversation(data.conversation, "send-template-response");
  }

  async function handleAddConversationTags(conversationId: string, tagIds: string[]) {
    if (!tagIds.length) return;

    const response = await fetch(`/api/conversations/${conversationId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagIds, mode: "append" })
    });

    if (!response.ok) {
      setAppError("Nao foi possivel aplicar tag na conversa.");
      return;
    }

    const data = (await response.json()) as { conversation: ConversationRow };
    mergeConversation(data.conversation, "add-tags");
  }

  async function handleRemoveConversationTag(conversationId: string, tagId: string) {
    const response = await fetch(`/api/conversations/${conversationId}/tags/${tagId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      setAppError("Nao foi possivel remover tag da conversa.");
      return;
    }

    const data = (await response.json()) as { conversation: ConversationRow };
    mergeConversation(data.conversation, "remove-tag");
  }

  async function handleAnalyzeConversation(conversationId: string) {
    setAiLoading(true);
    setAppError("");

    const response = await fetch(`/api/conversations/${conversationId}/ai`, {
      method: "POST"
    });

    if (!response.ok) {
      setAppError("Nao foi possivel gerar analise IA.");
      setAiLoading(false);
      return;
    }

    const data = (await response.json()) as {
      analysis: AiAnalysis;
      conversation: ConversationRow;
    };

    setAiAnalysis(data.analysis);
    mergeConversation(data.conversation, "ai-analysis");
    setAiLoading(false);
  }

  async function handleConversationAiMode(
    conversationId: string,
    payload: { mode?: AiMode | null; paused?: boolean }
  ) {
    const response = await fetch(`/api/conversations/${conversationId}/ai-mode`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      setAppError("Nao foi possivel atualizar o modo da IA.");
      return;
    }

    const data = (await response.json()) as { conversation: ConversationRow };
    mergeConversation(data.conversation, "ai-mode");
  }

  async function handleSimulateInboundMessage(payload: {
    channelId: string;
    name: string;
    phone: string;
    message: string;
  }) {
    const response = await fetch("/api/channels/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel simular mensagem.");
      return;
    }

    const data = (await response.json()) as { conversation: ConversationRow };
    mergeConversation(data.conversation, "simulate-inbound");
    setConversationFilters({ search: "", status: "OPEN", tagIds: [], assignedTo: "default" });
    await loadConversations({ search: "", status: "OPEN", tagIds: [], assignedTo: "default" });
    void loadContacts(contactFilters);
  }

  async function handleCreateProposal(payload: {
    contactId: string;
    bank: string;
    agreement: string;
    product: string;
    amount: string;
    commission: string;
    status: ProposalStatus;
  }) {
    const response = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel criar proposta.");
      return;
    }

    const data = (await response.json()) as { proposal: ProposalRow };
    setProposals((current) => [data.proposal, ...current]);
    await loadProposals(proposalFilters);
    void loadDashboard(dashboardFilters);
    await loadKanban();
    void loadContacts(contactFilters);
  }

  async function handleUpdateProposal(
    id: string,
    payload: Partial<{
      bank: string;
      agreement: string;
      product: string;
      amount: string;
      commission: string;
      status: ProposalStatus;
    }>
  ) {
    const response = await fetch(`/api/proposals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel atualizar proposta.");
      return;
    }

    const data = (await response.json()) as { proposal: ProposalRow };
    setProposals((current) =>
      current.map((proposal) => (proposal.id === id ? data.proposal : proposal))
    );
    void loadProposals(proposalFilters);
    void loadDashboard(dashboardFilters);
  }

  async function handleDeleteProposal(id: string) {
    const response = await fetch(`/api/proposals/${id}`, { method: "DELETE" });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel remover proposta.");
      return;
    }

    setProposals((current) => current.filter((proposal) => proposal.id !== id));
    void loadProposals(proposalFilters);
    void loadDashboard(dashboardFilters);
    void loadContacts(contactFilters);
  }

  async function handleCreateOrigin(name: string) {
    const response = await fetch("/api/settings/origins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel criar origem.");
      return;
    }

    await refreshOperationalViews();
  }

  async function handleUpdateOrigin(id: string, name: string) {
    const response = await fetch(`/api/settings/origins/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel atualizar origem.");
      return;
    }

    await refreshOperationalViews();
  }

  async function handleDeleteOrigin(id: string) {
    const response = await fetch(`/api/settings/origins/${id}`, { method: "DELETE" });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel remover origem.");
      return;
    }

    await refreshOperationalViews();
  }

  async function handleCreateStage(payload: {
    name: string;
    color: string;
    position: number;
  }) {
    const response = await fetch("/api/settings/stages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel criar etapa.");
      return;
    }

    await refreshOperationalViews();
  }

  async function handleUpdateStage(
    id: string,
    payload: { name: string; color: string; position: number }
  ) {
    const response = await fetch(`/api/settings/stages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel atualizar etapa.");
      return;
    }

    await refreshOperationalViews();
  }

  async function handleDeleteStage(id: string) {
    const response = await fetch(`/api/settings/stages/${id}`, { method: "DELETE" });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel remover etapa.");
      return;
    }

    await refreshOperationalViews();
  }

  async function handleCreateUser(payload: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
  }) {
    const response = await fetch("/api/settings/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel criar usuario.");
      return;
    }

    await refreshOperationalViews();
  }

  async function handleUpdateUser(
    id: string,
    payload: {
      name: string;
      email: string;
      password?: string;
      role: UserRole;
    }
  ) {
    const response = await fetch(`/api/settings/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel atualizar usuario.");
      return;
    }

    await refreshOperationalViews();
  }

  async function handleDeleteUser(id: string) {
    const response = await fetch(`/api/settings/users/${id}`, { method: "DELETE" });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel remover usuario.");
      return;
    }

    await refreshOperationalViews();
  }

  async function handleCreateTag(payload: {
    name: string;
    color: string;
    textColor?: string;
    category?: string | null;
    isActive?: boolean;
  }) {
    const response = await fetch("/api/settings/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel criar tag.");
      return;
    }

    await refreshOperationalViews();
  }

  async function handleUpdateTag(
    id: string,
    payload: {
      name?: string;
      color?: string;
      textColor?: string;
      category?: string | null;
      isActive?: boolean;
    }
  ) {
    const response = await fetch(`/api/settings/tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel atualizar tag.");
      return;
    }

    await refreshOperationalViews();
  }

  async function handleDeleteTag(id: string) {
    const response = await fetch(`/api/settings/tags/${id}`, { method: "DELETE" });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel remover tag.");
      return;
    }

    await refreshOperationalViews();
  }

  function openCltSimulationFromConversation(conversation: ConversationRow) {
    setCltDraft({
      contactId: conversation.contact.id,
      cpf: conversation.contact.cpf,
      phone: conversation.contact.phone,
      name: conversation.contact.name
    });
    setActive("simulacao-clt");
  }

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    if (!session) return;
    if (!visibleNavItems.some((item) => item.id === active)) {
      setActive("atendimento");
    }
  }, [active, session, visibleNavItems]);

  useEffect(() => {
    if (!session) return;

    void loadContacts(contactFilters);
    void loadSettingsTags();
    void loadAiSettings();
    void loadReference();
    void loadAttendants();
    if (userCanManageOperation(session)) {
      void loadKanban();
      void loadRetirementLeads(retirementFilters);
    }
    if (userIsAdmin(session)) {
      void loadChannels();
      void loadChannelStatus();
      void loadMessageLogs({ channelId: "", status: "ALL", type: "ALL" });
      void loadCampaigns();
      void loadLeadAssignmentSettings();
      void loadProposals(proposalFilters);
    }
    if (userIsPlatformAdmin(session)) {
      void loadCompanies();
    }
    void loadConversations(conversationFilters);
    void loadNotifications({ silent: true });
  }, [
    contactFilters,
    conversationFilters,
    loadContacts,
    loadAiSettings,
    loadSettingsTags,
    loadConversations,
    loadAttendants,
    loadLeadAssignmentSettings,
    loadRetirementLeads,
    loadMessageLogs,
    loadNotifications,
    loadProposals,
    loadCompanies,
    proposalFilters,
    retirementFilters,
    session
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDesktopPermission(
      "Notification" in window ? window.Notification.permission : "unsupported"
    );
  }, []);

  useEffect(() => {
    if (!session || !userCanManageOperation(session)) return;

    void loadDashboard(dashboardFilters);
  }, [dashboardFilters, loadDashboard, session]);

  useEffect(() => {
    if (!session || !userCanManageOperation(session) || active !== "recem-aposentados") {
      return;
    }

    void loadRetirementLeads(retirementFilters);
  }, [active, loadRetirementLeads, retirementFilters, session]);

  useEffect(() => {
    if (!session || active !== "atendimento") return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [active, session]);

  useEffect(() => {
    if (!session || active !== "atendimento") return;

    const interval = window.setInterval(() => {
      void refreshConversation();
      void loadConversations(conversationFilters, { silent: true });
    }, 3000);

    return () => window.clearInterval(interval);
  }, [active, conversationFilters, loadConversations, refreshConversation, session]);

  useEffect(() => {
    if (!session) return;

    if (typeof window !== "undefined" && "EventSource" in window) {
      const events = new EventSource("/api/notifications/stream");

      events.addEventListener("new_inbound_message", (event) => {
        const notification = JSON.parse((event as MessageEvent).data) as NotificationRow;
        handleIncomingNotification(notification);
      });

      events.onerror = () => {
        void loadNotifications();
      };

      return () => events.close();
    }

    const interval = globalThis.setInterval(() => {
      void loadNotifications();
    }, 3000);

    return () => globalThis.clearInterval(interval);
  }, [handleIncomingNotification, loadNotifications, session]);

  useEffect(() => {
    if (!session) return;

    const interval = window.setInterval(() => {
      void loadNotifications();
    }, 30000);

    return () => window.clearInterval(interval);
  }, [loadNotifications, session]);

  if (sessionLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-paper text-ink">
        <div className="rounded border border-line bg-white p-6 shadow-soft">
          Carregando CRM...
        </div>
      </main>
    );
  }

  if (!session) {
    return <LoginScreen error={appError} onLogin={handleLogin} />;
  }

  return (
    <main
      className={clsx(
        "bg-paper text-ink",
        active === "atendimento" ? "h-[100dvh] overflow-hidden" : "min-h-screen"
      )}
    >
      <aside
        className={clsx(
          "fixed left-0 top-0 hidden h-screen flex-col border-r border-line/80 bg-white/95 backdrop-blur transition-[width] duration-300 ease-out xl:flex",
          leftSidebarCollapsed ? "w-[72px]" : "w-[264px]"
        )}
      >
        <div
          className={clsx(
            "flex h-20 shrink-0 items-center gap-3 px-5",
            leftSidebarCollapsed && "justify-center px-3"
          )}
        >
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand text-sm font-bold text-white shadow-soft">
            AI
          </div>
          {!leftSidebarCollapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
                  CRM
                </p>
                <h1 className="truncate text-[15px] font-bold text-slate-950">
                  Operacao Inteligente
                </h1>
              </div>
              <button
                type="button"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                title="Recolher menu lateral"
                onClick={() => setLeftSidebarCollapsed(true)}
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {leftSidebarCollapsed ? (
          <div className="shrink-0 px-3">
            <button
              type="button"
              className="grid h-10 w-full place-items-center rounded-2xl border border-line bg-slate-50 text-slate-500 transition hover:bg-blue-50 hover:text-brand"
              title="Expandir menu lateral"
              onClick={() => setLeftSidebarCollapsed(false)}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="mx-4 shrink-0 rounded-2xl border border-line/80 bg-slate-50/80 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Workspace
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {session.company.name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {session.company.segment ?? "Credito consignado"}
                </p>
              </div>
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
            </div>
          </div>
        )}

        <nav
          className={clsx(
            "min-h-0 flex-1 space-y-1 overflow-y-scroll pb-4 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]",
            leftSidebarCollapsed ? "mt-4 px-3" : "mt-5 px-3 pr-2"
          )}
        >
          {!leftSidebarCollapsed && (
            <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
              Navegacao
            </p>
          )}
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const itemCount =
              item.id === "atendimento"
                ? atendimentoUnread
                : "count" in item && typeof item.count === "number"
                  ? item.count
                  : 0;
            return (
              <button
                key={item.id}
                className={clsx(
                  "group relative flex h-10 w-full items-center rounded-xl text-left text-sm font-medium transition-colors",
                  leftSidebarCollapsed
                    ? "justify-center px-0"
                    : "justify-between px-3",
                  active === item.id
                    ? "bg-blue-50 text-brand shadow-[inset_0_0_0_1px_rgba(37,99,235,0.10)]"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                )}
                onClick={() => setActive(item.id)}
                title={leftSidebarCollapsed ? item.label : undefined}
              >
                <span
                  className={clsx(
                    "flex items-center",
                    leftSidebarCollapsed ? "justify-center" : "gap-3"
                  )}
                >
                  <Icon
                    className={clsx(
                      "h-4 w-4",
                      active === item.id
                        ? "text-brand"
                        : "text-slate-400 group-hover:text-slate-600"
                    )}
                  />
                  {!leftSidebarCollapsed && item.label}
                </span>
                {itemCount > 0 && (
                  <span
                    className={clsx(
                      "rounded-full bg-rose-500 text-[11px] font-bold text-white",
                      leftSidebarCollapsed
                        ? "absolute ml-7 mt-[-1.6rem] min-w-4 px-1 text-[9px]"
                        : "px-2 py-0.5"
                    )}
                  >
                    {itemCount > 99 ? "99+" : itemCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div
          className={clsx(
            "shrink-0 border-t border-line/70",
            leftSidebarCollapsed ? "space-y-2 p-3" : "space-y-3 p-4"
          )}
        >
          {userCanManageOperation(session) && (
            <button
              className={clsx(
                "flex h-10 w-full items-center rounded-xl text-left text-sm font-semibold transition-colors",
                leftSidebarCollapsed
                  ? "justify-center px-0"
                  : "gap-3 px-3",
                active === "tags"
                  ? "bg-blue-50 text-brand shadow-[inset_0_0_0_1px_rgba(37,99,235,0.10)]"
                  : "bg-white text-slate-600 ring-1 ring-line hover:bg-slate-50 hover:text-slate-950"
              )}
              onClick={() => setActive("tags")}
              type="button"
              title={leftSidebarCollapsed ? "Gerenciar tags" : undefined}
            >
              <Tags className={clsx("h-4 w-4", active === "tags" ? "text-brand" : "text-slate-400")} />
              {!leftSidebarCollapsed && "Gerenciar tags"}
            </button>
          )}
          <div
            className={clsx(
              "rounded-2xl bg-gradient-to-br from-blue-50 to-white ring-1 ring-blue-100",
              leftSidebarCollapsed ? "grid h-10 place-items-center p-0" : "p-3"
            )}
            title={leftSidebarCollapsed ? "IA ativa" : undefined}
          >
            <div className={clsx("flex items-center", leftSidebarCollapsed ? "justify-center" : "gap-2")}>
              <Sparkles className="h-4 w-4 text-brand" />
              {!leftSidebarCollapsed && (
                <p className="text-xs font-bold uppercase tracking-wide text-brand">
                  IA ativa
                </p>
              )}
            </div>
            {!leftSidebarCollapsed && (
              <p className="mt-2 text-sm leading-5 text-slate-600">
                Correspondente bancario com foco em FGTS, CLT e INSS.
              </p>
            )}
          </div>
          <div
            className={clsx(
              "flex items-center rounded-2xl hover:bg-slate-50",
              leftSidebarCollapsed ? "justify-center p-0" : "gap-3 p-2"
            )}
            title={leftSidebarCollapsed ? `${session.user.name} - ${session.user.role}` : undefined}
          >
            <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">
              {session.user.name.slice(0, 1).toUpperCase()}
            </div>
            {!leftSidebarCollapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {session.user.name}
                </p>
                <p className="truncate text-xs text-slate-500">{session.user.role}</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      <section
        className={clsx(
          "transition-[padding-left] duration-300 ease-out",
          active === "atendimento" && "flex h-[100dvh] flex-col overflow-hidden",
          leftSidebarCollapsed ? "xl:pl-[72px]" : "xl:pl-[264px]"
        )}
      >
        <header className="sticky top-0 z-10 flex min-h-20 shrink-0 items-center justify-between border-b border-line/70 bg-white/90 px-4 backdrop-blur-xl md:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <button className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-white text-slate-600 shadow-sm xl:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Base inicial</span>
                <span>/</span>
                <span className="font-medium text-slate-700">{pageTitle}</span>
              </div>
              <h2 className="truncate text-xl font-bold tracking-tight text-slate-950 md:text-2xl">
                {pageTitle}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <AttendantStatusToggle
              value={myAvailability}
              onChange={(status) => void updateMyAvailability(status)}
            />
            <div className="hidden h-10 w-[min(26vw,360px)] items-center gap-2 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-500 ring-0 focus-within:border-blue-200 focus-within:bg-white focus-within:shadow-soft lg:flex">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                className="w-full bg-transparent outline-none"
                placeholder="Buscar cliente, telefone ou conversa"
              />
              <kbd className="rounded-md border border-line bg-white px-1.5 py-0.5 text-[10px] text-slate-400">
                ⌘K
              </kbd>
            </div>
            <div className="relative">
              <button
                className="relative grid h-10 w-10 place-items-center rounded-full border border-line bg-white text-slate-600 shadow-sm hover:-translate-y-0.5 hover:shadow-soft"
                onClick={() => setNotificationsOpen((current) => !current)}
                title="Notificacoes"
              >
                <Bell className="h-4 w-4" />
                {unreadNotifications > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white ring-2 ring-white">
                    {unreadNotifications > 99 ? "99+" : unreadNotifications}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <div className="absolute right-0 top-12 z-30 w-[min(22rem,calc(100vw-2rem))] rounded border border-line bg-white shadow-soft">
                  <div className="flex items-center justify-between border-b border-line p-3">
                    <div>
                      <p className="text-sm font-bold">Notificacoes</p>
                      <p className="text-xs text-slate-500">
                        {unreadNotifications} nao lida(s)
                      </p>
                    </div>
                    <button
                      className="rounded border border-line px-2 py-1 text-xs font-semibold text-slate-600"
                      onClick={() => void markNotificationsRead({ all: true })}
                    >
                      Marcar todas
                    </button>
                  </div>
                  {desktopPermission !== "granted" && (
                    <div className="border-b border-line p-3">
                      <button
                        className="w-full rounded bg-brand px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                        disabled={desktopPermission === "denied" || desktopPermission === "unsupported"}
                        onClick={requestDesktopNotifications}
                      >
                        {desktopPermission === "denied"
                          ? "Notificacoes bloqueadas no navegador"
                          : desktopPermission === "unsupported"
                            ? "Navegador sem notificacoes desktop"
                            : "Ativar notificacoes no computador"}
                      </button>
                    </div>
                  )}
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.length === 0 && (
                      <p className="p-4 text-sm text-slate-500">
                        Nenhuma notificacao recebida ainda.
                      </p>
                    )}
                    {notifications.map((notification) => (
                      <button
                        key={notification.id}
                        className={clsx(
                          "block w-full border-b border-line p-3 text-left text-sm last:border-b-0 hover:bg-slate-50",
                          !notification.readAt && "bg-teal-50"
                        )}
                        onClick={() => {
                          setNotificationsOpen(false);
                          void openConversationById(notification.conversationId);
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-900">
                              {notification.customerName || notification.phone || "Cliente"}
                            </p>
                            <p className="text-xs text-slate-500">
                              {notification.phone || "Sem telefone"} - {notification.channelLabel || "WhatsApp"}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs text-slate-400">
                            {formatRelativeDate(notification.createdAt)}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-slate-600">
                          {notification.message}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              className="hidden h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-soft hover:-translate-y-0.5 hover:bg-blue-700 md:flex"
              onClick={() => {
                setNewConversationError("");
                setNewConversationOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Nova conversa
            </button>
            <button className="hidden h-10 items-center gap-2 rounded-full border border-line bg-white px-2.5 text-sm font-semibold text-slate-700 shadow-sm md:flex">
              <div className="grid h-7 w-7 place-items-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                {session.user.name.slice(0, 1).toUpperCase()}
              </div>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>
            <button
              className="hidden h-10 rounded-full border border-line bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50 md:block"
              onClick={handleLogout}
            >
              Sair
            </button>
          </div>
        </header>

        <div
          className={clsx(
            active === "atendimento"
              ? "flex min-h-0 flex-1 flex-col overflow-hidden p-2 md:p-3"
              : "p-4 md:p-8"
          )}
        >
          {appError && (
            <div className="mb-3 shrink-0 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {appError}
            </div>
          )}
          {active === "dashboard" && (
            <Dashboard
              data={dashboard}
              filters={dashboardFilters}
              loading={dashboardLoading}
              reference={reference}
              onFiltersChange={setDashboardFilters}
              onCompleteTask={handleCompleteTask}
            />
          )}
          {active === "atendimento" && (
            <div className="min-h-0 flex-1 overflow-hidden">
              <Atendimento
                conversations={conversationList}
                statusCounts={conversationStatusCounts}
                filters={conversationFilters}
                availableTags={reference.tags}
                attendants={attendants}
                currentUserId={session.user.id}
                isAdmin={userCanManageOperation(session)}
                loading={conversationLoading}
                selectedConversation={selectedConversation}
                onFiltersChange={setConversationFilters}
                onSelectConversation={(conversation) => void handleSelectConversation(conversation)}
                onAssignConversation={handleAssignConversation}
                onUnassignConversation={handleUnassignConversation}
                onTransferConversation={handleTransferConversation}
                onSendMessage={handleSendMessage}
                onSendMedia={handleSendMedia}
                onLoadTemplates={handleLoadTemplates}
                onSendTemplate={handleSendTemplate}
                onUpdateStatus={handleConversationStatus}
                aiAnalysis={aiAnalysis}
                aiLoading={aiLoading}
                aiSettings={aiSettings}
                onAnalyzeConversation={handleAnalyzeConversation}
                onUpdateConversationAiMode={handleConversationAiMode}
                onAddTags={handleAddConversationTags}
                onRemoveTag={handleRemoveConversationTag}
                onOpenCltSimulation={openCltSimulationFromConversation}
              />
            </div>
          )}
          {active === "kanban" && (
            <Kanban
              loading={kanbanLoading}
              stages={kanbanStages}
              onMoveContact={handleMoveKanbanContact}
            />
          )}
          {active === "contatos" && (
            <Contatos
              contacts={contacts}
              loading={contactsLoading}
              filters={contactFilters}
              reference={reference}
              onFiltersChange={setContactFilters}
              onCreateContact={handleCreateContact}
              onImportContacts={handleImportContacts}
              onBulkContacts={handleBulkContacts}
              onCreateContactNote={handleCreateContactNote}
              onCreateTask={handleCreateTask}
              onCompleteTask={handleCompleteTask}
              onUpdateContact={handleUpdateContact}
              onArchiveContact={handleArchiveContact}
            />
          )}
          {active === "simulacao-clt" && (
            <SimulacaoClt
              contacts={contacts}
              initialDraft={cltDraft}
              onProposalCreated={async () => {
                await loadContacts(contactFilters);
                await loadProposals(proposalFilters);
                await loadDashboard(dashboardFilters);
              }}
            />
          )}
          {active === "multicred" && userIsAdmin(session) && (
            <Multicred
              contacts={contacts}
              filters={proposalFilters}
              loading={proposalsLoading}
              metrics={proposalMetrics}
              proposals={proposals}
              onCreateProposal={handleCreateProposal}
              onDeleteProposal={handleDeleteProposal}
              onFiltersChange={setProposalFilters}
              onUpdateProposal={handleUpdateProposal}
            />
          )}
          {active === "canais" && userIsAdmin(session) && (
            <Canais
              channels={channels}
              channelStatus={channelStatus}
              messageLogs={messageLogs}
              messageLogFilters={messageLogFilters}
              loading={channelsLoading}
              statusLoading={channelStatusLoading}
              logsLoading={messageLogsLoading}
              onCreateChannel={handleCreateChannel}
              onUpdateChannel={handleUpdateChannel}
              onSubscribeChannelWebhook={handleSubscribeChannelWebhook}
              onRefreshStatus={loadChannelStatus}
              onMessageLogFiltersChange={(filters) => {
                setMessageLogFilters(filters);
                void loadMessageLogs(filters);
              }}
              onRefreshLogs={() => loadMessageLogs(messageLogFilters)}
              onSimulateInbound={handleSimulateInboundMessage}
            />
          )}
          {active === "disparos" && userIsAdmin(session) && (
            <Disparos
              campaigns={campaigns}
              channels={channels}
              contacts={contacts}
              loading={campaignsLoading}
              onCreateCampaign={handleCreateCampaign}
              onRefreshCampaigns={loadCampaigns}
            />
          )}
          {active === "recem-aposentados" && userCanManageOperation(session) && (
            <RecemAposentados
              leads={retirementLeads}
              dashboard={retirementDashboard}
              pagination={retirementPagination}
              filters={retirementFilters}
              loading={retirementLoading}
              selectedLead={selectedRetirementLead}
              onFiltersChange={setRetirementFilters}
              onSelectLead={setSelectedRetirementLead}
              onUpdateLead={updateRetirementLead}
              onCreateEvent={createRetirementLeadEvent}
            />
          )}
          {active === "empresas" && userIsPlatformAdmin(session) && (
            <EmpresasPage
              companies={companies}
              loading={companiesLoading}
              onCreateCompany={handleCreateCompanyTenant}
              onRefresh={loadCompanies}
            />
          )}
          {active === "chatbot" && userIsAdmin(session) && <Chatbot />}
          {active === "tags" && (
            <TagsSettingsPage
              tags={settingsTags}
              loading={tagsLoading}
              onCreateTag={handleCreateTag}
              onUpdateTag={handleUpdateTag}
              onDeleteTag={handleDeleteTag}
            />
          )}
          {active === "config" && userIsAdmin(session) && (
            <Configuracoes
              reference={reference}
              attendants={attendants}
              aiSettings={aiSettings}
              leadAssignmentSettings={leadAssignmentSettings}
              onSaveAiSettings={saveAiSettings}
              onSaveLeadAssignmentSettings={saveLeadAssignmentSettings}
              onUpdateAttendantStatus={updateAttendantStatus}
              onCreateOrigin={handleCreateOrigin}
              onCreateStage={handleCreateStage}
              onCreateTag={handleCreateTag}
              onCreateUser={handleCreateUser}
              onDeleteOrigin={handleDeleteOrigin}
              onDeleteStage={handleDeleteStage}
              onDeleteTag={handleDeleteTag}
              onDeleteUser={handleDeleteUser}
              onUpdateOrigin={handleUpdateOrigin}
              onUpdateStage={handleUpdateStage}
              onUpdateTag={handleUpdateTag}
              onUpdateUser={handleUpdateUser}
            />
          )}
        </div>
      </section>
      {newConversationOpen && (
        <NewConversationModal
          contacts={contacts}
          form={newConversationForm}
          saving={newConversationSaving}
          error={newConversationError}
          onClose={() => {
            if (!newConversationSaving) setNewConversationOpen(false);
          }}
          onChange={setNewConversationForm}
          onSubmit={() => void handleStartNewConversation()}
        />
      )}
    </main>
  );
}

function NewConversationModal({
  contacts,
  form,
  saving,
  error,
  onClose,
  onChange,
  onSubmit
}: {
  contacts: ContactRow[];
  form: { search: string; contactId: string; name: string; phone: string; cpf: string };
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (form: {
    search: string;
    contactId: string;
    name: string;
    phone: string;
    cpf: string;
  }) => void;
  onSubmit: () => void;
}) {
  const normalizedSearch = form.search.trim().toLowerCase();
  const filteredContacts = contacts
    .filter((contact) => {
      if (!normalizedSearch) return true;
      return [contact.name, contact.phone, contact.cpf ?? "", contact.email ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    })
    .slice(0, 6);

  const selectedContact = contacts.find((contact) => contact.id === form.contactId);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-[1.5rem] border border-line bg-white shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-line/70 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
              Atendimento
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-950">
              Iniciar nova conversa
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Escolha um contato existente ou informe um novo cliente.
            </p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-slate-500 hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {error && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {error}
            </div>
          )}

          <div>
            <label className="text-sm font-semibold text-slate-800">
              Buscar contato existente
            </label>
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-line bg-slate-50 px-3 py-2 focus-within:border-blue-200 focus-within:bg-white">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                className="w-full bg-transparent text-sm outline-none"
                placeholder="Nome, telefone, CPF ou email"
                value={form.search}
                onChange={(event) =>
                  onChange({ ...form, search: event.target.value, contactId: "" })
                }
              />
            </div>
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
              {filteredContacts.map((contact) => {
                const selected = contact.id === form.contactId;
                return (
                  <button
                    key={contact.id}
                    className={clsx(
                      "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors",
                      selected
                        ? "border-blue-200 bg-blue-50"
                        : "border-line bg-white hover:bg-slate-50"
                    )}
                    onClick={() =>
                      onChange({
                        ...form,
                        contactId: selected ? "" : contact.id,
                        name: selected ? form.name : contact.name,
                        phone: selected ? form.phone : contact.phone,
                        cpf: selected ? form.cpf : contact.cpf ?? ""
                      })
                    }
                    type="button"
                  >
                    <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                      {contact.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-950">
                        {contact.name}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {[contact.phone, contact.cpf ? `CPF: ${formatCpf(contact.cpf)}` : null, contact.origin]
                          .filter(Boolean)
                          .join(" - ")}
                      </p>
                    </div>
                    {selected && <Check className="h-4 w-4 text-brand" />}
                  </button>
                );
              })}
              {filteredContacts.length === 0 && (
                <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
                  Nenhum contato encontrado. Preencha os dados abaixo para criar.
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm font-semibold text-slate-800">
              Nome do cliente
              <input
                className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm outline-none focus:border-blue-200"
                disabled={Boolean(selectedContact)}
                placeholder="Ex: Maria Silva"
                value={form.name}
                onChange={(event) =>
                  onChange({ ...form, name: event.target.value, contactId: "" })
                }
              />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              WhatsApp
              <input
                className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm outline-none focus:border-blue-200"
                disabled={Boolean(selectedContact)}
                placeholder="Ex: 5533999999999"
                value={form.phone}
                onChange={(event) =>
                  onChange({ ...form, phone: event.target.value, contactId: "" })
                }
              />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              CPF do cliente
              <input
                className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm outline-none focus:border-blue-200"
                placeholder="Ex: 000.000.000-00"
                value={form.cpf}
                onChange={(event) =>
                  onChange({ ...form, cpf: event.target.value })
                }
              />
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line/70 bg-slate-50 px-5 py-4">
          <button
            className="h-10 rounded-full border border-line bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-soft disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={saving}
            onClick={onSubmit}
            type="button"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Iniciar conversa
          </button>
        </div>
      </div>
    </div>
  );
}

function TransferConversationModal({
  conversation,
  attendants,
  error,
  saving,
  onClose,
  onSubmit
}: {
  conversation: ConversationRow;
  attendants: AttendantRow[];
  error: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (userId: string) => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState(
    attendants.find((attendant) => attendant.id !== conversation.agent?.id)?.id ?? ""
  );

  useEffect(() => {
    setSelectedUserId(
      attendants.find((attendant) => attendant.id !== conversation.agent?.id)?.id ?? ""
    );
  }, [attendants, conversation.agent?.id, conversation.id]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-[1.5rem] border border-line bg-white shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-line/70 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
              Transferencia
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-950">
              Transferir atendimento
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Escolha quem sera responsavel por {conversation.contact.name}.
            </p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-slate-500 hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          {error && (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
              {error}
            </div>
          )}

          <div className="rounded-2xl border border-line bg-slate-50 p-3 text-sm">
            <p className="font-bold text-slate-900">{conversation.contact.name}</p>
            <p className="text-slate-500">{conversation.contact.phone}</p>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              Atual: {conversation.agent?.name ?? "Sem responsavel"}
            </p>
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {attendants.length === 0 && (
              <p className="rounded-2xl border border-line bg-white p-4 text-sm text-slate-500">
                Nenhum atendente disponivel para transferir.
              </p>
            )}
            {attendants.map((attendant) => {
              const current = attendant.id === conversation.agent?.id;
              const selected = attendant.id === selectedUserId;
              return (
                <button
                  key={attendant.id}
                  className={clsx(
                    "flex w-full items-center justify-between gap-3 rounded-2xl border p-3 text-left transition-colors",
                    selected
                      ? "border-blue-200 bg-blue-50"
                      : "border-line bg-white hover:bg-slate-50",
                    current && "cursor-not-allowed opacity-55"
                  )}
                  disabled={current}
                  onClick={() => setSelectedUserId(attendant.id)}
                  type="button"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-950">{attendant.name}</p>
                    <p className="truncate text-xs text-slate-500">{attendant.email}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-[11px] font-bold",
                        attendant.availabilityStatus === "ONLINE"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      )}
                    >
                      {attendant.availabilityStatus}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                      {attendant.openConversations}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line/70 p-5">
          <button
            className="h-10 rounded-full border border-line bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!selectedUserId || saving}
            onClick={() => onSubmit(selectedUserId)}
            type="button"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Transferir
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmUnassignModal({
  conversation,
  saving,
  onClose,
  onConfirm
}: {
  conversation: ConversationRow;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-[1.5rem] border border-line bg-white shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-line/70 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-600">
              Devolver para fila
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-950">
              Remover responsavel?
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {conversation.contact.name} voltara para a fila sem responsavel.
            </p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-slate-500 hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 p-5">
          <button
            className="h-10 rounded-full border border-line bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-full bg-amber-500 px-4 text-sm font-bold text-white shadow-sm hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving}
            onClick={onConfirm}
            type="button"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar devolucao
          </button>
        </div>
      </div>
    </div>
  );
}

function AttendantStatusToggle({
  value,
  onChange
}: {
  value: AvailabilityStatus;
  onChange: (status: AvailabilityStatus) => void;
}) {
  const colors: Record<AvailabilityStatus, string> = {
    ONLINE: "bg-emerald-500",
    BUSY: "bg-amber-500",
    OFFLINE: "bg-slate-400",
    PAUSED: "bg-rose-500"
  };

  return (
    <label className="hidden h-10 items-center gap-2 rounded-full border border-line bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm md:flex">
      <span className={clsx("h-2 w-2 rounded-full", colors[value])} />
      <select
        className="bg-transparent outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value as AvailabilityStatus)}
        title="Disponibilidade"
      >
        <option value="ONLINE">Disponivel</option>
        <option value="BUSY">Ocupado</option>
        <option value="PAUSED">Pausado</option>
        <option value="OFFLINE">Indisponivel</option>
      </select>
    </label>
  );
}

function LoginScreen({
  error,
  onLogin
}: {
  error: string;
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("admin@crm.local");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    await onLogin(email, password);
    setLoading(false);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-paper p-4 text-ink">
      <form
        className="w-full max-w-md rounded border border-line bg-white p-6 shadow-soft"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded bg-brand text-base font-bold text-white">
            AI
          </div>
          <div>
            <p className="text-sm font-semibold uppercase text-brand">CRM</p>
            <h1 className="text-xl font-bold">Entrar na operacao</h1>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block text-sm font-semibold">
            Email
            <input
              className="mt-2 h-11 w-full rounded border border-line px-3 font-normal outline-none focus:border-brand"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@crm.local"
              type="email"
            />
          </label>
          <label className="block text-sm font-semibold">
            Senha
            <input
              className="mt-2 h-11 w-full rounded border border-line px-3 font-normal outline-none focus:border-brand"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Digite sua senha"
              type="password"
            />
          </label>
        </div>

        {error && (
          <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {error}
          </div>
        )}

        <button
          className="mt-6 h-11 w-full rounded bg-brand font-semibold text-white disabled:opacity-60"
          disabled={loading}
          type="submit"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <p className="mt-4 text-sm text-slate-500">
          Use o usuario administrador criado para sua empresa.
        </p>
      </form>
    </main>
  );
}

function Dashboard({
  data,
  filters,
  loading,
  reference,
  onFiltersChange,
  onCompleteTask
}: {
  data: DashboardData;
  filters: { period: string; originId: string; ownerId: string };
  loading: boolean;
  reference: ReferenceData;
  onFiltersChange: (filters: {
    period: string;
    originId: string;
    ownerId: string;
  }) => void;
  onCompleteTask: (taskId: string) => Promise<TaskRow | null>;
}) {
  const maxFunnel = Math.max(...data.funnel.map((item) => item.count), 1);
  const maxStatus = Math.max(...data.proposalStatus.map((item) => item.count), 1);
  const cards = [
    {
      label: "Conversas abertas",
      value: data.metrics.openConversations.toString(),
      hint: `${data.metrics.staleConversations} aguardando ha mais de 4h`,
      trend: "+12%",
      icon: MessageCircle,
      tone: "blue"
    },
    {
      label: "Leads ativos",
      value: data.metrics.activeContacts.toString(),
      hint: `${data.metrics.newContacts} novo(s) no periodo`,
      trend: "+8%",
      icon: UserRound,
      tone: "slate"
    },
    {
      label: "Propostas",
      value: data.metrics.proposals.toString(),
      hint: formatCurrency(data.metrics.totalProposalAmount),
      trend: "+4%",
      icon: CircleDollarSign,
      tone: "emerald"
    },
    {
      label: "Conversao",
      value: `${data.metrics.conversionRate}%`,
      hint: `${data.metrics.paidProposals} proposta(s) paga(s)`,
      trend: "estavel",
      icon: Activity,
      tone: "violet"
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-[1.35rem] border border-line/80 bg-white p-5 shadow-soft md:flex-row md:items-center md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
            <Sparkles className="h-3.5 w-3.5" />
            Visao de gestao
          </div>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">
            Dashboard operacional
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Indicadores principais, prioridades e funil comercial em tempo real.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <select
            className="h-10 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-700 outline-none hover:bg-white focus:border-blue-200 focus:bg-white focus:shadow-soft"
            value={filters.period}
            onChange={(event) =>
              onFiltersChange({ ...filters, period: event.target.value })
            }
          >
            <option value="7d">Ultimos 7 dias</option>
            <option value="30d">Ultimos 30 dias</option>
            <option value="90d">Ultimos 90 dias</option>
            <option value="all">Todo periodo</option>
          </select>
          <select
            className="h-10 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-700 outline-none hover:bg-white focus:border-blue-200 focus:bg-white focus:shadow-soft"
            value={filters.originId}
            onChange={(event) =>
              onFiltersChange({ ...filters, originId: event.target.value })
            }
          >
            <option value="">Todas as origens</option>
            {reference.origins.map((origin) => (
              <option key={origin.id} value={origin.id}>
                {origin.name}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-700 outline-none hover:bg-white focus:border-blue-200 focus:bg-white focus:shadow-soft"
            value={filters.ownerId}
            onChange={(event) =>
              onFiltersChange({ ...filters, ownerId: event.target.value })
            }
          >
            <option value="">Todos os responsaveis</option>
            {reference.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <div className="rounded-[1.35rem] border border-line/80 bg-white p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-950">Prioridades do dia</h3>
              <p className="text-sm text-slate-500">Fila inteligente para evitar perda de lead.</p>
            </div>
            <span className="flex h-9 items-center gap-2 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-600">
              <Filter className="h-4 w-4" />
              {loading ? "Atualizando" : `${data.priorities.length} item(ns)`}
            </span>
          </div>
          <div className="divide-y divide-line/70">
            {data.priorities.map((item) => (
              <PriorityItem
                key={`${item.type}-${item.id}`}
                item={item}
              />
            ))}
            {!loading && data.priorities.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line p-6 text-sm text-slate-500">
                Nenhuma prioridade critica no filtro atual.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-[1.35rem] border border-line/80 bg-white p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-950">Minhas tarefas</h3>
                <p className="text-sm text-slate-500">{data.tasks.length} pendente(s)</p>
              </div>
              <MoreHorizontal className="h-5 w-5 text-slate-400" />
            </div>
            <div className="mt-5 space-y-3">
              {data.tasks.map((task) => {
                const overdue = new Date(task.dueAt).getTime() < Date.now();
                return (
                  <div key={task.id} className="rounded-2xl border border-line/80 bg-slate-50/60 p-3 text-sm hover:bg-white hover:shadow-soft">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-950">{task.title}</p>
                        <p className="mt-1 text-slate-600">{task.contact.name}</p>
                        <p
                          className={clsx(
                            "mt-1 text-xs",
                            overdue ? "text-rose-600" : "text-slate-500"
                          )}
                        >
                          {new Date(task.dueAt).toLocaleString("pt-BR")}
                        </p>
                      </div>
                      <button
                        className="grid h-8 w-8 place-items-center rounded-full border border-line bg-white text-brand hover:border-blue-200 hover:bg-blue-50"
                        onClick={() => void onCompleteTask(task.id)}
                        title="Concluir tarefa"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {!loading && data.tasks.length === 0 && (
                <p className="text-sm text-slate-500">Nenhuma tarefa pendente.</p>
              )}
            </div>
          </section>

          <PipelineCard
            title="Funil de leads"
            subtitle={`${data.metrics.hotContacts} quente(s)`}
            empty="Sem leads no filtro atual."
            loading={loading}
          >
            {data.funnel.map((item) => (
              <div key={item.id} className="group">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">{item.label}</span>
                  <strong className="text-slate-950">{item.count}</strong>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-2.5 rounded-full transition-all duration-500 group-hover:brightness-95"
                    style={{
                      width: `${Math.max(6, (item.count / maxFunnel) * 100)}%`,
                      backgroundColor: item.color
                    }}
                  />
                </div>
              </div>
            ))}
          </PipelineCard>

          <PipelineCard
            title="Status Multicred"
            subtitle={formatCurrency(data.metrics.commissionForecast)}
            empty="Sem propostas no filtro atual."
            loading={loading}
          >
            {data.proposalStatus.map((item) => (
              <div key={item.status} className="group">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">
                    {proposalStatusLabels[item.status] ?? item.status}
                  </span>
                  <strong className="text-slate-950">{item.count}</strong>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-2.5 rounded-full bg-brand transition-all duration-500 group-hover:bg-blue-700"
                    style={{ width: `${Math.max(6, (item.count / maxStatus) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </PipelineCard>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  trend,
  icon: Icon,
  tone
}: {
  label: string;
  value: string;
  hint: string;
  trend: string;
  icon: typeof MessageCircle;
  tone: string;
}) {
  const toneClass =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-600 ring-emerald-100"
      : tone === "violet"
        ? "bg-violet-50 text-violet-600 ring-violet-100"
        : tone === "slate"
          ? "bg-slate-100 text-slate-600 ring-slate-200"
          : "bg-blue-50 text-brand ring-blue-100";

  return (
    <div className="group rounded-[1.35rem] border border-line/80 bg-white p-5 shadow-soft hover:-translate-y-0.5 hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <strong className="mt-3 block text-3xl font-bold tracking-tight text-slate-950">
            {value}
          </strong>
        </div>
        <div className={clsx("grid h-10 w-10 place-items-center rounded-2xl ring-1", toneClass)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
          <TrendingUp className="h-3.5 w-3.5" />
          {trend}
        </span>
        <span className="truncate text-xs text-slate-500">{hint}</span>
      </div>
    </div>
  );
}

function PriorityItem({
  item
}: {
  item: DashboardData["priorities"][number];
}) {
  const initials = item.title
    .split(" ")
    .map((part) => part.slice(0, 1))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <button className="grid w-full gap-3 py-4 text-left hover:bg-slate-50/70 md:grid-cols-[auto_1fr_auto]">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">
        {initials || "LD"}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-950">{item.title}</p>
          <span
            className={clsx(
              "rounded-full px-2 py-0.5 text-xs font-semibold",
              item.severity === "high"
                ? "bg-rose-50 text-rose-700"
                : "bg-amber-50 text-amber-700"
            )}
          >
            {item.severity === "high" ? "Alta prioridade" : "Media prioridade"}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            {item.type}
          </span>
        </div>
        <p className="mt-1 line-clamp-1 text-sm text-slate-600">{item.detail}</p>
        <p className="mt-2 text-xs text-slate-400">{item.meta}</p>
      </div>
      <div className="flex items-center gap-2 self-center text-sm font-semibold text-brand">
        Abrir
        <ArrowRight className="h-4 w-4" />
      </div>
    </button>
  );
}

function PipelineCard({
  title,
  subtitle,
  empty,
  loading,
  children
}: {
  title: string;
  subtitle: string;
  empty: string;
  loading: boolean;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <section className="rounded-[1.35rem] border border-line/80 bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-950">{title}</h3>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <Activity className="h-5 w-5 text-slate-400" />
      </div>
      <div className="mt-5 space-y-4">
        {children}
        {!loading && !hasChildren && <p className="text-sm text-slate-500">{empty}</p>}
      </div>
    </section>
  );
}

function Atendimento({
  conversations,
  statusCounts,
  filters,
  availableTags,
  attendants,
  currentUserId,
  isAdmin,
  loading,
  selectedConversation,
  onFiltersChange,
  onSelectConversation,
  onAssignConversation,
  onUnassignConversation,
  onTransferConversation,
  onSendMessage,
  onSendMedia,
  onLoadTemplates,
  onSendTemplate,
  onUpdateStatus,
  aiAnalysis,
  aiLoading,
  aiSettings,
  onAnalyzeConversation,
  onUpdateConversationAiMode,
  onAddTags,
  onRemoveTag,
  onOpenCltSimulation
}: {
  conversations: ConversationRow[];
  statusCounts: ConversationStatusCounts;
  filters: { search: string; status: string; tagIds: string[]; assignedTo: string };
  availableTags: ReferenceData["tags"];
  attendants: AttendantRow[];
  currentUserId: string;
  isAdmin: boolean;
  loading: boolean;
  selectedConversation: ConversationRow | null;
  onFiltersChange: (filters: { search: string; status: string; tagIds: string[]; assignedTo: string }) => void;
  onSelectConversation: (conversation: ConversationRow) => void;
  onAssignConversation: (conversationId: string, userId?: string) => Promise<void>;
  onUnassignConversation: (conversationId: string) => Promise<void>;
  onTransferConversation: (conversationId: string, userId: string) => Promise<void>;
  onSendMessage: (conversationId: string, body: string) => Promise<void>;
  onSendMedia: (conversationId: string, file: File, caption?: string) => Promise<void>;
  onLoadTemplates: (conversationId: string) => Promise<WhatsAppTemplateRow[]>;
  onSendTemplate: (
    conversationId: string,
    payload: { templateName: string; language: string; variables: string[] }
  ) => Promise<void>;
  onUpdateStatus: (
    conversationId: string,
    status: ConversationRow["status"]
  ) => Promise<void>;
  aiAnalysis: AiAnalysis | null;
  aiLoading: boolean;
  aiSettings: AiSettings;
  onAnalyzeConversation: (conversationId: string) => Promise<void>;
  onUpdateConversationAiMode: (
    conversationId: string,
    payload: { mode?: AiMode | null; paused?: boolean }
  ) => Promise<void>;
  onAddTags: (conversationId: string, tagIds: string[]) => Promise<void>;
  onRemoveTag: (conversationId: string, tagId: string) => Promise<void>;
  onOpenCltSimulation: (conversation: ConversationRow) => void;
}) {
  const [message, setMessage] = useState("");
  const [composerError, setComposerError] = useState("");
  const [sendingAttachment, setSendingAttachment] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplateRow[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplateRow | null>(null);
  const [templateValues, setTemplateValues] = useState<string[]>([]);
  const [filePreview, setFilePreview] = useState<{ file: File; url?: string } | null>(null);
  const [audioPreview, setAudioPreview] = useState<{ file: File; url: string } | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [assigningConversationId, setAssigningConversationId] = useState<string | null>(null);
  const [unassignOpen, setUnassignOpen] = useState(false);
  const [unassignSaving, setUnassignSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [aiSidebarCollapsed, setAiSidebarCollapsed] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [selectedConversation?.id, selectedConversation?.messages.length]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("crm.aiSidebarCollapsed");
    if (stored === "true" || stored === "false") {
      setAiSidebarCollapsed(stored === "true");
      return;
    }
    setAiSidebarCollapsed(window.innerWidth < 1280);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("crm.aiSidebarCollapsed", String(aiSidebarCollapsed));
  }, [aiSidebarCollapsed]);

  useEffect(() => {
    return () => {
      clearRecordingTimer();
      if (filePreview?.url) URL.revokeObjectURL(filePreview.url);
      if (audioPreview?.url) URL.revokeObjectURL(audioPreview.url);
    };
  }, [audioPreview?.url, filePreview?.url]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConversation || !message.trim()) return;

    await onSendMessage(selectedConversation.id, message);
    setMessage("");
  }

  function insertEmoji(emoji: string) {
    setMessage((current) => `${current}${emoji}`);
    setEmojiOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  async function startRecording() {
    setComposerError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setComposerError("Este navegador nao suporta gravacao de audio.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = [
        "audio/ogg;codecs=opus",
        "audio/webm;codecs=opus",
        "audio/webm"
      ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
      const recorder = new MediaRecorder(
        stream,
        preferredMimeType ? { mimeType: preferredMimeType } : undefined
      );
      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        clearRecordingTimer();
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm"
        });
        const baseMimeType = (blob.type || "audio/webm").split(";")[0];
        const extension = baseMimeType.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `audio-${Date.now()}.${extension}`, {
          type: blob.type || "audio/webm"
        });
        if (audioPreview?.url) URL.revokeObjectURL(audioPreview.url);
        setAudioPreview({ file, url: URL.createObjectURL(blob) });
        setRecording(false);
      };

      setAudioPreview(null);
      setRecordingSeconds(0);
      setRecording(true);
      recorder.start();
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((current) => {
          if (current >= 180) {
            mediaRecorderRef.current?.stop();
            return current;
          }
          return current + 1;
        });
      }, 1000);
    } catch {
      setComposerError("Permissao de microfone bloqueada ou indisponivel.");
    }
  }

  function cancelRecording() {
    clearRecordingTimer();
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setRecording(false);
    setRecordingSeconds(0);
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }

  function handleFileChange(file?: File) {
    if (!file) return;
    setComposerError("");
    if (file.size > 16 * 1024 * 1024) {
      setComposerError("Arquivo acima do limite de 16 MB.");
      return;
    }
    if (filePreview?.url) URL.revokeObjectURL(filePreview.url);
    setFilePreview({
      file,
      url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
    });
  }

  async function sendMediaPreview(preview: { file: File }, caption?: string) {
    if (!selectedConversation || sendingAttachment) return;
    setSendingAttachment(true);
    setComposerError("");
    try {
      await onSendMedia(selectedConversation.id, preview.file, caption);
      if (filePreview?.url) URL.revokeObjectURL(filePreview.url);
      if (audioPreview?.url) URL.revokeObjectURL(audioPreview.url);
      setFilePreview(null);
      setAudioPreview(null);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Falha ao enviar midia.");
    } finally {
      setSendingAttachment(false);
    }
  }

  async function openTemplates() {
    if (!selectedConversation) return;
    setTemplatesOpen((current) => !current);
    if (templates.length) return;
    setTemplatesLoading(true);
    setComposerError("");
    try {
      setTemplates(await onLoadTemplates(selectedConversation.id));
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Falha ao buscar templates.");
    } finally {
      setTemplatesLoading(false);
    }
  }

  async function sendTemplate() {
    if (!selectedConversation || !selectedTemplate || sendingAttachment) return;
    setSendingAttachment(true);
    setComposerError("");
    try {
      await onSendTemplate(selectedConversation.id, {
        templateName: selectedTemplate.name,
        language: selectedTemplate.language,
        variables: templateValues
      });
      setSelectedTemplate(null);
      setTemplateValues([]);
      setTemplatesOpen(false);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Falha ao enviar template.");
    } finally {
      setSendingAttachment(false);
    }
  }

  async function submitTransfer(userId: string) {
    if (!selectedConversation) return;
    setTransferSaving(true);
    setTransferError("");
    try {
      await onTransferConversation(selectedConversation.id, userId);
      setTransferOpen(false);
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "Falha ao transferir atendimento.");
    } finally {
      setTransferSaving(false);
    }
  }

  async function submitAssign(conversationId: string, userId?: string) {
    setAssigningConversationId(conversationId);
    try {
      await onAssignConversation(conversationId, userId);
    } finally {
      setAssigningConversationId(null);
    }
  }

  async function submitUnassign() {
    if (!selectedConversation) return;
    setUnassignSaving(true);
    try {
      await onUnassignConversation(selectedConversation.id);
      setUnassignOpen(false);
    } finally {
      setUnassignSaving(false);
    }
  }

  return (
    <div
      className={clsx(
        "grid h-full min-h-0 gap-3 overflow-hidden transition-[grid-template-columns] duration-300 ease-out md:gap-4",
        aiSidebarCollapsed
          ? "xl:grid-cols-[340px_minmax(0,1fr)_64px]"
          : "xl:grid-cols-[340px_minmax(0,1fr)_320px]"
      )}
    >
      {transferOpen && selectedConversation && (
        <TransferConversationModal
          attendants={attendants}
          conversation={selectedConversation}
          error={transferError}
          saving={transferSaving}
          onClose={() => {
            setTransferOpen(false);
            setTransferError("");
          }}
          onSubmit={(userId) => void submitTransfer(userId)}
        />
      )}
      {unassignOpen && selectedConversation && (
        <ConfirmUnassignModal
          conversation={selectedConversation}
          saving={unassignSaving}
          onClose={() => setUnassignOpen(false)}
          onConfirm={() => void submitUnassign()}
        />
      )}
      <ConversationList
        conversations={conversations}
        statusCounts={statusCounts}
        filters={filters}
        availableTags={availableTags}
        attendants={attendants}
        isAdmin={isAdmin}
        loading={loading}
        selectedConversation={selectedConversation}
        onFiltersChange={onFiltersChange}
        onSelectConversation={onSelectConversation}
      />

      <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-line/80 bg-white shadow-soft">
        <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-line/70 px-4 py-2 md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative grid h-11 w-11 place-items-center rounded-full bg-blue-50 text-sm font-bold text-brand ring-1 ring-blue-100">
              {formatContactNameForUi(selectedConversation?.contact.name)
                .slice(0, 1)
                .toUpperCase() ?? "C"}
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-bold text-slate-950">
                {selectedConversation
                  ? formatContactNameForUi(selectedConversation.contact.name)
                  : "Selecione uma conversa"}
              </h3>
              <p className="truncate text-sm text-slate-500">
                {selectedConversation
                  ? [
                      selectedConversation.contact.phone,
                      selectedConversation.contact.cpf
                        ? `CPF: ${formatCpf(selectedConversation.contact.cpf)}`
                        : null
                    ]
                      .filter(Boolean)
                      .join(" • ")
                  : "Inbox interno"}
              </p>
              {selectedConversation && (
                <p className="truncate text-xs font-semibold text-slate-500">
                  Responsavel:{" "}
                  <span className={selectedConversation.agent ? "text-slate-700" : "text-amber-600"}>
                    {selectedConversation.agent?.name ?? "Sem responsavel"}
                  </span>
                </p>
              )}
            </div>
          </div>
          {selectedConversation && (
            <div className="flex items-center gap-2">
              {!selectedConversation.agent && (
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-emerald-600 px-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={assigningConversationId === selectedConversation.id}
                  onClick={() => void submitAssign(selectedConversation.id)}
                >
                  {assigningConversationId === selectedConversation.id && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {assigningConversationId === selectedConversation.id ? "Assumindo..." : "Assumir"}
                </button>
              )}
              {isAdmin && selectedConversation.agent && (
                <button
                  type="button"
                  className="hidden h-10 rounded-full border border-line bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 lg:inline-flex"
                  onClick={() => setUnassignOpen(true)}
                >
                  Devolver
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  onClick={() => setTransferOpen(true)}
                >
                  <ArrowRight className="h-4 w-4" />
                  Transferir
                </button>
              )}
              <button
                type="button"
                className="hidden h-10 items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 text-sm font-bold text-primary hover:bg-blue-100 lg:inline-flex"
                onClick={() => onOpenCltSimulation(selectedConversation)}
              >
                <BriefcaseBusiness className="h-4 w-4" />
                Simular CLT
              </button>
              <ConversationTagSelector
                availableTags={availableTags}
                selectedTags={selectedConversation.tags}
                onAdd={(tagIds) => onAddTags(selectedConversation.id, tagIds)}
                onRemove={(tagId) => onRemoveTag(selectedConversation.id, tagId)}
              />
              <span className="hidden rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 md:inline-flex">
                Online
              </span>
              <select
                className="h-10 rounded-full border border-line bg-slate-50 px-3 text-sm font-medium text-slate-700 outline-none hover:bg-white focus:border-blue-200 focus:bg-white"
                value={selectedConversation.status}
                onChange={(event) =>
                  void onUpdateStatus(
                    selectedConversation.id,
                    event.target.value as ConversationRow["status"]
                  )
                }
              >
                <option value="OPEN">Aberto</option>
                <option value="PENDING">Pendente</option>
                <option value="BOT">Robo</option>
                <option value="SOLD">Vendas</option>
                <option value="RESOLVED">Resolvido</option>
              </select>
            </div>
          )}
        </div>

        {selectedConversation && selectedConversation.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-line/70 px-5 py-3">
            {selectedConversation.tags.map((tag) => (
              <TagBadge
                key={tag.id}
                tag={tag}
                onRemove={() => onRemoveTag(selectedConversation.id, tag.id)}
              />
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FAFC_100%)] p-5">
          {!selectedConversation && (
            <div className="grid h-80 place-items-center text-center text-sm text-slate-500">
              <div>
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-brand">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <p className="mt-3 font-medium text-slate-700">
                  Escolha uma conversa na lista para iniciar o atendimento.
                </p>
              </div>
            </div>
          )}
          {selectedConversation?.messages.map((item, index, messages) => {
            const side = item.direction === "outbound" ? "right" : "left";
            const timelineEvent = getMessageTimelineEvent(item);
            const previousMessage = messages[index - 1] ?? null;

            return (
              <div key={item.id} className="space-y-3">
                {shouldShowTimelineDateSeparator(item, previousMessage) && (
                  <TimelineDateDivider date={item.createdAt} />
                )}
                {timelineEvent && (
                  <TimelineEventMarker
                    label={timelineEvent.label}
                    detail={timelineEvent.detail}
                    tone={timelineEvent.tone}
                  />
                )}
                <ChatBubble
                  side={side}
                  status={item.status}
                  readAt={item.readAt}
                  timestamp={formatRelativeDate(item.createdAt)}
                >
                  {item.type === "audio" || item.mimeType?.startsWith("audio/") ? (
                    <AudioMessage
                      messageId={item.id}
                      body={item.body}
                      mediaUrl={item.mediaUrl}
                      hasMediaId={Boolean(item.mediaId)}
                      side={side}
                    />
                  ) : item.type === "document" || isDocumentMimeType(item.mimeType) ? (
                    <DocumentMessage
                      messageId={item.id}
                      body={item.body}
                      fileName={item.fileName}
                      mimeType={item.mimeType}
                      mediaUrl={item.mediaUrl}
                      hasMediaId={Boolean(item.mediaId)}
                      side={side}
                    />
                  ) : item.type === "template" ? (
                    <TemplateMessage
                      body={item.body}
                      mediaUrl={item.mediaUrl}
                      templateName={item.templateName}
                      side={side}
                    />
                  ) : (
                    item.body
                  )}
                </ChatBubble>
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        <form className="shrink-0 border-t border-slate-200 bg-white p-3 shadow-[0_-10px_28px_rgba(15,23,42,0.06)]" onSubmit={handleSubmit}>
          {composerError && (
            <div className="mb-3 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {composerError}
            </div>
          )}

          {recording && (
            <div className="mb-3 flex items-center justify-between rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
                Gravando audio {formatRecordingTime(recordingSeconds)}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" className="rounded-full px-3 py-1 hover:bg-white" onClick={cancelRecording}>
                  Cancelar
                </button>
                <button type="button" className="rounded-full bg-rose-600 px-3 py-1 font-semibold text-white" onClick={stopRecording}>
                  Parar
                </button>
              </div>
            </div>
          )}

          {(filePreview || audioPreview) && (
            <div className="mb-3 rounded-2xl border border-line bg-slate-50 p-3">
              {filePreview && (
                <div className="flex items-center gap-3">
                  {filePreview.url ? (
                    <div
                      className="h-14 w-14 rounded-xl bg-cover bg-center"
                      style={{ backgroundImage: `url(${filePreview.url})` }}
                    />
                  ) : (
                    <div className="grid h-14 w-14 place-items-center rounded-xl bg-white text-slate-500">
                      <FileIcon className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{filePreview.file.name}</p>
                    <p className="text-xs text-slate-500">{formatFileSize(filePreview.file.size)}</p>
                  </div>
                  <button type="button" className="rounded-full px-3 py-1 text-sm text-slate-500 hover:bg-white" onClick={() => setFilePreview(null)}>
                    Remover
                  </button>
                  <button type="button" className="rounded-full bg-brand px-3 py-1 text-sm font-semibold text-white disabled:opacity-50" disabled={sendingAttachment} onClick={() => void sendMediaPreview(filePreview, message)}>
                    {sendingAttachment ? "Enviando..." : "Enviar"}
                  </button>
                </div>
              )}
              {audioPreview && (
                <div className="flex items-center gap-3">
                  <audio className="min-w-0 flex-1" controls src={audioPreview.url} />
                  <button type="button" className="rounded-full px-3 py-1 text-sm text-slate-500 hover:bg-white" onClick={() => setAudioPreview(null)}>
                    Descartar
                  </button>
                  <button type="button" className="rounded-full bg-brand px-3 py-1 text-sm font-semibold text-white disabled:opacity-50" disabled={sendingAttachment} onClick={() => void sendMediaPreview(audioPreview)}>
                    {sendingAttachment ? "Enviando..." : "Enviar audio"}
                  </button>
                </div>
              )}
            </div>
          )}

          {templatesOpen && (
            <div className="mb-3 max-h-72 overflow-y-auto rounded-2xl border border-line bg-white p-3 shadow-soft">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-900">Templates aprovados</p>
                <button type="button" className="text-xs font-semibold text-slate-500" onClick={() => setTemplatesOpen(false)}>
                  Fechar
                </button>
              </div>
              {templatesLoading && <p className="text-sm text-slate-500">Buscando templates...</p>}
              {!templatesLoading && templates.length === 0 && (
                <p className="text-sm text-slate-500">Nenhum template aprovado encontrado para este numero.</p>
              )}
              <div className="space-y-2">
                {templates.map((template) => (
                  <button
                    key={`${template.name}-${template.language}`}
                    type="button"
                    className={clsx(
                      "w-full rounded-2xl border p-3 text-left hover:bg-slate-50",
                      selectedTemplate?.name === template.name && selectedTemplate.language === template.language
                        ? "border-blue-200 bg-blue-50"
                        : "border-line"
                    )}
                    onClick={() => {
                      setSelectedTemplate(template);
                      setTemplateValues(Array.from({ length: template.variableCount }, () => ""));
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-slate-900">{template.name}</p>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                        {template.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{template.category} - {template.language}</p>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-600">{template.preview}</p>
                  </button>
                ))}
              </div>
              {selectedTemplate && (
                <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                  {selectedTemplate.variableCount > 0 && (
                    <div className="space-y-2">
                      {templateValues.map((value, index) => (
                        <input
                          key={index}
                          className="h-9 w-full rounded-xl border border-line px-3 text-sm outline-none focus:border-blue-200"
                          placeholder={`Variavel ${index + 1}`}
                          value={value}
                          onChange={(event) =>
                            setTemplateValues((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? event.target.value : item
                              )
                            )
                          }
                        />
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="mt-3 h-9 w-full rounded-full bg-brand text-sm font-semibold text-white disabled:opacity-50"
                    disabled={sendingAttachment}
                    onClick={() => void sendTemplate()}
                  >
                    {sendingAttachment ? "Enviando..." : "Enviar template"}
                  </button>
                </div>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="image/jpeg,image/png,application/pdf,audio/mpeg,audio/ogg,audio/webm,video/mp4,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => handleFileChange(event.target.files?.[0])}
          />

          <div className="relative flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-3 py-2 shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_22px_rgba(15,23,42,0.07)] transition focus-within:border-brand/60 focus-within:shadow-[0_1px_0_rgba(37,99,235,0.08),0_10px_28px_rgba(37,99,235,0.10)] focus-within:ring-4 focus-within:ring-blue-50">
            <ComposerButton title="Anexar arquivo" disabled={!selectedConversation} onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="h-4 w-4" />
            </ComposerButton>
            <ComposerButton title="Emoji" disabled={!selectedConversation} onClick={() => setEmojiOpen((current) => !current)}>
              <Smile className="h-4 w-4" />
            </ComposerButton>
            <ComposerButton title="Gravar audio" disabled={!selectedConversation || recording} onClick={() => void startRecording()}>
              {recording ? <Square className="h-4 w-4 text-rose-500" /> : <Mic className="h-4 w-4" />}
            </ComposerButton>
            <ComposerButton title="Templates Meta" disabled={!selectedConversation} onClick={() => void openTemplates()}>
              <FileText className="h-4 w-4" />
            </ComposerButton>

            {emojiOpen && (
              <div className="absolute bottom-14 left-12 z-20 grid grid-cols-8 gap-1 rounded-2xl border border-line bg-white p-2 shadow-lift">
                {commonEmojis.map((emoji) => (
                  <button key={emoji} type="button" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-50" onClick={() => insertEmoji(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            <input
              ref={inputRef}
              className="w-full bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:text-slate-500 disabled:text-slate-400 disabled:placeholder:text-slate-400"
              disabled={!selectedConversation}
              placeholder="Digite uma mensagem..."
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <button
              className="grid h-10 w-10 place-items-center rounded-full bg-brand text-white shadow-[0_8px_18px_rgba(37,99,235,0.25)] transition hover:bg-blue-700 active:scale-95 disabled:bg-slate-300 disabled:opacity-70 disabled:shadow-none"
              disabled={!selectedConversation || !message.trim()}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </section>

      <section
        className={clsx(
          "min-h-0 overflow-hidden transition-all duration-300 ease-out",
          aiSidebarCollapsed
            ? "rounded-[1.5rem] border border-line/80 bg-white p-2 shadow-soft"
            : "space-y-4 overflow-y-auto overscroll-contain pr-1"
        )}
      >
        {aiSidebarCollapsed ? (
          <CollapsedAiSidebar
            hasAnalysis={Boolean(aiAnalysis)}
            onExpand={() => setAiSidebarCollapsed(false)}
            onAnalyze={() =>
              selectedConversation
                ? void onAnalyzeConversation(selectedConversation.id)
                : undefined
            }
            disabled={!selectedConversation || aiLoading}
            loading={aiLoading}
          />
        ) : (
          <>
            <AiPanel
              compact
              analysis={aiAnalysis}
              companyMode={aiSettings.mode}
              conversation={selectedConversation}
              loading={aiLoading}
              disabled={!selectedConversation}
              onAnalyze={() =>
                selectedConversation
                  ? void onAnalyzeConversation(selectedConversation.id)
                  : undefined
              }
              onModeChange={(mode) =>
                selectedConversation
                  ? void onUpdateConversationAiMode(selectedConversation.id, { mode })
                  : undefined
              }
              onPauseChange={(paused) =>
                selectedConversation
                  ? void onUpdateConversationAiMode(selectedConversation.id, { paused })
                  : undefined
              }
              onCollapse={() => setAiSidebarCollapsed(true)}
            />
            {aiAnalysis && (
              <button
                className="flex h-10 w-full items-center justify-center gap-2 rounded bg-brand px-3 text-sm font-semibold text-white"
                disabled={!selectedConversation}
                onClick={() => setMessage(aiAnalysis.suggestedReply)}
              >
                <Send className="h-4 w-4" />
                Usar sugestao
              </button>
            )}
            <button
              type="button"
              className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-blue-100 bg-blue-50 px-3 text-sm font-bold text-primary hover:bg-blue-100 disabled:opacity-50"
              disabled={!selectedConversation}
              onClick={() =>
                selectedConversation
                  ? onOpenCltSimulation(selectedConversation)
                  : undefined
              }
            >
              <BriefcaseBusiness className="h-4 w-4" />
              Simular CLT deste lead
            </button>
            <div className="rounded border border-line bg-white p-4 shadow-soft">
              <h3 className="font-bold">Ficha rapida</h3>
              <dl className="mt-4 space-y-3 text-sm">
                <Info label="Origem" value={selectedConversation?.contact.origin ?? "-"} />
                <Info label="Etapa" value={selectedConversation?.contact.stage ?? "-"} />
                <Info label="Responsavel" value={selectedConversation?.contact.owner ?? "-"} />
                <Info
                  label="Temperatura"
                  value={
                    selectedConversation?.contact.temperature
                      ? temperatureLabels[
                          selectedConversation.contact
                            .temperature as keyof typeof temperatureLabels
                        ]
                      : "-"
                  }
                />
              </dl>
            </div>
            {selectedConversation?.summary && (
              <div className="rounded border border-line bg-white p-4 shadow-soft">
                <h3 className="font-bold">Resumo salvo</h3>
                <p className="mt-2 whitespace-pre-line text-sm text-slate-600">
                  {selectedConversation.summary}
                </p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function TagBadge({
  tag,
  compact,
  onRemove
}: {
  tag: {
    id: string;
    name: string;
    color: string;
    textColor?: string | null;
  };
  compact?: boolean;
  onRemove?: () => void;
}) {
  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center gap-1 rounded-full font-semibold",
        compact ? "max-w-[8rem] shrink-0 px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      )}
      style={{
        backgroundColor: tag.color,
        color: tag.textColor || "#ffffff"
      }}
      title={tag.name}
    >
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          className="grid h-4 w-4 place-items-center rounded-full bg-white/20 hover:bg-white/30"
          onClick={onRemove}
          type="button"
          title="Remover tag"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function ConversationTagSelector({
  availableTags,
  selectedTags,
  onAdd,
  onRemove
}: {
  availableTags: ReferenceData["tags"];
  selectedTags: ConversationRow["tags"];
  onAdd: (tagIds: string[]) => Promise<void>;
  onRemove: (tagId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedIds = new Set(selectedTags.map((tag) => tag.id));
  const filteredTags = availableTags
    .filter((tag) => tag.isActive !== false)
    .filter((tag) => tag.name.toLowerCase().includes(search.trim().toLowerCase()));

  async function toggleTag(tagId: string) {
    setSaving(true);
    if (selectedIds.has(tagId)) {
      await onRemove(tagId);
    } else {
      await onAdd([tagId]);
    }
    setSaving(false);
  }

  return (
    <div className="relative">
      <button
        className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <Tags className="h-4 w-4" />
        Tags
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-30 w-72 rounded-2xl border border-line bg-white p-3 shadow-soft">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              className="w-full bg-transparent text-sm outline-none"
              placeholder="Buscar tag..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
            {filteredTags.map((tag) => {
              const selected = selectedIds.has(tag.id);
              return (
                <button
                  key={tag.id}
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50 disabled:opacity-60"
                  disabled={saving}
                  onClick={() => void toggleTag(tag.id)}
                  type="button"
                >
                  <TagBadge tag={tag} compact />
                  {selected && <Check className="h-4 w-4 text-brand" />}
                </button>
              );
            })}
            {filteredTags.length === 0 && (
              <p className="p-3 text-sm text-slate-500">
                Nenhuma tag ativa encontrada.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConversationList({
  conversations,
  statusCounts,
  filters,
  availableTags,
  attendants,
  isAdmin,
  loading,
  selectedConversation,
  onFiltersChange,
  onSelectConversation
}: {
  conversations: ConversationRow[];
  statusCounts: ConversationStatusCounts;
  filters: { search: string; status: string; tagIds: string[]; assignedTo: string };
  availableTags: ReferenceData["tags"];
  attendants: AttendantRow[];
  isAdmin: boolean;
  loading: boolean;
  selectedConversation: ConversationRow | null;
  onFiltersChange: (filters: { search: string; status: string; tagIds: string[]; assignedTo: string }) => void;
  onSelectConversation: (conversation: ConversationRow) => void;
}) {
  const activeTags = availableTags.filter((tag) => tag.isActive !== false);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const selectedTagNames = activeTags
    .filter((tag) => filters.tagIds.includes(tag.id))
    .map((tag) => tag.name);
  const queueLabel =
    filters.assignedTo === "me"
      ? "Meus"
      : filters.assignedTo === "unassigned"
        ? "Sem responsavel"
        : filters.assignedTo && !["default", "me", "unassigned"].includes(filters.assignedTo)
          ? attendants.find((attendant) => attendant.id === filters.assignedTo)?.name ?? "Atendente"
          : isAdmin
            ? "Todos"
            : "Minha fila";
  const statusFilterItems: Array<{
    value: ConversationRow["status"];
    label: string;
  }> = [
    { value: "OPEN", label: "Aberto" },
    { value: "PENDING", label: "Pendentes" },
    { value: "BOT", label: "Robo" },
    { value: "RESOLVED", label: "Resolvidos" },
    { value: "SOLD", label: "Vendas" }
  ];

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-line/80 bg-white shadow-soft">
      <div className="border-b border-line/70 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-950">Conversas</h3>
            <p className="text-sm text-slate-500">{conversations.length} atendimentos</p>
          </div>
          <div className="relative">
            <button
              className={clsx(
                "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-bold transition-colors",
                filters.tagIds.length
                  ? "border-blue-200 bg-blue-50 text-brand"
                  : "border-line bg-slate-50 text-slate-500 hover:bg-white"
              )}
              onClick={() => setTagFilterOpen((current) => !current)}
              type="button"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Tags{filters.tagIds.length ? `: ${filters.tagIds.length}` : ""}
            </button>
            {tagFilterOpen && (
              <div className="absolute right-0 top-11 z-20 w-72 rounded-2xl border border-line bg-white p-3 shadow-soft">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Filtrar por tag
                  </p>
                  {filters.tagIds.length > 0 && (
                    <button
                      className="text-xs font-bold text-brand"
                      onClick={() => onFiltersChange({ ...filters, tagIds: [] })}
                      type="button"
                    >
                      Limpar
                    </button>
                  )}
                </div>
                <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto pr-1">
                  {activeTags.map((tag) => {
                    const selected = filters.tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        className={clsx(
                          "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                          selected
                            ? "border-blue-200 bg-blue-50 text-brand"
                            : "border-line bg-white text-slate-600 hover:bg-slate-50"
                        )}
                        onClick={() =>
                          onFiltersChange({
                            ...filters,
                            tagIds: selected
                              ? filters.tagIds.filter((tagId) => tagId !== tag.id)
                              : [...filters.tagIds, tag.id]
                          })
                        }
                        type="button"
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                  {activeTags.length === 0 && (
                    <p className="text-sm text-slate-500">Nenhuma tag ativa.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex h-10 items-center gap-2 rounded-2xl border border-line bg-slate-50 px-3 focus-within:border-blue-200 focus-within:bg-white">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Buscar conversas..."
            value={filters.search}
            onChange={(event) =>
              onFiltersChange({ ...filters, search: event.target.value })
            }
          />
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto rounded-2xl bg-slate-50 p-1 text-[11px] ring-1 ring-line/80">
          {statusFilterItems.map(({ value, label }) => {
            const count = statusCounts[value] ?? 0;
            const active = filters.status === value;

            return (
            <button
              key={value}
              className={clsx(
                "inline-flex h-8 min-w-max flex-1 items-center justify-center gap-1.5 rounded-xl px-2 font-bold transition-colors",
                active
                  ? "bg-white text-brand shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              )}
              onClick={() => onFiltersChange({ ...filters, status: value })}
            >
              <span>{label}</span>
              <span
                className={clsx(
                  "grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-black leading-none",
                  count > 0
                    ? active
                      ? "bg-brand text-white"
                      : "bg-rose-100 text-rose-600"
                    : active
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-slate-200 text-slate-400"
                )}
              >
                {count > 99 ? "99+" : count}
              </span>
            </button>
            );
          })}
        </div>
        <div className="mt-3 grid gap-2 text-xs">
          <div className="flex items-center gap-2">
            <select
              className="h-9 min-w-0 flex-1 rounded-full border border-line bg-white px-3 text-xs font-semibold text-slate-600 outline-none"
              value={filters.assignedTo}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  assignedTo: event.target.value || "default"
                })
              }
            >
              <option value="default">{isAdmin ? "Fila: Todos" : "Fila: Minha fila"}</option>
              <option value="me">Meus atendimentos</option>
              <option value="unassigned">Sem responsavel</option>
              {isAdmin &&
                attendants.map((attendant) => (
                  <option key={attendant.id} value={attendant.id}>
                    {attendant.name}
                  </option>
                ))}
            </select>
            {filters.tagIds.length > 0 && (
              <button
                className="h-9 rounded-full border border-line bg-white px-3 text-xs font-bold text-slate-500 hover:bg-slate-50"
                onClick={() => onFiltersChange({ ...filters, tagIds: [] })}
                type="button"
              >
                Limpar
              </button>
            )}
          </div>
          {(filters.assignedTo !== "default" || selectedTagNames.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                {queueLabel}
              </span>
              {selectedTagNames.slice(0, 2).map((name) => (
                <span
                  key={name}
                  className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-brand"
                >
                  {name}
                </span>
              ))}
              {selectedTagNames.length > 2 && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                  +{selectedTagNames.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-line/70 overflow-y-auto overscroll-contain">
        {conversations.map((item) => {
          const selected = selectedConversation?.id === item.id;
          const unread = item.unreadCount ?? 0;
          const hasUnread = unread > 0;
          const contactName = formatContactNameForUi(item.contact.name);
          const preview = formatConversationPreview(item);
          const channelLine = formatConversationChannelLine(item);
          const messageTime = item.lastMessageAt ?? item.lastMessage?.createdAt;
          const attention = getConversationAttention(item);
          const temperatureLabel =
            temperatureLabels[item.contact.temperature as keyof typeof temperatureLabels] ??
            item.contact.temperature;
          const visibleTags = item.tags.slice(0, 2);
          const extraTagCount = Math.max(0, item.tags.length - visibleTags.length);
          return (
            <button
              key={item.id}
              data-conversation-row="true"
              data-conversation-id={item.id}
              data-contact-id={item.contact.id}
              data-contact-phone={item.contact.phone}
              data-contact-name={contactName}
              className={clsx(
                "group relative block min-h-[112px] w-full overflow-hidden px-3.5 py-3 text-left transition-colors hover:bg-slate-50",
                attention.tone === "green" && "bg-emerald-50/45",
                attention.tone === "amber" && !selected && "bg-amber-50/30",
                attention.tone === "rose" && !selected && "bg-rose-50/30",
                selected && "bg-blue-50/70"
              )}
              onClick={() => onSelectConversation(item)}
            >
              <span
                className={clsx(
                  "absolute left-0 top-4 h-10 w-1 rounded-r-full",
                  attention.tone === "green" && "bg-emerald-500",
                  attention.tone === "amber" && "bg-amber-400",
                  attention.tone === "rose" && "bg-rose-500",
                  attention.tone === "slate" && "bg-transparent"
                )}
              />
              <div className="flex min-h-[88px] items-start gap-3">
                <div className="relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                  {contactName.slice(0, 2).toUpperCase()}
                  <span
                    className={clsx(
                      "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white",
                      attention.pulse && "animate-pulse",
                      attention.tone === "green"
                        ? "bg-emerald-500"
                        : attention.tone === "amber"
                          ? "bg-amber-400"
                          : attention.tone === "rose"
                            ? "bg-rose-500"
                            : "bg-emerald-500"
                    )}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex h-5 items-center justify-between gap-2">
                    <p
                      className={clsx(
                        "min-w-0 flex-1 truncate text-[13px] leading-5 text-slate-950",
                        hasUnread ? "font-bold" : "font-semibold"
                      )}
                      title={contactName}
                    >
                      {contactName}
                    </p>
                    <span
                      className={clsx(
                        "w-16 shrink-0 truncate text-right text-[10px] tabular-nums",
                        hasUnread ? "font-bold text-emerald-600" : "text-slate-400"
                      )}
                      title={messageTime ? formatRelativeDate(messageTime) : item.status}
                    >
                      {messageTime ? formatRelativeDate(messageTime) : item.status}
                    </span>
                  </div>

                  <div className="mt-1 flex h-5 items-center justify-between gap-2 overflow-hidden">
                    <p
                      className={clsx(
                        "min-w-0 flex-1 truncate text-[12px] leading-5",
                        hasUnread ? "font-semibold text-slate-800" : "text-slate-500"
                      )}
                      title={preview}
                    >
                      {preview}
                    </p>
                    {hasUnread && (
                      <span className="grid h-5 min-w-[1.25rem] shrink-0 place-items-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold leading-none text-white shadow-sm">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </div>

                  <p className="mt-0.5 h-4 truncate text-[10px] font-medium leading-4 text-slate-400" title={channelLine}>
                    {channelLine}
                  </p>

                  <div className="mt-1.5 flex max-h-10 flex-wrap items-center gap-1 overflow-hidden">
                    {attention.tone !== "slate" && (
                      <span
                        className={clsx(
                          "max-w-[8.5rem] truncate rounded-full px-2 py-0.5 text-[10px] font-bold leading-4 ring-1",
                          getConversationBadgeClass(attention.label, "status")
                        )}
                        title={attention.label}
                      >
                        {attention.label}
                      </span>
                    )}
                    {visibleTags.map((tag) => (
                      <span
                        key={tag.id}
                        className={clsx(
                          "max-w-[9rem] truncate rounded-full px-2 py-0.5 text-[10px] font-bold leading-4 ring-1",
                          getConversationBadgeClass(tag.name)
                        )}
                        title={tag.name}
                      >
                        {tag.name}
                      </span>
                    ))}
                    {extraTagCount > 0 && (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold leading-4 text-slate-500 ring-1 ring-slate-200">
                        +{extraTagCount}
                      </span>
                    )}
                    <span
                      className={clsx(
                        "max-w-[5.5rem] truncate rounded-full px-2 py-0.5 text-[10px] font-bold leading-4 ring-1",
                        getConversationBadgeClass(temperatureLabel)
                      )}
                      title={temperatureLabel}
                    >
                      {temperatureLabel}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
        {!loading && conversations.length === 0 && (
          <div className="p-6 text-center text-sm text-slate-500">
            Nenhuma conversa nesta fila.
          </div>
        )}
        {loading && (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

type TimelineEventTone = "template" | "interaction" | "media" | "error";

function isSameLocalDay(first: string, second: string) {
  const firstDate = new Date(first);
  const secondDate = new Date(second);

  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}

function shouldShowTimelineDateSeparator(
  message: ConversationMessageRow,
  previousMessage: ConversationMessageRow | null
) {
  if (!previousMessage) return true;
  return !isSameLocalDay(message.createdAt, previousMessage.createdAt);
}

function formatTimelineDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameLocalDay(value, now.toISOString())) return "Hoje";
  if (isSameLocalDay(value, yesterday.toISOString())) return "Ontem";

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function cleanTimelineDetail(value?: string | null) {
  if (!value) return null;
  return value
    .replace(/^Resposta interativa:\s*/i, "")
    .replace(/\[Imagem no cabecalho\]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function getMessageTimelineEvent(message: ConversationMessageRow) {
  const type = message.type?.toLowerCase() ?? "text";
  const status = message.status?.toLowerCase() ?? "";

  if (message.direction === "outbound" && status === "failed") {
    return {
      label: "Falha no envio",
      detail: cleanTimelineDetail(message.body),
      tone: "error" as TimelineEventTone
    };
  }

  if (type === "template") {
    return {
      label: "Template enviado",
      detail: message.templateName ? `Modelo: ${message.templateName}` : "Mensagem aprovada pela Meta",
      tone: "template" as TimelineEventTone
    };
  }

  if (type === "button" || type === "interactive") {
    return {
      label: "Cliente respondeu botao",
      detail: cleanTimelineDetail(message.body),
      tone: "interaction" as TimelineEventTone
    };
  }

  if (type === "audio" || message.mimeType?.startsWith("audio/")) {
    return {
      label: message.direction === "outbound" ? "Audio enviado" : "Audio recebido",
      detail: null,
      tone: "media" as TimelineEventTone
    };
  }

  if (type === "document" || isDocumentMimeType(message.mimeType)) {
    return {
      label: message.direction === "outbound" ? "Documento enviado" : "Documento recebido",
      detail: resolveDocumentName({
        fileName: message.fileName,
        body: message.body,
        mimeType: message.mimeType
      }),
      tone: "media" as TimelineEventTone
    };
  }

  if (type === "image" || message.mimeType?.startsWith("image/")) {
    return {
      label: message.direction === "outbound" ? "Imagem enviada" : "Imagem recebida",
      detail: cleanTimelineDetail(message.body),
      tone: "media" as TimelineEventTone
    };
  }

  return null;
}

function TimelineDateDivider({ date }: { date: string }) {
  return (
    <div className="flex items-center justify-center">
      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 shadow-sm">
        {formatTimelineDate(date)}
      </span>
    </div>
  );
}

function TimelineEventMarker({
  label,
  detail,
  tone
}: {
  label: string;
  detail?: string | null;
  tone: TimelineEventTone;
}) {
  const Icon =
    tone === "template"
      ? Sparkles
      : tone === "interaction"
        ? MessageSquareText
        : tone === "error"
          ? AlertTriangle
          : FileText;

  return (
    <div className="flex justify-center">
      <div
        className={clsx(
          "inline-flex max-w-[86%] items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold shadow-sm",
          tone === "template" && "border-blue-100 bg-blue-50 text-blue-700",
          tone === "interaction" && "border-amber-100 bg-amber-50 text-amber-700",
          tone === "media" && "border-slate-200 bg-white text-slate-600",
          tone === "error" && "border-rose-100 bg-rose-50 text-rose-700"
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0">{label}</span>
        {detail && (
          <span className="min-w-0 truncate border-l border-current/20 pl-2 font-semibold opacity-80">
            {detail}
          </span>
        )}
      </div>
    </div>
  );
}

function ChatBubble({
  side,
  status,
  readAt,
  timestamp,
  children
}: {
  side: "left" | "right";
  status?: string;
  readAt?: string | null;
  timestamp?: string;
  children: React.ReactNode;
}) {
  const normalizedStatus = status?.toLowerCase() ?? "sent";
  const failed = normalizedStatus === "failed";
  const showDeliveryStatus = side === "right";
  const deliveryLabel =
    normalizedStatus === "sending"
      ? "Enviando..."
      : failed
        ? "Falhou"
        : normalizedStatus === "read"
          ? "Visualizada"
          : normalizedStatus === "delivered"
            ? "Entregue"
            : "Enviada";
  const DeliveryIcon =
    normalizedStatus === "sending"
      ? Loader2
      : failed
        ? AlertTriangle
        : normalizedStatus === "sent"
          ? Check
          : CheckCheck;

  return (
    <div className={clsx("flex", side === "right" && "justify-end")}>
      <div className="max-w-[82%] sm:max-w-[74%]">
        <div
          className={clsx(
            "whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-left text-sm leading-6 shadow-sm [overflow-wrap:anywhere]",
            failed
              ? "rounded-br-md border border-rose-100 bg-rose-50 text-rose-700"
              : side === "right"
              ? "rounded-br-md bg-brand text-white"
              : "rounded-bl-md border border-line/70 bg-white text-slate-800"
          )}
        >
          {children}
        </div>
        {failed && (
          <p className="mt-1 px-1 text-[11px] font-semibold text-rose-600">
            Falha ao enviar
          </p>
        )}
        {(timestamp || showDeliveryStatus) && (
          <div
            className={clsx(
              "mt-1 flex items-center gap-1 px-1 text-[11px] text-slate-400",
              side === "right" && "justify-end text-right"
            )}
          >
            {timestamp && <span>{timestamp}</span>}
            {showDeliveryStatus && (
              <span
                className={clsx(
                  "inline-flex items-center gap-1 font-medium",
                  normalizedStatus === "read" && "text-sky-500",
                  normalizedStatus === "delivered" && "text-slate-500",
                  failed && "text-rose-600"
                )}
                title={
                  normalizedStatus === "read" && readAt
                    ? `Visualizada ${formatRelativeDate(readAt)}`
                    : deliveryLabel
                }
              >
                <DeliveryIcon
                  className={clsx(
                    "h-3 w-3",
                    normalizedStatus === "sending" && "animate-spin"
                  )}
                />
                {deliveryLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const commonEmojis = ["😀", "🙂", "😉", "👍", "🙏", "✅", "🔥", "🚀", "📌", "💬", "📄", "⏰", "❤️", "👏", "🤝", "💰"];

function AudioMessage({
  messageId,
  body,
  mediaUrl,
  hasMediaId,
  side
}: {
  messageId: string;
  body: string;
  mediaUrl?: string | null;
  hasMediaId: boolean;
  side: "left" | "right";
}) {
  const [failed, setFailed] = useState(false);
  const sourceUrl = mediaUrl || (hasMediaId ? `/api/messages/${messageId}/media` : "");
  const label = body && !body.startsWith("[Audio:") ? body : "Audio";

  return (
    <div className="w-full min-w-[220px] max-w-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold">
        <span
          className={clsx(
            "grid h-7 w-7 place-items-center rounded-full",
            side === "right" ? "bg-white/15 text-white" : "bg-blue-50 text-brand"
          )}
        >
          <Mic className="h-3.5 w-3.5" />
        </span>
        <span className={side === "right" ? "text-white" : "text-slate-700"}>
          {label}
        </span>
      </div>

      {sourceUrl && !failed ? (
        <audio
          className={clsx(
            "h-9 w-full min-w-0 rounded-full",
            side === "right" && "[&::-webkit-media-controls-panel]:bg-blue-50"
          )}
          controls
          preload="metadata"
          src={sourceUrl}
          onError={() => setFailed(true)}
        />
      ) : (
        <a
          className={clsx(
            "inline-flex rounded-full px-3 py-1.5 text-xs font-bold",
            side === "right"
              ? "bg-white/15 text-white hover:bg-white/20"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          )}
          href={sourceUrl || undefined}
          download
        >
          Baixar audio
        </a>
      )}
    </div>
  );
}

function isDocumentMimeType(mimeType?: string | null) {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase();
  return (
    normalized === "application/pdf" ||
    normalized.includes("word") ||
    normalized.includes("spreadsheet") ||
    normalized.includes("excel") ||
    normalized.includes("powerpoint") ||
    normalized === "application/msword" ||
    normalized === "text/plain"
  );
}

function resolveDocumentName({
  fileName,
  body,
  mimeType
}: {
  fileName?: string | null;
  body: string;
  mimeType?: string | null;
}) {
  if (fileName?.trim()) return fileName.trim();

  const fromBody = body.match(/Documento recebido:\s*(.+)$/i)?.[1]?.trim();
  if (fromBody) return fromBody;

  if (mimeType === "application/pdf") return "documento.pdf";
  return "documento";
}

function getDocumentLabel(mimeType?: string | null) {
  const normalized = mimeType?.toLowerCase() ?? "";
  if (normalized === "application/pdf") return "PDF";
  if (normalized.includes("word") || normalized === "application/msword") return "DOC";
  if (normalized.includes("spreadsheet") || normalized.includes("excel")) return "XLS";
  if (normalized.includes("powerpoint") || normalized.includes("presentation")) return "PPT";
  return "ARQ";
}

function DocumentMessage({
  messageId,
  body,
  fileName,
  mimeType,
  mediaUrl,
  hasMediaId,
  side
}: {
  messageId: string;
  body: string;
  fileName?: string | null;
  mimeType?: string | null;
  mediaUrl?: string | null;
  hasMediaId: boolean;
  side: "left" | "right";
}) {
  const sourceUrl = mediaUrl || (hasMediaId ? `/api/messages/${messageId}/media` : "");
  const downloadUrl = mediaUrl || (hasMediaId ? `/api/messages/${messageId}/media?download=1` : "");
  const displayName = resolveDocumentName({ fileName, body, mimeType });
  const documentLabel = getDocumentLabel(mimeType);
  const isPdf = mimeType?.toLowerCase() === "application/pdf" || displayName.toLowerCase().endsWith(".pdf");

  return (
    <div
      className={clsx(
        "w-full min-w-[240px] max-w-sm rounded-2xl border p-3",
        side === "right"
          ? "border-white/20 bg-white/10 text-white"
          : "border-slate-200 bg-white text-slate-800 shadow-sm"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={clsx(
            "grid h-10 w-10 shrink-0 place-items-center rounded-2xl",
            side === "right" ? "bg-white/15 text-white" : "bg-rose-50 text-rose-600"
          )}
        >
          <FileText className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                "rounded-md px-1.5 py-0.5 text-[10px] font-black",
                side === "right" ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"
              )}
            >
              {documentLabel}
            </span>
            <span className={clsx("text-xs font-semibold", side === "right" ? "text-white/75" : "text-slate-500")}>
              Documento
            </span>
          </div>
          {sourceUrl ? (
            <a
              className={clsx(
                "mt-1 block truncate text-sm font-bold underline-offset-2 hover:underline",
                side === "right" ? "text-white" : "text-slate-900"
              )}
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              title={displayName}
            >
              {displayName}
            </a>
          ) : (
            <p className="mt-1 truncate text-sm font-bold" title={displayName}>
              {displayName}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              className={clsx(
                "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition",
                !sourceUrl && "pointer-events-none opacity-50",
                side === "right"
                  ? "bg-white text-brand hover:bg-blue-50"
                  : "bg-brand text-white hover:bg-blue-700"
              )}
              href={sourceUrl || undefined}
              target="_blank"
              rel="noreferrer"
            >
              <FileText className="h-3.5 w-3.5" />
              {isPdf ? "Visualizar" : "Abrir"}
            </a>
            <a
              className={clsx(
                "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition",
                !downloadUrl && "pointer-events-none opacity-50",
                side === "right"
                  ? "bg-white/15 text-white hover:bg-white/20"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              )}
              href={downloadUrl || undefined}
              download={displayName}
            >
              <Download className="h-3.5 w-3.5" />
              Baixar
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function resolveTemplateImageForDisplay({
  mediaUrl,
  templateName
}: {
  mediaUrl?: string | null;
  templateName?: string | null;
}) {
  if (mediaUrl) return mediaUrl;
  if (templateName === "inss_utilidade_01") return "/templates/inss_utilidade_01.jpg";
  return null;
}

function TemplateMessage({
  body,
  mediaUrl,
  templateName,
  side
}: {
  body: string;
  mediaUrl?: string | null;
  templateName?: string | null;
  side: "left" | "right";
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = resolveTemplateImageForDisplay({ mediaUrl, templateName });
  const cleanBody = imageUrl
    ? body
        .replace(/\[Imagem no cabecalho\]\s*/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : body;

  return (
    <div className="space-y-3">
      {imageUrl && !imageFailed && (
        <div className="overflow-hidden rounded-2xl border border-white/20 bg-slate-100">
          <NextImage
            src={imageUrl}
            alt={`Imagem do template ${templateName ?? "WhatsApp"}`}
            width={1024}
            height={1024}
            className="h-auto w-full object-cover"
            unoptimized
            onError={() => setImageFailed(true)}
          />
        </div>
      )}
      {imageUrl && imageFailed && (
        <a
          className={clsx(
            "inline-flex rounded-full px-3 py-1.5 text-xs font-bold",
            side === "right"
              ? "bg-white/15 text-white hover:bg-white/20"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          )}
          href={imageUrl}
          target="_blank"
          rel="noreferrer"
        >
          Abrir imagem do template
        </a>
      )}
      <div>{cleanBody}</div>
    </div>
  );
}

function ComposerButton({
  title,
  disabled,
  onClick,
  children
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      className="group relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-600 transition hover:bg-blue-50 hover:text-brand active:scale-95 disabled:cursor-not-allowed disabled:text-slate-300 disabled:opacity-60 disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span className="pointer-events-none absolute bottom-11 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-disabled:hidden">
        {title}
      </span>
    </button>
  );
}

function formatRecordingTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const rest = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function Kanban({
  stages,
  loading,
  onMoveContact
}: {
  stages: KanbanStage[];
  loading: boolean;
  onMoveContact: (contactId: string, stageId: string) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-bold">Pipeline de leads</h3>
          <p className="text-sm text-slate-500">
            Leads ativos agrupados pela etapa salva no banco.
          </p>
        </div>
        <div className="rounded border border-line bg-white px-3 py-2 text-sm text-slate-600">
          {loading ? "Carregando..." : `${stages.reduce((sum, stage) => sum + stage.contacts.length, 0)} leads ativos`}
        </div>
      </div>

      <div className="grid gap-4 overflow-x-auto pb-2 xl:grid-cols-4">
        {stages.map((stage) => (
          <section
            key={stage.id || "unstaged"}
            className="min-w-72 rounded border border-line bg-white p-4 shadow-soft"
          >
          <div className="flex items-center justify-between">
            <h3 className="font-bold">{stage.name}</h3>
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: stage.color }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {stage.contacts.length} contato(s)
          </p>
          <div className="mt-4 space-y-3">
            {stage.contacts.map((contact) => (
              <article key={contact.id} className="rounded border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{contact.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{contact.phone}</p>
                  </div>
                  <span
                    className={clsx(
                      "rounded px-2 py-1 text-xs font-semibold",
                      contact.temperature === "HOT" && "bg-rose-50 text-rose-700",
                      contact.temperature === "WARM" && "bg-amber-50 text-amber-700",
                      contact.temperature === "COLD" && "bg-slate-100 text-slate-600"
                    )}
                  >
                    {temperatureLabels[contact.temperature]}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  {contact.lastMessage ?? "Sem observacao registrada."}
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                  <Clock3 className="h-3.5 w-3.5" />
                  atualizado {formatRelativeDate(contact.updatedAt)}
                </div>
                <select
                  className="mt-3 h-9 w-full rounded border border-line px-2 text-sm outline-none"
                  value={contact.stageId ?? ""}
                  onChange={(event) => void onMoveContact(contact.id, event.target.value)}
                >
                  {stages.map((option) => (
                    <option key={option.id || "none"} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </article>
            ))}
            {!loading && stage.contacts.length === 0 && (
              <div className="rounded border border-dashed border-line p-4 text-center text-sm text-slate-500">
                Nenhum lead nesta etapa.
              </div>
            )}
          </div>
        </section>
      ))}
      </div>
    </div>
  );
}

function Contatos({
  contacts,
  loading,
  filters,
  reference,
  onFiltersChange,
  onCreateContact,
  onImportContacts,
  onBulkContacts,
  onCreateContactNote,
  onCreateTask,
  onCompleteTask,
  onUpdateContact,
  onArchiveContact
}: {
  contacts: ContactRow[];
  loading: boolean;
  filters: {
    search: string;
    status: string;
    originId: string;
    stageId: string;
    ownerId: string;
    tagId: string;
    temperature: string;
  };
  reference: ReferenceData;
  onFiltersChange: (filters: {
    search: string;
    status: string;
    originId: string;
    stageId: string;
    ownerId: string;
    tagId: string;
    temperature: string;
  }) => void;
  onCreateContact: (payload: {
    name: string;
    phone: string;
    email: string;
    cpf: string;
    originId: string;
    stageId: string;
    ownerId: string;
    tagIds?: string[];
    temperature: ContactRow["temperature"];
  }) => Promise<void>;
  onImportContacts: (payload: {
    csv: string;
    defaults: { originId: string; stageId: string; ownerId: string };
  }) => Promise<ImportResult | null>;
  onBulkContacts: (payload: {
    contactIds: string[];
    ownerId?: string;
    stageId?: string;
    tagId?: string;
    archived?: boolean;
  }) => Promise<void>;
  onCreateContactNote: (
    contactId: string,
    detail: string
  ) => Promise<ContactActivityRow | null>;
  onCreateTask: (payload: {
    contactId: string;
    assigneeId: string;
    title: string;
    note: string;
    dueAt: string;
  }) => Promise<TaskRow | null>;
  onCompleteTask: (taskId: string) => Promise<TaskRow | null>;
  onUpdateContact: (
    id: string,
    payload: Partial<{
      name: string;
      phone: string;
      email: string;
      cpf: string;
      originId: string;
      stageId: string;
      ownerId: string;
      tagIds: string[];
      temperature: ContactRow["temperature"];
      lastMessage: string;
      archived: boolean;
    }>
  ) => Promise<ContactRow | null>;
  onArchiveContact: (id: string) => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importForm, setImportForm] = useState({
    csv: "",
    fileName: "",
    originId: "",
    stageId: "",
    ownerId: ""
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkForm, setBulkForm] = useState({
    ownerId: "",
    stageId: "",
    tagId: ""
  });
  const [selectedContact, setSelectedContact] = useState<ContactRow | null>(null);
  const [editingContact, setEditingContact] = useState<ContactRow | null>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    cpf: "",
    originId: "",
    stageId: "",
    ownerId: "",
    temperature: "WARM" as ContactRow["temperature"]
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onCreateContact(form);
    setForm({
      name: "",
      phone: "",
      email: "",
      cpf: "",
      originId: "",
      stageId: "",
      ownerId: "",
      temperature: "WARM"
    });
    setShowForm(false);
  }

  async function handleImportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importForm.csv.trim()) return;

    setImportLoading(true);
    const result = await onImportContacts({
      csv: importForm.csv,
      defaults: {
        originId: importForm.originId,
        stageId: importForm.stageId,
        ownerId: importForm.ownerId
      }
    });
    setImportResult(result);
    setImportLoading(false);
  }

  async function handleExportContacts() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const response = await fetch(`/api/contacts/export?${params.toString()}`);

    if (!response.ok) return;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `contatos-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((contactId) => contactId !== id)
        : [...current, id]
    );
  }

  async function applyBulk(payload: {
    ownerId?: string;
    stageId?: string;
    tagId?: string;
    archived?: boolean;
  }) {
    if (!selectedIds.length) return;
    await onBulkContacts({ contactIds: selectedIds, ...payload });
    setSelectedIds([]);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <section className="rounded border border-line bg-white shadow-soft">
        <div className="flex flex-col gap-3 border-b border-line p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-bold">Contatos</h3>
            <p className="text-sm text-slate-500">Leads, clientes e historico comercial.</p>
          </div>
          <div className="flex gap-2">
            <button
              className="flex h-10 items-center gap-2 rounded border border-line px-3 text-sm"
              onClick={() => void handleExportContacts()}
            >
              <Download className="h-4 w-4" />
              Exportar
            </button>
            <button
              className="flex h-10 items-center gap-2 rounded border border-line px-3 text-sm"
              onClick={() => setShowImport((current) => !current)}
            >
              <Upload className="h-4 w-4" />
              Importar
            </button>
            <button
              className="flex h-10 items-center gap-2 rounded bg-brand px-3 text-sm font-semibold text-white"
              onClick={() => setShowForm((current) => !current)}
            >
              <Plus className="h-4 w-4" />
              Novo contato
            </button>
          </div>
        </div>

        {showImport && (
          <form
            className="space-y-4 border-b border-line bg-slate-50 p-5"
            onSubmit={handleImportSubmit}
          >
            <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_180px]">
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded border border-line bg-white px-3 text-sm">
                <Upload className="h-4 w-4 text-slate-400" />
                <span className="truncate">
                  {importForm.fileName || "Selecionar CSV"}
                </span>
                <input
                  accept=".csv,text/csv"
                  className="hidden"
                  type="file"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const csv = await file.text();
                    setImportForm((current) => ({
                      ...current,
                      csv,
                      fileName: file.name
                    }));
                    setImportResult(null);
                  }}
                />
              </label>
              <ReferenceSelect
                label="Origem padrao"
                value={importForm.originId}
                options={reference.origins}
                onChange={(value) =>
                  setImportForm((current) => ({ ...current, originId: value }))
                }
              />
              <ReferenceSelect
                label="Etapa padrao"
                value={importForm.stageId}
                options={reference.stages}
                onChange={(value) =>
                  setImportForm((current) => ({ ...current, stageId: value }))
                }
              />
              <ReferenceSelect
                label="Responsavel padrao"
                value={importForm.ownerId}
                options={reference.users}
                onChange={(value) =>
                  setImportForm((current) => ({ ...current, ownerId: value }))
                }
              />
            </div>

            <textarea
              className="min-h-28 w-full rounded border border-line bg-white p-3 text-sm outline-none"
              placeholder="Ou cole aqui: nome,telefone,cpf,email,origem,etapa,responsavel,tags,temperatura"
              value={importForm.csv}
              onChange={(event) =>
                setImportForm((current) => ({
                  ...current,
                  csv: event.target.value,
                  fileName: current.fileName
                }))
              }
            />

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-xs text-slate-500">
                Cabeçalhos aceitos: nome, telefone, CPF, email, origem, etapa,
                responsavel, tags e temperatura.
              </p>
              <button
                className="h-10 rounded bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50"
                disabled={importLoading || !importForm.csv.trim()}
              >
                {importLoading ? "Importando..." : "Processar CSV"}
              </button>
            </div>

            {importResult && (
              <div className="grid gap-3 rounded border border-line bg-white p-4 text-sm md:grid-cols-4">
                <Info label="Linhas" value={String(importResult.summary.totalRows)} />
                <Info label="Criados" value={String(importResult.summary.created)} />
                <Info label="Ignorados" value={String(importResult.summary.ignored)} />
                <Info label="Erros" value={String(importResult.summary.errors)} />
                {(importResult.ignored.length > 0 || importResult.errors.length > 0) && (
                  <div className="md:col-span-4">
                    {[...importResult.errors, ...importResult.ignored].slice(0, 5).map((item) => (
                      <p key={`${item.row}-${item.reason}`} className="text-xs text-slate-500">
                        Linha {item.row}: {item.reason}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </form>
        )}

        {showForm && (
          <form
            className="grid gap-3 border-b border-line bg-slate-50 p-5 md:grid-cols-3"
            onSubmit={handleSubmit}
          >
            <ContactInput
              placeholder="Nome"
              required
              value={form.name}
              onChange={(value) => setForm((current) => ({ ...current, name: value }))}
            />
            <ContactInput
              placeholder="Telefone"
              required
              value={form.phone}
              onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
            />
            <ContactInput
              placeholder="CPF"
              value={form.cpf}
              onChange={(value) => setForm((current) => ({ ...current, cpf: value }))}
            />
            <ContactInput
              placeholder="Email"
              type="email"
              value={form.email}
              onChange={(value) => setForm((current) => ({ ...current, email: value }))}
            />
            <ReferenceSelect
              label="Origem"
              value={form.originId}
              options={reference.origins}
              onChange={(value) => setForm((current) => ({ ...current, originId: value }))}
            />
            <ReferenceSelect
              label="Responsavel"
              value={form.ownerId}
              options={reference.users}
              onChange={(value) => setForm((current) => ({ ...current, ownerId: value }))}
            />
            <div className="flex gap-2">
              <ReferenceSelect
                label="Etapa"
                value={form.stageId}
                options={reference.stages}
                onChange={(value) => setForm((current) => ({ ...current, stageId: value }))}
              />
              <button className="h-10 rounded bg-brand px-4 text-sm font-semibold text-white">
                Salvar
              </button>
            </div>
          </form>
        )}

        <div className="grid gap-3 border-b border-line p-5 lg:grid-cols-[1.4fr_150px_150px_150px_150px_130px_120px]">
          <div className="flex items-center gap-2 rounded border border-line px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              className="w-full outline-none"
              placeholder="Buscar por nome, telefone, CPF ou email..."
              value={filters.search}
              onChange={(event) =>
                onFiltersChange({ ...filters, search: event.target.value })
              }
            />
          </div>
          <ReferenceSelect
            label="Origem"
            value={filters.originId}
            options={reference.origins}
            onChange={(value) => onFiltersChange({ ...filters, originId: value })}
          />
          <ReferenceSelect
            label="Etapa"
            value={filters.stageId}
            options={reference.stages}
            onChange={(value) => onFiltersChange({ ...filters, stageId: value })}
          />
          <ReferenceSelect
            label="Responsavel"
            value={filters.ownerId}
            options={reference.users}
            onChange={(value) => onFiltersChange({ ...filters, ownerId: value })}
          />
          <ReferenceSelect
            label="Tag"
            value={filters.tagId}
            options={reference.tags}
            onChange={(value) => onFiltersChange({ ...filters, tagId: value })}
          />
          <select
            className="h-10 rounded border border-line px-3 outline-none"
            value={filters.temperature}
            onChange={(event) =>
              onFiltersChange({ ...filters, temperature: event.target.value })
            }
          >
            <option value="">Temperatura</option>
            <option value="HOT">Quente</option>
            <option value="WARM">Morno</option>
            <option value="COLD">Frio</option>
          </select>
          <select
            className="h-10 rounded border border-line px-3 outline-none"
            value={filters.status}
            onChange={(event) =>
              onFiltersChange({ ...filters, status: event.target.value })
            }
          >
            <option value="active">Ativos</option>
            <option value="archived">Arquivados</option>
          </select>
        </div>

        {selectedIds.length > 0 && (
          <div className="grid gap-3 border-b border-line bg-teal-50 p-4 md:grid-cols-[auto_1fr_1fr_1fr_auto_auto] md:items-center">
            <span className="text-sm font-semibold text-brand">
              {selectedIds.length} selecionado(s)
            </span>
            <ReferenceSelect
              label="Responsavel"
              value={bulkForm.ownerId}
              options={reference.users}
              onChange={(value) => setBulkForm((current) => ({ ...current, ownerId: value }))}
            />
            <ReferenceSelect
              label="Etapa"
              value={bulkForm.stageId}
              options={reference.stages}
              onChange={(value) => setBulkForm((current) => ({ ...current, stageId: value }))}
            />
            <ReferenceSelect
              label="Aplicar tag"
              value={bulkForm.tagId}
              options={reference.tags}
              onChange={(value) => setBulkForm((current) => ({ ...current, tagId: value }))}
            />
            <button
              className="h-10 rounded bg-brand px-3 text-sm font-semibold text-white disabled:opacity-50"
              disabled={!bulkForm.ownerId && !bulkForm.stageId && !bulkForm.tagId}
              onClick={() =>
                void applyBulk({
                  ...(bulkForm.ownerId ? { ownerId: bulkForm.ownerId } : {}),
                  ...(bulkForm.stageId ? { stageId: bulkForm.stageId } : {}),
                  ...(bulkForm.tagId ? { tagId: bulkForm.tagId } : {})
                })
              }
            >
              Aplicar
            </button>
            <button
              className="h-10 rounded border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700"
              onClick={() => void applyBulk({ archived: filters.status !== "archived" })}
            >
              {filters.status === "archived" ? "Reativar" : "Arquivar"}
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="border-b border-line px-5 py-3">
                  <input
                    checked={contacts.length > 0 && selectedIds.length === contacts.length}
                    type="checkbox"
                    onChange={(event) =>
                      setSelectedIds(event.target.checked ? contacts.map((contact) => contact.id) : [])
                    }
                  />
                </th>
                {[
                  "Nome",
                  "Telefone",
                  "Origem",
                  "Etapa",
                  "Responsavel",
                  "Temperatura",
                  "Atualizado",
                  "Acoes"
                ].map((head) => (
                  <th key={head} className="border-b border-line px-5 py-3 font-semibold">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr
                  key={contact.id}
                  className={clsx(
                    "hover:bg-slate-50",
                    selectedContact?.id === contact.id && "bg-teal-50/60"
                  )}
                >
                  <td className="border-b border-line px-5 py-4">
                    <input
                      checked={selectedIds.includes(contact.id)}
                      type="checkbox"
                      onChange={() => toggleSelected(contact.id)}
                    />
                  </td>
                  <td className="border-b border-line px-5 py-4">
                    <button
                      className="text-left font-semibold text-ink"
                      onClick={() => {
                        setSelectedContact(contact);
                        setEditingContact(null);
                      }}
                    >
                      {contact.name}
                      {contact.archivedAt && (
                        <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs font-normal text-slate-600">
                          arquivado
                        </span>
                      )}
                    </button>
                    {contact.email && (
                      <p className="mt-1 text-xs text-slate-500">{contact.email}</p>
                    )}
                  </td>
                  <td className="border-b border-line px-5 py-4">{contact.phone}</td>
                  <td className="border-b border-line px-5 py-4">{contact.origin}</td>
                  <td className="border-b border-line px-5 py-4">{contact.stage}</td>
                  <td className="border-b border-line px-5 py-4">{contact.owner}</td>
                  <td className="border-b border-line px-5 py-4">
                    {temperatureLabels[contact.temperature]}
                  </td>
                  <td className="border-b border-line px-5 py-4">
                    {formatRelativeDate(contact.updatedAt)}
                  </td>
                  <td className="border-b border-line px-5 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        className="grid h-8 w-8 place-items-center rounded border border-line"
                        title="Editar"
                        onClick={() => {
                          setSelectedContact(contact);
                          setEditingContact(contact);
                        }}
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      {contact.archivedAt ? (
                        <button
                          className="grid h-8 w-8 place-items-center rounded border border-line"
                          title="Reativar"
                          onClick={async () => {
                            const updated = await onUpdateContact(contact.id, {
                              archived: false
                            });
                            if (updated) setSelectedContact(updated);
                          }}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          className="grid h-8 w-8 place-items-center rounded border border-line text-berry"
                          title="Arquivar"
                          onClick={() => void onArchiveContact(contact.id)}
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && contacts.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              Nenhum contato encontrado.
            </div>
          )}
          {loading && (
            <div className="p-8 text-center text-sm text-slate-500">
              Carregando contatos...
            </div>
          )}
        </div>
      </section>

      <ContactDrawer
        contact={selectedContact}
        editingContact={editingContact}
        reference={reference}
        onClose={() => {
          setSelectedContact(null);
          setEditingContact(null);
        }}
        onEdit={() => setEditingContact(selectedContact)}
        onCancelEdit={() => setEditingContact(null)}
        onCreateNote={onCreateContactNote}
        onCreateTask={onCreateTask}
        onCompleteTask={onCompleteTask}
        onSave={async (id, payload) => {
          const updated = await onUpdateContact(id, payload);
          if (updated) {
            setSelectedContact(updated);
            setEditingContact(null);
          }
        }}
      />
    </div>
  );
}

function ContactInput({
  value,
  onChange,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange">) {
  return (
    <input
      className="h-10 rounded border border-line px-3 outline-none"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...props}
    />
  );
}

function ReferenceSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<{ id: string; name: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="h-10 min-w-0 rounded border border-line px-3 outline-none"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  );
}

function ContactDrawer({
  contact,
  editingContact,
  reference,
  onClose,
  onEdit,
  onCancelEdit,
  onCreateNote,
  onCreateTask,
  onCompleteTask,
  onSave
}: {
  contact: ContactRow | null;
  editingContact: ContactRow | null;
  reference: ReferenceData;
  onClose: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onCreateNote: (
    contactId: string,
    detail: string
  ) => Promise<ContactActivityRow | null>;
  onCreateTask: (payload: {
    contactId: string;
    assigneeId: string;
    title: string;
    note: string;
    dueAt: string;
  }) => Promise<TaskRow | null>;
  onCompleteTask: (taskId: string) => Promise<TaskRow | null>;
  onSave: (
    id: string,
    payload: Partial<{
      name: string;
      phone: string;
      email: string;
      cpf: string;
      originId: string;
      stageId: string;
      ownerId: string;
      tagIds: string[];
      temperature: ContactRow["temperature"];
      lastMessage: string;
    }>
  ) => Promise<void>;
}) {
  const [activities, setActivities] = useState<ContactActivityRow[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [note, setNote] = useState("");
  const [taskForm, setTaskForm] = useState({
    title: "",
    note: "",
    dueAt: "",
    assigneeId: ""
  });
  const [draft, setDraft] = useState({
    name: "",
    phone: "",
    email: "",
    cpf: "",
    originId: "",
    stageId: "",
    ownerId: "",
    tagIds: [] as string[],
    temperature: "WARM" as ContactRow["temperature"],
    lastMessage: ""
  });

  useEffect(() => {
    if (!editingContact) return;
    setDraft({
      name: editingContact.name,
      phone: editingContact.phone,
      email: editingContact.email ?? "",
      cpf: editingContact.cpf ?? "",
      originId: editingContact.originId ?? "",
      stageId: editingContact.stageId ?? "",
      ownerId: editingContact.ownerId ?? "",
      tagIds: editingContact.tags.map((tag) => tag.id),
      temperature: editingContact.temperature,
      lastMessage: editingContact.lastMessage ?? ""
    });
  }, [editingContact]);

  useEffect(() => {
    if (!contact) {
      setActivities([]);
      return;
    }

    let active = true;
    setActivitiesLoading(true);
    fetch(`/api/contacts/${contact.id}/activities`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { activities?: ContactActivityRow[] } | null) => {
        if (active) setActivities(data?.activities ?? []);
      })
      .finally(() => {
        if (active) setActivitiesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [contact]);

  useEffect(() => {
    if (!contact) {
      setTasks([]);
      return;
    }

    let active = true;
    setTasksLoading(true);
    fetch(`/api/tasks?contactId=${contact.id}&status=ALL`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { tasks?: TaskRow[] } | null) => {
        if (active) setTasks(data?.tasks ?? []);
      })
      .finally(() => {
        if (active) setTasksLoading(false);
      });

    setTaskForm((current) => ({
      ...current,
      assigneeId: contact.ownerId ?? "",
      dueAt: current.dueAt || new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString().slice(0, 16)
    }));

    return () => {
      active = false;
    };
  }, [contact]);

  if (!contact) {
    return (
      <aside className="rounded border border-line bg-white p-5 shadow-soft">
        <h3 className="font-bold">Ficha do cliente</h3>
        <p className="mt-2 text-sm text-slate-500">
          Selecione um contato para ver historico, dados comerciais e proximas acoes.
        </p>
      </aside>
    );
  }

  const isEditing = Boolean(editingContact);

  return (
    <aside className="rounded border border-line bg-white shadow-soft">
      <div className="flex items-start justify-between border-b border-line p-5">
        <div>
          <p className="text-xs font-semibold uppercase text-brand">Ficha</p>
          <h3 className="mt-1 text-lg font-bold">{contact.name}</h3>
          <p className="text-sm text-slate-500">{contact.phone}</p>
        </div>
        <button className="grid h-8 w-8 place-items-center rounded border border-line" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-5 p-5">
        {isEditing ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onSave(contact.id, draft);
            }}
          >
            <ContactInput value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} placeholder="Nome" />
            <ContactInput value={draft.phone} onChange={(value) => setDraft((current) => ({ ...current, phone: value }))} placeholder="Telefone" />
            <ContactInput value={draft.cpf} onChange={(value) => setDraft((current) => ({ ...current, cpf: value }))} placeholder="CPF" />
            <ContactInput value={draft.email} onChange={(value) => setDraft((current) => ({ ...current, email: value }))} placeholder="Email" type="email" />
            <ReferenceSelect label="Origem" value={draft.originId} options={reference.origins} onChange={(value) => setDraft((current) => ({ ...current, originId: value }))} />
            <ReferenceSelect label="Etapa" value={draft.stageId} options={reference.stages} onChange={(value) => setDraft((current) => ({ ...current, stageId: value }))} />
            <ReferenceSelect label="Responsavel" value={draft.ownerId} options={reference.users} onChange={(value) => setDraft((current) => ({ ...current, ownerId: value }))} />
            <div className="rounded border border-line p-3">
              <p className="mb-2 text-sm font-semibold">Tags</p>
              <div className="flex flex-wrap gap-2">
                {reference.tags.map((tag) => {
                  const active = draft.tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      className={clsx(
                        "rounded border px-2 py-1 text-xs font-semibold",
                        active ? "border-transparent text-white" : "border-line text-slate-600"
                      )}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          tagIds: active
                            ? current.tagIds.filter((id) => id !== tag.id)
                            : [...current.tagIds, tag.id]
                        }))
                      }
                      style={active ? { backgroundColor: tag.color } : undefined}
                      type="button"
                    >
                      {tag.name}
                    </button>
                  );
                })}
                {reference.tags.length === 0 && (
                  <span className="text-sm text-slate-500">Nenhuma tag configurada.</span>
                )}
              </div>
            </div>
            <select
              className="h-10 w-full rounded border border-line px-3 outline-none"
              value={draft.temperature}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  temperature: event.target.value as ContactRow["temperature"]
                }))
              }
            >
              <option value="HOT">Quente</option>
              <option value="WARM">Morno</option>
              <option value="COLD">Frio</option>
            </select>
            <textarea
              className="min-h-24 w-full rounded border border-line p-3 text-sm outline-none"
              value={draft.lastMessage}
              onChange={(event) =>
                setDraft((current) => ({ ...current, lastMessage: event.target.value }))
              }
              placeholder="Observacao ou ultima mensagem importante"
            />
            <div className="flex gap-2">
              <button className="h-10 flex-1 rounded bg-brand px-4 text-sm font-semibold text-white">
                Salvar
              </button>
              <button
                className="h-10 rounded border border-line px-4 text-sm font-semibold"
                onClick={onCancelEdit}
                type="button"
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <>
            <dl className="space-y-3 text-sm">
              <Info label="Email" value={contact.email ?? "Nao informado"} />
              <Info label="CPF" value={contact.cpf ?? "Nao informado"} />
              <Info label="Origem" value={contact.origin} />
              <Info label="Etapa" value={contact.stage} />
              <Info label="Temperatura" value={temperatureLabels[contact.temperature]} />
              <Info label="Responsavel" value={contact.owner} />
              <Info label="Criado" value={new Date(contact.createdAt).toLocaleDateString("pt-BR")} />
            </dl>
            <div className="flex flex-wrap gap-2">
              {contact.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded px-2 py-1 text-xs font-semibold text-white"
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
              {contact.tags.length === 0 && (
                <span className="text-sm text-slate-500">Sem tags aplicadas.</span>
              )}
            </div>
            <button
              className="flex h-10 w-full items-center justify-center gap-2 rounded border border-line text-sm font-semibold"
              onClick={onEdit}
            >
              <Edit3 className="h-4 w-4" />
              Editar ficha
            </button>
          </>
        )}

        <div className="rounded border border-line p-4">
          <h4 className="font-semibold">Resumo operacional</h4>
          <p className="mt-2 text-sm text-slate-600">
            {contact.lastMessage ?? "Sem observacoes registradas para este contato."}
          </p>
        </div>

        <div className="rounded border border-line p-4">
          <h4 className="font-semibold">Anotacao manual</h4>
          <form
            className="mt-3 space-y-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!note.trim()) return;
              const activity = await onCreateNote(contact.id, note);
              if (activity) {
                setActivities((current) => [activity, ...current]);
                setNote("");
              }
            }}
          >
            <textarea
              className="min-h-20 w-full rounded border border-line p-3 text-sm outline-none"
              placeholder="Registrar observacao, combinados ou pendencias"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <button
              className="h-9 rounded bg-brand px-3 text-sm font-semibold text-white disabled:opacity-50"
              disabled={!note.trim()}
            >
              Salvar anotacao
            </button>
          </form>
        </div>

        <div className="rounded border border-line p-4">
          <h4 className="font-semibold">Follow-up</h4>
          <form
            className="mt-3 space-y-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!taskForm.title.trim() || !taskForm.dueAt) return;

              const task = await onCreateTask({
                contactId: contact.id,
                assigneeId: taskForm.assigneeId,
                title: taskForm.title,
                note: taskForm.note,
                dueAt: new Date(taskForm.dueAt).toISOString()
              });

              if (task) {
                setTasks((current) => [task, ...current]);
                setTaskForm((current) => ({ ...current, title: "", note: "" }));
              }
            }}
          >
            <ContactInput
              placeholder="Proximo passo"
              value={taskForm.title}
              onChange={(value) =>
                setTaskForm((current) => ({ ...current, title: value }))
              }
            />
            <div className="grid gap-2 md:grid-cols-2">
              <input
                className="h-10 rounded border border-line px-3 text-sm outline-none"
                type="datetime-local"
                value={taskForm.dueAt}
                onChange={(event) =>
                  setTaskForm((current) => ({ ...current, dueAt: event.target.value }))
                }
              />
              <ReferenceSelect
                label="Responsavel"
                value={taskForm.assigneeId}
                options={reference.users}
                onChange={(value) =>
                  setTaskForm((current) => ({ ...current, assigneeId: value }))
                }
              />
            </div>
            <textarea
              className="min-h-16 w-full rounded border border-line p-3 text-sm outline-none"
              placeholder="Detalhe opcional"
              value={taskForm.note}
              onChange={(event) =>
                setTaskForm((current) => ({ ...current, note: event.target.value }))
              }
            />
            <button
              className="h-9 rounded bg-brand px-3 text-sm font-semibold text-white disabled:opacity-50"
              disabled={!taskForm.title.trim() || !taskForm.dueAt}
            >
              Criar tarefa
            </button>
          </form>

          <div className="mt-4 space-y-2">
            {tasksLoading && <p className="text-sm text-slate-500">Carregando tarefas...</p>}
            {!tasksLoading && tasks.length === 0 && (
              <p className="text-sm text-slate-500">Nenhuma tarefa registrada.</p>
            )}
            {tasks.map((task) => {
              const overdue =
                task.status === "PENDING" && new Date(task.dueAt).getTime() < Date.now();
              return (
                <div key={task.id} className="rounded border border-line p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{task.title}</p>
                      {task.note && <p className="mt-1 text-slate-600">{task.note}</p>}
                      <p
                        className={clsx(
                          "mt-1 text-xs",
                          overdue ? "text-rose-600" : "text-slate-500"
                        )}
                      >
                        {new Date(task.dueAt).toLocaleString("pt-BR")}
                        {task.assignee ? ` por ${task.assignee.name}` : ""}
                      </p>
                    </div>
                    {task.status === "PENDING" ? (
                      <button
                        className="grid h-8 w-8 place-items-center rounded border border-line text-brand"
                        onClick={async () => {
                          const updated = await onCompleteTask(task.id);
                          if (updated) {
                            setTasks((current) =>
                              current.map((item) => (item.id === updated.id ? updated : item))
                            );
                          }
                        }}
                        title="Concluir tarefa"
                        type="button"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    ) : (
                      <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                        Concluida
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h4 className="font-semibold">Historico</h4>
          <div className="mt-3 space-y-3">
            {activitiesLoading && (
              <p className="text-sm text-slate-500">Carregando historico...</p>
            )}
            {!activitiesLoading && activities.length === 0 && (
              <p className="text-sm text-slate-500">Nenhuma atividade registrada.</p>
            )}
            {activities.map((activity) => (
              <div key={activity.id} className="rounded border border-line p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{activity.title}</p>
                    {activity.detail && (
                      <p className="mt-1 text-slate-600">{activity.detail}</p>
                    )}
                  </div>
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-500">
                    {activity.type}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {formatRelativeDate(activity.createdAt)}
                  {activity.user ? ` por ${activity.user.name}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="font-semibold">Conversas recentes</h4>
          <div className="mt-3 space-y-2">
            {contact.conversations.length === 0 && (
              <p className="text-sm text-slate-500">Nenhuma conversa registrada.</p>
            )}
            {contact.conversations.map((conversation) => (
              <div key={conversation.id} className="rounded border border-line p-3 text-sm">
                <p className="font-semibold">{conversation.channel} - {conversation.status}</p>
                <p className="mt-1 text-slate-500">{formatRelativeDate(conversation.updatedAt)}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="font-semibold">Propostas</h4>
          <div className="mt-3 space-y-2">
            {contact.proposals.length === 0 && (
              <p className="text-sm text-slate-500">Nenhuma proposta criada.</p>
            )}
            {contact.proposals.map((proposal) => (
              <div key={proposal.id} className="rounded border border-line p-3 text-sm">
                <p className="font-semibold">{proposal.product} - {proposal.bank}</p>
                <p className="mt-1 text-slate-500">R$ {proposal.amount} - {proposal.status}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
function SimulacaoClt({
  contacts,
  initialDraft,
  onProposalCreated
}: {
  contacts: ContactRow[];
  initialDraft: CltSimulationDraft | null;
  onProposalCreated: () => Promise<void>;
}) {
  const [banks, setBanks] = useState<CltBankRow[]>([]);
  const [integrations, setIntegrations] = useState<CltIntegrationRow[]>([]);
  const [logs, setLogs] = useState<CltLogRow[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [simulationLoading, setSimulationLoading] = useState(false);
  const [testingBankId, setTestingBankId] = useState("");
  const [authenticatingBankId, setAuthenticatingBankId] = useState("");
  const [verifyingSmsBankId, setVerifyingSmsBankId] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [customer, setCustomer] = useState<CltCustomerData | null>(null);
  const [offers, setOffers] = useState<CltSimulationOffer[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    bankId: "",
    cpf: "",
    phone: "",
    product: "",
    income: "1621",
    availableMargin: "372.76",
    installmentAmount: "372.76",
    installments: "48",
    includeInsurance: true
  });
  const [integrationForm, setIntegrationForm] = useState({
    bankId: "",
    provider: "manual",
    baseUrl: "",
    authType: "none",
    apiKey: "",
    username: "",
    password: "",
    newcorbanIdentifier: "",
    smsCode: "",
    digitadorCode: "",
    certifiedAgentCpf: "",
    actingUf: "",
    status: "MANUAL"
  });

  const selectedBank = banks.find((bank) => bank.id === form.bankId);
  const selectedIntegration = integrations.find(
    (integration) => integration.bankId === integrationForm.bankId
  );
  const selectedOffer = offers.find((offer) => offer.id === selectedOfferId) ?? offers[0];

  useEffect(() => {
    let active = true;

    async function loadBanks() {
      setLoadingBanks(true);
      const response = await fetch("/api/clt/banks");
      if (response.ok) {
        const data = (await response.json()) as { banks: CltBankRow[] };
        if (!active) return;
        setBanks(data.banks);
        setForm((current) => ({
          ...current,
          bankId: current.bankId || data.banks[0]?.id || "",
          product: current.product || data.banks[0]?.products[0] || ""
        }));
      }
      if (active) setLoadingBanks(false);
    }

    void loadBanks();

    return () => {
      active = false;
    };
  }, []);

  async function loadCltIntegrations() {
    setLoadingIntegrations(true);
    const response = await fetch("/api/clt/integrations");
    if (response.ok) {
      const data = (await response.json()) as { integrations: CltIntegrationRow[] };
      setIntegrations(data.integrations);
      const first = data.integrations[0];
      if (first) {
        setIntegrationForm({
          bankId: first.bankId,
          provider: first.provider,
          baseUrl: first.baseUrl || "",
          authType: first.authType,
          apiKey: "",
          username: first.username || "",
          password: "",
          newcorbanIdentifier: first.newcorbanIdentifier || "",
          smsCode: "",
          digitadorCode: first.digitadorCode || "",
          certifiedAgentCpf: first.certifiedAgentCpf || "",
          actingUf: first.actingUf || "",
          status: first.status
        });
      }
    }
    setLoadingIntegrations(false);
  }

  async function loadCltLogs() {
    setLoadingLogs(true);
    const response = await fetch("/api/clt/logs?take=50");
    if (response.ok) {
      const data = (await response.json()) as { logs: CltLogRow[] };
      setLogs(data.logs);
    }
    setLoadingLogs(false);
  }

  useEffect(() => {
    void loadCltIntegrations();
    void loadCltLogs();
  }, []);

  useEffect(() => {
    if (!initialDraft) return;

    setSelectedContactId(initialDraft.contactId || "");
    setCustomer(null);
    setOffers([]);
    setSelectedOfferId("");
    setMessage(
      initialDraft.name
        ? `Simulacao iniciada para ${initialDraft.name}.`
        : "Simulacao iniciada a partir do atendimento."
    );
    setForm((current) => ({
      ...current,
      cpf: initialDraft.cpf || current.cpf,
      phone: initialDraft.phone || current.phone
    }));
  }, [initialDraft]);

  function updateForm(field: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleContactSelect(contactId: string) {
    setSelectedContactId(contactId);
    const contact = contacts.find((item) => item.id === contactId);
    if (!contact) return;

    setForm((current) => ({
      ...current,
      cpf: contact.cpf || current.cpf,
      phone: contact.phone || current.phone
    }));
  }

  async function handleCustomerLookup() {
    setCustomerLoading(true);
    setMessage("");

    const response = await fetch("/api/clt/customer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cpf: form.cpf, phone: form.phone })
    });
    const data = (await response.json().catch(() => null)) as
      | { customer?: CltCustomerData; error?: string }
      | null;

    if (response.ok && data?.customer) {
      setCustomer(data.customer);
      setForm((current) => ({
        ...current,
        cpf: data.customer!.cpf,
        phone: data.customer!.phone || current.phone,
        income: String(data.customer!.income),
        availableMargin: String(data.customer!.availableMargin),
        installmentAmount: String(data.customer!.availableMargin)
      }));
      setMessage("Dados do trabalhador carregados.");
      void loadCltLogs();
    } else {
      setMessage(data?.error || "Nao foi possivel consultar o trabalhador.");
    }

    setCustomerLoading(false);
  }

  async function handleSimulation() {
    setSimulationLoading(true);
    setMessage("");

    const response = await fetch("/api/clt/simulations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bankId: form.bankId,
        cpf: form.cpf,
        phone: form.phone,
        product: form.product || selectedBank?.products[0],
        income: Number(form.income),
        availableMargin: Number(form.availableMargin),
        installmentAmount: Number(form.installmentAmount),
        installments: Number(form.installments),
        includeInsurance: form.includeInsurance
      })
    });
    const data = (await response.json().catch(() => null)) as
      | { offers?: CltSimulationOffer[]; provider?: string; mode?: string; nextStep?: string; error?: string }
      | null;

    if (response.ok && data?.offers?.length) {
      setOffers(data.offers);
      setSelectedOfferId(data.offers[0].id);
      setMessage(
        data.mode === "NEWCORBAN_ASSISTED"
          ? data.nextStep || "Simulacao pronta para conferencia no Newcorban."
          : "Simulacao CLT gerada."
      );
      void loadCltLogs();
    } else {
      setMessage(data?.error || "Nao foi possivel simular CLT.");
    }

    setSimulationLoading(false);
  }

  async function handleSaveProposal() {
    if (!customer || !selectedOffer) return;
    setSaving(true);
    setMessage("");

    const response = await fetch("/api/clt/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: selectedContactId || undefined,
        customer: { ...customer, phone: form.phone },
        offer: selectedOffer
      })
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (response.ok) {
      setMessage("Proposta CLT salva no CRM.");
      await onProposalCreated();
      void loadCltLogs();
    } else {
      setMessage(data?.error || "Nao foi possivel salvar proposta CLT.");
    }

    setSaving(false);
  }

  function selectIntegration(bankId: string) {
    const integration = integrations.find((item) => item.bankId === bankId);
    if (!integration) return;
    setIntegrationForm({
      bankId: integration.bankId,
      provider: integration.provider,
      baseUrl: integration.baseUrl || "",
      authType: integration.authType,
      apiKey: "",
      username: integration.username || "",
      password: "",
      newcorbanIdentifier: integration.newcorbanIdentifier || "",
      smsCode: "",
      digitadorCode: integration.digitadorCode || "",
      certifiedAgentCpf: integration.certifiedAgentCpf || "",
      actingUf: integration.actingUf || "",
      status: integration.status
    });
  }

  async function saveIntegration() {
    setMessage("");
    const response = await fetch("/api/clt/integrations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(integrationForm)
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (response.ok) {
      setMessage("Integracao CLT salva.");
      await loadCltIntegrations();
    } else {
      setMessage(data?.error || "Nao foi possivel salvar integracao CLT.");
    }
  }

  async function authenticateNewcorban() {
    if (!integrationForm.bankId) return;
    if (!integrationForm.password && !selectedIntegration?.hasPassword) {
      setMessage("Informe a senha do banco ou salve a integracao com a senha antes de entrar no perfil.");
      return;
    }
    setAuthenticatingBankId(integrationForm.bankId);
    setMessage("");
    try {
      const response = await fetch("/api/clt/integrations/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankId: integrationForm.bankId,
          username: integrationForm.username,
          password: integrationForm.password
        })
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string; message?: string; integration?: CltIntegrationRow }
        | null;

      if (response.ok) {
        setMessage(data?.message || "Fluxo assistido preparado.");
        if (data?.integration) {
          setIntegrations((current) =>
            current.map((item) =>
              item.bankId === data.integration!.bankId ? data.integration! : item
            )
          );
        }
        await loadCltIntegrations();
      } else {
        setMessage(data?.error || "Nao foi possivel autenticar Newcorban.");
      }
    } catch {
      setMessage("Falha de conexao ao preparar autenticacao Newcorban. Tente novamente.");
    } finally {
      setAuthenticatingBankId("");
    }
  }

  async function verifyNewcorbanSms() {
    if (!integrationForm.bankId) return;
    setVerifyingSmsBankId(integrationForm.bankId);
    setMessage("");
    const response = await fetch("/api/clt/integrations/verify-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bankId: integrationForm.bankId,
        smsCode: integrationForm.smsCode,
        newcorbanIdentifier: integrationForm.newcorbanIdentifier,
        digitadorCode: integrationForm.digitadorCode,
        certifiedAgentCpf: integrationForm.certifiedAgentCpf,
        actingUf: integrationForm.actingUf
      })
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: string; message?: string; integration?: CltIntegrationRow }
      | null;

    if (response.ok) {
      setMessage(data?.message || "Credenciais salvas.");
      if (data?.integration) {
        setIntegrations((current) =>
          current.map((item) => (item.bankId === data.integration!.bankId ? data.integration! : item))
        );
        setIntegrationForm((current) => ({
          ...current,
          smsCode: "",
          status: data.integration!.status
        }));
      }
      await loadCltIntegrations();
    } else {
      setMessage(data?.error || "Nao foi possivel validar SMS.");
    }
    setVerifyingSmsBankId("");
  }

  async function testIntegration(bankId: string) {
    setTestingBankId(bankId);
    setMessage("");
    const response = await fetch("/api/clt/integrations/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankId })
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (response.ok) {
      setMessage("Teste de integracao CLT concluido.");
      await loadCltIntegrations();
    } else {
      setMessage(data?.error || "Nao foi possivel testar integracao CLT.");
    }
    setTestingBankId("");
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-[28px] border border-line bg-white p-6 shadow-soft">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase text-primary">
              Credito do Trabalhador
            </p>
            <h2 className="mt-3 text-2xl font-black text-slate-950">Simulacao CLT</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Consulte dados, simule margem e salve a proposta vinculada ao atendimento do CRM.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Provider inicial: <span className="font-bold">manual/mock</span>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-[24px] border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-slate-950">Integrações CLT</h3>
              <p className="text-sm text-slate-500">
                Configure o provider de cada banco antes da API real.
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-line px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              onClick={() => void loadCltIntegrations()}
            >
              Atualizar
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[0.8fr_1.2fr]">
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {integrations.map((integration) => (
                <button
                  key={integration.id}
                  type="button"
                  className={clsx(
                    "w-full rounded-2xl border p-3 text-left",
                    integrationForm.bankId === integration.bankId
                      ? "border-primary bg-blue-50"
                      : "border-line bg-white hover:bg-slate-50"
                  )}
                  onClick={() => selectIntegration(integration.bankId)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-black text-slate-900">{integration.bankName}</p>
                    <IntegrationStatusBadge status={integration.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {integration.provider} · {integration.authType}
                  </p>
                  {integration.lastTestMessage && (
                    <p className="mt-2 line-clamp-2 text-xs text-slate-500">
                      {integration.lastTestMessage}
                    </p>
                  )}
                </button>
              ))}
              {!loadingIntegrations && !integrations.length && (
                <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-slate-500">
                  Nenhuma integração CLT cadastrada.
                </p>
              )}
            </div>

            <div className="grid gap-3 rounded-2xl border border-line bg-slate-50 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold uppercase text-slate-500">
                  Provider
                  <select
                    className="mt-2 h-10 w-full rounded-2xl border border-line bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-primary"
                    value={integrationForm.provider}
                    onChange={(event) =>
                      setIntegrationForm((current) => ({
                        ...current,
                        provider: event.target.value,
                        status: event.target.value === "manual" ? "MANUAL" : "PENDING"
                      }))
                    }
                  >
                    <option value="manual">Manual</option>
                    <option value="newcorban">New Corban</option>
                    <option value="bank-api">API do banco</option>
                  </select>
                </label>
                <label className="text-xs font-bold uppercase text-slate-500">
                  Autenticação
                  <select
                    className="mt-2 h-10 w-full rounded-2xl border border-line bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-primary"
                    value={integrationForm.authType}
                    onChange={(event) =>
                      setIntegrationForm((current) => ({
                        ...current,
                        authType: event.target.value
                      }))
                    }
                  >
                    <option value="none">Sem autenticação</option>
                    <option value="login-sms">Login + SMS</option>
                    <option value="api-key">API Key</option>
                    <option value="basic">Usuário e senha</option>
                    <option value="oauth">OAuth/Token</option>
                  </select>
                </label>
              </div>
              <ContactInput
                placeholder="URL base da API"
                value={integrationForm.baseUrl}
                onChange={(value) =>
                  setIntegrationForm((current) => ({ ...current, baseUrl: value }))
                }
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <ContactInput
                  placeholder={
                    selectedIntegration?.apiKeyPreview
                      ? `Token (${selectedIntegration.apiKeyPreview})`
                      : "Token/API key"
                  }
                  value={integrationForm.apiKey}
                  onChange={(value) =>
                    setIntegrationForm((current) => ({ ...current, apiKey: value }))
                  }
                />
                <ContactInput
                  placeholder="Usuário"
                  value={integrationForm.username}
                  onChange={(value) =>
                    setIntegrationForm((current) => ({ ...current, username: value }))
                  }
                />
                <ContactInput
                  placeholder={selectedIntegration?.hasPassword ? "Senha cadastrada" : "Senha"}
                  value={integrationForm.password}
                  onChange={(value) =>
                    setIntegrationForm((current) => ({ ...current, password: value }))
                  }
                />
              </div>
              {integrationForm.provider === "newcorban" && (
                <div className="grid gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-3">
                  <div>
                    <p className="text-sm font-black text-primary">Credenciais Mercantil/Newcorban</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Primeiro salve ou confirme o login e a senha. Nesta etapa o CRM apenas prepara
                      a autenticacao assistida; o SMS real ainda precisa ser solicitado no Newcorban
                      ate conectarmos a automacao/API do banco.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      className="h-10 flex-1 rounded-2xl bg-primary px-4 text-sm font-bold text-white shadow-soft disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                      disabled={
                        !integrationForm.bankId ||
                        !integrationForm.username ||
                        (!integrationForm.password && !selectedIntegration?.hasPassword) ||
                        authenticatingBankId === integrationForm.bankId
                      }
                      onClick={() => void authenticateNewcorban()}
                    >
                      {authenticatingBankId === integrationForm.bankId ? "Preparando..." : "Preparar autenticacao assistida"}
                    </button>
                    <span className="flex items-center rounded-2xl bg-white px-3 text-xs font-bold text-slate-500">
                      SMS: {selectedIntegration?.smsStatus || "nao solicitado"}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ContactInput
                      placeholder="Codigo SMS"
                      value={integrationForm.smsCode}
                      onChange={(value) =>
                        setIntegrationForm((current) => ({ ...current, smsCode: value }))
                      }
                    />
                    <ContactInput
                      placeholder="Identificador (opcional)"
                      value={integrationForm.newcorbanIdentifier}
                      onChange={(value) =>
                        setIntegrationForm((current) => ({ ...current, newcorbanIdentifier: value }))
                      }
                    />
                    <ContactInput
                      placeholder="Cod. Usuario Digitador"
                      value={integrationForm.digitadorCode}
                      onChange={(value) =>
                        setIntegrationForm((current) => ({ ...current, digitadorCode: value }))
                      }
                    />
                    <ContactInput
                      placeholder="CPF Agente Certificado"
                      value={integrationForm.certifiedAgentCpf}
                      onChange={(value) =>
                        setIntegrationForm((current) => ({ ...current, certifiedAgentCpf: value }))
                      }
                    />
                    <ContactInput
                      placeholder="UF Atuacao"
                      value={integrationForm.actingUf}
                      onChange={(value) =>
                        setIntegrationForm((current) => ({ ...current, actingUf: value.toUpperCase() }))
                      }
                    />
                    <button
                      type="button"
                      className="h-10 rounded-2xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-60"
                      disabled={
                        !integrationForm.bankId ||
                        !integrationForm.smsCode ||
                        !integrationForm.digitadorCode ||
                        !integrationForm.certifiedAgentCpf ||
                        !integrationForm.actingUf ||
                        verifyingSmsBankId === integrationForm.bankId
                      }
                      onClick={() => void verifyNewcorbanSms()}
                    >
                      {verifyingSmsBankId === integrationForm.bankId ? "Validando..." : "Validar SMS e salvar"}
                    </button>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="h-10 flex-1 rounded-2xl bg-primary px-4 text-sm font-bold text-white shadow-soft hover:bg-blue-700"
                  onClick={() => void saveIntegration()}
                >
                  Salvar login e senha
                </button>
                <button
                  type="button"
                  className="h-10 flex-1 rounded-2xl border border-line bg-white px-4 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                  disabled={!integrationForm.bankId || testingBankId === integrationForm.bankId}
                  onClick={() => void testIntegration(integrationForm.bankId)}
                >
                  {testingBankId === integrationForm.bankId ? "Testando..." : "Testar conexão"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[24px] border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-slate-950">Logs CLT</h3>
              <p className="text-sm text-slate-500">
                Auditoria de consulta, simulação e proposta.
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-line px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              onClick={() => void loadCltLogs()}
            >
              Atualizar
            </button>
          </div>
          <div className="mt-4 max-h-96 divide-y divide-line/70 overflow-y-auto rounded-2xl border border-line">
            {logs.map((log) => (
              <div key={log.id} className="grid gap-1 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-black text-slate-900">{cltActionLabel(log.action)}</p>
                  <span
                    className={clsx(
                      "rounded-full px-2 py-1 text-xs font-bold",
                      log.status === "ERROR"
                        ? "bg-rose-50 text-rose-700"
                        : "bg-emerald-50 text-emerald-700"
                    )}
                  >
                    {log.status === "ERROR" ? "Erro" : "Sucesso"}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {log.bankName || "Sem banco"} · {log.userName || "Sistema"} ·{" "}
                  {formatRelativeDate(log.createdAt)}
                </p>
                <p className="line-clamp-2 text-xs text-slate-600">{log.message || "-"}</p>
                <p className="truncate font-mono text-[10px] text-slate-400">
                  CPF {log.cpf || "-"} · Tel {log.phone || "-"}
                </p>
              </div>
            ))}
            {!loadingLogs && !logs.length && (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                Nenhum log CLT registrado ainda.
              </div>
            )}
            {loadingLogs && (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                Carregando logs...
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[24px] border border-line bg-white p-5 shadow-soft">
          <h3 className="text-lg font-black text-slate-950">Dados para consulta</h3>
          <div className="mt-4 grid gap-3">
            <label className="text-xs font-bold uppercase text-slate-500">
              Vincular contato existente
              <select
                className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-primary"
                value={selectedContactId}
                onChange={(event) => handleContactSelect(event.target.value)}
              >
                <option value="">Novo cliente ou sem vinculo</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name} - {contact.phone}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold uppercase text-slate-500">
                Banco
                <select
                  className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-primary"
                  disabled={loadingBanks}
                  value={form.bankId}
                  onChange={(event) => {
                    const bank = banks.find((item) => item.id === event.target.value);
                    setForm((current) => ({
                      ...current,
                      bankId: event.target.value,
                      product: bank?.products[0] || current.product
                    }));
                  }}
                >
                  {banks.map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-bold uppercase text-slate-500">
                Produto
                <select
                  className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-primary"
                  value={form.product}
                  onChange={(event) => updateForm("product", event.target.value)}
                >
                  {(selectedBank?.products || []).map((product) => (
                    <option key={product} value={product}>
                      {product}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedBank?.provider === "newcorban" && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-black text-primary">Fluxo Newcorban assistido</p>
                <p className="mt-1">
                  Para este banco, o CRM prepara CPF, telefone e oferta. A validacao de margem
                  deve ser conferida no Newcorban com login e codigo SMS ate ativarmos a
                  automacao completa.
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <ContactInput
                placeholder="CPF"
                required
                value={form.cpf}
                onChange={(value) => updateForm("cpf", value)}
              />
              <ContactInput
                placeholder="Celular"
                required
                value={form.phone}
                onChange={(value) => updateForm("phone", value)}
              />
            </div>

            <button
              type="button"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-white disabled:opacity-60"
              disabled={customerLoading || !form.cpf}
              onClick={() => void handleCustomerLookup()}
            >
              {customerLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Consultar dados
            </button>
          </div>
        </div>

        <div className="rounded-[24px] border border-line bg-white p-5 shadow-soft">
          <h3 className="text-lg font-black text-slate-950">Dados do trabalhador</h3>
          {customer ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <InfoField label="Nome" value={customer.name} />
              <InfoField label="Matricula" value={customer.registry} />
              <InfoField label="Nascimento" value={customer.birthDate} />
              <InfoField label="Empregador" value={customer.employerDocument} />
              <InfoField label="Renda" value={formatCurrency(customer.income)} />
              <InfoField label="Margem" value={formatCurrency(customer.availableMargin)} />
              <InfoField label="Cidade/UF" value={`${customer.city}/${customer.state}`} />
              <InfoField label="Endereco" value={`${customer.address}, ${customer.number}`} />
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-line p-6 text-sm text-slate-500">
              Informe CPF e telefone para buscar os dados do trabalhador.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[24px] border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-black text-slate-950">Simulador</h3>
            <p className="text-sm text-slate-500">
              Ajuste parcela, prazo e seguro antes de gerar a oferta.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-600">
            <input
              type="checkbox"
              checked={form.includeInsurance}
              onChange={(event) => updateForm("includeInsurance", event.target.checked)}
            />
            Incluir seguro prestamista
          </label>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <ContactInput
            placeholder="Renda"
            value={form.income}
            onChange={(value) => updateForm("income", value)}
          />
          <ContactInput
            placeholder="Margem disponivel"
            value={form.availableMargin}
            onChange={(value) => updateForm("availableMargin", value)}
          />
          <ContactInput
            placeholder="Valor parcela"
            value={form.installmentAmount}
            onChange={(value) => updateForm("installmentAmount", value)}
          />
          <ContactInput
            placeholder="Quantidade de parcelas"
            value={form.installments}
            onChange={(value) => updateForm("installments", value)}
          />
        </div>

        <button
          type="button"
          className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-sm font-bold text-white disabled:opacity-60"
          disabled={simulationLoading || !customer}
          onClick={() => void handleSimulation()}
        >
          {simulationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Nova simulacao
        </button>

        <div className="mt-5 overflow-hidden rounded-2xl border border-line">
          <div className="grid grid-cols-[0.7fr_1.4fr_0.7fr_0.8fr_0.9fr_0.9fr_0.8fr] gap-3 bg-slate-50 px-4 py-3 text-xs font-bold uppercase text-slate-500">
            <span>Tabela</span>
            <span>Nome</span>
            <span>Prazo</span>
            <span>Taxa</span>
            <span>Parcela</span>
            <span>Liberado</span>
            <span className="text-right">Acao</span>
          </div>
          <div className="divide-y divide-line/70">
            {offers.map((offer) => (
              <div
                key={offer.id}
                className={clsx(
                  "grid grid-cols-[0.7fr_1.4fr_0.7fr_0.8fr_0.9fr_0.9fr_0.8fr] gap-3 px-4 py-3 text-sm",
                  selectedOfferId === offer.id && "bg-blue-50/60"
                )}
              >
                <span className="font-bold text-slate-700">{offer.tableCode}</span>
                <span className="text-slate-600">{offer.tableName}</span>
                <span>{offer.installments}x</span>
                <span>{offer.monthlyRate.toFixed(2)}% a.m.</span>
                <span>{formatCurrency(offer.installmentAmount)}</span>
                <span className="font-black text-emerald-700">
                  {formatCurrency(offer.releasedAmount)}
                </span>
                <button
                  type="button"
                  className="justify-self-end rounded-full border border-primary/30 px-3 py-1 text-xs font-bold text-primary"
                  onClick={() => setSelectedOfferId(offer.id)}
                >
                  Selecionar
                </button>
              </div>
            ))}
            {!offers.length && (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                Aguardando simulacao.
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-slate-600">{message}</p>
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-bold text-white disabled:opacity-60"
            disabled={saving || !selectedOffer || !customer}
            onClick={() => void handleSaveProposal()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Salvar proposta no CRM
          </button>
        </div>
      </section>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-bold uppercase text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-slate-800">{value || "-"}</p>
    </div>
  );
}

function IntegrationStatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const label =
    normalized === "CONNECTED"
      ? "Conectado"
      : normalized === "ASSISTED"
        ? "Assistido"
      : normalized === "PENDING"
        ? "Pendente"
        : normalized === "ERROR"
          ? "Erro"
          : "Manual";

  return (
    <span
      className={clsx(
        "rounded-full px-2 py-1 text-[11px] font-black",
        normalized === "CONNECTED"
          ? "bg-emerald-50 text-emerald-700"
          : normalized === "ASSISTED"
            ? "bg-blue-50 text-primary"
          : normalized === "ERROR"
            ? "bg-rose-50 text-rose-700"
            : normalized === "PENDING"
              ? "bg-amber-50 text-amber-700"
              : "bg-slate-100 text-slate-600"
      )}
    >
      {label}
    </span>
  );
}

function cltActionLabel(action: string) {
  const labels: Record<string, string> = {
    CUSTOMER_LOOKUP: "Consulta de dados",
    SIMULATION: "Simulação",
    PROPOSAL_CREATED: "Proposta criada"
  };

  return labels[action] ?? action;
}

function Multicred({
  contacts,
  filters,
  loading,
  metrics,
  proposals,
  onCreateProposal,
  onDeleteProposal,
  onFiltersChange,
  onUpdateProposal
}: {
  contacts: ContactRow[];
  filters: { search: string; status: string };
  loading: boolean;
  metrics: ProposalMetrics;
  proposals: ProposalRow[];
  onCreateProposal: (payload: {
    contactId: string;
    bank: string;
    agreement: string;
    product: string;
    amount: string;
    commission: string;
    status: ProposalStatus;
  }) => Promise<void>;
  onDeleteProposal: (id: string) => Promise<void>;
  onFiltersChange: (filters: { search: string; status: string }) => void;
  onUpdateProposal: (
    id: string,
    payload: Partial<{
      bank: string;
      agreement: string;
      product: string;
      amount: string;
      commission: string;
      status: ProposalStatus;
    }>
  ) => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
  const [form, setForm] = useState({
    contactId: "",
    bank: "Banco Master",
    agreement: "FGTS",
    product: "Antecipacao FGTS",
    amount: "",
    commission: "",
    status: "DRAFT" as ProposalStatus
  });
  const [editForm, setEditForm] = useState({
    bank: "",
    agreement: "",
    product: "",
    amount: "",
    commission: "",
    status: "DRAFT" as ProposalStatus
  });

  const selectedContactId = form.contactId || contacts[0]?.id || "";
  const statusOptions = Object.entries(proposalStatusLabels) as Array<
    [ProposalStatus, string]
  >;
  const stats = [
    {
      label: "Carteira ativa",
      value: formatCurrency(metrics.totalAmount),
      icon: CircleDollarSign
    },
    {
      label: "Em formalizacao",
      value: formatCurrency(metrics.formalizingAmount),
      icon: Clock3
    },
    {
      label: "Comissao prevista",
      value: formatCurrency(metrics.commissionForecast),
      icon: Banknote
    },
    {
      label: "Ticket medio",
      value: formatCurrency(metrics.ticketAverage),
      icon: FileText
    }
  ];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedContactId) return;

    await onCreateProposal({ ...form, contactId: selectedContactId });
    setForm((current) => ({
      ...current,
      amount: "",
      commission: "",
      contactId: selectedContactId
    }));
    setShowForm(false);
  }

  function startEdit(proposal: ProposalRow) {
    setEditingProposalId(proposal.id);
    setEditForm({
      bank: proposal.bank,
      agreement: proposal.agreement,
      product: proposal.product,
      amount: proposal.amount,
      commission: proposal.commission,
      status: proposal.status
    });
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProposalId) return;

    await onUpdateProposal(editingProposalId, editForm);
    setEditingProposalId(null);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded border border-line bg-white p-5 shadow-soft">
              <Icon className="h-5 w-5 text-brand" />
              <p className="mt-4 text-sm text-slate-500">{stat.label}</p>
              <strong className="mt-2 block text-2xl">{stat.value}</strong>
            </div>
          );
        })}
      </div>
      <section className="rounded border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-bold">Esteira de propostas</h3>
            <p className="text-sm text-slate-500">
              {loading ? "Carregando propostas..." : `${metrics.count} proposta(s) ativa(s)`}
            </p>
          </div>
          <button
            className="flex h-10 items-center gap-2 rounded bg-brand px-3 text-sm font-semibold text-white"
            onClick={() => setShowForm((current) => !current)}
          >
            <Plus className="h-4 w-4" />
            Nova proposta
          </button>
        </div>

        {showForm && (
          <form
            className="mt-5 grid gap-3 rounded border border-line bg-slate-50 p-4 md:grid-cols-3"
            onSubmit={handleSubmit}
          >
            <select
              className="h-10 rounded border border-line px-3 text-sm outline-none"
              value={selectedContactId}
              onChange={(event) =>
                setForm((current) => ({ ...current, contactId: event.target.value }))
              }
            >
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name} - {contact.phone}
                </option>
              ))}
            </select>
            <ContactInput
              placeholder="Banco"
              required
              value={form.bank}
              onChange={(value) => setForm((current) => ({ ...current, bank: value }))}
            />
            <ContactInput
              placeholder="Convenio"
              required
              value={form.agreement}
              onChange={(value) =>
                setForm((current) => ({ ...current, agreement: value }))
              }
            />
            <ContactInput
              placeholder="Produto"
              required
              value={form.product}
              onChange={(value) =>
                setForm((current) => ({ ...current, product: value }))
              }
            />
            <ContactInput
              placeholder="Valor liberado"
              required
              value={form.amount}
              onChange={(value) =>
                setForm((current) => ({ ...current, amount: value }))
              }
            />
            <ContactInput
              placeholder="Comissao"
              required
              value={form.commission}
              onChange={(value) =>
                setForm((current) => ({ ...current, commission: value }))
              }
            />
            <select
              className="h-10 rounded border border-line px-3 text-sm outline-none"
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  status: event.target.value as ProposalStatus
                }))
              }
            >
              {statusOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              className="h-10 rounded bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50 md:col-span-2"
              disabled={!selectedContactId}
            >
              Salvar proposta
            </button>
          </form>
        )}

        <div className="mt-5 flex flex-col gap-3 md:flex-row">
          <label className="flex h-10 flex-1 items-center gap-2 rounded border border-line px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              className="w-full bg-transparent text-sm outline-none"
              placeholder="Buscar por cliente, banco, CPF ou produto"
              value={filters.search}
              onChange={(event) =>
                onFiltersChange({ ...filters, search: event.target.value })
              }
            />
          </label>
          <select
            className="h-10 rounded border border-line px-3 text-sm outline-none"
            value={filters.status}
            onChange={(event) => onFiltersChange({ ...filters, status: event.target.value })}
          >
            <option value="">Todos os status</option>
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {editingProposalId && (
          <form
            className="mt-5 grid gap-3 rounded border border-brand bg-teal-50 p-4 md:grid-cols-3"
            onSubmit={handleEditSubmit}
          >
            <div className="md:col-span-3">
              <p className="text-sm font-semibold text-brand">Editando proposta</p>
              <p className="text-xs text-slate-600">
                Ajuste banco, produto, valores ou status e salve a alteracao.
              </p>
            </div>
            <ContactInput
              placeholder="Banco"
              required
              value={editForm.bank}
              onChange={(value) =>
                setEditForm((current) => ({ ...current, bank: value }))
              }
            />
            <ContactInput
              placeholder="Convenio"
              required
              value={editForm.agreement}
              onChange={(value) =>
                setEditForm((current) => ({ ...current, agreement: value }))
              }
            />
            <ContactInput
              placeholder="Produto"
              required
              value={editForm.product}
              onChange={(value) =>
                setEditForm((current) => ({ ...current, product: value }))
              }
            />
            <ContactInput
              placeholder="Valor liberado"
              required
              value={editForm.amount}
              onChange={(value) =>
                setEditForm((current) => ({ ...current, amount: value }))
              }
            />
            <ContactInput
              placeholder="Comissao"
              required
              value={editForm.commission}
              onChange={(value) =>
                setEditForm((current) => ({ ...current, commission: value }))
              }
            />
            <select
              className="h-10 rounded border border-line px-3 text-sm outline-none"
              value={editForm.status}
              onChange={(event) =>
                setEditForm((current) => ({
                  ...current,
                  status: event.target.value as ProposalStatus
                }))
              }
            >
              {statusOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button className="flex h-10 items-center justify-center gap-2 rounded bg-brand px-4 text-sm font-semibold text-white">
              <Check className="h-4 w-4" />
              Salvar alteracoes
            </button>
            <button
              className="flex h-10 items-center justify-center gap-2 rounded border border-line bg-white px-4 text-sm font-semibold"
              onClick={() => setEditingProposalId(null)}
              type="button"
            >
              <X className="h-4 w-4" />
              Cancelar edicao
            </button>
          </form>
        )}

        <div className="mt-5 overflow-hidden rounded border border-line">
          <div className="hidden grid-cols-[1.2fr_1fr_1fr_0.8fr_0.8fr_0.7fr] bg-slate-50 px-4 py-3 text-xs font-semibold uppercase text-slate-500 md:grid">
            <span>Cliente</span>
            <span>Produto</span>
            <span>Banco</span>
            <span>Valores</span>
            <span>Status</span>
            <span>Acoes</span>
          </div>
          <div className="divide-y divide-line">
            {proposals.map((proposal) => (
              <div
                key={proposal.id}
                className={clsx(
                  "grid gap-3 px-4 py-4 text-sm md:grid-cols-[1.2fr_1fr_1fr_0.8fr_0.8fr_0.7fr]",
                  editingProposalId === proposal.id && "bg-teal-50"
                )}
              >
                <div>
                  <p className="font-semibold">{proposal.contact.name}</p>
                  <p className="text-xs text-slate-500">
                    {proposal.contact.phone} {proposal.contact.cpf ? `- ${proposal.contact.cpf}` : ""}
                  </p>
                </div>
                <div>
                  <p className="font-medium">{proposal.product}</p>
                  <p className="text-xs text-slate-500">{proposal.agreement}</p>
                </div>
                <div>
                  <p>{proposal.bank}</p>
                  <p className="text-xs text-slate-500">
                    Criada {formatRelativeDate(proposal.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="font-semibold">{formatCurrency(proposal.amount)}</p>
                  <p className="text-xs text-slate-500">
                    Comissao {formatCurrency(proposal.commission)}
                  </p>
                </div>
                <select
                  className={clsx(
                    "h-9 rounded border px-2 text-xs font-semibold outline-none",
                    proposal.status === "PAID" && "border-emerald-200 bg-emerald-50 text-emerald-700",
                    proposal.status === "FORMALIZING" && "border-amber-200 bg-amber-50 text-amber-700",
                    proposal.status === "CANCELED" && "border-rose-200 bg-rose-50 text-rose-700",
                    proposal.status === "REWORK" && "border-orange-200 bg-orange-50 text-orange-700",
                    proposal.status === "DRAFT" && "border-line bg-white text-slate-700"
                  )}
                  value={proposal.status}
                  onChange={(event) =>
                    void onUpdateProposal(proposal.id, {
                      status: event.target.value as ProposalStatus
                    })
                  }
                >
                  {statusOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <button
                    className="grid h-9 w-9 place-items-center rounded border border-line text-slate-600 hover:bg-slate-50"
                    onClick={() => startEdit(proposal)}
                    title="Editar proposta"
                    type="button"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    className="grid h-9 w-9 place-items-center rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                    onClick={() => {
                      if (window.confirm("Remover esta proposta da esteira?")) {
                        void onDeleteProposal(proposal.id);
                      }
                    }}
                    title="Remover proposta"
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            {!loading && proposals.length === 0 && (
              <div className="p-6 text-sm text-slate-500">
                Nenhuma proposta encontrada.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Canais({
  channels,
  channelStatus,
  messageLogs,
  messageLogFilters,
  loading,
  statusLoading,
  logsLoading,
  onCreateChannel,
  onUpdateChannel,
  onSubscribeChannelWebhook,
  onRefreshStatus,
  onMessageLogFiltersChange,
  onRefreshLogs,
  onSimulateInbound
}: {
  channels: ChannelRow[];
  channelStatus: ChannelStatusData | null;
  messageLogs: MessageLogRow[];
  messageLogFilters: { channelId: string; status: string; type: string };
  loading: boolean;
  statusLoading: boolean;
  logsLoading: boolean;
  onCreateChannel: (payload: {
    name: string;
    displayPhone: string;
    phoneNumberId: string;
    wabaId: string;
    accessToken: string;
    verifyToken: string;
    appSecret: string;
  }) => Promise<void>;
  onUpdateChannel: (
    id: string,
    payload: {
      name: string;
      type: string;
      provider: string;
      displayPhone: string;
      phoneNumberId: string;
      wabaId: string;
      accessToken: string;
      verifyToken: string;
      appSecret: string;
      status: string;
    }
  ) => Promise<boolean>;
  onSubscribeChannelWebhook: (id: string) => Promise<string | null>;
  onRefreshStatus: () => Promise<void>;
  onMessageLogFiltersChange: (filters: { channelId: string; status: string; type: string }) => void;
  onRefreshLogs: () => Promise<void>;
  onSimulateInbound: (payload: {
    channelId: string;
    name: string;
    phone: string;
    message: string;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    channelId: "",
    name: "Cliente Sandbox",
    phone: "11999990000",
    message: "Oi, vi o anuncio e quero saber se consigo simular hoje."
  });
  const [channelForm, setChannelForm] = useState({
    name: "",
    displayPhone: "",
    phoneNumberId: "",
    wabaId: "",
    accessToken: "",
    verifyToken: "",
    appSecret: ""
  });
  const [editingChannel, setEditingChannel] = useState<ChannelRow | null>(null);
  const [channelFeedback, setChannelFeedback] = useState("");
  const [channelSaving, setChannelSaving] = useState(false);
  const [channelDiagnostics, setChannelDiagnostics] =
    useState<MetaChannelDiagnostics | null>(null);
  const [channelValidationFeedback, setChannelValidationFeedback] = useState("");
  const [channelValidating, setChannelValidating] = useState(false);
  const [subscribingChannelId, setSubscribingChannelId] = useState("");

  const selectedChannelId = form.channelId || channels[0]?.id || "";

  function findChannel(id: string) {
    return channels.find((channel) => channel.id === id) ?? null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSimulateInbound({ ...form, channelId: selectedChannelId });
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!channelDiagnostics?.ok) {
      setChannelValidationFeedback(
        "Valide token, WABA e Phone Number ID antes de cadastrar o canal como ativo."
      );
      return;
    }
    await onCreateChannel(channelForm);
    setChannelForm({
      name: "",
      displayPhone: "",
      phoneNumberId: "",
      wabaId: "",
      accessToken: "",
      verifyToken: "",
      appSecret: ""
    });
    setChannelDiagnostics(null);
    setChannelValidationFeedback("");
  }

  function updateChannelForm(key: keyof typeof channelForm, value: string) {
    setChannelForm((current) => ({ ...current, [key]: value }));
    setChannelDiagnostics(null);
    setChannelValidationFeedback("");
  }

  async function handleValidateChannel() {
    setChannelValidating(true);
    setChannelValidationFeedback("");

    const response = await fetch("/api/channels/meta/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: channelForm.accessToken,
        wabaId: channelForm.wabaId,
        phoneNumberId: channelForm.phoneNumberId
      })
    });
    const data = (await response.json().catch(() => null)) as
      | { diagnostics?: MetaChannelDiagnostics; error?: string }
      | null;

    setChannelValidating(false);

    if (!response.ok || !data?.diagnostics) {
      setChannelValidationFeedback(data?.error ?? "Nao foi possivel validar a integracao.");
      return;
    }

    setChannelDiagnostics(data.diagnostics);
    setChannelValidationFeedback(
      data.diagnostics.ok
        ? "Integracao validada. Agora cadastre o canal e assine o webhook."
        : "Encontramos pontos pendentes. Confira o checklist antes de cadastrar."
    );
  }

  async function handleSubscribeWebhook(channelId: string) {
    setSubscribingChannelId(channelId);
    setChannelFeedback("");
    const message = await onSubscribeChannelWebhook(channelId);
    setSubscribingChannelId("");
    setChannelFeedback(message ?? "Nao foi possivel assinar o webhook.");
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <div className="space-y-4">
        {channelFeedback && !editingChannel && (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
            {channelFeedback}
          </div>
        )}
        <section className="rounded border border-line bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-brand" />
                <h3 className="text-lg font-bold">Status WhatsApp/API</h3>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Monitoramento rapido dos canais, webhook, token e ultima atividade.
              </p>
              <p className="mt-2 break-all rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Webhook: {channelStatus?.webhookUrl ?? "Carregando..."}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              disabled={statusLoading}
              onClick={() => void onRefreshStatus()}
            >
              {statusLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              Atualizar status
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <StatusMetric
              label="Canais"
              value={channelStatus?.summary.total ?? channels.length}
            />
            <StatusMetric
              label="Prontos"
              value={channelStatus?.summary.ready ?? 0}
              tone="success"
            />
            <StatusMetric
              label="Alertas"
              value={channelStatus?.summary.withWarnings ?? 0}
              tone={channelStatus?.summary.withWarnings ? "danger" : "neutral"}
            />
          </div>

          <div className="mt-5 grid gap-3">
            {(channelStatus?.channels ?? []).map((item) => (
              <div key={item.id} className="rounded-2xl border border-line bg-slate-50/70 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={clsx(
                          "h-2.5 w-2.5 rounded-full",
                          item.ready ? "bg-emerald-500" : "bg-rose-500"
                        )}
                      />
                      <p className="font-bold text-slate-950">{item.name}</p>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500">
                        {item.provider === "meta" ? "Meta Cloud API" : item.provider}
                      </span>
                      <span
                        className={clsx(
                          "rounded-full px-2 py-0.5 text-[11px] font-bold",
                          item.ready
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
                        )}
                      >
                        {item.ready ? "Operacional" : "Atenção"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {item.displayPhone ?? "Telefone nao informado"} · Phone ID{" "}
                      <span className="font-mono text-xs">
                        {item.phoneNumberId ?? "nao informado"}
                      </span>
                    </p>
                    {item.meta.verifiedName && (
                      <p className="mt-1 text-xs text-slate-500">
                        Nome verificado: {item.meta.verifiedName}
                        {item.meta.qualityRating
                          ? ` · Qualidade: ${item.meta.qualityRating}`
                          : ""}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-right text-xs text-slate-500">
                      <div className="rounded-xl bg-white px-3 py-2">
                        <p className="font-bold text-slate-900">{item.metrics.inboundCount}</p>
                        <p>recebidas</p>
                      </div>
                      <div className="rounded-xl bg-white px-3 py-2">
                        <p className="font-bold text-slate-900">{item.metrics.outboundCount}</p>
                        <p>enviadas</p>
                      </div>
                    </div>
                    <button
                      className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-line bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                      onClick={() => setEditingChannel(findChannel(item.id))}
                      type="button"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Editar
                    </button>
                    {item.provider === "meta" && (
                      <button
                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-brand px-3 text-xs font-bold text-white hover:bg-brand-strong disabled:opacity-60"
                        disabled={subscribingChannelId === item.id}
                        onClick={() => void handleSubscribeWebhook(item.id)}
                        type="button"
                      >
                        {subscribingChannelId === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Activity className="h-3.5 w-3.5" />
                        )}
                        Assinar webhook
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    ["Ativo", item.checks.active],
                    ["Phone ID", item.checks.phoneNumberId],
                    ["WABA", item.checks.wabaId],
                    ["Token", item.checks.accessToken],
                    ["Verify token", item.checks.verifyToken],
                    ["Webhook assinado", item.checks.webhookSubscribed],
                    ["Mensagem real recebida", item.checks.webhookReceived],
                    ["Meta", item.checks.metaReachable]
                  ].map(([label, ok]) => (
                    <StatusPill key={String(label)} label={String(label)} ok={Boolean(ok)} />
                  ))}
                </div>

                <div className="mt-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-500">
                  <p className="font-semibold text-slate-700">Última atividade</p>
                  {item.metrics.lastActivityAt ? (
                    <p className="mt-1">
                      {formatRelativeDate(item.metrics.lastActivityAt)} ·{" "}
                      {item.metrics.lastDirection === "inbound" ? "recebida" : "enviada"} ·{" "}
                      {formatMessagePreview(item.metrics.lastMessagePreview)}
                    </p>
                  ) : (
                    <p className="mt-1">Nenhuma mensagem registrada neste canal.</p>
                  )}
                </div>

                <div className="mt-3 grid gap-2 rounded-xl bg-white px-3 py-2 text-xs text-slate-500 md:grid-cols-3">
                  <div>
                    <p className="font-semibold text-slate-700">Webhook assinado</p>
                    <p className="mt-1">
                      {item.lastWebhookSubscribedAt
                        ? formatRelativeDate(item.lastWebhookSubscribedAt)
                        : "Sem registro pelo CRM."}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700">Webhook recebido</p>
                    <p className="mt-1">
                      {item.lastWebhookReceivedAt
                        ? formatRelativeDate(item.lastWebhookReceivedAt)
                        : "Nenhum recebimento real."}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700">Ultima mensagem no canal</p>
                    <p className="mt-1">
                      {item.metrics.lastActivityAt
                        ? `${item.metrics.lastContactName ?? "Contato"} - ${
                            item.metrics.lastContactPhone ?? "sem telefone"
                          }`
                        : "Nenhuma mensagem registrada."}
                    </p>
                  </div>
                </div>

                {item.warnings.length > 0 && (
                  <div className="mt-3 space-y-1 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    {item.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!statusLoading && channelStatus?.channels.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line p-4 text-sm text-slate-500">
                Nenhum canal para monitorar.
              </div>
            )}
            {statusLoading && (
              <div className="rounded-2xl border border-line p-4 text-sm text-slate-500">
                Verificando canais...
              </div>
            )}
          </div>
        </section>

        <section className="rounded border border-line bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-bold">Logs de mensagens WhatsApp</h3>
              <p className="text-sm text-slate-500">
                Últimos envios, status retornado pela Meta e falhas registradas.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              disabled={logsLoading}
              onClick={() => void onRefreshLogs()}
            >
              {logsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              Atualizar logs
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <label className="text-xs font-bold uppercase text-slate-500">
              Canal
              <select
                className="mt-2 h-10 w-full rounded-2xl border border-line bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-primary"
                value={messageLogFilters.channelId}
                onChange={(event) =>
                  onMessageLogFiltersChange({
                    ...messageLogFilters,
                    channelId: event.target.value
                  })
                }
              >
                <option value="">Todos os canais</option>
                {channels
                  .filter((channel) => channel.type === "whatsapp")
                  .map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
              </select>
            </label>

            <label className="text-xs font-bold uppercase text-slate-500">
              Status
              <select
                className="mt-2 h-10 w-full rounded-2xl border border-line bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-primary"
                value={messageLogFilters.status}
                onChange={(event) =>
                  onMessageLogFiltersChange({
                    ...messageLogFilters,
                    status: event.target.value
                  })
                }
              >
                <option value="ALL">Todos os status</option>
                <option value="sent">Enviado</option>
                <option value="delivered">Entregue</option>
                <option value="read">Lido</option>
                <option value="failed">Erro/Falha</option>
              </select>
            </label>

            <label className="text-xs font-bold uppercase text-slate-500">
              Tipo
              <select
                className="mt-2 h-10 w-full rounded-2xl border border-line bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-primary"
                value={messageLogFilters.type}
                onChange={(event) =>
                  onMessageLogFiltersChange({
                    ...messageLogFilters,
                    type: event.target.value
                  })
                }
              >
                <option value="ALL">Todos os tipos</option>
                <option value="text">Texto</option>
                <option value="image">Imagem</option>
                <option value="audio">Audio</option>
                <option value="document">Documento</option>
                <option value="video">Video</option>
                <option value="template">Template</option>
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                className="h-10 w-full rounded-2xl border border-line px-4 text-sm font-bold text-slate-600 hover:bg-slate-50"
                onClick={() =>
                  onMessageLogFiltersChange({
                    channelId: "",
                    status: "ALL",
                    type: "ALL"
                  })
                }
              >
                Limpar filtros
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-line">
            <div className="grid grid-cols-[1.3fr_0.8fr_0.8fr_0.7fr] gap-3 bg-slate-50 px-4 py-3 text-xs font-bold uppercase text-slate-500">
              <span>Cliente</span>
              <span>Tipo</span>
              <span>Status</span>
              <span className="text-right">Hora</span>
            </div>
            <div className="scrollbar-thin max-h-[360px] divide-y divide-line/70 overflow-y-auto overscroll-contain [scrollbar-color:#CBD5E1_transparent]">
              {messageLogs.map((log) => (
                <div
                  key={log.id}
                  className="grid grid-cols-[1.3fr_0.8fr_0.8fr_0.7fr] gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {log.contact.name}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {log.contact.phone} · {formatMessagePreview(log.body)}
                    </p>
                    {log.providerMessageId && (
                      <p className="mt-1 truncate font-mono text-[10px] text-slate-400">
                        {log.providerMessageId}
                      </p>
                    )}
                  </div>
                  <div className="flex items-start">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                      {messageTypeLabel(log.type)}
                    </span>
                  </div>
                  <div className="flex items-start">
                    <MessageStatusBadge status={log.status} />
                  </div>
                  <p className="text-right text-xs text-slate-500">
                    {formatRelativeDate(log.createdAt)}
                  </p>
                  {resolveMessageLogError(log) && (
                    <div className="col-span-full rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                      <span className="font-bold">Erro:</span>{" "}
                      {resolveMessageLogError(log)}
                    </div>
                  )}
                </div>
              ))}
              {!logsLoading && messageLogs.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-slate-500">
                  Nenhum envio registrado ainda.
                </div>
              )}
              {logsLoading && (
                <div className="px-4 py-8 text-center text-sm text-slate-500">
                  Carregando logs...
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">Conectar WhatsApp Meta</h3>
              <p className="text-sm text-slate-500">
                Valide token, WABA e numero antes de ativar uma BM no CRM.
              </p>
            </div>
            <Plus className="h-5 w-5 text-slate-400" />
          </div>

          <form className="mt-5 grid gap-3 lg:grid-cols-2" onSubmit={handleCreate}>
            <ContactInput
              placeholder="Nome do canal"
              required
              value={channelForm.name}
              onChange={(value) => updateChannelForm("name", value)}
            />
            <ContactInput
              placeholder="Telefone exibido"
              value={channelForm.displayPhone}
              onChange={(value) => updateChannelForm("displayPhone", value)}
            />
            <ContactInput
              placeholder="Phone Number ID"
              required
              value={channelForm.phoneNumberId}
              onChange={(value) => updateChannelForm("phoneNumberId", value)}
            />
            <ContactInput
              placeholder="WABA ID"
              required
              value={channelForm.wabaId}
              onChange={(value) => updateChannelForm("wabaId", value)}
            />
            <ContactInput
              placeholder="Access token"
              required
              value={channelForm.accessToken}
              onChange={(value) => updateChannelForm("accessToken", value)}
            />
            <ContactInput
              placeholder="Verify token"
              required
              value={channelForm.verifyToken}
              onChange={(value) => updateChannelForm("verifyToken", value)}
            />
            <ContactInput
              placeholder="App secret"
              value={channelForm.appSecret}
              onChange={(value) => updateChannelForm("appSecret", value)}
            />
            <div className="flex gap-2">
              <button
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded border border-line px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                disabled={
                  channelValidating ||
                  !channelForm.accessToken ||
                  !channelForm.wabaId ||
                  !channelForm.phoneNumberId
                }
                onClick={() => void handleValidateChannel()}
                type="button"
              >
                {channelValidating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Validar integracao
              </button>
              <button
                className="h-10 flex-1 rounded bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50"
                disabled={!channelDiagnostics?.ok}
              >
                Cadastrar canal
              </button>
            </div>

            <div className="lg:col-span-2 rounded-2xl border border-line bg-slate-50 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    Checklist de validacao Meta
                  </p>
                  <p className="text-xs text-slate-500">
                    O CRM nunca mostra o token completo.{" "}
                    {channelDiagnostics?.tokenPreview
                      ? `Token: ${channelDiagnostics.tokenPreview}`
                      : "Valide para ver o diagnostico."}
                  </p>
                </div>
                <span
                  className={clsx(
                    "rounded-full px-3 py-1 text-xs font-bold",
                    channelDiagnostics?.ok
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  )}
                >
                  {channelDiagnostics?.ok ? "Pronto para cadastrar" : "Aguardando validacao"}
                </span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <StatusPill
                  label="Token valido"
                  ok={Boolean(channelDiagnostics?.checklist.tokenValid)}
                />
                <StatusPill
                  label="Permissoes conferidas"
                  ok={Boolean(channelDiagnostics?.checklist.permissionsChecked)}
                />
                <StatusPill
                  label="WABA acessivel"
                  ok={Boolean(channelDiagnostics?.checklist.wabaAccessible)}
                />
                <StatusPill
                  label="Numero encontrado"
                  ok={Boolean(channelDiagnostics?.checklist.phoneFound)}
                />
                <StatusPill
                  label="Numero pertence a WABA"
                  ok={Boolean(channelDiagnostics?.checklist.phoneBelongsToWaba)}
                />
              </div>

              {channelDiagnostics && (
                <div className="mt-3 grid gap-3 text-xs text-slate-600 md:grid-cols-3">
                  <div className="rounded-xl bg-white p-3">
                    <p className="font-bold text-slate-900">Permissoes</p>
                    <p className="mt-1">
                      Detectadas:{" "}
                      {channelDiagnostics.permissions.detected.length
                        ? channelDiagnostics.permissions.detected.join(", ")
                        : "nao lidas"}
                    </p>
                    {channelDiagnostics.permissions.missing.length > 0 && (
                      <p className="mt-1 font-semibold text-rose-700">
                        Faltando: {channelDiagnostics.permissions.missing.join(", ")}
                      </p>
                    )}
                    {channelDiagnostics.permissions.optionalMissing.length > 0 && (
                      <p className="mt-1 text-amber-700">
                        Recomendada para webhook:{" "}
                        {channelDiagnostics.permissions.optionalMissing.join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl bg-white p-3">
                    <p className="font-bold text-slate-900">WABA</p>
                    <p className="mt-1 break-all">
                      {channelDiagnostics.waba.name ?? channelDiagnostics.waba.id ?? "-"}
                    </p>
                    {channelDiagnostics.waba.error && (
                      <p className="mt-1 font-semibold text-rose-700">
                        {channelDiagnostics.waba.error}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl bg-white p-3">
                    <p className="font-bold text-slate-900">Numero</p>
                    <p className="mt-1">
                      {channelDiagnostics.phone.displayPhone ??
                        channelDiagnostics.phone.id ??
                        "-"}
                    </p>
                    {channelDiagnostics.phone.verifiedName && (
                      <p className="mt-1">
                        Nome: {channelDiagnostics.phone.verifiedName}
                      </p>
                    )}
                    {channelDiagnostics.phone.error && (
                      <p className="mt-1 font-semibold text-rose-700">
                        {channelDiagnostics.phone.error}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {channelValidationFeedback && (
                <p
                  className={clsx(
                    "mt-3 rounded-xl px-3 py-2 text-xs font-semibold",
                    channelDiagnostics?.ok
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-800"
                  )}
                >
                  {channelValidationFeedback}
                </p>
              )}
            </div>
          </form>
        </section>

        <section className="rounded border border-line bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold">Canais conectados</h3>
            <p className="text-sm text-slate-500">
              WhatsApp Meta, sandbox, webhooks e filas de atendimento.
            </p>
          </div>
          <span className="rounded border border-line px-3 py-2 text-sm text-slate-600">
            {loading ? "Carregando..." : `${channels.length} canal(is)`}
          </span>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((channel) => (
            <div key={channel.id} className="rounded border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">{channel.name}</p>
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      "rounded px-2 py-1 text-xs font-semibold",
                      channel.status === "ACTIVE"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    )}
                  >
                    {channel.status === "ACTIVE" ? "Ativo" : channel.status}
                  </span>
                  <button
                    className="inline-flex h-8 items-center gap-1.5 rounded border border-line px-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    onClick={() => setEditingChannel(channel)}
                    title="Editar canal"
                    type="button"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Editar
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {channel.provider === "meta" ? "Meta Cloud API" : channel.provider} -{" "}
                {channel.type}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Telefone: {channel.displayPhone ?? "nao informado"}
              </p>
              <p className="mt-1 break-all text-xs text-slate-500">
                Phone ID: {channel.phoneNumberId ?? channel.externalId ?? "nao informado"}
              </p>
              {channel.wabaId && (
                <p className="mt-1 break-all text-xs text-slate-500">
                  WABA: {channel.wabaId}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  ["Token", channel.hasAccessToken],
                  ["Verify", channel.hasVerifyToken],
                  ["App secret", channel.hasAppSecret],
                  ["Webhook", channel.lastWebhookSubscribedAt]
                ].map(([label, enabled]) => (
                  <span
                    key={String(label)}
                    className={clsx(
                      "rounded px-2 py-1 text-xs font-semibold",
                      enabled
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    )}
                  >
                    {label}
                  </span>
                ))}
              </div>
              {channel.lastWebhookSubscribedAt && (
                <p className="mt-2 text-xs text-slate-500">
                  Webhook assinado: {formatRelativeDate(channel.lastWebhookSubscribedAt)}
                </p>
              )}
              {channel.lastWebhookReceivedAt && (
                <p className="mt-1 text-xs text-slate-500">
                  Ultimo webhook recebido: {formatRelativeDate(channel.lastWebhookReceivedAt)}
                </p>
              )}
              {channel.provider === "meta" && (
                <button
                  className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-brand px-3 text-xs font-bold text-white hover:bg-brand-strong disabled:opacity-60"
                  disabled={subscribingChannelId === channel.id}
                  onClick={() => void handleSubscribeWebhook(channel.id)}
                  type="button"
                >
                  {subscribingChannelId === channel.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Activity className="h-3.5 w-3.5" />
                  )}
                  Assinar webhook
                </button>
              )}
            </div>
          ))}
          {!loading && channels.length === 0 && (
            <div className="rounded border border-dashed border-line p-4 text-sm text-slate-500">
              Nenhum canal configurado.
            </div>
          )}
        </div>
      </section>
      </div>

      <section className="rounded border border-line bg-white p-5 shadow-soft">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-5 w-5 text-brand" />
          <h3 className="font-bold">Simular WhatsApp recebido</h3>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          A mensagem entra pelo mesmo fluxo do webhook e aparece no Atendimento.
        </p>

        <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
          <select
            className="h-10 w-full rounded border border-line px-3 outline-none"
            value={selectedChannelId}
            onChange={(event) =>
              setForm((current) => ({ ...current, channelId: event.target.value }))
            }
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
          <ContactInput
            placeholder="Nome"
            value={form.name}
            onChange={(value) => setForm((current) => ({ ...current, name: value }))}
          />
          <ContactInput
            placeholder="Telefone"
            required
            value={form.phone}
            onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
          />
          <textarea
            className="min-h-28 w-full rounded border border-line p-3 text-sm outline-none"
            required
            value={form.message}
            onChange={(event) =>
              setForm((current) => ({ ...current, message: event.target.value }))
            }
            placeholder="Mensagem recebida"
          />
          <button
            className="h-10 w-full rounded bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!selectedChannelId}
          >
            Receber mensagem sandbox
          </button>
        </form>

        <div className="mt-5 rounded border border-line bg-slate-50 p-3 text-xs text-slate-600">
          Webhook local: <span className="font-semibold">/api/webhooks/whatsapp</span>
        </div>
      </section>
      {editingChannel && (
        <ChannelEditModal
          channel={editingChannel}
          feedback={channelFeedback}
          saving={channelSaving}
          onClose={() => {
            if (!channelSaving) {
              setEditingChannel(null);
              setChannelFeedback("");
            }
          }}
          onSubmit={async (payload) => {
            setChannelSaving(true);
            setChannelFeedback("");
            const ok = await onUpdateChannel(editingChannel.id, payload);
            setChannelSaving(false);
            if (ok) {
              setChannelFeedback("Canal atualizado com sucesso.");
              setEditingChannel(null);
            } else {
              setChannelFeedback("Nao foi possivel atualizar o canal.");
            }
          }}
        />
      )}
    </div>
  );
}

function ChannelEditModal({
  channel,
  feedback,
  saving,
  onClose,
  onSubmit
}: {
  channel: ChannelRow;
  feedback: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    type: string;
    provider: string;
    displayPhone: string;
    phoneNumberId: string;
    wabaId: string;
    accessToken: string;
    verifyToken: string;
    appSecret: string;
    status: string;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: channel.name,
    type: channel.type,
    provider: channel.provider,
    displayPhone: channel.displayPhone ?? "",
    phoneNumberId: channel.phoneNumberId ?? channel.externalId ?? "",
    wabaId: channel.wabaId ?? "",
    accessToken: "",
    verifyToken: "",
    appSecret: "",
    status: channel.status
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(form);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
              Canal WhatsApp
            </p>
            <h3 className="mt-1 text-xl font-black text-slate-950">Editar canal</h3>
            <p className="mt-1 text-sm text-slate-500">
              Campos sensiveis em branco mantem o valor atual cadastrado.
            </p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-full border border-line text-slate-500 hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="mt-5 grid gap-3 md:grid-cols-2" onSubmit={handleSubmit}>
          <label className="text-xs font-bold uppercase text-slate-500">
            Nome do canal
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm font-semibold normal-case text-slate-900 outline-none focus:border-primary"
              required
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>

          <label className="text-xs font-bold uppercase text-slate-500">
            Numero de telefone
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm font-semibold normal-case text-slate-900 outline-none focus:border-primary"
              value={form.displayPhone}
              onChange={(event) =>
                setForm((current) => ({ ...current, displayPhone: event.target.value }))
              }
            />
          </label>

          <label className="text-xs font-bold uppercase text-slate-500">
            Phone Number ID
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm font-semibold normal-case text-slate-900 outline-none focus:border-primary"
              value={form.phoneNumberId}
              onChange={(event) =>
                setForm((current) => ({ ...current, phoneNumberId: event.target.value }))
              }
            />
          </label>

          <label className="text-xs font-bold uppercase text-slate-500">
            WABA ID
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm font-semibold normal-case text-slate-900 outline-none focus:border-primary"
              value={form.wabaId}
              onChange={(event) =>
                setForm((current) => ({ ...current, wabaId: event.target.value }))
              }
            />
          </label>

          <label className="text-xs font-bold uppercase text-slate-500">
            Tipo
            <select
              className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm font-semibold normal-case text-slate-900 outline-none focus:border-primary"
              value={form.type}
              onChange={(event) =>
                setForm((current) => ({ ...current, type: event.target.value }))
              }
            >
              <option value="whatsapp">WhatsApp</option>
            </select>
          </label>

          <label className="text-xs font-bold uppercase text-slate-500">
            Status
            <select
              className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm font-semibold normal-case text-slate-900 outline-none focus:border-primary"
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({ ...current, status: event.target.value }))
              }
            >
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
            </select>
          </label>

          <label className="text-xs font-bold uppercase text-slate-500">
            Provider
            <select
              className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm font-semibold normal-case text-slate-900 outline-none focus:border-primary"
              value={form.provider}
              onChange={(event) =>
                setForm((current) => ({ ...current, provider: event.target.value }))
              }
            >
              <option value="meta">Meta Cloud API</option>
              <option value="sandbox">Sandbox</option>
            </select>
          </label>

          <div className="rounded-2xl border border-line bg-slate-50 p-3 text-xs text-slate-500">
            <p className="font-bold uppercase text-slate-600">Credenciais atuais</p>
            <p className="mt-2">Access token: {channel.hasAccessToken ? "cadastrado" : "vazio"}</p>
            <p>Verify token: {channel.hasVerifyToken ? "cadastrado" : "vazio"}</p>
            <p>App secret: {channel.hasAppSecret ? "cadastrado" : "vazio"}</p>
          </div>

          <label className="text-xs font-bold uppercase text-slate-500">
            Novo access token
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm font-semibold normal-case text-slate-900 outline-none focus:border-primary"
              placeholder="Deixe em branco para manter"
              value={form.accessToken}
              onChange={(event) =>
                setForm((current) => ({ ...current, accessToken: event.target.value }))
              }
            />
          </label>

          <label className="text-xs font-bold uppercase text-slate-500">
            Novo verify token
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm font-semibold normal-case text-slate-900 outline-none focus:border-primary"
              placeholder="Deixe em branco para manter"
              value={form.verifyToken}
              onChange={(event) =>
                setForm((current) => ({ ...current, verifyToken: event.target.value }))
              }
            />
          </label>

          <label className="text-xs font-bold uppercase text-slate-500">
            Novo app secret
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm font-semibold normal-case text-slate-900 outline-none focus:border-primary"
              placeholder="Deixe em branco para manter"
              value={form.appSecret}
              onChange={(event) =>
                setForm((current) => ({ ...current, appSecret: event.target.value }))
              }
            />
          </label>

          {feedback && (
            <div className="md:col-span-2 rounded-2xl border border-amber-100 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
              {feedback}
            </div>
          )}

          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <button
              className="h-10 rounded-full border border-line px-4 text-sm font-bold text-slate-600 hover:bg-slate-50"
              disabled={saving}
              onClick={onClose}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-5 text-sm font-bold text-white disabled:opacity-60"
              disabled={saving}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar alteracoes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StatusMetric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: number;
  tone?: "neutral" | "success" | "danger";
}) {
  return (
    <div
      className={clsx(
        "rounded-2xl border px-4 py-3",
        tone === "success"
          ? "border-emerald-100 bg-emerald-50"
          : tone === "danger"
            ? "border-rose-100 bg-rose-50"
            : "border-line bg-slate-50"
      )}
    >
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
    </div>
  );
}

function StatusPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold",
        ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      )}
    >
      {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </span>
  );
}

function messageTypeLabel(type: string) {
  const labels: Record<string, string> = {
    text: "Texto",
    image: "Imagem",
    audio: "Áudio",
    document: "Arquivo",
    video: "Vídeo",
    template: "Template"
  };

  return labels[type] ?? type;
}

function resolveMessageLogError(log: MessageLogRow) {
  if (log.errorMessage) return log.errorMessage;
  if (log.status.toLowerCase() !== "failed") return "";

  const marker = "Falha:";
  const markerIndex = log.body.indexOf(marker);
  if (markerIndex === -1) return "";

  return log.body.slice(markerIndex + marker.length).trim();
}

function MessageStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const label =
    normalized === "sent"
      ? "Enviado"
      : normalized === "delivered"
        ? "Entregue"
        : normalized === "read"
          ? "Lido"
          : normalized === "failed"
            ? "Falhou"
            : normalized;

  return (
    <span
      className={clsx(
        "rounded-full px-2 py-1 text-xs font-bold",
        normalized === "failed"
          ? "bg-rose-50 text-rose-700"
          : normalized === "read"
            ? "bg-blue-50 text-blue-700"
            : normalized === "delivered"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-600"
      )}
    >
      {label}
    </span>
  );
}

function Disparos({
  campaigns,
  channels,
  contacts,
  loading,
  onCreateCampaign,
  onRefreshCampaigns
}: {
  campaigns: CampaignRow[];
  channels: ChannelRow[];
  contacts: ContactRow[];
  loading: boolean;
  onCreateCampaign: (payload: {
    channelId: string;
    contactIds: string[];
    message: string;
    image?: File | null;
    messageType?: string;
    templateName?: string;
    templateLanguage?: string;
    templateVariables?: string[];
  }) => Promise<CampaignRow | null>;
  onRefreshCampaigns: () => Promise<void>;
}) {
  const metaChannels = channels.filter(
    (channel) =>
      channel.provider === "meta" &&
      ["ACTIVE", "CONNECTED"].includes(channel.status) &&
      channel.phoneNumberId &&
      channel.hasAccessToken
  );
  const [channelId, setChannelId] = useState(metaChannels[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [messageMode, setMessageMode] = useState<"TEXT" | "TEMPLATE">("TEMPLATE");
  const [campaignTemplates, setCampaignTemplates] = useState<WhatsAppTemplateRow[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedCampaignTemplate, setSelectedCampaignTemplate] =
    useState<WhatsAppTemplateRow | null>(null);
  const [campaignTemplateValues, setCampaignTemplateValues] = useState<string[]>([]);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [lastCampaign, setLastCampaign] = useState<CampaignRow | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [campaignStatusFilter, setCampaignStatusFilter] = useState("ALL");
  const [recipientStatusFilter, setRecipientStatusFilter] = useState("ALL");
  const [campaignActionLoading, setCampaignActionLoading] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] =
    useState<SpreadsheetImportPreview | null>(null);
  const [importConfirm, setImportConfirm] =
    useState<SpreadsheetImportConfirm | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!channelId && metaChannels[0]?.id) {
      setChannelId(metaChannels[0].id);
    }
  }, [channelId, metaChannels]);

  useEffect(() => {
    if (!selectedCampaignId && campaigns[0]?.id) {
      setSelectedCampaignId(campaigns[0].id);
    }
  }, [campaigns, selectedCampaignId]);

  useEffect(() => {
    const hasRunningCampaign = campaigns.some((campaign) =>
      ["SENDING", "PENDING", "DRAFT"].includes(campaign.status)
    );
    if (!hasRunningCampaign) return;

    const interval = window.setInterval(() => {
      void onRefreshCampaigns();
    }, 10000);

    return () => window.clearInterval(interval);
  }, [campaigns, onRefreshCampaigns]);

  useEffect(() => {
    if (!image) {
      setImagePreview("");
      return;
    }

    const url = URL.createObjectURL(image);
    setImagePreview(url);

    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    setCampaignTemplates([]);
    setSelectedCampaignTemplate(null);
    setCampaignTemplateValues([]);

    if (!channelId) return;

    async function loadChannelTemplates() {
      setTemplatesLoading(true);
      const response = await fetch(`/api/whatsapp/templates?channelId=${channelId}`);
      setTemplatesLoading(false);

      if (!response.ok) return;

      const data = (await response.json()) as { templates: WhatsAppTemplateRow[] };
      setCampaignTemplates(data.templates);
    }

    void loadChannelTemplates();
  }, [channelId]);

  const filteredContacts = contacts.filter((contact) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return !contact.archivedAt;

    return (
      !contact.archivedAt &&
      [contact.name, contact.phone, contact.email ?? "", contact.cpf ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  });
  const selectedContacts = contacts.filter((contact) =>
    selectedIds.includes(contact.id)
  );
  const filteredCampaigns = campaigns.filter((campaign) =>
    campaignStatusFilter === "ALL" ? true : campaign.status === campaignStatusFilter
  );
  const selectedCampaign =
    campaigns.find((campaign) => campaign.id === selectedCampaignId) ??
    filteredCampaigns[0] ??
    campaigns[0] ??
    null;
  const selectedCampaignRecipients =
    selectedCampaign?.recipients.filter((recipient) =>
      recipientStatusFilter === "ALL"
        ? true
        : recipient.status === recipientStatusFilter
    ) ?? [];
  const selectedCampaignPending =
    selectedCampaign?.recipients.filter((recipient) => recipient.status === "PENDING")
      .length ?? 0;
  const importedContactsPreview =
    importPreview?.rows.filter((row) => row.status === "VALID").slice(0, 4) ?? [];
  const previewContact =
    selectedContacts[0] ??
    (importedContactsPreview[0]
      ? {
          name: importedContactsPreview[0].name,
          cpf: importedContactsPreview[0].cpf,
          phone: importedContactsPreview[0].whatsapp
        }
      : null);

  function renderMessagePreview() {
    const template =
      messageMode === "TEMPLATE" && selectedCampaignTemplate
        ? selectedCampaignTemplate.preview.replace(/\{\{(\d+)\}\}/g, (_, index) => {
            const value = campaignTemplateValues[Number(index) - 1] ?? "";
            return value || `{{${index}}}`;
          })
        : message || "Sua mensagem aparecera aqui.";
    if (!previewContact) return template;

    return template
      .replace(/\{\{\s*nome\s*\}\}/gi, previewContact.name)
      .replace(/\{\{\s*cpf\s*\}\}/gi, previewContact.cpf ?? "")
      .replace(/\{\{\s*telefone\s*\}\}/gi, previewContact.phone);
  }

  function toggleContact(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((contactId) => contactId !== id)
        : [...current, id]
    );
  }

  function handleImageChange(file?: File | null) {
    setError("");
    if (!file) {
      setImage(null);
      return;
    }

    const validTypes = ["image/jpeg", "image/png"];
    if (!validTypes.includes(file.type)) {
      setError("A imagem precisa ser JPG, JPEG ou PNG.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("A imagem precisa ter no maximo 5MB.");
      return;
    }

    setImage(file);
  }

  async function handleSpreadsheetPreview() {
    setError("");
    setImportPreview(null);
    setImportConfirm(null);

    if (!importFile) {
      setError("Selecione uma planilha CSV ou Excel .xlsx.");
      return;
    }

    const extension = importFile.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx"].includes(extension ?? "")) {
      setError("Arquivo deve ser CSV ou Excel .xlsx.");
      return;
    }

    const formData = new FormData();
    formData.set("file", importFile);

    setImportLoading(true);
    const response = await fetch("/api/imports/contacts/preview", {
      method: "POST",
      body: formData
    });
    setImportLoading(false);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(data?.error ?? "Nao foi possivel validar a planilha.");
      return;
    }

    setImportPreview((await response.json()) as SpreadsheetImportPreview);
  }

  async function handleConfirmSpreadsheetImport() {
    setError("");

    if (!importPreview) {
      setError("Valide a planilha antes de importar.");
      return;
    }

    const validRows = importPreview.rows.filter((row) => row.status === "VALID");
    if (!validRows.length) {
      setError("A planilha nao possui contatos validos para importar.");
      return;
    }

    setImporting(true);
    const response = await fetch("/api/imports/contacts/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: importPreview.rows })
    });
    setImporting(false);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(data?.error ?? "Nao foi possivel confirmar a importacao.");
      return;
    }

    const data = (await response.json()) as SpreadsheetImportConfirm;
    setImportConfirm(data);
    setSelectedIds(data.contactIds);
  }

  function downloadImportErrors() {
    if (!importPreview) return;

    const invalidRows = importPreview.rows.filter((row) => row.status === "INVALID");
    if (!invalidRows.length) return;

    const csv = [
      ["linha", "nome", "cpf", "telefone", "motivo"].join(";"),
      ...invalidRows.map((row) =>
        [
          row.rowNumber,
          row.name,
          row.cpf,
          row.phone,
          row.errors.join(" | ")
        ]
          .map((value) => `"${String(value).replace(/"/g, "\"\"")}"`)
          .join(";")
      )
    ].join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "erros-importacao-contatos.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadImportTemplate() {
    const csv = [
      ["CPF", "Nome", "Telefone", "Data Concessao", "Beneficio", "Cidade", "Estado"].join(";"),
      ["12345678901", "Maria Silva", "33999413444", "01/04/2026", "Aposentadoria", "Governador Valadares", "MG"].join(";"),
      ["98765432100", "Joao Pereira", "5533998887766", "", "", "", ""].join(";")
    ].join("\n");

    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "modelo-importacao-contatos.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function campaignStatusLabel(status: string) {
    const labels: Record<string, string> = {
      DRAFT: "Rascunho",
      PENDING: "Pendente",
      SENDING: "Enviando",
      PAUSED: "Pausada",
      CANCELED: "Cancelada",
      COMPLETED: "Concluida",
      PARTIAL: "Parcial",
      FAILED: "Falhou"
    };

    return labels[status] ?? status;
  }

  function campaignStatusClass(status: string) {
    if (["COMPLETED"].includes(status)) return "bg-emerald-50 text-emerald-700";
    if (["SENDING", "PENDING", "DRAFT"].includes(status)) {
      return "bg-blue-50 text-blue-700";
    }
    if (status === "PAUSED") return "bg-amber-50 text-amber-700";
    if (["FAILED", "CANCELED"].includes(status)) return "bg-rose-50 text-rose-700";
    return "bg-slate-100 text-slate-600";
  }

  async function runCampaignAction(campaignId: string, action: string) {
    const actionLabel: Record<string, string> = {
      start: "iniciar",
      resume: "retomar",
      pause: "pausar",
      cancel: "cancelar"
    };
    const confirmed =
      action === "cancel"
        ? window.confirm("Cancelar esta campanha? Os pendentes serao marcados como cancelados.")
        : true;
    if (!confirmed) return;

    setError("");
    setCampaignActionLoading(`${campaignId}:${action}`);
    const response = await fetch(`/api/campaigns/${campaignId}/${action}`, {
      method: "PATCH"
    });
    setCampaignActionLoading("");

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(data?.error ?? `Nao foi possivel ${actionLabel[action] ?? "alterar"} campanha.`);
      return;
    }

    await onRefreshCampaigns();
  }

  function downloadCampaignReport(campaign: CampaignRow) {
    const rows = [
      [
        "campanha",
        "contato",
        "telefone",
        "status",
        "erro",
        "enviado_em",
        "entregue_em"
      ],
      ...campaign.recipients.map((recipient) => [
        campaign.name,
        recipient.contactName,
        recipient.phone,
        recipient.status,
        recipient.errorMessage ?? "",
        recipient.sentAt ?? "",
        recipient.deliveredAt ?? ""
      ])
    ];
    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replace(/"/g, "\"\"")}"`)
          .join(";")
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-${campaign.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!channelId) {
      setError("Selecione um canal WhatsApp Meta ativo.");
      return;
    }
    if (!selectedIds.length) {
      setError("Selecione pelo menos um contato.");
      return;
    }
    if (messageMode !== "TEMPLATE" && !message.trim()) {
      setError("Escreva a mensagem do disparo.");
      return;
    }
    if (messageMode === "TEMPLATE") {
      if (!selectedCampaignTemplate) {
        setError("Selecione um template aprovado da Meta.");
        return;
      }
      if (
        campaignTemplateValues.length < selectedCampaignTemplate.variableCount ||
        campaignTemplateValues.some((value) => !value.trim())
      ) {
        setError("Preencha todas as variaveis obrigatorias do template.");
        return;
      }
    }

    const confirmed = window.confirm(
      `Enviar disparo para ${selectedIds.length} contato(s)?`
    );
    if (!confirmed) return;

    setSending(true);
    const campaign = await onCreateCampaign({
      channelId,
      contactIds: selectedIds,
      message: messageMode === "TEMPLATE" ? renderMessagePreview() : message,
      image: messageMode === "TEMPLATE" ? null : image,
      messageType: messageMode,
      templateName: selectedCampaignTemplate?.name,
      templateLanguage: selectedCampaignTemplate?.language,
      templateVariables: campaignTemplateValues
    });
    setSending(false);

    if (campaign) {
      setLastCampaign(campaign);
      setSelectedIds([]);
      setMessage("");
      setImage(null);
      setSelectedCampaignTemplate(null);
      setCampaignTemplateValues([]);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <form
        className="rounded border border-line bg-white p-4 shadow-soft"
        onSubmit={handleSubmit}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div>
            <h3 className="text-lg font-bold">Disparo WhatsApp</h3>
            <p className="text-sm text-slate-500">
              Campanhas em massa pela API oficial da Meta.
            </p>
          </div>
          <button
            className="flex h-10 items-center gap-2 rounded bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
            disabled={sending || loading}
            type="submit"
          >
            <Send className="h-4 w-4" />
            {sending ? "Enviando..." : "Enviar disparo"}
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-blue-200 bg-blue-50/60 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <FileText className="h-4 w-4 text-brand" />
                Importar planilha para disparo
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Aceita CSV ou Excel .xlsx com CPF, Nome e Telefone. Variaveis:
                {" {{nome}}"}, {"{{cpf}}"} e {"{{telefone}}"}.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="inline-flex h-10 items-center gap-2 rounded-full border border-blue-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm"
                type="button"
                onClick={downloadImportTemplate}
              >
                <Download className="h-4 w-4" />
                Baixar modelo
              </button>
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-blue-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm">
                <Upload className="h-4 w-4" />
                {importFile ? importFile.name : "Escolher planilha"}
                <input
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  type="file"
                  onChange={(event) => {
                    setImportFile(event.target.files?.[0] ?? null);
                    setImportPreview(null);
                    setImportConfirm(null);
                  }}
                />
              </label>
              <button
                className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-3 text-sm font-semibold text-brand shadow-sm ring-1 ring-blue-200 disabled:opacity-60"
                disabled={importLoading || !importFile}
                type="button"
                onClick={handleSpreadsheetPreview}
              >
                {importLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Validar
              </button>
            </div>
          </div>

          {importPreview && (
            <div className="mt-4 grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span className="rounded-xl bg-white p-3 shadow-sm">
                  <b className="block text-lg text-slate-950">
                    {importPreview.summary.totalRows}
                  </b>
                  linhas
                </span>
                <span className="rounded-xl bg-white p-3 shadow-sm">
                  <b className="block text-lg text-emerald-600">
                    {importPreview.summary.validRows}
                  </b>
                  validas
                </span>
                <span className="rounded-xl bg-white p-3 shadow-sm">
                  <b className="block text-lg text-rose-600">
                    {importPreview.summary.invalidRows}
                  </b>
                  invalidas
                </span>
                <span className="rounded-xl bg-white p-3 shadow-sm">
                  <b className="block text-lg text-amber-600">
                    {importPreview.summary.existingContacts}
                  </b>
                  atualizacoes
                </span>
                <span className="rounded-xl bg-white p-3 shadow-sm">
                  <b className="block text-lg text-slate-800">
                    {importPreview.summary.duplicateCpfs}
                  </b>
                  CPFs repetidos
                </span>
                <span className="rounded-xl bg-white p-3 shadow-sm">
                  <b className="block text-lg text-slate-800">
                    {importPreview.summary.duplicatePhones}
                  </b>
                  telefones repetidos
                </span>
              </div>

              <div className="min-w-0 rounded-xl border border-blue-100 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
                  <p className="text-sm font-semibold">Previa da importacao</p>
                  <div className="flex gap-2">
                    {importPreview.summary.invalidRows > 0 && (
                      <button
                        className="inline-flex h-8 items-center gap-1 rounded-full border border-line px-3 text-xs font-semibold text-slate-600"
                        type="button"
                        onClick={downloadImportErrors}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Baixar erros
                      </button>
                    )}
                    <button
                      className="inline-flex h-8 items-center gap-1 rounded-full bg-brand px-3 text-xs font-semibold text-white disabled:opacity-60"
                      disabled={importing || importPreview.summary.validRows === 0}
                      type="button"
                      onClick={handleConfirmSpreadsheetImport}
                    >
                      {importing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Confirmar importacao
                    </button>
                  </div>
                </div>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Linha</th>
                        <th className="px-3 py-2">Nome</th>
                        <th className="px-3 py-2">CPF</th>
                        <th className="px-3 py-2">WhatsApp</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {importPreview.rows.slice(0, 80).map((row) => (
                        <tr key={`${row.rowNumber}-${row.cpf}-${row.whatsapp}`}>
                          <td className="px-3 py-2">{row.rowNumber}</td>
                          <td className="max-w-[180px] truncate px-3 py-2 font-semibold">
                            {row.name || "-"}
                          </td>
                          <td className="px-3 py-2">{row.cpf || "-"}</td>
                          <td className="px-3 py-2">{row.whatsapp || "-"}</td>
                          <td className="px-3 py-2">
                            {row.status === "VALID" ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
                                {row.existingContactId ? "Atualizar" : "Criar"}
                              </span>
                            ) : (
                              <span
                                className="inline-block max-w-[220px] truncate rounded-full bg-rose-50 px-2 py-1 font-semibold text-rose-700"
                                title={row.errors.join(" ")}
                              >
                                {row.errors[0]}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {importConfirm && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              Importacao concluida: {importConfirm.summary.created} criado(s),{" "}
              {importConfirm.summary.updated} atualizado(s). A base importada ja foi
              selecionada para o disparo.
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <label className="block text-sm font-semibold">
              Canal de envio
              <select
                className="mt-2 h-11 w-full rounded border border-line bg-white px-3 font-normal outline-none focus:border-brand"
                value={channelId}
                onChange={(event) => setChannelId(event.target.value)}
              >
                <option value="">Selecione um canal Meta</option>
                {metaChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name} {channel.displayPhone ? `- ${channel.displayPhone}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="rounded border border-line bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Tipo de mensagem</p>
                  <p className="text-xs text-slate-500">
                    Use template aprovado para clientes fora da janela de 24h.
                  </p>
                </div>
                <div className="flex rounded-full bg-slate-100 p-1 text-xs font-semibold">
                  <button
                    className={clsx(
                      "rounded-full px-3 py-1.5",
                      messageMode === "TEMPLATE"
                        ? "bg-white text-brand shadow-sm"
                        : "text-slate-500"
                    )}
                    type="button"
                    onClick={() => setMessageMode("TEMPLATE")}
                  >
                    Template Meta
                  </button>
                  <button
                    className={clsx(
                      "rounded-full px-3 py-1.5",
                      messageMode === "TEXT"
                        ? "bg-white text-brand shadow-sm"
                        : "text-slate-500"
                    )}
                    type="button"
                    onClick={() => setMessageMode("TEXT")}
                  >
                    Mensagem livre
                  </button>
                </div>
              </div>

              {messageMode === "TEMPLATE" ? (
                <div className="mt-3 space-y-3">
                  <label className="block text-sm font-semibold">
                    Template aprovado
                    <select
                      className="mt-2 h-11 w-full rounded border border-line bg-white px-3 font-normal outline-none focus:border-brand"
                      value={
                        selectedCampaignTemplate
                          ? `${selectedCampaignTemplate.name}::${selectedCampaignTemplate.language}`
                          : ""
                      }
                      onChange={(event) => {
                        const template = campaignTemplates.find(
                          (item) =>
                            `${item.name}::${item.language}` === event.target.value
                        );
                        setSelectedCampaignTemplate(template ?? null);
                        setCampaignTemplateValues(
                          template
                            ? Array.from({ length: template.variableCount }, () => "")
                            : []
                        );
                      }}
                    >
                      <option value="">
                        {templatesLoading
                          ? "Buscando templates..."
                          : "Selecione um template aprovado"}
                      </option>
                      {campaignTemplates.map((template) => (
                        <option
                          key={`${template.name}-${template.language}`}
                          value={`${template.name}::${template.language}`}
                        >
                          {template.name} - {template.language} - {template.category}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedCampaignTemplate && (
                    <div className="rounded-xl bg-slate-50 p-3 text-sm">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
                          {selectedCampaignTemplate.status}
                        </span>
                        <span className="rounded-full bg-blue-50 px-2 py-1 font-semibold text-blue-700">
                          {selectedCampaignTemplate.language}
                        </span>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-slate-700">
                        {selectedCampaignTemplate.preview}
                      </p>
                      {campaignTemplateValues.length > 0 && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {campaignTemplateValues.map((value, index) => (
                            <input
                              key={index}
                              className="h-10 rounded border border-line px-3 text-sm outline-none focus:border-brand"
                              placeholder={`Variavel {{${index + 1}}} - ex: {{nome}}`}
                              value={value}
                              onChange={(event) =>
                                setCampaignTemplateValues((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index ? event.target.value : item
                                  )
                                )
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {!templatesLoading && channelId && campaignTemplates.length === 0 && (
                    <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                      Nenhum template aprovado encontrado para este canal. Confira os
                      modelos na Meta.
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            {messageMode === "TEXT" && (
              <label className="block text-sm font-semibold">
                Mensagem do disparo
                <textarea
                  className="mt-2 min-h-36 w-full rounded border border-line px-3 py-3 font-normal outline-none focus:border-brand"
                  placeholder="Digite a mensagem que sera enviada para contatos dentro da janela de 24h."
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>
            )}

            <div
              className={clsx(
                "rounded border border-line bg-slate-50 p-3",
                messageMode === "TEMPLATE" && "opacity-50"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Adicionar imagem</p>
                  <p className="text-xs text-slate-500">
                    JPG, JPEG ou PNG ate 5MB. A imagem sera enviada com legenda.
                  </p>
                </div>
                <label className="flex h-10 cursor-pointer items-center gap-2 rounded border border-line bg-white px-3 text-sm font-semibold text-slate-700">
                  <Upload className="h-4 w-4" />
                  Escolher imagem
                  <input
                    accept="image/jpeg,image/png"
                    className="hidden"
                    disabled={messageMode === "TEMPLATE"}
                    type="file"
                    onChange={(event) =>
                      handleImageChange(event.target.files?.[0] ?? null)
                    }
                  />
                </label>
              </div>

              {imagePreview && (
                <div className="mt-3 flex items-start gap-3">
                  <NextImage
                    alt="Preview do disparo"
                    className="h-28 w-28 rounded border border-line object-cover"
                    height={112}
                    src={imagePreview}
                    unoptimized
                    width={112}
                  />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-semibold">{image?.name}</p>
                    <p className="text-slate-500">
                      {image ? `${(image.size / 1024 / 1024).toFixed(2)} MB` : ""}
                    </p>
                    <button
                      className="mt-3 inline-flex h-9 items-center gap-2 rounded border border-line bg-white px-3 font-semibold text-slate-600"
                      type="button"
                      onClick={() => setImage(null)}
                    >
                      <X className="h-4 w-4" />
                      Remover imagem
                    </button>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {error}
              </div>
            )}

            {lastCampaign && (
              <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                Disparo criado: {lastCampaign.sent} enviado(s),{" "}
                {lastCampaign.failed} falha(s).
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded border border-line bg-white p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">
                  Contatos selecionados: {selectedIds.length}
                </p>
                <button
                  className="text-xs font-semibold text-brand"
                  type="button"
                  onClick={() =>
                    setSelectedIds(
                      selectedIds.length === filteredContacts.length
                        ? []
                        : filteredContacts.map((contact) => contact.id)
                    )
                  }
                >
                  {selectedIds.length === filteredContacts.length
                    ? "Limpar"
                    : "Selecionar todos"}
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  className="h-10 w-full rounded border border-line pl-9 pr-3 text-sm outline-none focus:border-brand"
                  placeholder="Buscar contatos..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <div className="mt-3 max-h-96 space-y-2 overflow-auto pr-1">
                {filteredContacts.map((contact) => (
                  <label
                    key={contact.id}
                    className="flex cursor-pointer items-center gap-3 rounded border border-line p-3 text-sm hover:bg-slate-50"
                  >
                    <input
                      checked={selectedIds.includes(contact.id)}
                      type="checkbox"
                      onChange={() => toggleContact(contact.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {contact.name}
                      </span>
                      <span className="text-xs text-slate-500">{contact.phone}</span>
                    </span>
                  </label>
                ))}
                {!filteredContacts.length && (
                  <p className="rounded border border-dashed border-line p-4 text-center text-sm text-slate-500">
                    Nenhum contato encontrado.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </form>

      <aside className="space-y-4">
        <div className="rounded border border-line bg-white p-4 shadow-soft">
          <h3 className="font-bold">Previa da mensagem</h3>
          <div className="mt-3 rounded bg-[#e7ffdb] p-3 text-sm text-slate-800">
            {imagePreview ? (
              <NextImage
                alt="Preview da imagem"
                className="mb-3 max-h-56 w-full rounded object-cover"
                height={224}
                src={imagePreview}
                unoptimized
                width={320}
              />
            ) : (
              <div className="mb-3 grid h-32 place-items-center rounded border border-dashed border-emerald-300 bg-white/40 text-emerald-700">
                <ImageIcon className="h-8 w-8" />
              </div>
            )}
            <p className="whitespace-pre-wrap">
              {renderMessagePreview()}
            </p>
          </div>
          <div className="mt-3 rounded border border-line p-3 text-xs text-slate-500">
            {selectedContacts.slice(0, 3).map((contact) => contact.name).join(", ") ||
              importedContactsPreview.map((contact) => contact.name).join(", ") ||
              "Selecione contatos ou importe uma planilha para ver destinatarios."}
            {selectedContacts.length > 3
              ? ` e mais ${selectedContacts.length - 3}`
              : importedContactsPreview.length > 3
                ? ` e mais ${importedContactsPreview.length - 3}`
              : ""}
          </div>
        </div>

        <div className="rounded border border-line bg-white p-4 shadow-soft">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold">Historico de disparos</h3>
              <p className="text-xs text-slate-500">
                {loading ? "Carregando..." : `${campaigns.length} campanhas`}
              </p>
            </div>
            <button
              className="inline-flex h-8 items-center gap-1 rounded-full border border-line px-3 text-xs font-semibold text-slate-600"
              type="button"
              onClick={() => void onRefreshCampaigns()}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Atualizar
            </button>
          </div>
          <select
            className="mb-3 h-9 w-full rounded border border-line bg-white px-3 text-xs font-semibold outline-none focus:border-brand"
            value={campaignStatusFilter}
            onChange={(event) => setCampaignStatusFilter(event.target.value)}
          >
            <option value="ALL">Todos os status</option>
            <option value="SENDING">Enviando</option>
            <option value="PAUSED">Pausadas</option>
            <option value="COMPLETED">Concluidas</option>
            <option value="PARTIAL">Parciais</option>
            <option value="FAILED">Falhas</option>
            <option value="CANCELED">Canceladas</option>
          </select>
          <div className="max-h-96 space-y-3 overflow-auto pr-1">
            {filteredCampaigns.slice(0, 12).map((campaign) => (
              <button
                key={campaign.id}
                className={clsx(
                  "w-full rounded border p-3 text-left text-sm transition hover:bg-slate-50",
                  selectedCampaign?.id === campaign.id
                    ? "border-brand bg-blue-50/40"
                    : "border-line bg-white"
                )}
                type="button"
                onClick={() => setSelectedCampaignId(campaign.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{campaign.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatRelativeDate(campaign.createdAt)}
                    </p>
                  </div>
                  <span
                    className={clsx(
                      "rounded-full px-2 py-1 text-xs font-semibold",
                      campaignStatusClass(campaign.status)
                    )}
                  >
                    {campaignStatusLabel(campaign.status)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                  <span className="rounded bg-slate-50 p-2">Total {campaign.total}</span>
                  <span className="rounded bg-emerald-50 p-2">
                    Env. {campaign.sent}
                  </span>
                  <span className="rounded bg-teal-50 p-2">
                    Ent. {campaign.delivered}
                  </span>
                  <span className="rounded bg-rose-50 p-2">
                    Erro {campaign.failed}
                  </span>
                </div>
                {campaign.recipients.some((recipient) => recipient.errorMessage) && (
                  <p className="mt-2 line-clamp-2 text-xs text-rose-700">
                    {campaign.recipients.find((recipient) => recipient.errorMessage)
                      ?.errorMessage}
                  </p>
                )}
              </button>
            ))}
            {!filteredCampaigns.length && (
              <p className="rounded border border-dashed border-line p-4 text-center text-sm text-slate-500">
                Nenhum disparo registrado ainda.
              </p>
            )}
          </div>
        </div>

        {selectedCampaign && (
          <div className="rounded border border-line bg-white p-4 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-bold">Acompanhamento</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedCampaign.channel.name}
                  {selectedCampaign.channel.displayPhone
                    ? ` - ${selectedCampaign.channel.displayPhone}`
                    : ""}
                </p>
              </div>
              <span
                className={clsx(
                  "rounded-full px-2 py-1 text-xs font-semibold",
                  campaignStatusClass(selectedCampaign.status)
                )}
              >
                {campaignStatusLabel(selectedCampaign.status)}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
              <span className="rounded-xl bg-slate-50 p-3">
                <b className="block text-lg text-slate-950">{selectedCampaign.total}</b>
                Total
              </span>
              <span className="rounded-xl bg-blue-50 p-3">
                <b className="block text-lg text-blue-700">{selectedCampaignPending}</b>
                Pendentes
              </span>
              <span className="rounded-xl bg-emerald-50 p-3">
                <b className="block text-lg text-emerald-700">{selectedCampaign.sent}</b>
                Enviados
              </span>
              <span className="rounded-xl bg-rose-50 p-3">
                <b className="block text-lg text-rose-700">{selectedCampaign.failed}</b>
                Erros
              </span>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round(
                      ((selectedCampaign.sent + selectedCampaign.failed) /
                        Math.max(selectedCampaign.total, 1)) *
                        100
                    )
                  )}%`
                }}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {["DRAFT", "PENDING", "PAUSED"].includes(selectedCampaign.status) && (
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-brand px-3 text-xs font-semibold text-white disabled:opacity-60"
                  disabled={Boolean(campaignActionLoading)}
                  type="button"
                  onClick={() =>
                    void runCampaignAction(
                      selectedCampaign.id,
                      selectedCampaign.status === "PAUSED" ? "resume" : "start"
                    )
                  }
                >
                  <Send className="h-3.5 w-3.5" />
                  {campaignActionLoading.includes(selectedCampaign.id)
                    ? "Processando..."
                    : selectedCampaign.status === "PAUSED"
                      ? "Retomar"
                      : "Iniciar"}
                </button>
              )}
              {selectedCampaign.status === "SENDING" && (
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700 disabled:opacity-60"
                  disabled={Boolean(campaignActionLoading)}
                  type="button"
                  onClick={() => void runCampaignAction(selectedCampaign.id, "pause")}
                >
                  <Clock3 className="h-3.5 w-3.5" />
                  Pausar
                </button>
              )}
              {!["COMPLETED", "FAILED", "CANCELED"].includes(selectedCampaign.status) && (
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 disabled:opacity-60"
                  disabled={Boolean(campaignActionLoading)}
                  type="button"
                  onClick={() => void runCampaignAction(selectedCampaign.id, "cancel")}
                >
                  <Square className="h-3.5 w-3.5" />
                  Cancelar
                </button>
              )}
              <button
                className="inline-flex h-9 items-center gap-2 rounded-full border border-line px-3 text-xs font-semibold text-slate-600"
                type="button"
                onClick={() => downloadCampaignReport(selectedCampaign)}
              >
                <Download className="h-3.5 w-3.5" />
                Exportar
              </button>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Destinatarios</p>
                <select
                  className="h-8 rounded border border-line bg-white px-2 text-xs font-semibold outline-none"
                  value={recipientStatusFilter}
                  onChange={(event) => setRecipientStatusFilter(event.target.value)}
                >
                  <option value="ALL">Todos</option>
                  <option value="PENDING">Pendentes</option>
                  <option value="SENT">Enviados</option>
                  <option value="DELIVERED">Entregues</option>
                  <option value="FAILED">Erros</option>
                  <option value="CANCELED">Cancelados</option>
                </select>
              </div>
              <div className="max-h-72 space-y-2 overflow-auto pr-1">
                {selectedCampaignRecipients.slice(0, 120).map((recipient) => (
                  <div
                    key={recipient.id}
                    className="rounded-xl border border-line bg-slate-50 p-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">
                          {recipient.contactName}
                        </p>
                        <p className="text-slate-500">{recipient.phone}</p>
                      </div>
                      <span
                        className={clsx(
                          "shrink-0 rounded-full px-2 py-1 font-semibold",
                          recipient.status === "FAILED"
                            ? "bg-rose-50 text-rose-700"
                            : recipient.status === "DELIVERED" ||
                                recipient.status === "SENT"
                              ? "bg-emerald-50 text-emerald-700"
                              : recipient.status === "CANCELED"
                                ? "bg-slate-100 text-slate-500"
                                : "bg-blue-50 text-blue-700"
                        )}
                      >
                        {recipient.status}
                      </span>
                    </div>
                    {recipient.errorMessage && (
                      <p className="mt-2 rounded-lg bg-rose-50 p-2 text-rose-700">
                        {recipient.errorMessage}
                      </p>
                    )}
                  </div>
                ))}
                {!selectedCampaignRecipients.length && (
                  <p className="rounded border border-dashed border-line p-4 text-center text-sm text-slate-500">
                    Nenhum destinatario neste filtro.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Chatbot() {
  return (
    <section className="rounded border border-line bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">Construtor de chatbot</h3>
          <p className="text-sm text-slate-500">Fluxos, perguntas, tags e follow-up automatico.</p>
        </div>
        <button className="rounded bg-brand px-4 py-2 text-sm font-semibold text-white">
          Novo fluxo
        </button>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {["Qualificacao", "Follow-up por tag", "Transferencia para agente"].map((flow) => (
          <div key={flow} className="rounded border border-line p-4">
            <p className="font-semibold">{flow}</p>
            <p className="mt-2 text-sm text-slate-600">Blocos preparados para a proxima etapa.</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const retirementInterestLabels = {
  NONE: "Sem interesse",
  LOW: "Baixo",
  MEDIUM: "Medio",
  HIGH: "Alto"
} as const;

const retirementStatusLabels = {
  IMPORTED: "Importado",
  FIRST_CONTACT: "Primeiro contato",
  RESPONDED: "Respondeu",
  INTERESTED: "Interessado",
  NURTURING: "Nutricao",
  PRE_UNLOCK: "Pre-desbloqueio",
  READY_TO_CONVERT: "Pronto para converter",
  CONVERTED: "Convertido",
  LOST: "Perdido"
} as const;

function formatShortDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
}

function RecemAposentados({
  leads,
  dashboard,
  pagination,
  filters,
  loading,
  selectedLead,
  onFiltersChange,
  onSelectLead,
  onUpdateLead,
  onCreateEvent
}: {
  leads: RetirementLeadRow[];
  dashboard: RetirementLeadDashboard;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  filters: RetirementLeadFilters;
  loading: boolean;
  selectedLead: RetirementLeadRow | null;
  onFiltersChange: (filters: RetirementLeadFilters) => void;
  onSelectLead: (lead: RetirementLeadRow | null) => void;
  onUpdateLead: (id: string, payload: Partial<RetirementLeadRow>) => Promise<void>;
  onCreateEvent: (retirementLeadId: string, description: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");

  function updateFilter(key: keyof RetirementLeadFilters, value: string | number) {
    onFiltersChange({ ...filters, [key]: value, page: key === "page" ? Number(value) : 1 });
  }

  async function handleNoteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedLead || !note.trim()) return;
    await onCreateEvent(selectedLead.id, note);
    setNote("");
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
              Jornada 90 dias
            </p>
            <h3 className="mt-1 text-2xl font-black text-slate-950">
              Recem-Aposentados
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Base preparada para organizar concessao, desbloqueio e proxima acao.
            </p>
          </div>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-bold text-slate-600 hover:bg-slate-50"
            onClick={() => onFiltersChange({ ...filters, page: 1 })}
            type="button"
          >
            <RefreshCcw className="h-4 w-4" />
            Atualizar
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4 xl:grid-cols-8">
          <RetirementMetric label="Total importados" value={dashboard.totalImported} />
          <RetirementMetric label="Ate 90 dias" value={dashboard.until90} />
          <RetirementMetric label="Ate 60 dias" value={dashboard.until60} />
          <RetirementMetric label="Ate 30 dias" value={dashboard.until30} />
          <RetirementMetric label="Ate 15 dias" value={dashboard.until15} />
          <RetirementMetric label="Prontos" value={dashboard.readyToConvert} />
          <RetirementMetric label="Quentes" value={dashboard.hotLeads} tone="hot" />
          <RetirementMetric label="Frios" value={dashboard.coldLeads} tone="cold" />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-3xl border border-line bg-white shadow-soft">
          <div className="border-b border-line p-4">
            <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
              <input
                className="h-10 rounded-2xl border border-line px-3 text-sm outline-none focus:border-primary md:col-span-2"
                placeholder="Buscar nome, CPF, telefone ou beneficio"
                value={filters.search}
                onChange={(event) => updateFilter("search", event.target.value)}
              />
              <input
                className="h-10 rounded-2xl border border-line px-3 text-sm outline-none focus:border-primary"
                placeholder="Estado"
                value={filters.state}
                onChange={(event) => updateFilter("state", event.target.value)}
              />
              <input
                className="h-10 rounded-2xl border border-line px-3 text-sm outline-none focus:border-primary"
                placeholder="Cidade"
                value={filters.city}
                onChange={(event) => updateFilter("city", event.target.value)}
              />
              <select
                className="h-10 rounded-2xl border border-line bg-white px-3 text-sm outline-none"
                value={filters.maxDaysToUnlock}
                onChange={(event) => updateFilter("maxDaysToUnlock", event.target.value)}
              >
                <option value="">Dias</option>
                <option value="90">Ate 90</option>
                <option value="60">Ate 60</option>
                <option value="30">Ate 30</option>
                <option value="15">Ate 15</option>
              </select>
              <input
                className="h-10 rounded-2xl border border-line px-3 text-sm outline-none focus:border-primary"
                placeholder="Score min."
                value={filters.minScore}
                onChange={(event) => updateFilter("minScore", event.target.value)}
              />
              <select
                className="h-10 rounded-2xl border border-line bg-white px-3 text-sm outline-none"
                value={filters.interestLevel}
                onChange={(event) => updateFilter("interestLevel", event.target.value)}
              >
                <option value="">Interesse</option>
                {Object.entries(retirementInterestLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                className="h-10 rounded-2xl border border-line bg-white px-3 text-sm outline-none"
                value={filters.journeyStatus}
                onChange={(event) => updateFilter("journeyStatus", event.target.value)}
              >
                <option value="">Status</option>
                {Object.entries(retirementStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                className="h-9 rounded-full border border-line bg-white px-3 text-xs font-semibold text-slate-600 outline-none"
                value={filters.hasCorrespondent}
                onChange={(event) => updateFilter("hasCorrespondent", event.target.value)}
              >
                <option value="">Correspondente: todos</option>
                <option value="true">Possui</option>
                <option value="false">Nao possui</option>
              </select>
              <select
                className="h-9 rounded-full border border-line bg-white px-3 text-xs font-semibold text-slate-600 outline-none"
                value={filters.nextAction}
                onChange={(event) => updateFilter("nextAction", event.target.value)}
              >
                <option value="">Proxima acao: todas</option>
                <option value="due">Vencida/hoje</option>
                <option value="scheduled">Agendada</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Telefone</th>
                  <th className="px-4 py-3">Cidade/UF</th>
                  <th className="px-4 py-3">Beneficio</th>
                  <th className="px-4 py-3">Concessao</th>
                  <th className="px-4 py-3">Dias</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Interesse</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Proxima acao</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className={clsx(
                      "cursor-pointer border-t border-line hover:bg-blue-50/40",
                      selectedLead?.id === lead.id && "bg-blue-50"
                    )}
                    onClick={() => onSelectLead(lead)}
                  >
                    <td className="px-4 py-3 font-bold text-slate-900">
                      {lead.contact.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{lead.contact.phone}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {[lead.city, lead.state].filter(Boolean).join(" / ") || "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {lead.benefitType || lead.benefitNumber || "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatShortDate(lead.grantDate)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">
                      {lead.daysToUnlock ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">
                        {lead.score}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <RetirementBadge value={retirementInterestLabels[lead.interestLevel]} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {retirementStatusLabels[lead.journeyStatus]}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatShortDate(lead.nextContactDate)}
                    </td>
                  </tr>
                ))}
                {!loading && leads.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={10}>
                      Nenhum lead de recem-aposentado encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-line p-4 text-sm text-slate-600">
            <span>
              {loading ? "Carregando..." : `${pagination.total} registro(s)`}
            </span>
            <div className="flex items-center gap-2">
              <button
                className="h-9 rounded-full border border-line px-3 font-semibold disabled:opacity-40"
                disabled={pagination.page <= 1}
                onClick={() => updateFilter("page", pagination.page - 1)}
                type="button"
              >
                Anterior
              </button>
              <span className="text-xs font-bold">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                className="h-9 rounded-full border border-line px-3 font-semibold disabled:opacity-40"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => updateFilter("page", pagination.page + 1)}
                type="button"
              >
                Proxima
              </button>
            </div>
          </div>
        </div>

        <aside className="rounded-3xl border border-line bg-white p-5 shadow-soft">
          {!selectedLead ? (
            <div className="grid min-h-72 place-items-center text-center text-sm text-slate-500">
              Selecione um lead para ver dados e timeline.
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-brand">
                  Detalhe do lead
                </p>
                <h4 className="mt-1 text-xl font-black text-slate-950">
                  {selectedLead.contact.name}
                </h4>
                <p className="text-sm text-slate-500">{selectedLead.contact.phone}</p>
              </div>

              <div className="grid gap-2 text-sm">
                <RetirementInfo label="CPF" value={selectedLead.contact.cpf || "-"} />
                <RetirementInfo label="Cidade" value={selectedLead.city || "-"} />
                <RetirementInfo label="Estado" value={selectedLead.state || "-"} />
                <RetirementInfo label="Beneficio" value={selectedLead.benefitType || "-"} />
                <RetirementInfo label="Concessao" value={formatShortDate(selectedLead.grantDate)} />
                <RetirementInfo
                  label="Desbloqueio"
                  value={formatShortDate(selectedLead.estimatedUnlockDate)}
                />
              </div>

              <div className="rounded-2xl border border-line bg-slate-50 p-3">
                <p className="text-sm font-bold text-slate-900">Informacoes comerciais</p>
                <div className="mt-3 grid gap-2">
                  <label className="text-xs font-bold uppercase text-slate-500">
                    Interesse
                    <select
                      className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm normal-case text-slate-700"
                      value={selectedLead.interestLevel}
                      onChange={(event) =>
                        void onUpdateLead(selectedLead.id, {
                          interestLevel: event.target.value as RetirementLeadRow["interestLevel"]
                        })
                      }
                    >
                      {Object.entries(retirementInterestLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-bold uppercase text-slate-500">
                    Status da jornada
                    <select
                      className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm normal-case text-slate-700"
                      value={selectedLead.journeyStatus}
                      onChange={(event) =>
                        void onUpdateLead(selectedLead.id, {
                          journeyStatus: event.target.value as RetirementLeadRow["journeyStatus"]
                        })
                      }
                    >
                      {Object.entries(retirementStatusLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-600">
                    Possui correspondente
                    <input
                      checked={selectedLead.hasCorrespondent}
                      onChange={(event) =>
                        void onUpdateLead(selectedLead.id, {
                          hasCorrespondent: event.target.checked
                        })
                      }
                      type="checkbox"
                    />
                  </label>
                  <RetirementInfo label="Valor desejado" value={selectedLead.desiredAmount ? formatCurrency(selectedLead.desiredAmount) : "-"} />
                  <RetirementInfo label="Score" value={String(selectedLead.score)} />
                </div>
              </div>

              <div>
                <p className="text-sm font-bold text-slate-900">Timeline</p>
                <form className="mt-2 flex gap-2" onSubmit={handleNoteSubmit}>
                  <input
                    className="h-10 min-w-0 flex-1 rounded-xl border border-line px-3 text-sm outline-none"
                    placeholder="Adicionar nota"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <button className="h-10 rounded-xl bg-brand px-3 text-xs font-bold text-white">
                    Salvar
                  </button>
                </form>
                <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1">
                  {selectedLead.events.map((event) => (
                    <div key={event.id} className="rounded-2xl border border-line p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold uppercase text-slate-500">
                          {event.eventType}
                        </p>
                        <span className="text-xs text-slate-400">
                          {formatRelativeDate(event.createdAt)}
                        </span>
                      </div>
                      {event.description && (
                        <p className="mt-1 text-sm text-slate-700">{event.description}</p>
                      )}
                    </div>
                  ))}
                  {selectedLead.events.length === 0 && (
                    <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-slate-500">
                      Nenhum evento registrado.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}

function RetirementMetric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: number;
  tone?: "neutral" | "hot" | "cold";
}) {
  return (
    <div
      className={clsx(
        "rounded-2xl border p-3",
        tone === "hot"
          ? "border-emerald-100 bg-emerald-50"
          : tone === "cold"
            ? "border-slate-200 bg-slate-50"
            : "border-line bg-white"
      )}
    >
      <p className="text-[11px] font-bold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
    </div>
  );
}

function RetirementBadge({ value }: { value: string }) {
  return (
    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
      {value}
    </span>
  );
}

function RetirementInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
      <span className="text-xs font-bold uppercase text-slate-500">{label}</span>
      <span className="text-right text-sm font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function EmpresasPage({
  companies,
  loading,
  onCreateCompany,
  onRefresh
}: {
  companies: CompanyTenantRow[];
  loading: boolean;
  onCreateCompany: (payload: {
    companyName: string;
    companyEmail: string;
    companyPhone: string;
    segment: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
  }) => Promise<CompanyTenantRow | null>;
  onRefresh: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    companyName: "",
    companyEmail: "",
    companyPhone: "",
    segment: "Correspondente bancario com foco em credito consignado",
    adminName: "",
    adminEmail: "",
    adminPassword: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [createdCompany, setCreatedCompany] = useState<CompanyTenantRow | null>(null);
  const [localError, setLocalError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError("");

    if (
      !form.companyName.trim() ||
      !form.adminName.trim() ||
      !form.adminEmail.trim() ||
      !form.adminPassword
    ) {
      setLocalError("Preencha empresa, nome do admin, email e senha.");
      return;
    }

    setSubmitting(true);
    const company = await onCreateCompany(form);
    setSubmitting(false);

    if (!company) return;

    setCreatedCompany(company);
    setForm({
      companyName: "",
      companyEmail: "",
      companyPhone: "",
      segment: "Correspondente bancario com foco em credito consignado",
      adminName: "",
      adminEmail: "",
      adminPassword: ""
    });
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
      <form
        className="rounded-[1.5rem] border border-line/80 bg-white p-5 shadow-soft"
        onSubmit={submit}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
              Multiempresa
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-950">
              Nova empresa
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Cria um tenant separado com admin proprio e base isolada.
            </p>
          </div>
          <button
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-slate-500 hover:bg-slate-50"
            type="button"
            onClick={() => void onRefresh()}
            title="Atualizar"
          >
            <RefreshCcw className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <label className="block text-sm font-semibold">
            Nome da empresa
            <input
              className="mt-2 h-11 w-full rounded-xl border border-line px-3 font-normal outline-none focus:border-brand"
              value={form.companyName}
              onChange={(event) =>
                setForm((current) => ({ ...current, companyName: event.target.value }))
              }
              placeholder="Ex: Viva Consultoria"
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            <label className="block text-sm font-semibold">
              Email da empresa
              <input
                className="mt-2 h-11 w-full rounded-xl border border-line px-3 font-normal outline-none focus:border-brand"
                value={form.companyEmail}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    companyEmail: event.target.value
                  }))
                }
                placeholder="contato@empresa.com"
              />
            </label>
            <label className="block text-sm font-semibold">
              Telefone
              <input
                className="mt-2 h-11 w-full rounded-xl border border-line px-3 font-normal outline-none focus:border-brand"
                value={form.companyPhone}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    companyPhone: event.target.value
                  }))
                }
                placeholder="+55 33 99999-9999"
              />
            </label>
          </div>
          <label className="block text-sm font-semibold">
            Segmento/contexto da IA
            <textarea
              className="mt-2 min-h-20 w-full rounded-xl border border-line px-3 py-3 font-normal outline-none focus:border-brand"
              value={form.segment}
              onChange={(event) =>
                setForm((current) => ({ ...current, segment: event.target.value }))
              }
            />
          </label>
        </div>

        <div className="mt-5 rounded-2xl bg-slate-50 p-3">
          <p className="text-sm font-bold text-slate-900">Admin da empresa</p>
          <div className="mt-3 space-y-3">
            <input
              className="h-11 w-full rounded-xl border border-line px-3 text-sm outline-none focus:border-brand"
              value={form.adminName}
              onChange={(event) =>
                setForm((current) => ({ ...current, adminName: event.target.value }))
              }
              placeholder="Nome do administrador"
            />
            <input
              className="h-11 w-full rounded-xl border border-line px-3 text-sm outline-none focus:border-brand"
              type="email"
              value={form.adminEmail}
              onChange={(event) =>
                setForm((current) => ({ ...current, adminEmail: event.target.value }))
              }
              placeholder="email@empresa.com"
            />
            <input
              className="h-11 w-full rounded-xl border border-line px-3 text-sm outline-none focus:border-brand"
              type="password"
              value={form.adminPassword}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  adminPassword: event.target.value
                }))
              }
              placeholder="Senha inicial"
            />
          </div>
        </div>

        {localError && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            {localError}
          </p>
        )}
        {createdCompany && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <p className="font-bold">Empresa criada: {createdCompany.name}</p>
            <p className="mt-1">
              Admin: {createdCompany.admins[0]?.email}. Ela ja pode acessar o mesmo
              link do CRM com esses dados.
            </p>
          </div>
        )}

        <button
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-soft disabled:opacity-60"
          disabled={submitting}
          type="submit"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Criar empresa e admin
        </button>
      </form>

      <div className="rounded-[1.5rem] border border-line/80 bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-slate-950">Empresas cadastradas</h3>
            <p className="text-sm text-slate-500">
              Cada empresa possui contatos, canais Meta, campanhas e usuarios isolados.
            </p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-brand">
            {loading ? "Carregando..." : `${companies.length} empresa(s)`}
          </span>
        </div>

        <div className="mt-5 space-y-3">
          {loading &&
            [0, 1, 2].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          {!loading &&
            companies.map((company) => (
              <div
                key={company.id}
                className="rounded-2xl border border-line bg-slate-50/70 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-slate-950">{company.name}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {company.segment || "Credito consignado"}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      Criada {formatRelativeDate(company.createdAt)}
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-line">
                    {company.id === "seed-company" ? "Master" : "Tenant"}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                  <span className="rounded-xl bg-white p-2">
                    <b className="block text-base text-slate-950">
                      {company.counts.users}
                    </b>
                    usuarios
                  </span>
                  <span className="rounded-xl bg-white p-2">
                    <b className="block text-base text-slate-950">
                      {company.counts.contacts}
                    </b>
                    contatos
                  </span>
                  <span className="rounded-xl bg-white p-2">
                    <b className="block text-base text-slate-950">
                      {company.counts.channels}
                    </b>
                    canais
                  </span>
                  <span className="rounded-xl bg-white p-2">
                    <b className="block text-base text-slate-950">
                      {company.counts.campaigns}
                    </b>
                    disparos
                  </span>
                </div>
                <div className="mt-4 rounded-xl bg-white p-3 text-sm">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Admins
                  </p>
                  {company.admins.map((admin) => (
                    <p key={admin.id} className="mt-1 font-semibold text-slate-700">
                      {admin.name} - {admin.email}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          {!loading && companies.length === 0 && (
            <p className="rounded border border-dashed border-line p-6 text-center text-sm text-slate-500">
              Nenhuma empresa cadastrada.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

const tagColorPalette = [
  { label: "Fechado", color: "#16a34a", textColor: "#ffffff" },
  { label: "Negociacao", color: "#f59e0b", textColor: "#111827" },
  { label: "Problema", color: "#dc2626", textColor: "#ffffff" },
  { label: "CLT", color: "#2563eb", textColor: "#ffffff" },
  { label: "FGTS", color: "#7c3aed", textColor: "#ffffff" },
  { label: "Retomar", color: "#0f766e", textColor: "#ffffff" },
  { label: "Documento", color: "#475569", textColor: "#ffffff" }
];

type TagFormState = {
  name: string;
  color: string;
  textColor: string;
  category: string;
  isActive: boolean;
};

function emptyTagForm(): TagFormState {
  return {
    name: "",
    color: "#2563eb",
    textColor: "#ffffff",
    category: "",
    isActive: true
  };
}

function TagsSettingsPage({
  tags,
  loading,
  onCreateTag,
  onUpdateTag,
  onDeleteTag
}: {
  tags: SettingsTagRow[];
  loading: boolean;
  onCreateTag: (payload: {
    name: string;
    color: string;
    textColor?: string;
    category?: string | null;
    isActive?: boolean;
  }) => Promise<void>;
  onUpdateTag: (
    id: string,
    payload: {
      name?: string;
      color?: string;
      textColor?: string;
      category?: string | null;
      isActive?: boolean;
    }
  ) => Promise<void>;
  onDeleteTag: (id: string) => Promise<void>;
}) {
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingTag, setEditingTag] = useState<SettingsTagRow | null>(null);
  const [toast, setToast] = useState("");
  const activeCount = tags.filter((tag) => tag.isActive).length;
  const inactiveCount = tags.length - activeCount;

  async function deactivateTag(tag: SettingsTagRow) {
    if (!window.confirm(`Desativar a tag "${tag.name}"?`)) return;
    await onDeleteTag(tag.id);
    setToast("Tag desativada.");
  }

  async function activateTag(tag: SettingsTagRow) {
    await onUpdateTag(tag.id, { isActive: true });
    setToast("Tag ativada.");
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 rounded-[1.5rem] border border-line/80 bg-white p-5 shadow-soft md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
            Configuracoes
          </p>
          <h3 className="mt-1 text-2xl font-bold text-slate-950">Tags</h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Organize conversas por perfil, produto, etapa comercial e proximo passo.
          </p>
        </div>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-soft hover:bg-blue-700"
          onClick={() => {
            setEditingTag(null);
            setModalMode("create");
          }}
          type="button"
        >
          <Plus className="h-4 w-4" />
          Nova tag
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-line/80 bg-white p-4 shadow-soft">
          <p className="text-sm text-slate-500">Total de tags</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{tags.length}</p>
        </div>
        <div className="rounded-2xl border border-line/80 bg-white p-4 shadow-soft">
          <p className="text-sm text-slate-500">Ativas</p>
          <p className="mt-2 text-2xl font-bold text-emerald-600">{activeCount}</p>
        </div>
        <div className="rounded-2xl border border-line/80 bg-white p-4 shadow-soft">
          <p className="text-sm text-slate-500">Inativas</p>
          <p className="mt-2 text-2xl font-bold text-slate-500">{inactiveCount}</p>
        </div>
      </div>

      {toast && (
        <div className="flex items-center justify-between rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {toast}
          <button className="text-emerald-800" onClick={() => setToast("")} type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-[1.5rem] border border-line/80 bg-white shadow-soft">
        <div className="hidden grid-cols-[1.4fr_1fr_0.8fr_0.7fr_0.8fr_0.8fr] gap-4 border-b border-line/70 bg-slate-50 px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-400 md:grid">
          <span>Tag</span>
          <span>Categoria</span>
          <span>Status</span>
          <span>Conversas</span>
          <span>Criada</span>
          <span className="text-right">Acoes</span>
        </div>
        <div className="divide-y divide-line/70">
          {loading && (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          )}
          {!loading && tags.length === 0 && (
            <div className="grid place-items-center p-10 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-brand">
                <Tags className="h-5 w-5" />
              </div>
              <p className="mt-3 font-semibold text-slate-900">Nenhuma tag criada ainda.</p>
              <p className="mt-1 text-sm text-slate-500">
                Crie tags como CLT, FGTS, Proposta enviada ou Retomar hoje.
              </p>
            </div>
          )}
          {!loading &&
            tags.map((tag) => (
              <div
                key={tag.id}
                className="grid gap-3 px-5 py-4 text-sm md:grid-cols-[1.4fr_1fr_0.8fr_0.7fr_0.8fr_0.8fr] md:items-center"
              >
                <div className="min-w-0">
                  <TagBadge tag={tag} />
                  <p className="mt-2 text-xs text-slate-500">
                    Fundo {tag.color} · Texto {tag.textColor || "#ffffff"}
                  </p>
                </div>
                <p className="text-slate-600">{tag.category || "Sem categoria"}</p>
                <span
                  className={clsx(
                    "w-fit rounded-full px-2.5 py-1 text-xs font-bold",
                    tag.isActive
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  )}
                >
                  {tag.isActive ? "Ativa" : "Inativa"}
                </span>
                <p className="font-semibold text-slate-800">{tag.conversationCount}</p>
                <p className="text-slate-500">
                  {tag.createdAt ? formatRelativeDate(tag.createdAt) : "-"}
                </p>
                <div className="flex justify-start gap-2 md:justify-end">
                  <button
                    className="grid h-9 w-9 place-items-center rounded-full border border-line text-slate-600 hover:bg-slate-50"
                    onClick={() => {
                      setEditingTag(tag);
                      setModalMode("edit");
                    }}
                    title="Editar"
                    type="button"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  {tag.isActive ? (
                    <button
                      className="grid h-9 w-9 place-items-center rounded-full border border-rose-200 text-rose-600 hover:bg-rose-50"
                      onClick={() => void deactivateTag(tag)}
                      title="Desativar"
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      className="grid h-9 w-9 place-items-center rounded-full border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      onClick={() => void activateTag(tag)}
                      title="Ativar"
                      type="button"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>

      {modalMode && (
        <TagEditorModal
          mode={modalMode}
          tag={editingTag}
          onClose={() => setModalMode(null)}
          onSubmit={async (payload) => {
            if (modalMode === "edit" && editingTag) {
              await onUpdateTag(editingTag.id, payload);
              setToast("Tag atualizada.");
            } else {
              await onCreateTag(payload);
              setToast("Tag criada.");
            }
            setModalMode(null);
          }}
        />
      )}
    </section>
  );
}

function TagEditorModal({
  mode,
  tag,
  onClose,
  onSubmit
}: {
  mode: "create" | "edit";
  tag: SettingsTagRow | null;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    color: string;
    textColor: string;
    category: string | null;
    isActive: boolean;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState<TagFormState>(() =>
    tag
      ? {
          name: tag.name,
          color: tag.color,
          textColor: tag.textColor || "#ffffff",
          category: tag.category || "",
          isActive: tag.isActive
        }
      : emptyTagForm()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("Informe o nome da tag.");
      return;
    }

    setSaving(true);
    setError("");
    await onSubmit({
      name: form.name.trim(),
      color: form.color,
      textColor: form.textColor,
      category: form.category.trim() || null,
      isActive: form.isActive
    });
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 backdrop-blur-sm">
      <form
        className="w-full max-w-lg overflow-hidden rounded-[1.5rem] border border-line bg-white shadow-soft"
        onSubmit={submit}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line/70 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
              Tags
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-950">
              {mode === "edit" ? "Editar tag" : "Criar tag"}
            </h3>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-full border border-line text-slate-500 hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {error}
            </div>
          )}

          <div className="rounded-2xl border border-line bg-slate-50 p-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">
              Preview
            </p>
            <TagBadge
              tag={{
                id: "preview",
                name: form.name || "Cliente fechado",
                color: form.color,
                textColor: form.textColor
              }}
            />
          </div>

          <label className="block text-sm font-semibold text-slate-800">
            Nome da tag
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm outline-none focus:border-blue-200"
              placeholder="Ex: Cliente fechado"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label className="block text-sm font-semibold text-slate-800">
            Categoria opcional
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm outline-none focus:border-blue-200"
              placeholder="Ex: Produto, Status, Follow-up"
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({ ...current, category: event.target.value }))
              }
            />
          </label>

          <div>
            <p className="text-sm font-semibold text-slate-800">Paleta rapida</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {tagColorPalette.map((option) => (
                <button
                  key={option.label}
                  className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold hover:bg-slate-50"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      color: option.color,
                      textColor: option.textColor
                    }))
                  }
                  type="button"
                >
                  <span
                    className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: option.color }}
                  />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-800">
              Cor de fundo
              <input
                className="mt-2 h-11 w-full rounded-2xl border border-line px-2"
                type="color"
                value={form.color}
                onChange={(event) =>
                  setForm((current) => ({ ...current, color: event.target.value }))
                }
              />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Cor do texto
              <input
                className="mt-2 h-11 w-full rounded-2xl border border-line px-2"
                type="color"
                value={form.textColor}
                onChange={(event) =>
                  setForm((current) => ({ ...current, textColor: event.target.value }))
                }
              />
            </label>
          </div>

          <label className="flex items-center justify-between rounded-2xl border border-line px-3 py-3 text-sm font-semibold text-slate-800">
            Tag ativa
            <input
              checked={form.isActive}
              className="h-4 w-4"
              onChange={(event) =>
                setForm((current) => ({ ...current, isActive: event.target.checked }))
              }
              type="checkbox"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-line/70 bg-slate-50 px-5 py-4">
          <button
            className="h-10 rounded-full border border-line bg-white px-4 text-sm font-semibold text-slate-600"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white disabled:bg-slate-300"
            disabled={saving}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar tag
          </button>
        </div>
      </form>
    </div>
  );
}

function Configuracoes({
  reference,
  attendants,
  aiSettings,
  leadAssignmentSettings,
  onSaveAiSettings,
  onSaveLeadAssignmentSettings,
  onUpdateAttendantStatus,
  onCreateOrigin,
  onCreateStage,
  onCreateTag,
  onCreateUser,
  onDeleteOrigin,
  onDeleteStage,
  onDeleteTag,
  onDeleteUser,
  onUpdateOrigin,
  onUpdateStage,
  onUpdateTag,
  onUpdateUser
}: {
  reference: ReferenceData;
  attendants: AttendantRow[];
  aiSettings: AiSettings;
  leadAssignmentSettings: LeadAssignmentSettings;
  onSaveAiSettings: (settings: AiSettings) => Promise<void>;
  onSaveLeadAssignmentSettings: (settings: LeadAssignmentSettings) => Promise<void>;
  onUpdateAttendantStatus: (userId: string, status: AvailabilityStatus) => Promise<void>;
  onCreateOrigin: (name: string) => Promise<void>;
  onCreateStage: (payload: {
    name: string;
    color: string;
    position: number;
  }) => Promise<void>;
  onCreateTag: (payload: { name: string; color: string }) => Promise<void>;
  onCreateUser: (payload: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
  }) => Promise<void>;
  onDeleteOrigin: (id: string) => Promise<void>;
  onDeleteStage: (id: string) => Promise<void>;
  onDeleteTag: (id: string) => Promise<void>;
  onDeleteUser: (id: string) => Promise<void>;
  onUpdateOrigin: (id: string, name: string) => Promise<void>;
  onUpdateStage: (
    id: string,
    payload: { name: string; color: string; position: number }
  ) => Promise<void>;
  onUpdateTag: (id: string, payload: { name: string; color: string }) => Promise<void>;
  onUpdateUser: (
    id: string,
    payload: { name: string; email: string; password?: string; role: UserRole }
  ) => Promise<void>;
}) {
  const [originName, setOriginName] = useState("");
  const [editingOrigin, setEditingOrigin] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [stageForm, setStageForm] = useState({
    name: "",
    color: "#0f766e",
    position: reference.stages.length + 1
  });
  const [editingStage, setEditingStage] = useState<{
    id: string;
    name: string;
    color: string;
    position: number;
  } | null>(null);
  const [tagForm, setTagForm] = useState({
    name: "",
    color: "#0f766e"
  });
  const [editingTag, setEditingTag] = useState<{
    id: string;
    name: string;
    color: string;
  } | null>(null);
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "AGENT" as UserRole
  });
  const [editingUser, setEditingUser] = useState<{
    id: string;
    name: string;
    email: string;
    password: string;
    role: UserRole;
  } | null>(null);
  const [assignmentForm, setAssignmentForm] =
    useState<LeadAssignmentSettings>(leadAssignmentSettings);
  const [aiForm, setAiForm] = useState<AiSettings>(aiSettings);

  useEffect(() => {
    setAssignmentForm(leadAssignmentSettings);
  }, [leadAssignmentSettings]);

  useEffect(() => {
    setAiForm(aiSettings);
  }, [aiSettings]);

  useEffect(() => {
    setStageForm((current) => ({
      ...current,
      position: current.name ? current.position : reference.stages.length + 1
    }));
  }, [reference.stages.length]);

  async function submitOrigin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!originName.trim()) return;

    await onCreateOrigin(originName);
    setOriginName("");
  }

  async function submitStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stageForm.name.trim()) return;

    await onCreateStage(stageForm);
    setStageForm({
      name: "",
      color: "#0f766e",
      position: reference.stages.length + 2
    });
  }

  async function submitUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userForm.name.trim() || !userForm.email.trim() || !userForm.password) return;

    await onCreateUser(userForm);
    setUserForm({ name: "", email: "", password: "", role: "AGENT" });
  }

  async function submitTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tagForm.name.trim()) return;

    await onCreateTag(tagForm);
    setTagForm({ name: "", color: "#0f766e" });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[1.5rem] border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
              Inteligencia artificial
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-950">
              Modo de atendimento da IA
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Defina se a IA fica desligada, apenas sugerindo respostas ou respondendo
              automaticamente quando novas mensagens chegarem.
            </p>
          </div>
          <button
            className="h-10 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-soft"
            onClick={() => void onSaveAiSettings(aiForm)}
            type="button"
          >
            Salvar IA
          </button>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[0.7fr_1.3fr]">
          <label className="text-sm font-semibold text-slate-800">
            Modo padrao da empresa
            <select
              className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm outline-none"
              value={aiForm.mode}
              onChange={(event) =>
                setAiForm((current) => ({
                  ...current,
                  mode: event.target.value as AiMode
                }))
              }
            >
              <option value="OFF">Desligada</option>
              <option value="COPILOT">Copiloto: sugerir resposta</option>
              <option value="AUTO">Automatica: responder sozinha</option>
              <option value="HYBRID">Hibrida: automatica sem responsavel</option>
            </select>
            <p className="mt-2 text-xs text-slate-500">
              O modo da conversa pode sobrescrever essa configuracao no Atendimento.
            </p>
          </label>
          <label className="text-sm font-semibold text-slate-800">
            Instrucoes internas da IA
            <textarea
              className="mt-2 min-h-28 w-full rounded-2xl border border-line bg-white px-3 py-2 text-sm outline-none"
              placeholder="Ex: priorizar credito CLT, pedir CPF somente quando necessario, transferir para humano ao falar de contrato."
              value={aiForm.instructions}
              onChange={(event) =>
                setAiForm((current) => ({
                  ...current,
                  instructions: event.target.value
                }))
              }
            />
          </label>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
              Atendimento
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-950">
              Distribuicao de leads
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Defina se novos leads ficam em fila para o primeiro atendente assumir
              ou se o sistema distribui automaticamente entre vendedores disponiveis.
            </p>
          </div>
          <button
            className="h-10 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-soft"
            onClick={() => void onSaveLeadAssignmentSettings(assignmentForm)}
            type="button"
          >
            Salvar distribuicao
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-800">
              Modo de distribuicao
              <select
                className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm outline-none"
                value={assignmentForm.mode}
                onChange={(event) =>
                  setAssignmentForm((current) => ({
                    ...current,
                    mode: event.target.value as LeadAssignmentSettings["mode"]
                  }))
                }
              >
                <option value="CLAIM_FIRST">Quem clicar primeiro pega</option>
                <option value="ROUND_ROBIN">Automatico igualitario</option>
                <option value="ADMIN_MANUAL">Manual pelo administrador</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Maximo aberto por atendente
              <input
                className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm outline-none"
                min={0}
                placeholder="Sem limite"
                type="number"
                value={assignmentForm.maxOpenPerAttendant ?? ""}
                onChange={(event) =>
                  setAssignmentForm((current) => ({
                    ...current,
                    maxOpenPerAttendant: event.target.value
                      ? Number(event.target.value)
                      : null
                  }))
                }
              />
            </label>
            {[
              ["onlineOnly", "Distribuir apenas para online"],
              ["allowAttendantClaim", "Permitir atendente assumir sem responsavel"],
              ["redistributeWhenOffline", "Redistribuir quando ficar offline"]
            ].map(([key, label]) => (
              <label
                key={key}
                className="flex items-center justify-between rounded-2xl border border-line px-3 py-3 text-sm font-semibold text-slate-700"
              >
                {label}
                <input
                  checked={Boolean(
                    assignmentForm[key as keyof LeadAssignmentSettings]
                  )}
                  type="checkbox"
                  onChange={(event) =>
                    setAssignmentForm((current) => ({
                      ...current,
                      [key]: event.target.checked
                    }))
                  }
                />
              </label>
            ))}
          </div>

          <div className="rounded-2xl border border-line bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-950">Atendentes</p>
                <p className="text-xs text-slate-500">
                  {assignmentModeLabel(assignmentForm.mode)}
                </p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-500 ring-1 ring-line">
                {attendants.length} usuario(s)
              </span>
            </div>
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
              {attendants.map((attendant) => (
                <div
                  key={attendant.id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3 ring-1 ring-line/70"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {attendant.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {attendant.openConversations} atendimento(s) aberto(s)
                    </p>
                  </div>
                  <select
                    className="h-9 rounded-full border border-line bg-slate-50 px-2 text-xs font-semibold text-slate-600"
                    value={attendant.availabilityStatus}
                    onChange={(event) =>
                      void onUpdateAttendantStatus(
                        attendant.id,
                        event.target.value as AvailabilityStatus
                      )
                    }
                  >
                    <option value="ONLINE">Disponivel</option>
                    <option value="BUSY">Ocupado</option>
                    <option value="PAUSED">Pausado</option>
                    <option value="OFFLINE">Indisponivel</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
      <section className="rounded border border-line bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold">Equipe</h3>
            <p className="text-sm text-slate-500">
              Usuarios, funcoes e responsaveis comerciais.
            </p>
          </div>
          <SlidersHorizontal className="h-5 w-5 text-slate-400" />
        </div>

        <form className="mt-5 grid gap-2" onSubmit={submitUser}>
          <ContactInput
            placeholder="Nome"
            required
            value={userForm.name}
            onChange={(name) => setUserForm((current) => ({ ...current, name }))}
          />
          <ContactInput
            placeholder="Email"
            required
            type="email"
            value={userForm.email}
            onChange={(email) => setUserForm((current) => ({ ...current, email }))}
          />
          <div className="grid gap-2 md:grid-cols-[1fr_140px_40px]">
            <ContactInput
              placeholder="Senha inicial"
              required
              type="password"
              value={userForm.password}
              onChange={(password) =>
                setUserForm((current) => ({ ...current, password }))
              }
            />
            <select
              className="h-10 rounded border border-line px-3 text-sm outline-none"
              value={userForm.role}
              onChange={(event) =>
                setUserForm((current) => ({
                  ...current,
                  role: event.target.value as UserRole
                }))
              }
            >
              <option value="AGENT">Agente</option>
              <option value="SUPERVISOR">Supervisor</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button className="grid h-10 w-10 place-items-center rounded bg-brand text-white">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </form>

        <div className="mt-5 divide-y divide-line rounded border border-line">
          {reference.users.map((user) => (
            <div key={user.id} className="p-3">
              {editingUser?.id === user.id ? (
                <form
                  className="grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onUpdateUser(user.id, {
                      name: editingUser.name,
                      email: editingUser.email,
                      role: editingUser.role,
                      ...(editingUser.password ? { password: editingUser.password } : {})
                    }).then(() => setEditingUser(null));
                  }}
                >
                  <ContactInput
                    placeholder="Nome"
                    required
                    value={editingUser.name}
                    onChange={(name) =>
                      setEditingUser((current) =>
                        current ? { ...current, name } : current
                      )
                    }
                  />
                  <ContactInput
                    placeholder="Email"
                    required
                    type="email"
                    value={editingUser.email}
                    onChange={(email) =>
                      setEditingUser((current) =>
                        current ? { ...current, email } : current
                      )
                    }
                  />
                  <ContactInput
                    placeholder="Nova senha opcional"
                    type="password"
                    value={editingUser.password}
                    onChange={(password) =>
                      setEditingUser((current) =>
                        current ? { ...current, password } : current
                      )
                    }
                  />
                  <div className="grid gap-2 md:grid-cols-[1fr_40px_40px]">
                    <select
                      className="h-10 rounded border border-line px-3 text-sm outline-none"
                      value={editingUser.role}
                      onChange={(event) =>
                        setEditingUser((current) =>
                          current
                            ? { ...current, role: event.target.value as UserRole }
                            : current
                        )
                      }
                    >
                      <option value="AGENT">Agente</option>
                      <option value="SUPERVISOR">Supervisor</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                    <button className="grid h-10 w-10 place-items-center rounded bg-brand text-white">
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      className="grid h-10 w-10 place-items-center rounded border border-line"
                      onClick={() => setEditingUser(null)}
                      type="button"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{user.name}</p>
                    <p className="truncate text-xs text-slate-500">{user.email}</p>
                    <span className="mt-2 inline-flex rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {user.role === "ADMIN"
                        ? "Admin"
                        : user.role === "SUPERVISOR"
                          ? "Supervisor"
                          : "Agente"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="grid h-9 w-9 place-items-center rounded border border-line text-slate-600"
                      onClick={() =>
                        setEditingUser({
                          id: user.id,
                          name: user.name,
                          email: user.email,
                          password: "",
                          role: user.role
                        })
                      }
                      type="button"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      className="grid h-9 w-9 place-items-center rounded border border-rose-200 text-rose-600"
                      onClick={() => {
                        if (window.confirm("Remover este usuario da equipe?")) {
                          void onDeleteUser(user.id);
                        }
                      }}
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded border border-line bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold">Tags de segmentacao</h3>
            <p className="text-sm text-slate-500">
              Classificam contatos para filtros e follow-up.
            </p>
          </div>
          <Tags className="h-5 w-5 text-slate-400" />
        </div>

        <form className="mt-5 grid gap-2 md:grid-cols-[1fr_88px_40px]" onSubmit={submitTag}>
          <ContactInput
            placeholder="Nova tag"
            required
            value={tagForm.name}
            onChange={(name) => setTagForm((current) => ({ ...current, name }))}
          />
          <input
            className="h-10 rounded border border-line px-2 outline-none"
            type="color"
            value={tagForm.color}
            onChange={(event) =>
              setTagForm((current) => ({ ...current, color: event.target.value }))
            }
          />
          <button className="grid h-10 w-10 place-items-center rounded bg-brand text-white">
            <Plus className="h-4 w-4" />
          </button>
        </form>

        <div className="mt-5 divide-y divide-line rounded border border-line">
          {reference.tags.map((tag) => (
            <div key={tag.id} className="p-3">
              {editingTag?.id === tag.id ? (
                <form
                  className="grid gap-2 md:grid-cols-[1fr_88px_40px_40px]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onUpdateTag(tag.id, editingTag).then(() => setEditingTag(null));
                  }}
                >
                  <ContactInput
                    placeholder="Tag"
                    required
                    value={editingTag.name}
                    onChange={(name) =>
                      setEditingTag((current) =>
                        current ? { ...current, name } : current
                      )
                    }
                  />
                  <input
                    className="h-10 rounded border border-line px-2 outline-none"
                    type="color"
                    value={editingTag.color}
                    onChange={(event) =>
                      setEditingTag((current) =>
                        current ? { ...current, color: event.target.value } : current
                      )
                    }
                  />
                  <button className="grid h-10 w-10 place-items-center rounded bg-brand text-white">
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    className="grid h-10 w-10 place-items-center rounded border border-line"
                    onClick={() => setEditingTag(null)}
                    type="button"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="rounded px-2 py-1 text-xs font-semibold text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                  <div className="flex gap-2">
                    <button
                      className="grid h-9 w-9 place-items-center rounded border border-line text-slate-600"
                      onClick={() => setEditingTag(tag)}
                      type="button"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      className="grid h-9 w-9 place-items-center rounded border border-rose-200 text-rose-600"
                      onClick={() => {
                        if (window.confirm("Remover esta tag dos contatos?")) {
                          void onDeleteTag(tag.id);
                        }
                      }}
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {reference.tags.length === 0 && (
            <div className="p-3 text-sm text-slate-500">Nenhuma tag configurada.</div>
          )}
        </div>
      </section>

      <section className="rounded border border-line bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold">Origens dos leads</h3>
            <p className="text-sm text-slate-500">
              Usadas nos contatos, filtros e Dashboard.
            </p>
          </div>
          <SlidersHorizontal className="h-5 w-5 text-slate-400" />
        </div>

        <form className="mt-5 flex gap-2" onSubmit={submitOrigin}>
          <ContactInput
            placeholder="Nova origem"
            required
            value={originName}
            onChange={setOriginName}
          />
          <button className="grid h-10 w-10 shrink-0 place-items-center rounded bg-brand text-white">
            <Plus className="h-4 w-4" />
          </button>
        </form>

        <div className="mt-5 divide-y divide-line rounded border border-line">
          {reference.origins.map((origin) => (
            <div key={origin.id} className="p-3">
              {editingOrigin?.id === origin.id ? (
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onUpdateOrigin(origin.id, editingOrigin.name).then(() =>
                      setEditingOrigin(null)
                    );
                  }}
                >
                  <ContactInput
                    placeholder="Origem"
                    required
                    value={editingOrigin.name}
                    onChange={(name) =>
                      setEditingOrigin((current) =>
                        current ? { ...current, name } : current
                      )
                    }
                  />
                  <button className="grid h-10 w-10 shrink-0 place-items-center rounded bg-brand text-white">
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    className="grid h-10 w-10 shrink-0 place-items-center rounded border border-line"
                    onClick={() => setEditingOrigin(null)}
                    type="button"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{origin.name}</p>
                  <div className="flex gap-2">
                    <button
                      className="grid h-9 w-9 place-items-center rounded border border-line text-slate-600"
                      onClick={() => setEditingOrigin(origin)}
                      type="button"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      className="grid h-9 w-9 place-items-center rounded border border-rose-200 text-rose-600"
                      onClick={() => {
                        if (window.confirm("Remover esta origem dos filtros?")) {
                          void onDeleteOrigin(origin.id);
                        }
                      }}
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded border border-line bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold">Etapas do funil</h3>
            <p className="text-sm text-slate-500">
              Controlam o Kanban, a ficha do cliente e a criacao de propostas.
            </p>
          </div>
          <SlidersHorizontal className="h-5 w-5 text-slate-400" />
        </div>

        <form className="mt-5 grid gap-2 md:grid-cols-[1fr_88px_96px_40px]" onSubmit={submitStage}>
          <ContactInput
            placeholder="Nova etapa"
            required
            value={stageForm.name}
            onChange={(name) => setStageForm((current) => ({ ...current, name }))}
          />
          <input
            className="h-10 rounded border border-line px-2 outline-none"
            type="color"
            value={stageForm.color}
            onChange={(event) =>
              setStageForm((current) => ({ ...current, color: event.target.value }))
            }
          />
          <input
            className="h-10 rounded border border-line px-3 text-sm outline-none"
            min={1}
            type="number"
            value={stageForm.position}
            onChange={(event) =>
              setStageForm((current) => ({
                ...current,
                position: Number(event.target.value)
              }))
            }
          />
          <button className="grid h-10 w-10 place-items-center rounded bg-brand text-white">
            <Plus className="h-4 w-4" />
          </button>
        </form>

        <div className="mt-5 divide-y divide-line rounded border border-line">
          {reference.stages.map((stage) => (
            <div key={stage.id} className="p-3">
              {editingStage?.id === stage.id ? (
                <form
                  className="grid gap-2 md:grid-cols-[1fr_88px_96px_40px_40px]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onUpdateStage(stage.id, editingStage).then(() =>
                      setEditingStage(null)
                    );
                  }}
                >
                  <ContactInput
                    placeholder="Etapa"
                    required
                    value={editingStage.name}
                    onChange={(name) =>
                      setEditingStage((current) =>
                        current ? { ...current, name } : current
                      )
                    }
                  />
                  <input
                    className="h-10 rounded border border-line px-2 outline-none"
                    type="color"
                    value={editingStage.color}
                    onChange={(event) =>
                      setEditingStage((current) =>
                        current ? { ...current, color: event.target.value } : current
                      )
                    }
                  />
                  <input
                    className="h-10 rounded border border-line px-3 text-sm outline-none"
                    min={1}
                    type="number"
                    value={editingStage.position}
                    onChange={(event) =>
                      setEditingStage((current) =>
                        current
                          ? { ...current, position: Number(event.target.value) }
                          : current
                      )
                    }
                  />
                  <button className="grid h-10 w-10 place-items-center rounded bg-brand text-white">
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    className="grid h-10 w-10 place-items-center rounded border border-line"
                    onClick={() => setEditingStage(null)}
                    type="button"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-4 w-4 rounded"
                      style={{ backgroundColor: stage.color ?? "#0f766e" }}
                    />
                    <div>
                      <p className="font-medium">{stage.name}</p>
                      <p className="text-xs text-slate-500">
                        Posicao {stage.position ?? 0}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="grid h-9 w-9 place-items-center rounded border border-line text-slate-600"
                      onClick={() =>
                        setEditingStage({
                          id: stage.id,
                          name: stage.name,
                          color: stage.color ?? "#0f766e",
                          position: stage.position ?? 1
                        })
                      }
                      type="button"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      className="grid h-9 w-9 place-items-center rounded border border-rose-200 text-rose-600"
                      onClick={() => {
                        if (window.confirm("Remover esta etapa do funil?")) {
                          void onDeleteStage(stage.id);
                        }
                      }}
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      </div>
    </div>
  );
}

function AiPanel({
  compact = false,
  analysis,
  companyMode = "COPILOT",
  conversation,
  loading = false,
  disabled = false,
  onAnalyze,
  onModeChange,
  onPauseChange,
  onCollapse
}: {
  compact?: boolean;
  analysis?: AiAnalysis | null;
  companyMode?: AiMode;
  conversation?: ConversationRow | null;
  loading?: boolean;
  disabled?: boolean;
  onAnalyze?: () => void;
  onModeChange?: (mode: AiMode | null) => void;
  onPauseChange?: (paused: boolean) => void;
  onCollapse?: () => void;
}) {
  const effectiveMode = conversation?.aiMode ?? companyMode;

  return (
    <aside className="rounded border border-line bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-saffron" />
          <h3 className="font-bold">Copiloto IA</h3>
        </div>
        {onCollapse && (
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-full border border-line text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
            title="Recolher Copiloto IA"
            onClick={onCollapse}
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {compact
          ? "Sugestao para a conversa atual."
          : "Analise do funil e proximas acoes recomendadas."}
      </p>
      {conversation && (
        <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand">
                Modo atual
              </p>
              <p className="text-sm font-semibold text-slate-800">
                {aiModeLabel(effectiveMode)}
                {conversation.aiMode ? "" : " (empresa)"}
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              Pausar
              <input
                checked={Boolean(conversation.aiPaused)}
                type="checkbox"
                onChange={(event) => onPauseChange?.(event.target.checked)}
              />
            </label>
          </div>
          <select
            className="mt-3 h-9 w-full rounded-xl border border-blue-100 bg-white px-3 text-xs font-semibold text-slate-700 outline-none"
            value={conversation.aiMode ?? ""}
            onChange={(event) =>
              onModeChange?.(event.target.value ? (event.target.value as AiMode) : null)
            }
          >
            <option value="">Usar padrao da empresa</option>
            <option value="OFF">Desligada nesta conversa</option>
            <option value="COPILOT">Copiloto nesta conversa</option>
            <option value="AUTO">Automatica nesta conversa</option>
            <option value="HYBRID">Hibrida nesta conversa</option>
          </select>
        </div>
      )}
      {onAnalyze && (
        <button
          className="mt-4 h-10 w-full rounded bg-saffron px-3 text-sm font-semibold text-white disabled:opacity-50"
          disabled={disabled || loading}
          onClick={onAnalyze}
        >
          {loading ? "Gerando..." : "Gerar resposta IA"}
        </button>
      )}
      {analysis && (
        <div className="mt-4 space-y-3 rounded border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-amber-950">
              Lead {temperatureLabels[analysis.temperature]}
            </p>
            <span className="rounded bg-white px-2 py-1 text-xs text-amber-900">
              {analysis.confidence}% confianca
            </span>
          </div>
          {analysis.source === "fallback" && (
            <p className="rounded bg-white/70 p-2 text-xs font-semibold text-amber-900">
              Conecte OPENAI_API_KEY para sugestoes inteligentes. Esta resposta usa o
              modo seguro local.
            </p>
          )}
          <p className="text-sm text-amber-950">{analysis.summary}</p>
          <p className="text-sm font-semibold text-amber-950">
            {analysis.nextAction}
          </p>
          <p className="rounded bg-white p-2 text-sm text-slate-700">
            {analysis.suggestedReply}
          </p>
          {analysis.shouldTransferToHuman && (
            <p className="rounded bg-rose-50 p-2 text-xs font-semibold text-rose-700">
              A IA recomenda transferencia humana antes de responder.
            </p>
          )}
        </div>
      )}
      <div className="mt-4 space-y-3">
        {aiActions.slice(0, compact ? 2 : 4).map((action) => (
          <div key={action} className="flex gap-3 rounded border border-line p-3">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <p className="text-sm text-slate-700">{action}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
        <Metric icon={<MessageSquareText className="h-4 w-4" />} label="Resumo" />
        <Metric icon={<Tags className="h-4 w-4" />} label="Tags" />
        <Metric icon={<ShieldCheck className="h-4 w-4" />} label="Risco" />
      </div>
    </aside>
  );
}

function Metric({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="grid place-items-center gap-1 rounded border border-line p-2 text-slate-600">
      {icon}
      {label}
    </div>
  );
}

function CollapsedAiSidebar({
  hasAnalysis,
  disabled,
  loading,
  onExpand,
  onAnalyze
}: {
  hasAnalysis: boolean;
  disabled: boolean;
  loading: boolean;
  onExpand: () => void;
  onAnalyze: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-between gap-3">
      <div className="flex w-full flex-col items-center gap-2">
        <button
          type="button"
          className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-50 text-saffron ring-1 ring-amber-100 transition hover:bg-amber-100"
          title="Expandir Copiloto IA"
          onClick={onExpand}
        >
          <Sparkles className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-2xl border border-line text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
          title="Gerar resposta IA"
          disabled={disabled}
          onClick={onAnalyze}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageSquareText className="h-4 w-4" />
          )}
        </button>
        <CollapsedAiIcon active={hasAnalysis} title="Resumo">
          <FileText className="h-4 w-4" />
        </CollapsedAiIcon>
        <CollapsedAiIcon title="Tags">
          <Tags className="h-4 w-4" />
        </CollapsedAiIcon>
        <CollapsedAiIcon title="Risco">
          <ShieldCheck className="h-4 w-4" />
        </CollapsedAiIcon>
      </div>
      <button
        type="button"
        className="grid h-10 w-10 place-items-center rounded-2xl border border-line text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
        title="Expandir painel"
        onClick={onExpand}
      >
        <PanelRightOpen className="h-4 w-4" />
      </button>
    </div>
  );
}

function CollapsedAiIcon({
  active,
  title,
  children
}: {
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "grid h-10 w-10 place-items-center rounded-2xl border transition",
        active
          ? "border-blue-100 bg-blue-50 text-brand"
          : "border-line text-slate-500 hover:bg-slate-50 hover:text-slate-800"
      )}
      title={title}
    >
      {children}
    </button>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
