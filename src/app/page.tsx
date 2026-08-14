"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
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
import { ConversationList } from "@/app/components/conversations/ConversationList";
import { TemplateVariableDialog } from "@/app/components/conversations/TemplateVariableDialog";
import { MotorCommercialPage } from "@/app/components/opportunities/MotorCommercialPage";
import { NextBestActionPage } from "@/app/components/opportunities/NextBestActionPage";
import { TemplateLibraryPage } from "@/app/components/templates/TemplateLibraryPage";
import { useNewMessageSound } from "@/app/hooks/use-new-message-sound";
import { resolveConversationChannelId } from "@/lib/conversation-channel.service";
import type { OpportunitySummary } from "@/lib/opportunity-summary-types";
import type {
  SpreadsheetImportColumn,
  SpreadsheetImportRawValues
} from "@/lib/spreadsheet-import-columns";
import {
  resolveTemplateColumnParameters,
  serializeResolvedTemplateVariablesV1,
  serializeTemplateVariableMappingV1,
  TemplateParameterError
} from "@/lib/template-parameters";
import type {
  ResolvedTemplateVariablesV1,
  TemplateVariableMapping,
  TemplateVariableMappingV1
} from "@/lib/template-parameters";
import {
  ArrowRight,
  Archive,
  Activity,
  AlertTriangle,
  Banknote,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Clipboard,
  Download,
  Edit3,
  File as FileIcon,
  FileText,
  Filter,
  IdCard,
  Image as ImageIcon,
  Loader2,
  Menu,
  MessageCircle,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Phone,
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

type NavigationGroup = {
  id: string;
  label: string;
  itemIds: Section[];
};

const navigationGroups: NavigationGroup[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    itemIds: ["dashboard"]
  },
  {
    id: "operacao-comercial",
    label: "Operação Comercial",
    itemIds: ["motor-comercial", "next-best-action"]
  },
  {
    id: "relacionamento",
    label: "Relacionamento",
    itemIds: ["atendimento", "kanban", "contatos", "tags"]
  },
  {
    id: "comunicacao",
    label: "Comunicação",
    itemIds: ["canais", "templates", "disparos"]
  },
  {
    id: "produtos-financeiros",
    label: "Produtos Financeiros",
    itemIds: ["simulacao-clt", "multicred", "recem-aposentados"]
  },
  {
    id: "administracao-apoio",
    label: "Administração",
    itemIds: ["chatbot", "empresas", "config"]
  }
];

const INBOUND_MESSAGE_NOTIFICATION_TYPE = "NEW_INBOUND_MESSAGE";

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
  internalNote?: string | null;
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
    channelId?: string | null;
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
type ConversationFilters = {
  search: string;
  status: string;
  tagIds: string[];
  assignedTo: string;
};

const emptyConversationStatusCounts: ConversationStatusCounts = {
  OPEN: 0,
  PENDING: 0,
  BOT: 0,
  SOLD: 0,
  RESOLVED: 0
};

const quickReplyTemplates = [
  {
    id: "cpf",
    title: "Pedir CPF",
    body: "Pode me informar seu CPF para eu consultar sua margem com seguranca?"
  },
  {
    id: "authorization",
    title: "Pedir autorizacao",
    body: "Para seguir com a consulta, preciso da sua autorizacao para verificar as opcoes disponiveis para voce."
  },
  {
    id: "document",
    title: "Pedir comprovante",
    body: "Pode me enviar um comprovante ou documento atualizado para eu conferir os dados da proposta?"
  },
  {
    id: "simulation",
    title: "Explicar simulacao CLT/INSS",
    body: "Vou fazer uma simulacao sem compromisso para verificar valor liberado, prazo e parcela. Assim que tiver o resultado, te envio as melhores opcoes."
  },
  {
    id: "no-margin",
    title: "Retorno sem margem",
    body: "No momento nao apareceu margem disponivel para essa consulta. Vou deixar seu atendimento salvo e te aviso se surgir uma nova possibilidade."
  },
  {
    id: "approved",
    title: "Proposta aprovada",
    body: "Sua proposta foi aprovada. Vou te orientar nos proximos passos para concluir com seguranca."
  }
];

const followUpReasons = [
  "Juros alto",
  "Valor baixo",
  "Vai pensar",
  "Sem tempo",
  "Comparando",
  "Sem documentos",
  "Aguardando pagamento",
  "Sem margem",
  "Outro"
];

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

type AvailableChannelRow = Pick<
  ChannelRow,
  "id" | "name" | "type" | "provider" | "displayPhone" | "status"
>;

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

type ProposalStatus =
  | "NEW"
  | "TYPED"
  | "ANALYSIS"
  | "PENDING"
  | "APPROVED"
  | "PAID"
  | "CANCELED"
  | "REJECTED"
  | "DRAFT"
  | "FORMALIZING"
  | "REWORK";

type ProposalRow = {
  id: string;
  contactId: string;
  multicredClientId?: string | null;
  assignedUserId?: string | null;
  bank: string;
  agreement: string;
  product: string;
  operation?: string | null;
  proposalNumber?: string | null;
  contractNumber?: string | null;
  amount: string;
  financedAmount?: string | null;
  releasedAmount?: string | null;
  installmentAmount?: string | null;
  term?: number | null;
  commission: string;
  commissionReceived?: string | null;
  notes?: string | null;
  status: ProposalStatus;
  createdAt: string;
  updatedAt?: string;
  assignedUser?: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  } | null;
  history?: Array<{
    id: string;
    action: string;
    title: string;
    detail?: string | null;
    createdAt: string;
    user?: { id: string; name: string; email: string } | null;
  }>;
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
  multicredClient?: {
    id: string;
    name: string;
    cpf: string;
    phone?: string | null;
    whatsapp?: string | null;
    bank?: string | null;
    agency?: string | null;
    account?: string | null;
    pixKey?: string | null;
  } | null;
};

type ProposalMetrics = {
  count: number;
  totalAmount: number;
  paidAmount: number;
  formalizingAmount: number;
  commissionForecast: number;
  commissionReceived: number;
  ticketAverage: number;
  totalProposals: number;
  analysisCount: number;
  pendingCount: number;
  approvedCount: number;
  paidCount: number;
  commissionAverage: number;
  conversionByProduct: Array<{ name: string; total: number; paid: number; rate: number }>;
  conversionByBank: Array<{ name: string; total: number; paid: number; rate: number }>;
  productionByOperator: Array<{ userId: string; total: number; paid: number }>;
};

type ProposalFilters = {
  search: string;
  status: string;
  product: string;
  bank: string;
  period: string;
  from: string;
  to: string;
  assignedUserId: string;
  sort: string;
  direction: string;
};

type MulticredClientRow = {
  id: string;
  companyId: string;
  contactId?: string | null;
  name: string;
  cpf: string;
  rg?: string | null;
  birthDate?: string | null;
  motherName?: string | null;
  maritalStatus?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  zipCode?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  bank?: string | null;
  agency?: string | null;
  account?: string | null;
  accountType?: string | null;
  pixKey?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; name: string; email: string } | null;
  contact?: {
    id: string;
    name: string;
    phone: string;
    cpf?: string | null;
    email?: string | null;
  } | null;
  proposals?: Array<{
    id: string;
    bank: string;
    agreement: string;
    product: string;
    amount: string;
    commission: string;
    status: ProposalStatus;
    createdAt: string;
  }>;
};

type MulticredClientForm = {
  contactId: string;
  name: string;
  cpf: string;
  rg: string;
  birthDate: string;
  motherName: string;
  maritalStatus: string;
  phone: string;
  whatsapp: string;
  email: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  bank: string;
  agency: string;
  account: string;
  accountType: string;
  pixKey: string;
  notes: string;
};

type MulticredProductShortcut = {
  id: string;
  companyId?: string;
  bankId: string;
  bankName: string;
  bankCode?: string | null;
  bankColor: string;
  bankCategory?: string | null;
  agreement: string;
  product: string;
  description?: string | null;
  isActive: boolean;
  position: number;
  createdAt?: string;
  updatedAt?: string;
};

type MulticredProductForm = {
  bankName: string;
  bankCode: string;
  bankColor: string;
  bankCategory: string;
  agreement: string;
  product: string;
  description: string;
};

type MulticredProposalPayload = {
  contactId?: string;
  multicredClientId?: string;
  assignedUserId?: string;
  bank: string;
  agreement: string;
  product: string;
  operation?: string;
  proposalNumber?: string;
  contractNumber?: string;
  amount: string;
  financedAmount?: string;
  releasedAmount?: string;
  installmentAmount?: string;
  term?: string;
  commission: string;
  commissionReceived?: string;
  notes?: string;
  status: ProposalStatus;
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
    todayContacts?: number;
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
  returns?: {
    totalPending: number;
    overdue: number;
    today: number;
    upcoming: number;
    items: TaskRow[];
  };
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

type OpportunitySummaryResponse = {
  summary?: OpportunitySummary;
  error?: string;
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
  rawValues?: SpreadsheetImportRawValues;
  status: "VALID" | "INVALID";
  errors: string[];
  duplicateCpf: boolean;
  duplicatePhone: boolean;
  existingContactId?: string | null;
};

type SpreadsheetImportPreview = {
  headers: string[];
  columns: SpreadsheetImportColumn[];
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
  rows: Array<{
    rowNumber: number;
    contactId: string;
    phone: string;
  }>;
  errors: Array<{ rowNumber: number; reason: string }>;
};

type TemplateImportRowValidation = {
  row: SpreadsheetImportRow;
  status: "VALID" | "INVALID";
  reasons: string[];
  resolved?: ResolvedTemplateVariablesV1;
  renderedBody?: string;
};

type TemplateImportValidationSummary = {
  totalRows: number;
  readyRows: number;
  invalidRows: number;
  reasons: Array<{ reason: string; count: number }>;
  rows: TemplateImportRowValidation[];
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

const opportunityPriorityStyles: Record<
  OpportunitySummary["priority"]["type"],
  string
> = {
  URGENT: "border-orange-200 bg-orange-50 text-orange-800",
  HIGH: "border-amber-200 bg-amber-50 text-amber-800",
  NORMAL: "border-blue-200 bg-blue-50 text-blue-800",
  LOW: "border-slate-200 bg-slate-50 text-slate-700",
  NONE: "border-slate-200 bg-slate-50 text-slate-500"
};

const conversationStatusLabels: Record<ConversationRow["status"], string> = {
  OPEN: "Aberto",
  PENDING: "Pendente",
  BOT: "Robo",
  SOLD: "Venda",
  RESOLVED: "Resolvido"
};

const conversationStatusIndicatorClasses: Record<ConversationRow["status"], string> = {
  OPEN: "bg-emerald-500",
  PENDING: "bg-amber-500",
  BOT: "bg-blue-500",
  SOLD: "bg-violet-500",
  RESOLVED: "bg-slate-400"
};

const proposalStatusLabels: Record<ProposalStatus, string> = {
  NEW: "Novo",
  TYPED: "Digitado",
  ANALYSIS: "Em analise",
  PENDING: "Pendente",
  APPROVED: "Aprovado",
  DRAFT: "Rascunho",
  FORMALIZING: "Formalizacao",
  PAID: "Pago",
  CANCELED: "Cancelado",
  REJECTED: "Reprovado",
  REWORK: "Pendencia"
};

const fallbackMulticredProducts: MulticredProductShortcut[] = [
  {
    id: "fallback-mercantil-inss",
    bankId: "fallback-mercantil",
    bankName: "Mercantil",
    agreement: "INSS",
    product: "Consignado INSS",
    bankColor: "blue",
    bankCategory: "INSS",
    description: "Aposentados e pensionistas.",
    isActive: true,
    position: 0
  },
  {
    id: "fallback-mercantil-fgts",
    bankId: "fallback-mercantil",
    bankName: "Mercantil",
    agreement: "FGTS",
    product: "Antecipacao FGTS",
    bankColor: "emerald",
    bankCategory: "FGTS",
    description: "Saque-aniversario e antecipacao.",
    isActive: true,
    position: 1
  },
  {
    id: "fallback-c6-clt",
    bankId: "fallback-c6",
    bankName: "C6 Ficsa",
    agreement: "CLT",
    product: "Credito do Trabalhador",
    bankColor: "violet",
    bankCategory: "CLT",
    description: "Operacao CLT.",
    isActive: true,
    position: 2
  },
  {
    id: "fallback-bmg-inss",
    bankId: "fallback-bmg",
    bankName: "BMG",
    agreement: "INSS",
    product: "Cartao Beneficio",
    bankColor: "amber",
    bankCategory: "INSS",
    description: "Beneficio e cartao.",
    isActive: true,
    position: 3
  },
  {
    id: "fallback-3rn-clt",
    bankId: "fallback-3rn",
    bankName: "3RN",
    agreement: "CLT",
    product: "Credito do Trabalhador",
    bankColor: "slate",
    bankCategory: "CLT",
    description: "Atalho CLT.",
    isActive: true,
    position: 4
  }
];

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));

  if (minutes < 60) return `ha ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `ha ${hours}h`;

  return `ha ${Math.floor(hours / 24)}d`;
}

function formatMessagePreview(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || "Sem mensagens.";
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

function conversationMatchesActiveFilters({
  conversation,
  filters,
  currentUserId,
  canManageOperation
}: {
  conversation: ConversationRow;
  filters: ConversationFilters;
  currentUserId: string;
  canManageOperation: boolean;
}) {
  if (filters.status !== "ALL" && conversation.status !== filters.status) {
    return false;
  }

  if (filters.assignedTo === "me") {
    if (conversation.agent?.id !== currentUserId) return false;
  } else if (filters.assignedTo === "unassigned") {
    if (conversation.agent !== null && conversation.assignmentStatus !== "UNASSIGNED") {
      return false;
    }
  } else if (filters.assignedTo && filters.assignedTo !== "default") {
    if (conversation.agent?.id !== filters.assignedTo) return false;
  } else if (filters.assignedTo === "default" && !canManageOperation) {
    // A composicao exata da fila default de atendentes comuns fica a cargo da API.
  }

  if (
    filters.tagIds.length > 0 &&
    !filters.tagIds.some((tagId) =>
      conversation.tags.some((tag) => tag.id === tagId)
    )
  ) {
    return false;
  }

  const search = filters.search.trim().toLocaleLowerCase("pt-BR");
  if (!search) return true;

  return [
    conversation.contact.name,
    conversation.contact.phone,
    conversation.contact.cpf ?? ""
  ].some((value) => value.toLocaleLowerCase("pt-BR").includes(search));
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

function formatPhoneForHeader(value?: string | null) {
  const raw = value?.trim() ?? "";
  if (!raw) return "";

  const digits = raw.replace(/\D/g, "");
  const nationalDigits =
    digits.length === 13 && digits.startsWith("55") ? digits.slice(2) : digits;

  if (nationalDigits.length === 11) {
    return nationalDigits.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  }

  if (nationalDigits.length === 10) {
    return nationalDigits.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  }

  return raw;
}

function buildShortChannelLabel(name?: string | null) {
  const compactName = name?.trim().replace(/\s+/g, " ") ?? "";
  if (!compactName) return "WhatsApp";

  const whatsappMatch = compactName.match(/\bWhatsApp\s+\d{2,}\b/i);
  if (whatsappMatch?.[0]) return whatsappMatch[0].replace(/^whatsapp/i, "WhatsApp");

  const whatsappSegment = compactName
    .split(/\s*[-–—•·]\s*/)
    .map((part) => part.trim())
    .find((part) => /^WhatsApp\b/i.test(part));

  if (whatsappSegment) return whatsappSegment.replace(/^whatsapp/i, "WhatsApp");

  return compactName;
}

function formatContactNameForUi(name?: string | null) {
  const trimmed = name?.trim().replace(/\s+/g, " ") ?? "";
  const meaningfulName = trimmed.replace(/[,\s.;:|/\\_-]+/g, "");

  if (!meaningfulName) {
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
  if (process.env.NODE_ENV === "production") {
    return;
  }

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

function preserveConversationTimeline(
  previous: ConversationRow | null,
  next: ConversationRow
) {
  if (!previous || previous.id !== next.id) return next;
  if (next.messages.length > 0 || previous.messages.length === 0) return next;

  return {
    ...next,
    lastMessage: next.lastMessage ?? previous.lastMessage,
    messages: previous.messages
  };
}

function emptyDashboardData(): DashboardData {
  return {
    metrics: {
      activeContacts: 0,
      newContacts: 0,
      todayContacts: 0,
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
    returns: {
      totalPending: 0,
      overdue: 0,
      today: 0,
      upcoming: 0,
      items: []
    },
    priorities: []
  };
}

export default function Home() {
  const { playNewMessageSound } = useNewMessageSound();
  const [active, setActive] = useState<Section>("dashboard");
  const [collapsedNavigationGroups, setCollapsedNavigationGroups] = useState<Record<string, boolean>>({});
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
  const [availableChannels, setAvailableChannels] = useState<AvailableChannelRow[]>([]);
  const [channelStatus, setChannelStatus] = useState<ChannelStatusData | null>(null);
  const [messageLogs, setMessageLogs] = useState<MessageLogRow[]>([]);
  const [messageLogFilters, setMessageLogFilters] = useState({
    channelId: "",
    status: "ALL",
    type: "ALL"
  });
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [multicredClients, setMulticredClients] = useState<MulticredClientRow[]>([]);
  const [multicredProducts, setMulticredProducts] = useState<MulticredProductShortcut[]>([]);
  const [multicredClientSearch, setMulticredClientSearch] = useState("");
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboardData);
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationRow | null>(null);
  const [highlightedConversationId, setHighlightedConversationId] =
    useState<string | null>(null);
  const [cltDraft, setCltDraft] = useState<CltSimulationDraft | null>(null);
  const selectedConversationRef = useRef<string | null>(null);
  const conversationListRef = useRef<ConversationRow[]>([]);
  const conversationRequestIdRef = useRef(0);
  const conversationHighlightTimeoutRef = useRef<number | null>(null);
  const conversationSearchSettlingRef = useRef(false);
  const knownNotificationIdsRef = useRef<Set<string>>(new Set());
  const notificationsLoadedRef = useRef(false);
  const loadedViewKeysRef = useRef<Record<string, string>>({});
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
    cpf: "",
    channelId: ""
  });
  const [desktopPermission, setDesktopPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [conversationFilters, setConversationFilters] = useState<ConversationFilters>({
    search: "",
    status: "OPEN",
    tagIds: [] as string[],
    assignedTo: "default"
  });
  const conversationFiltersRef = useRef<ConversationFilters>(conversationFilters);
  const conversationAccessRef = useRef({
    currentUserId: session?.user.id ?? "",
    canManageOperation: userCanManageOperation(session)
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
    status: "",
    product: "",
    bank: "",
    period: "30d",
    from: "",
    to: "",
    assignedUserId: "",
    sort: "date",
    direction: "desc"
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
    commissionReceived: 0,
    ticketAverage: 0,
    totalProposals: 0,
    analysisCount: 0,
    pendingCount: 0,
    approvedCount: 0,
    paidCount: 0,
    commissionAverage: 0,
    conversionByProduct: [],
    conversionByBank: [],
    productionByOperator: []
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
  const [multicredClientsLoading, setMulticredClientsLoading] = useState(false);
  const [multicredProductsLoading, setMulticredProductsLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [retirementLoading, setRetirementLoading] = useState(false);
  const [appError, setAppError] = useState("");
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    selectedConversationRef.current = selectedConversation?.id ?? null;
  }, [selectedConversation?.id]);

  useEffect(() => {
    conversationListRef.current = conversationList;
  }, [conversationList]);

  useEffect(() => {
    conversationFiltersRef.current = conversationFilters;
  }, [conversationFilters]);

  useEffect(() => {
    conversationAccessRef.current = {
      currentUserId: session?.user.id ?? "",
      canManageOperation: userCanManageOperation(session)
    };
  }, [session]);

  useEffect(() => {
    return () => {
      if (conversationHighlightTimeoutRef.current !== null) {
        window.clearTimeout(conversationHighlightTimeoutRef.current);
      }
    };
  }, []);

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

  useEffect(() => {
    if (!mobileSidebarOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileSidebarOpen]);

  const pageTitle = useMemo(() => {
    return navItems.find((item) => item.id === active)?.label ?? "Dashboard";
  }, [active]);

  const eligibleNewConversationChannels = useMemo(
    () =>
      availableChannels.filter(
        (channel) =>
          channel.type === "whatsapp" &&
          channel.provider === "meta" &&
          (channel.status === "ACTIVE" || channel.status === "CONNECTED")
      ),
    [availableChannels]
  );

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
          "motor-comercial",
          "next-best-action",
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
      ["motor-comercial", "next-best-action", "atendimento", "contatos", "kanban", "simulacao-clt"].includes(item.id)
    );
  }, [session]);

  const visibleNavigationGroups = useMemo(() => {
    const visibleItemIds = new Set<Section>(visibleNavItems.map((item) => item.id));

    return navigationGroups
      .map((group) => ({
        ...group,
        items: group.itemIds
          .filter((itemId) => visibleItemIds.has(itemId))
          .map((itemId) => visibleNavItems.find((item) => item.id === itemId))
          .filter((item): item is (typeof visibleNavItems)[number] => Boolean(item))
      }))
      .filter((group) => group.items.length > 0);
  }, [visibleNavItems]);

  const activeNavigationGroupId = useMemo(() => {
    return visibleNavigationGroups.find((group) =>
      group.items.some((item) => item.id === active)
    )?.id;
  }, [active, visibleNavigationGroups]);

  const toggleNavigationGroup = useCallback((groupId: string) => {
    setCollapsedNavigationGroups((current) => ({
      ...current,
      [groupId]: !current[groupId]
    }));
  }, []);

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
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch("/api/auth/session", {
        signal: controller.signal
      });

      if (response.ok) {
        setSession((await response.json()) as Session);
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
    } finally {
      window.clearTimeout(timeout);
      setSessionLoading(false);
    }
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
      filters: typeof conversationFilters,
      options: { silent?: boolean } = {}
    ) => {
      const requestId = options.silent
        ? conversationRequestIdRef.current
        : (conversationRequestIdRef.current += 1);

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

      try {
        const response = await fetch(`/api/conversations?${params.toString()}`);
        if (requestId !== conversationRequestIdRef.current) {
          return;
        }

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
            const stableNext = preserveConversationTimeline(current, next);
            logConversationRenderDebug({
              origin: "selected-conversation-load-sync",
              previous: current,
              next: stableNext
            });
            return stableNext;
          });
        } else if (!options.silent) {
          setAppError("Nao foi possivel carregar conversas.");
        }
      } catch {
        if (requestId === conversationRequestIdRef.current && !options.silent) {
          setAppError("Nao foi possivel carregar conversas.");
        }
      } finally {
        if (requestId === conversationRequestIdRef.current && !options.silent) {
          setConversationLoading(false);
        }
      }
    },
    []
  );

  const handleConversationSearchSettlingChange = useCallback((settling: boolean) => {
    conversationSearchSettlingRef.current = settling;
  }, []);

  const shouldLoadView = useCallback((view: string, key: string) => {
    if (loadedViewKeysRef.current[view] === key) return false;
    loadedViewKeysRef.current[view] = key;
    return true;
  }, []);

  const flashConversationHighlight = useCallback((conversationId: string) => {
    setHighlightedConversationId(conversationId);

    if (conversationHighlightTimeoutRef.current !== null) {
      window.clearTimeout(conversationHighlightTimeoutRef.current);
    }

    conversationHighlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedConversationId(null);
      conversationHighlightTimeoutRef.current = null;
    }, 700);
  }, []);

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
    setConversationList((current) => {
      const filters = conversationFiltersRef.current;
      const { currentUserId, canManageOperation } = conversationAccessRef.current;
      const alreadyInList = current.some((item) => item.id === conversation.id);
      const matchesActiveFilters = conversationMatchesActiveFilters({
        conversation,
        filters,
        currentUserId,
        canManageOperation
      });
      const canInsertFromMerge =
        alreadyInList ||
        filters.assignedTo !== "default" ||
        canManageOperation;
      const shouldHighlightConversation =
        !["refresh", "click-read"].includes(origin);

      if (!matchesActiveFilters) {
        return alreadyInList
          ? current.filter((item) => item.id !== conversation.id)
          : current;
      }

      if (!canInsertFromMerge) return current;

      if (shouldHighlightConversation) {
        flashConversationHighlight(conversation.id);
      }

      return mergeConversationListItem({ current, conversation, origin });
    });
  }, [flashConversationHighlight]);

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
        setSelectedConversation(data.conversation);
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

  const playInboundNotificationSound = useCallback(
    (notification: NotificationRow) => {
      if (!notificationsLoadedRef.current) return;
      if (notification.type !== INBOUND_MESSAGE_NOTIFICATION_TYPE) return;

      playNewMessageSound();
    },
    [playNewMessageSound]
  );

  const handleIncomingNotification = useCallback(
    (notification: NotificationRow) => {
      if (knownNotificationIdsRef.current.has(notification.id)) return;

      knownNotificationIdsRef.current.add(notification.id);
      playInboundNotificationSound(notification);

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
      playInboundNotificationSound,
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
        playInboundNotificationSound(notification);

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
    [
      markConversationRead,
      markNotificationsRead,
      playInboundNotificationSound,
      showDesktopNotification
    ]
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
    setSelectedConversation((current) =>
      preserveConversationTimeline(current, conversation)
    );
    void refreshConversation(conversation.id);
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
    const selectedEligibleChannel = eligibleNewConversationChannels.find(
      (channel) => channel.id === newConversationForm.channelId
    );
    const resolvedChannelId =
      selectedEligibleChannel?.id ||
      (eligibleNewConversationChannels.length === 1
        ? eligibleNewConversationChannels[0].id
        : "");

    if (eligibleNewConversationChannels.length === 0) {
      setNewConversationError("Nenhum canal Meta ativo disponivel para iniciar conversa.");
      return;
    }

    if (eligibleNewConversationChannels.length > 1 && !resolvedChannelId) {
      setNewConversationError("Selecione um canal WhatsApp para iniciar conversa.");
      return;
    }

    const payload: {
      contactId?: string;
      name?: string;
      phone?: string;
      cpf: string;
      channelId?: string;
      status: "OPEN";
    } = selectedContact
      ? {
          contactId: selectedContact.id,
          cpf: newConversationForm.cpf.trim(),
          ...(resolvedChannelId ? { channelId: resolvedChannelId } : {}),
          status: "OPEN"
        }
      : {
          name: newConversationForm.name.trim(),
          phone: newConversationForm.phone.trim(),
          cpf: newConversationForm.cpf.trim(),
          ...(resolvedChannelId ? { channelId: resolvedChannelId } : {}),
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
    setNewConversationForm({ search: "", contactId: "", name: "", phone: "", cpf: "", channelId: "" });
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

  async function loadAvailableChannels() {
    const response = await fetch("/api/channels/available");
    if (response.ok) {
      const data = (await response.json()) as { channels: AvailableChannelRow[] };
      setAvailableChannels(data.channels);
    } else {
      setAvailableChannels([]);
    }
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
    templateVariableMapping?: TemplateVariableMappingV1;
    recipientTemplateVariables?: Array<{
      contactId: string;
      rowNumber: number;
      resolved: ResolvedTemplateVariablesV1;
    }>;
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
    if (payload.templateVariableMapping) {
      formData.set(
        "templateVariableMapping",
        serializeTemplateVariableMappingV1(payload.templateVariableMapping)
      );
    }
    if (payload.recipientTemplateVariables) {
      formData.set(
        "recipientTemplateVariables",
        JSON.stringify(
          payload.recipientTemplateVariables.map((recipient) => ({
            contactId: recipient.contactId,
            rowNumber: recipient.rowNumber,
            resolved: JSON.parse(
              serializeResolvedTemplateVariablesV1(recipient.resolved)
            ) as ResolvedTemplateVariablesV1
          }))
        )
      );
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

  const loadMulticredClients = useCallback(async (search = multicredClientSearch) => {
    setMulticredClientsLoading(true);
    setAppError("");

    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());

    const response = await fetch(`/api/multicred/clients?${params.toString()}`);
    if (response.ok) {
      const data = (await response.json()) as { clients: MulticredClientRow[] };
      setMulticredClients(data.clients);
    } else {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel carregar clientes Multicred.");
    }

    setMulticredClientsLoading(false);
  }, [multicredClientSearch]);

  const loadMulticredProducts = useCallback(async () => {
    setMulticredProductsLoading(true);
    setAppError("");

    const response = await fetch("/api/multicred/products");
    if (response.ok) {
      const data = (await response.json()) as { products: MulticredProductShortcut[] };
      setMulticredProducts(data.products);
    } else {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setAppError(data?.error ?? "Nao foi possivel carregar produtos Multicred.");
    }

    setMulticredProductsLoading(false);
  }, []);

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
      internalNote: string | null;
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

  async function handleUpdateConversationContact(
    id: string,
    payload: Partial<{ name: string; cpf: string; internalNote: string | null }>
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
      throw new Error(data?.error ?? "Nao foi possivel atualizar contato.");
    }

    const data = (await response.json()) as { contact: ContactRow };
    const updated = data.contact;

    setContacts((current) =>
      current.map((contact) => (contact.id === id ? updated : contact))
    );

    const applyContactUpdate = (conversation: ConversationRow): ConversationRow =>
      conversation.contact.id === id
        ? {
            ...conversation,
            contact: {
              ...conversation.contact,
              name: updated.name,
              cpf: updated.cpf,
              internalNote: updated.internalNote
            }
          }
        : conversation;

    setSelectedConversation((current) =>
      current ? applyContactUpdate(current) : current
    );
    setConversationList((current) => current.map(applyContactUpdate));

    return updated;
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

    if (!conversation || !messageBody) return false;

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

    try {
      const channelId = conversation ? resolveConversationChannelId(conversation) : null;
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
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setAppError(data?.error ?? "Nao foi possivel enviar mensagem.");
        mergeConversation(conversation, "send-message-rollback");
        await refreshConversation(conversationId);
        return false;
      }

      const data = (await response.json()) as { conversation: ConversationRow };
      mergeConversation(data.conversation, "send-message-response");
      return true;
    } catch (error) {
      setAppError(
        error instanceof Error ? error.message : "Nao foi possivel enviar mensagem."
      );
      mergeConversation(conversation, "send-message-rollback");
      await refreshConversation(conversationId);
      return false;
    }
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

  async function handleCreateProposal(payload: MulticredProposalPayload) {
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
      multicredClientId?: string | null;
      assignedUserId?: string | null;
      agreement: string;
      product: string;
      operation: string;
      proposalNumber: string;
      contractNumber: string;
      amount: string;
      financedAmount: string;
      releasedAmount: string;
      installmentAmount: string;
      term: string;
      commission: string;
      commissionReceived: string;
      notes: string;
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

  async function handleCreateMulticredClient(payload: MulticredClientForm) {
    const response = await fetch("/api/multicred/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = (await response.json().catch(() => null)) as
      | { client?: MulticredClientRow; error?: string }
      | null;

    if (!response.ok || !data?.client) {
      setAppError(data?.error ?? "Nao foi possivel criar cliente Multicred.");
      return null;
    }

    setAppError("");
    setMulticredClients((current) => [data.client as MulticredClientRow, ...current]);
    return data.client;
  }

  async function handleUpdateMulticredClient(id: string, payload: MulticredClientForm) {
    const response = await fetch(`/api/multicred/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = (await response.json().catch(() => null)) as
      | { client?: MulticredClientRow; error?: string }
      | null;

    if (!response.ok || !data?.client) {
      setAppError(data?.error ?? "Nao foi possivel atualizar cliente Multicred.");
      return null;
    }

    setAppError("");
    setMulticredClients((current) =>
      current.map((client) => (client.id === id ? (data.client as MulticredClientRow) : client))
    );
    return data.client;
  }

  async function handleLoadMulticredClientDetail(id: string) {
    const response = await fetch(`/api/multicred/clients/${id}`);
    const data = (await response.json().catch(() => null)) as
      | { client?: MulticredClientRow; error?: string }
      | null;

    if (!response.ok || !data?.client) {
      setAppError(data?.error ?? "Nao foi possivel carregar cliente Multicred.");
      return null;
    }

    setAppError("");
    return data.client;
  }

  async function handleCreateMulticredProduct(payload: MulticredProductForm) {
    const response = await fetch("/api/multicred/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = (await response.json().catch(() => null)) as
      | { product?: MulticredProductShortcut; error?: string }
      | null;

    if (!response.ok || !data?.product) {
      setAppError(data?.error ?? "Nao foi possivel salvar produto Multicred.");
      return null;
    }

    setAppError("");
    setMulticredProducts((current) => {
      const withoutDuplicate = current.filter((product) => product.id !== data.product?.id);
      return [...withoutDuplicate, data.product as MulticredProductShortcut].sort((a, b) =>
        `${a.bankName}-${a.position}-${a.product}`.localeCompare(
          `${b.bankName}-${b.position}-${b.product}`
        )
      );
    });
    return data.product;
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

    void loadSettingsTags();
    void loadAiSettings();
    void loadReference();
    void loadAttendants();
    void loadAvailableChannels();
    if (userIsAdmin(session)) {
      void loadChannels();
      void loadCampaigns();
      void loadLeadAssignmentSettings();
      void loadProposals(proposalFilters);
      void loadMulticredClients(multicredClientSearch);
      void loadMulticredProducts();
    }
    if (userIsPlatformAdmin(session)) {
      void loadCompanies();
    }
    void loadNotifications({ silent: true });
  }, [
    loadAiSettings,
    loadSettingsTags,
    loadAttendants,
    loadLeadAssignmentSettings,
    loadMulticredClients,
    loadMulticredProducts,
    loadNotifications,
    loadProposals,
    loadCompanies,
    multicredClientSearch,
    proposalFilters,
    session
  ]);

  useEffect(() => {
    if (!session || active !== "contatos") return;

    const contactsKey = `${session.company.id}:${session.user.role}:${JSON.stringify(contactFilters)}`;
    if (!shouldLoadView("contatos", contactsKey)) return;
    void loadContacts(contactFilters);
  }, [active, contactFilters, loadContacts, session, shouldLoadView]);

  useEffect(() => {
    if (!session || !userCanManageOperation(session) || active !== "kanban") return;

    const kanbanKey = `${session.company.id}:${session.user.role}`;
    if (!shouldLoadView("kanban", kanbanKey)) return;
    void loadKanban();
  }, [active, session, shouldLoadView]);

  useEffect(() => {
    if (!session) return;

    void loadConversations(conversationFilters);
  }, [conversationFilters, loadConversations, session]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDesktopPermission(
      "Notification" in window ? window.Notification.permission : "unsupported"
    );
  }, []);

  useEffect(() => {
    if (!session || !userCanManageOperation(session) || active !== "dashboard") return;

    const dashboardKey = `${session.company.id}:${session.user.role}:${JSON.stringify(dashboardFilters)}`;
    if (!shouldLoadView("dashboard", dashboardKey)) return;
    void loadDashboard(dashboardFilters);
  }, [active, dashboardFilters, loadDashboard, session, shouldLoadView]);

  useEffect(() => {
    if (!session || !userIsAdmin(session) || active !== "canais") return;

    void loadChannelStatus();
  }, [active, session]);

  useEffect(() => {
    if (!session || !userIsAdmin(session) || active !== "canais") return;

    void loadMessageLogs(messageLogFilters);
  }, [active, loadMessageLogs, messageLogFilters, session]);

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

      if (document.hidden || conversationSearchSettlingRef.current) {
        return;
      }

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
          "fixed left-0 top-0 hidden h-screen flex-col border-r border-slate-200/80 bg-[#F3F6FB] shadow-[10px_0_28px_rgba(15,23,42,0.08)] backdrop-blur transition-[width] duration-300 ease-out xl:flex",
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

        {leftSidebarCollapsed && (
          <div className="shrink-0 px-3">
            <button
              type="button"
              className="grid h-10 w-full place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-blue-100 hover:bg-blue-50 hover:text-brand"
              title="Expandir menu lateral"
              onClick={() => setLeftSidebarCollapsed(false)}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        )}

        <nav
          className={clsx(
            "min-h-0 flex-1 space-y-1 overflow-y-scroll pb-4 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]",
            leftSidebarCollapsed ? "mt-4 px-3" : "mt-4 px-3 pr-2"
          )}
        >
          {!leftSidebarCollapsed && (
            <p className="px-3 pb-3 text-xs font-semibold tracking-wide text-slate-700">
              Navegacao
            </p>
          )}
          {leftSidebarCollapsed
            ? visibleNavItems.map((item) => {
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
                      "group relative flex h-10 w-full items-center rounded-xl text-left text-sm font-medium shadow-sm transition-colors",
                      "justify-center px-0",
                      active === item.id
                        ? "bg-white text-brand ring-1 ring-blue-100"
                        : "bg-white/60 text-slate-600 hover:bg-white hover:text-slate-950"
                    )}
                    onClick={() => setActive(item.id)}
                    title={item.label}
                  >
                    <span className="flex items-center justify-center">
                      <Icon
                        className={clsx(
                          "h-4 w-4",
                          active === item.id
                            ? "text-brand"
                            : "text-slate-400 group-hover:text-slate-600"
                        )}
                      />
                    </span>
                    {itemCount > 0 && (
                      <span className="absolute ml-7 mt-[-1.6rem] min-w-4 rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                        {itemCount > 99 ? "99+" : itemCount}
                      </span>
                    )}
                  </button>
                );
              })
            : visibleNavigationGroups.map((group, groupIndex) => {
                const isActiveGroup = group.id === activeNavigationGroupId;
                const isCollapsed = collapsedNavigationGroups[group.id] && !isActiveGroup;

                return (
                  <div
                    key={group.id}
                    className={clsx(
                      "space-y-2 rounded-2xl p-1 transition-colors",
                      !isCollapsed && "bg-white/45 shadow-sm ring-1 ring-white/70",
                      groupIndex > 0 && "mt-4 pt-1"
                    )}
                  >
                    <button
                      type="button"
                      className={clsx(
                        "flex w-full items-center justify-between rounded-xl border-l-[3px] px-3 py-2.5 text-left text-[14px] font-bold tracking-normal shadow-sm transition-colors duration-150",
                        isActiveGroup
                          ? "border-blue-500 bg-white text-slate-950 ring-1 ring-blue-100"
                          : "border-transparent bg-white/65 text-slate-700 hover:border-blue-400 hover:bg-blue-50 hover:text-slate-950 hover:ring-1 hover:ring-blue-100"
                      )}
                      onClick={() => toggleNavigationGroup(group.id)}
                    >
                      <span>{group.label}</span>
                      <ChevronRight
                        className={clsx(
                          "h-[18px] w-[18px] text-slate-600 transition-transform duration-150",
                          !isCollapsed && "rotate-90"
                        )}
                      />
                    </button>
                    {!isCollapsed &&
                      group.items.map((item) => {
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
                              "group relative flex h-10 w-full items-center justify-between rounded-xl px-3 pl-4 text-left text-sm font-medium transition-colors",
                              active === item.id
                                ? "bg-blue-50 text-brand shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)]"
                                : "text-slate-600 hover:bg-white/90 hover:text-slate-950"
                            )}
                            onClick={() => setActive(item.id)}
                          >
                            <span className="flex items-center gap-3">
                              <Icon
                                className={clsx(
                                  "h-4 w-4",
                                  active === item.id
                                    ? "text-brand"
                                    : "text-slate-400 group-hover:text-slate-600"
                                )}
                              />
                              {item.label}
                            </span>
                            {itemCount > 0 && (
                              <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white">
                                {itemCount > 99 ? "99+" : itemCount}
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                );
              })}
        </nav>

        <div
          className={clsx(
            "shrink-0 border-t border-slate-200/70",
            leftSidebarCollapsed ? "p-3" : "p-4"
          )}
        >
          <div
            className={clsx(
              "flex items-center rounded-2xl transition hover:bg-white/70",
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

      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <aside className="relative z-10 flex h-[100dvh] w-72 max-w-[85vw] flex-col border-r border-slate-200/80 bg-[#F3F6FB] shadow-[10px_0_28px_rgba(15,23,42,0.12)]">
            <div className="flex h-20 shrink-0 items-center gap-3 px-5">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand text-sm font-bold text-white shadow-soft">
                AI
              </div>
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
                aria-label="Fechar menu"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                onClick={() => setMobileSidebarOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pr-2 pb-4 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              <p className="px-3 pb-3 text-xs font-semibold tracking-wide text-slate-700">
                Navegacao
              </p>
              {visibleNavigationGroups.map((group, groupIndex) => {
                const isActiveGroup = group.id === activeNavigationGroupId;
                const isCollapsed = collapsedNavigationGroups[group.id] && !isActiveGroup;

                return (
                  <div
                    key={group.id}
                    className={clsx(
                      "space-y-2 rounded-2xl p-1 transition-colors",
                      !isCollapsed && "bg-white/45 shadow-sm ring-1 ring-white/70",
                      groupIndex > 0 && "mt-4 pt-1"
                    )}
                  >
                    <button
                      type="button"
                      className={clsx(
                        "flex w-full items-center justify-between rounded-xl border-l-[3px] px-3 py-2.5 text-left text-[14px] font-bold tracking-normal shadow-sm transition-colors duration-150",
                        isActiveGroup
                          ? "border-blue-500 bg-white text-slate-950 ring-1 ring-blue-100"
                          : "border-transparent bg-white/65 text-slate-700 hover:border-blue-400 hover:bg-blue-50 hover:text-slate-950 hover:ring-1 hover:ring-blue-100"
                      )}
                      onClick={() => toggleNavigationGroup(group.id)}
                    >
                      <span>{group.label}</span>
                      <ChevronRight
                        className={clsx(
                          "h-[18px] w-[18px] text-slate-600 transition-transform duration-150",
                          !isCollapsed && "rotate-90"
                        )}
                      />
                    </button>
                    {!isCollapsed &&
                      group.items.map((item) => {
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
                            type="button"
                            className={clsx(
                              "group relative flex h-10 w-full items-center justify-between rounded-xl px-3 pl-4 text-left text-sm font-medium transition-colors",
                              active === item.id
                                ? "bg-blue-50 text-brand shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)]"
                                : "text-slate-600 hover:bg-white/90 hover:text-slate-950"
                            )}
                            onClick={() => {
                              setActive(item.id);
                              setMobileSidebarOpen(false);
                            }}
                          >
                            <span className="flex items-center gap-3">
                              <Icon
                                className={clsx(
                                  "h-4 w-4",
                                  active === item.id
                                    ? "text-brand"
                                    : "text-slate-400 group-hover:text-slate-600"
                                )}
                              />
                              {item.label}
                            </span>
                            {itemCount > 0 && (
                              <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white">
                                {itemCount > 99 ? "99+" : itemCount}
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                );
              })}
            </nav>

            <div className="shrink-0 border-t border-slate-200/70 p-4">
              <div className="flex items-center gap-3 rounded-2xl p-2 transition hover:bg-white/70">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">
                  {session.user.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {session.user.name}
                  </p>
                  <p className="truncate text-xs text-slate-500">{session.user.role}</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      <section
        className={clsx(
          "transition-[padding-left] duration-300 ease-out",
          active === "atendimento" && "flex h-[100dvh] flex-col overflow-hidden",
          leftSidebarCollapsed ? "xl:pl-[72px]" : "xl:pl-[264px]"
        )}
      >
        <header className="sticky top-0 z-10 flex min-h-20 shrink-0 items-center justify-between border-b border-line/70 bg-white/90 px-4 backdrop-blur-xl md:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              aria-label="Abrir menu"
              className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-white text-slate-600 shadow-sm xl:hidden"
              onClick={() => setMobileSidebarOpen(true)}
            >
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
          {active === "motor-comercial" && (
            <MotorCommercialPage onOpenConversation={openConversationById} />
          )}
          {active === "next-best-action" && (
            <NextBestActionPage onOpenConversation={openConversationById} />
          )}
          {active === "atendimento" && (
            <div className="min-h-0 flex-1 overflow-hidden">
              <Atendimento
                leftSidebarCollapsed={leftSidebarCollapsed}
                conversations={conversationList}
                channels={channels}
                statusCounts={conversationStatusCounts}
                filters={conversationFilters}
                availableTags={reference.tags}
                attendants={attendants}
                currentUserId={session.user.id}
                isAdmin={userCanManageOperation(session)}
                loading={conversationLoading}
                selectedConversation={selectedConversation}
                highlightedConversationId={highlightedConversationId}
                onFiltersChange={setConversationFilters}
                onSearchSettlingChange={handleConversationSearchSettlingChange}
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
                onUpdateContact={handleUpdateConversationContact}
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
              attendants={attendants}
              contacts={contacts}
              clients={multicredClients}
              clientsLoading={multicredClientsLoading}
              clientSearch={multicredClientSearch}
              filters={proposalFilters}
              loading={proposalsLoading}
              metrics={proposalMetrics}
              products={multicredProducts}
              productsLoading={multicredProductsLoading}
              proposals={proposals}
              onClientSearchChange={(search) => {
                setMulticredClientSearch(search);
                void loadMulticredClients(search);
              }}
              onCreateClient={handleCreateMulticredClient}
              onCreateProduct={handleCreateMulticredProduct}
              onCreateProposal={handleCreateProposal}
              onDeleteProposal={handleDeleteProposal}
              onFiltersChange={setProposalFilters}
              onLoadClientDetail={handleLoadMulticredClientDetail}
              onRefreshClients={() => loadMulticredClients(multicredClientSearch)}
              onRefreshProducts={loadMulticredProducts}
              onUpdateClient={handleUpdateMulticredClient}
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
          {active === "templates" && userIsAdmin(session) && <TemplateLibraryPage />}
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
          channels={eligibleNewConversationChannels}
          channelSelectionKnown={Boolean(session)}
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
  channels,
  channelSelectionKnown,
  form,
  saving,
  error,
  onClose,
  onChange,
  onSubmit
}: {
  contacts: ContactRow[];
  channels: AvailableChannelRow[];
  channelSelectionKnown: boolean;
  form: { search: string; contactId: string; name: string; phone: string; cpf: string; channelId: string };
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (form: {
    search: string;
    contactId: string;
    name: string;
    phone: string;
    cpf: string;
    channelId: string;
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
  const singleChannel = channels.length === 1 ? channels[0] : null;
  const selectedChannelId = channels.some((channel) => channel.id === form.channelId)
    ? form.channelId
    : "";
  const submitDisabled =
    saving ||
    (channelSelectionKnown &&
      (channels.length === 0 || (channels.length > 1 && !selectedChannelId)));

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

          {channelSelectionKnown && (
            <div>
              <label className="text-sm font-semibold text-slate-800">
                Canal de envio *
              </label>
              {channels.length === 0 && (
                <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Nenhum canal Meta ativo disponivel para iniciar conversa.
                </div>
              )}
              {singleChannel && (
                <div className="mt-2 rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  {singleChannel.name}
                  {singleChannel.displayPhone ? ` - ${singleChannel.displayPhone}` : ""}
                </div>
              )}
              {channels.length > 1 && (
                <select
                  className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm outline-none focus:border-blue-200"
                  value={selectedChannelId}
                  onChange={(event) =>
                    onChange({ ...form, channelId: event.target.value })
                  }
                >
                  <option value="">Selecione um canal</option>
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                      {channel.displayPhone ? ` - ${channel.displayPhone}` : ""}
                    </option>
                  ))}
                </select>
              )}
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
            disabled={submitDisabled}
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

function OpportunitySummaryCard({
  summary,
  loading,
  error,
  onFocusComposer,
  onFollowUp,
  onOpenCltSimulation,
  onOpenTemplates
}: {
  summary: OpportunitySummary | null;
  loading: boolean;
  error: string;
  onFocusComposer: () => void;
  onFollowUp: () => void;
  onOpenCltSimulation: () => void;
  onOpenTemplates: () => void;
}) {
  const actionHandlers: Partial<
    Record<OpportunitySummary["recommendedAction"]["type"], () => void>
  > = {
    RESPOND_CUSTOMER: onFocusComposer,
    FOLLOW_UP: onFollowUp,
    SIMULATE_CLT: onOpenCltSimulation,
    SEND_TEMPLATE: onOpenTemplates
  };
  const actionHandler =
    summary?.primaryAction.actionable
      ? actionHandlers[summary.recommendedAction.type]
      : undefined;

  return (
    <div className="rounded border border-line bg-white p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand">
            Motor comercial
          </p>
          <h3 className="mt-1 font-bold text-slate-950">Oportunidade comercial</h3>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-brand" />}
      </div>

      {error && !loading && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          {error}
        </p>
      )}

      {!error && !loading && !summary && (
        <p className="mt-3 text-sm text-slate-500">
          Nao ha sinais comerciais suficientes neste momento.
        </p>
      )}

      {summary && (
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-bold ${opportunityPriorityStyles[summary.priority.type]}`}
            >
              {summary.priority.label}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
              {summary.commercialState.label}
            </span>
          </div>

          <div>
            <h4 className="text-base font-extrabold text-slate-950">
              {summary.situationTitle}
            </h4>
            <p className="mt-1 text-sm leading-5 text-slate-600">
              {summary.situationExplanation}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {summary.lastInteractionExplanation}
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
              Proxima acao
            </p>
            <p className="mt-1 font-bold text-slate-950">
              {summary.primaryAction.title}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              {summary.primaryAction.reason}
            </p>
            {actionHandler && (
              <button
                className="mt-3 inline-flex h-9 items-center justify-center rounded-full bg-brand px-3 text-xs font-bold text-white transition hover:bg-blue-700"
                type="button"
                onClick={actionHandler}
              >
                {summary.primaryAction.title}
              </button>
            )}
          </div>

          <div className="grid gap-2 rounded-2xl border border-slate-100 p-3">
            <Info label="Produto provavel" value={summary.productDisplayLabel} />
            <Info label="Contexto comercial" value={summary.contextExplanation} />
          </div>

          {summary.pendingReturn && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-bold">
                {summary.pendingReturn.overdue ? "Retorno vencido" : "Retorno programado"}
              </p>
              <p className="mt-1 break-words">
                {summary.pendingReturn.title} - {formatRelativeDate(String(summary.pendingReturn.dueAt))}
              </p>
            </div>
          )}

          {summary.activeProposal && (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
              <p className="font-bold">Proposta ativa</p>
              <p className="mt-1 break-words">
                {summary.activeProposal.product} - {summary.activeProposal.status}
                {summary.activeProposal.amount ? ` - R$ ${summary.activeProposal.amount}` : ""}
              </p>
            </div>
          )}

          {summary.displayEvidences.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                Evidencias
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {summary.displayEvidences.map((evidence) => (
                  <span
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"
                    key={`${evidence.type}-${evidence.sourceId ?? "source"}`}
                  >
                    {evidence.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditConversationContactModal({
  contactName,
  contactCpf,
  error,
  saving,
  onChange,
  onClose,
  onSubmit
}: {
  contactName: string;
  contactCpf: string;
  error: string;
  saving: boolean;
  onChange: (value: { name: string; cpf: string }) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 backdrop-blur-sm">
      <form
        className="w-full max-w-md overflow-hidden rounded-[1.5rem] border border-line bg-white shadow-soft"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line/70 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
              Atendimento
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-950">Editar contato</h3>
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
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
              {error}
            </div>
          )}

          <label className="block text-sm font-semibold text-slate-800">
            Nome
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm outline-none focus:border-blue-200"
              placeholder="Nome do cliente"
              value={contactName}
              onChange={(event) => onChange({ name: event.target.value, cpf: contactCpf })}
            />
          </label>

          <label className="block text-sm font-semibold text-slate-800">
            CPF
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm outline-none focus:border-blue-200"
              inputMode="numeric"
              placeholder="CPF do cliente"
              value={contactCpf}
              onChange={(event) => onChange({ name: contactName, cpf: event.target.value })}
            />
          </label>
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
            className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={saving}
            type="submit"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ScheduleFollowUpModal({
  attendants,
  currentUserId,
  conversation,
  error,
  form,
  saving,
  onChange,
  onClose,
  onSubmit
}: {
  attendants: AttendantRow[];
  currentUserId: string;
  conversation: ConversationRow;
  error: string;
  form: { reason: string; note: string; dueAt: string; assigneeId: string };
  saving: boolean;
  onChange: (value: { reason: string; note: string; dueAt: string; assigneeId: string }) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const assigneeOptions = [
    ...attendants.map((attendant) => ({
      id: attendant.id,
      label: attendant.name,
      detail: attendant.email
    })),
    ...(conversation.agent && !attendants.some((attendant) => attendant.id === conversation.agent?.id)
      ? [
          {
            id: conversation.agent.id,
            label: conversation.agent.name,
            detail: conversation.agent.email
          }
        ]
      : []),
    ...(conversation.contact.ownerId &&
    !attendants.some((attendant) => attendant.id === conversation.contact.ownerId) &&
    conversation.agent?.id !== conversation.contact.ownerId
      ? [
          {
            id: conversation.contact.ownerId,
            label: conversation.contact.owner,
            detail: "Responsavel do contato"
          }
        ]
      : []),
    ...(!attendants.some((attendant) => attendant.id === currentUserId) &&
    conversation.agent?.id !== currentUserId
    && conversation.contact.ownerId !== currentUserId
      ? [
          {
            id: currentUserId,
            label: "Usuario atual",
            detail: ""
          }
        ]
      : [])
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 backdrop-blur-sm">
      <form
        className="w-full max-w-lg overflow-hidden rounded-[1.5rem] border border-line bg-white shadow-soft"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line/70 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-600">
              Acompanhamento
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-950">Agendar retorno</h3>
            <p className="mt-1 text-sm text-slate-500">
              Registre o motivo e quando retornar para {conversation.contact.name}.
            </p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-full border border-line text-slate-500 hover:bg-slate-50"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
              {error}
            </div>
          )}

          <div className="rounded-2xl border border-line bg-slate-50 p-3 text-sm">
            <p className="font-bold text-slate-900">{conversation.contact.name}</p>
            <p className="text-slate-500">{conversation.contact.phone}</p>
          </div>

          <label className="block text-sm font-semibold text-slate-800">
            Motivo da nao venda
            <select
              className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm outline-none focus:border-blue-200"
              value={form.reason}
              onChange={(event) => onChange({ ...form, reason: event.target.value })}
            >
              {followUpReasons.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-semibold text-slate-800">
            Data/hora de retorno
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm outline-none focus:border-blue-200"
              type="datetime-local"
              value={form.dueAt}
              onChange={(event) => onChange({ ...form, dueAt: event.target.value })}
            />
          </label>

          <label className="block text-sm font-semibold text-slate-800">
            Responsavel
            <select
              className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm outline-none focus:border-blue-200"
              value={form.assigneeId}
              onChange={(event) => onChange({ ...form, assigneeId: event.target.value })}
            >
              {assigneeOptions.map((assignee) => (
                <option key={assignee.id} value={assignee.id}>
                  {assignee.detail ? `${assignee.label} - ${assignee.detail}` : assignee.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-semibold text-slate-800">
            Observacao
            <textarea
              className="mt-2 min-h-24 w-full rounded-2xl border border-line p-3 text-sm outline-none focus:border-blue-200"
              placeholder="Ex: Cliente achou juros alto. Retornar com nova simulacao."
              value={form.note}
              onChange={(event) => onChange({ ...form, note: event.target.value })}
            />
          </label>
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
            className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={saving || !form.reason.trim() || !form.dueAt}
            type="submit"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Agendando..." : "Agendar retorno"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ScheduledReturnsModal({
  tasks,
  loading,
  error,
  onClose,
  onRefresh,
  onTaskCompleted,
  onTaskUpdated
}: {
  tasks: TaskRow[];
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
  onTaskCompleted: (taskId: string) => void;
  onTaskUpdated: (task: TaskRow) => void;
}) {
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [reschedulingTask, setReschedulingTask] = useState<TaskRow | null>(null);
  const [rescheduleDueAt, setRescheduleDueAt] = useState("");
  const now = new Date();
  const tomorrowStart = new Date(now);
  tomorrowStart.setHours(24, 0, 0, 0);

  const overdueTasks = tasks.filter((task) => new Date(task.dueAt).getTime() < now.getTime());
  const todayTasks = tasks.filter((task) => {
    const dueAt = new Date(task.dueAt);
    return dueAt.getTime() >= now.getTime() && dueAt.getTime() < tomorrowStart.getTime();
  });
  const upcomingTasks = tasks.filter(
    (task) => new Date(task.dueAt).getTime() >= tomorrowStart.getTime()
  );
  const groups = [
    { key: "overdue", title: "Atrasados", tasks: overdueTasks, tone: "rose" },
    { key: "today", title: "Hoje", tasks: todayTasks, tone: "amber" },
    { key: "upcoming", title: "Proximos", tasks: upcomingTasks, tone: "blue" }
  ];
  const totalTasks = tasks.length;

  async function copyPhone(task: TaskRow) {
    try {
      await navigator.clipboard?.writeText(task.contact.phone);
      setCopiedTaskId(task.id);
      window.setTimeout(() => setCopiedTaskId(null), 1800);
    } catch {
      setCopiedTaskId(null);
    }
  }

  async function patchTask(taskId: string, payload: { status?: "DONE"; dueAt?: string }) {
    setSavingTaskId(taskId);
    setActionError("");

    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Nao foi possivel atualizar o retorno.");
      }

      const data = (await response.json()) as { task: TaskRow };
      return data.task;
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Nao foi possivel atualizar o retorno."
      );
      return null;
    } finally {
      setSavingTaskId(null);
    }
  }

  async function completeTask(task: TaskRow) {
    const updated = await patchTask(task.id, { status: "DONE" });
    if (updated) onTaskCompleted(task.id);
  }

  function openReschedule(task: TaskRow) {
    setActionError("");
    setReschedulingTask(task);
    setRescheduleDueAt(new Date(task.dueAt).toISOString().slice(0, 16));
  }

  async function submitReschedule() {
    if (!reschedulingTask) return;

    const dueAt = rescheduleDueAt ? new Date(rescheduleDueAt) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) {
      setActionError("Informe uma nova data/hora valida.");
      return;
    }

    const updated = await patchTask(reschedulingTask.id, { dueAt: dueAt.toISOString() });
    if (updated) {
      onTaskUpdated(updated);
      setReschedulingTask(null);
      setRescheduleDueAt("");
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-line bg-white shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-line/70 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
              Acompanhamento
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-950">Retornos</h3>
            <p className="mt-1 text-sm text-slate-500">
              {loading ? "Carregando retornos..." : `${totalTasks} retorno(s) pendente(s)`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="h-9 rounded-full border border-line bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
              disabled={loading}
              onClick={onRefresh}
              type="button"
            >
              Atualizar
            </button>
            <button
              className="grid h-9 w-9 place-items-center rounded-full border border-line text-slate-500 hover:bg-slate-50"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {error && (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
              {error}
            </div>
          )}
          {actionError && (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
              {actionError}
            </div>
          )}

          {reschedulingTask && (
            <form
              className="rounded-2xl border border-blue-100 bg-blue-50 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitReschedule();
              }}
            >
              <p className="text-sm font-bold text-slate-950">
                Reagendar {reschedulingTask.contact.name}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  className="h-10 min-w-[220px] flex-1 rounded-full border border-line bg-white px-3 text-sm outline-none focus:border-blue-200"
                  type="datetime-local"
                  value={rescheduleDueAt}
                  onChange={(event) => setRescheduleDueAt(event.target.value)}
                />
                <button
                  className="h-10 rounded-full border border-line bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  disabled={savingTaskId === reschedulingTask.id}
                  onClick={() => {
                    setReschedulingTask(null);
                    setRescheduleDueAt("");
                  }}
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={savingTaskId === reschedulingTask.id || !rescheduleDueAt}
                  type="submit"
                >
                  {savingTaskId === reschedulingTask.id && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  Salvar
                </button>
              </div>
            </form>
          )}

          {loading && (
            <div className="space-y-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          )}

          {!loading && !error && totalTasks === 0 && (
            <div className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-slate-500">
              Nenhum retorno pendente para voce.
            </div>
          )}

          {!loading &&
            !error &&
            groups.map((group) => (
              <section key={group.key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-950">{group.title}</h4>
                  <span
                    className={clsx(
                      "rounded-full px-2 py-0.5 text-xs font-bold",
                      group.tone === "rose" && "bg-rose-50 text-rose-700",
                      group.tone === "amber" && "bg-amber-50 text-amber-700",
                      group.tone === "blue" && "bg-blue-50 text-brand"
                    )}
                  >
                    {group.tasks.length}
                  </span>
                </div>

                {group.tasks.length === 0 ? (
                  <p className="rounded-2xl border border-line bg-slate-50 p-3 text-sm text-slate-500">
                    Nenhum retorno nesta faixa.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {group.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-2xl border border-line bg-white p-3 text-sm shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-bold text-slate-950">
                              {task.contact.name}
                            </p>
                            <p className="text-xs font-semibold text-slate-500">
                              {task.contact.phone}
                            </p>
                          </div>
                          <p
                            className={clsx(
                              "shrink-0 text-right text-xs font-bold tabular-nums",
                              group.tone === "rose" ? "text-rose-600" : "text-slate-500"
                            )}
                          >
                            {new Date(task.dueAt).toLocaleString("pt-BR")}
                          </p>
                        </div>
                        <p className="mt-2 font-semibold text-slate-800">{task.title}</p>
                        {task.note && (
                          <p className="mt-1 line-clamp-2 text-slate-600">{task.note}</p>
                        )}
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-slate-400">
                            {task.assignee ? `Responsavel: ${task.assignee.name}` : "Sem responsavel"}
                          </span>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                            <button
                              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-slate-50 px-3 text-xs font-bold text-slate-600 hover:bg-white"
                              onClick={() => void copyPhone(task)}
                              type="button"
                            >
                              <Clipboard className="h-3.5 w-3.5" />
                              {copiedTaskId === task.id ? "Copiado" : "Copiar telefone"}
                            </button>
                            <button
                              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-3 text-xs font-bold text-brand hover:bg-blue-100"
                              disabled={savingTaskId === task.id}
                              onClick={() => openReschedule(task)}
                              type="button"
                            >
                              <CalendarClock className="h-3.5 w-3.5" />
                              Reagendar
                            </button>
                            <button
                              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-70"
                              disabled={savingTaskId === task.id}
                              onClick={() => void completeTask(task)}
                              type="button"
                            >
                              {savingTaskId === task.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                              Concluir
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
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
    <main className="min-h-screen overflow-x-hidden bg-white font-sans text-ink">
      <div className="grid min-h-screen w-full grid-cols-1 overflow-hidden bg-white lg:grid-cols-[52.5%_47.5%]">
        <section className="relative hidden min-h-screen overflow-hidden bg-[#06152d] px-12 py-11 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_8%,rgba(45,122,255,0.18),transparent_28%),radial-gradient(circle_at_12%_82%,rgba(34,96,190,0.16),transparent_32%)]" />
          <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full border border-blue-400/10" />
          <div className="pointer-events-none absolute bottom-0 right-0 h-64 w-[34rem] bg-[radial-gradient(circle,rgba(61,138,255,0.24)_1px,transparent_1.5px)] bg-[length:16px_16px] opacity-20 [transform:perspective(520px)_rotateX(62deg)_rotateZ(-10deg)]" />

          <div className="relative max-w-2xl">
            <p className="text-[2.6rem] font-black uppercase leading-none tracking-[0.1em] text-white drop-shadow-sm xl:text-[2.9rem]">
              QE<span className="text-blue-300">V</span>ORA
            </p>
            <p className="mt-5 text-sm font-semibold uppercase tracking-[0.2em] text-blue-200/80">
              INTELIGÊNCIA PARA OPERAÇÕES COMERCIAIS
            </p>

            <div className="mt-[3.25rem] max-w-2xl xl:mt-14">
              <h1 className="text-[2.55rem] font-bold leading-[1.18] text-white xl:text-[3rem]">
                Operações comerciais, com{" "}
                <span className="text-blue-400">inteligência</span> e contexto.
              </h1>
              <p className="mt-5 max-w-md text-base leading-7 text-slate-200/90">
                Conecte conversas, oportunidades e decisões em uma única operação.
              </p>
            </div>
          </div>

          <div className="relative max-w-2xl">
            <div className="grid grid-cols-3 gap-0">
              {[
                {
                  description: "Conversas em um só lugar",
                  marker: "chat",
                  title: "Atendimento centralizado"
                },
                {
                  description: "Priorização comercial",
                  marker: "bars",
                  title: "Oportunidades inteligentes"
                },
                {
                  description: "Histórico da operação",
                  marker: "shield",
                  title: "Contexto preservado"
                }
              ].map((benefit, index) => (
                <div
                  className={clsx(
                    "min-w-0 px-7 first:pl-0 last:pr-0",
                    index > 0 && "border-l border-white/[0.08]"
                  )}
                  key={benefit.title}
                >
                  <div className="mb-4 flex h-8 items-end text-blue-300">
                    {benefit.marker === "chat" && (
                      <span className="relative block h-6 w-7 rounded-md border-2 border-current">
                        <span className="absolute -bottom-2 left-2 h-3 w-3 rounded-bl-md border-b-2 border-l-2 border-current bg-[#06152d]" />
                        <span className="absolute -bottom-2 -right-2 h-3.5 w-3.5 rounded-full border-2 border-[#06152d] bg-blue-400" />
                      </span>
                    )}
                    {benefit.marker === "bars" && (
                      <span className="flex h-7 items-end gap-1.5">
                        <span className="h-3 w-2 rounded-sm border-2 border-current" />
                        <span className="h-[1.125rem] w-2 rounded-sm border-2 border-current" />
                        <span className="h-7 w-2 rounded-sm border-2 border-current" />
                      </span>
                    )}
                    {benefit.marker === "shield" && (
                      <span className="relative block h-8 w-7 rounded-b-xl rounded-t-md border-2 border-current">
                        <span className="absolute left-2 top-3 h-2 w-2.5 rotate-[-45deg] border-b-2 border-l-2 border-current" />
                      </span>
                    )}
                  </div>
                  <h2 className="text-base font-semibold leading-snug text-white">
                    {benefit.title}
                  </h2>
                  <p className="mt-2.5 text-sm leading-6 text-slate-300">
                    {benefit.description}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-9 border-t border-white/[0.12] pt-6 text-sm font-medium text-slate-300">
              <span className="mr-3 inline-block h-1.5 w-1.5 rounded-full bg-blue-300 align-middle" />
              Tecnologia para uma operação mais organizada
            </div>
          </div>
        </section>

        <section className="flex min-h-screen items-center justify-start bg-white px-5 py-8 sm:justify-center sm:px-8 lg:px-12 xl:px-16">
          <form
            className="w-full max-w-[21rem] rounded-2xl bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.10)] ring-1 ring-slate-200/45 sm:max-w-[28rem] sm:p-9"
            onSubmit={handleSubmit}
          >
            <div>
              <p className="text-sm font-black uppercase tracking-[0.2em] text-slate-950">
                QE<span className="text-brand">V</span>ORA
              </p>
              <h1 className="mt-6 text-3xl font-bold tracking-normal text-slate-950 sm:text-[2.15rem]">
                Bem-vindo à QEVORA
              </h1>
              <p className="mt-3 text-base leading-7 text-slate-500">
                Acesse sua operação para continuar.
              </p>
            </div>

            <div className="mt-9 space-y-5">
              <label className="block text-sm font-semibold text-slate-900">
                E-mail
                <input
                  className="mt-3 h-14 w-full rounded border border-slate-200 bg-white px-4 font-normal text-slate-950 outline-none placeholder:text-slate-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="seu@email.com"
                  type="email"
                />
              </label>
              <label className="block text-sm font-semibold text-slate-900">
                Senha
                <input
                  className="mt-3 h-14 w-full rounded border border-slate-200 bg-white px-4 font-normal text-slate-950 outline-none placeholder:text-slate-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Digite sua senha"
                  type="password"
                />
              </label>
            </div>

            {error && (
              <div className="mt-5 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950">
                {error}
              </div>
            )}

            <button
              className="mt-7 h-14 w-full rounded bg-[#082f7a] font-bold text-white transition hover:bg-[#062864] focus:outline-none focus:ring-2 focus:ring-blue-200 focus:ring-offset-2 disabled:opacity-60"
              disabled={loading}
              type="submit"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>

            <div className="mt-6 text-center text-sm font-medium text-slate-500">
              Acesso seguro
            </div>
          </form>
        </section>
      </div>
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
  const scheduledReturns = data.returns ?? {
    totalPending: 0,
    overdue: 0,
    today: 0,
    upcoming: 0,
    items: []
  };
  const cards = [
    {
      label: "Receita paga",
      value: formatCurrency(data.metrics.paidAmount),
      hint: `${data.metrics.paidProposals} proposta(s) paga(s) no filtro atual`,
      icon: Banknote,
      tone: "emerald"
    },
    {
      label: "Propostas em aberto",
      value: formatCurrency(data.metrics.totalProposalAmount),
      hint: `${data.metrics.proposals} proposta(s) ativa(s) no periodo`,
      icon: CircleDollarSign,
      tone: "blue"
    },
    {
      label: "Conversao",
      value: `${data.metrics.conversionRate}%`,
      hint: "Propostas pagas sobre a base ativa",
      icon: Activity,
      tone: "violet"
    },
    {
      label: "Leads novos",
      value: data.metrics.newContacts.toString(),
      hint: `${data.metrics.todayContacts ?? 0} novo(s) hoje`,
      icon: UserRound,
      tone: "slate"
    },
    {
      label: "SLA critico",
      value: data.metrics.staleConversations.toString(),
      hint: "Conversas aguardando ha mais de 4h",
      icon: AlertTriangle,
      tone: "rose"
    },
    {
      label: "Comissao prevista",
      value: formatCurrency(data.metrics.commissionForecast),
      hint: "Comissao potencial nas propostas ativas",
      icon: BriefcaseBusiness,
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
            Dashboard executivo
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Saude comercial, receita, conversao e gargalos do periodo.
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <MetricCard key={card.label} {...card} showTrend={false} variant="executive" />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
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
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-950">Retornos agendados</h3>
                <p className="text-sm text-slate-500">
                  {scheduledReturns.totalPending} pendente(s)
                </p>
              </div>
              <CalendarClock className="h-5 w-5 text-brand" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-2xl bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-500">Pendentes</p>
                <strong className="mt-1 block text-lg text-slate-950">
                  {scheduledReturns.totalPending}
                </strong>
              </div>
              <div className="rounded-2xl bg-rose-50 p-3">
                <p className="text-xs font-semibold text-rose-600">Atrasados</p>
                <strong className="mt-1 block text-lg text-rose-700">
                  {scheduledReturns.overdue}
                </strong>
              </div>
              <div className="rounded-2xl bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-700">Hoje</p>
                <strong className="mt-1 block text-lg text-amber-800">
                  {scheduledReturns.today}
                </strong>
              </div>
              <div className="rounded-2xl bg-blue-50 p-3">
                <p className="text-xs font-semibold text-brand">Proximos</p>
                <strong className="mt-1 block text-lg text-blue-700">
                  {scheduledReturns.upcoming}
                </strong>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {scheduledReturns.items.map((task) => (
                <div
                  key={task.id}
                  className="rounded-2xl border border-line/80 bg-slate-50/60 p-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-950">{task.title}</p>
                      <p className="mt-1 truncate text-slate-600">
                        {task.contact.name} · {task.contact.phone}
                      </p>
                      {task.note ? (
                        <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                          {task.note}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-500 ring-1 ring-line">
                      {new Date(task.dueAt).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </span>
                  </div>
                </div>
              ))}
              {!loading && scheduledReturns.items.length === 0 && (
                <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-slate-500">
                  Nenhum retorno de hoje ou proximo retorno pendente.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-[1.35rem] border border-line/80 bg-white p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-950">Minhas tarefas</h3>
                <p className="text-sm text-slate-500">{data.tasks.length} pendente(s)</p>
              </div>
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
  tone,
  showTrend = true,
  variant = "default"
}: {
  label: string;
  value: string;
  hint: string;
  trend?: string;
  icon: typeof MessageCircle;
  tone: string;
  showTrend?: boolean;
  variant?: "default" | "executive";
}) {
  const toneClass =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-600 ring-emerald-100"
      : tone === "violet"
        ? "bg-violet-50 text-violet-600 ring-violet-100"
        : tone === "rose"
          ? "bg-rose-50 text-rose-600 ring-rose-100"
        : tone === "slate"
          ? "bg-slate-100 text-slate-600 ring-slate-200"
          : "bg-blue-50 text-brand ring-blue-100";
  const executive = variant === "executive";

  return (
    <div
      className={clsx(
        "group rounded-[1.35rem] border border-line/80 bg-white p-5 shadow-soft",
        !executive && "hover:-translate-y-0.5 hover:shadow-lift"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className={clsx(
              executive
                ? "text-sm font-semibold uppercase tracking-wide text-slate-500"
                : "text-sm font-medium text-slate-500"
            )}
          >
            {label}
          </p>
          <strong
            className={clsx(
              "mt-3 block truncate tracking-tight text-slate-950",
              executive ? "text-3xl font-black" : "text-3xl font-bold"
            )}
          >
            {value}
          </strong>
        </div>
        <div
          className={clsx(
            "grid shrink-0 place-items-center rounded-2xl ring-1",
            executive ? "h-11 w-11" : "h-10 w-10",
            toneClass
          )}
        >
          <Icon className={clsx(executive ? "h-5 w-5" : "h-4 w-4")} />
        </div>
      </div>
      {showTrend && trend ? (
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
            <TrendingUp className="h-3.5 w-3.5" />
            {trend}
          </span>
          <span className="truncate text-xs text-slate-500">{hint}</span>
        </div>
      ) : (
        <p className="mt-4 text-sm leading-5 text-slate-500">{hint}</p>
      )}
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
    <div className="grid w-full gap-3 py-4 text-left md:grid-cols-[auto_1fr]">
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
    </div>
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
  leftSidebarCollapsed,
  conversations,
  channels,
  statusCounts,
  filters,
  availableTags,
  attendants,
  currentUserId,
  isAdmin,
  loading,
  selectedConversation,
  highlightedConversationId,
  onFiltersChange,
  onSearchSettlingChange,
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
  onUpdateContact,
  onOpenCltSimulation
}: {
  leftSidebarCollapsed: boolean;
  conversations: ConversationRow[];
  channels: ChannelRow[];
  statusCounts: ConversationStatusCounts;
  filters: { search: string; status: string; tagIds: string[]; assignedTo: string };
  availableTags: ReferenceData["tags"];
  attendants: AttendantRow[];
  currentUserId: string;
  isAdmin: boolean;
  loading: boolean;
  selectedConversation: ConversationRow | null;
  highlightedConversationId?: string | null;
  onFiltersChange: (filters: { search: string; status: string; tagIds: string[]; assignedTo: string }) => void;
  onSearchSettlingChange?: (settling: boolean) => void;
  onSelectConversation: (conversation: ConversationRow) => void;
  onAssignConversation: (conversationId: string, userId?: string) => Promise<void>;
  onUnassignConversation: (conversationId: string) => Promise<void>;
  onTransferConversation: (conversationId: string, userId: string) => Promise<void>;
  onSendMessage: (conversationId: string, body: string) => Promise<boolean>;
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
  onUpdateContact: (
    contactId: string,
    payload: Partial<{ name: string; cpf: string; internalNote: string | null }>
  ) => Promise<ContactRow | null>;
  onOpenCltSimulation: (conversation: ConversationRow) => void;
}) {
  const [message, setMessage] = useState("");
  const [composerError, setComposerError] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sendingAttachment, setSendingAttachment] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplateRow[]>([]);
  const [templateSearch, setTemplateSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplateRow | null>(null);
  const [templateValues, setTemplateValues] = useState<string[]>([]);
  const [templateVariableDialogOpen, setTemplateVariableDialogOpen] = useState(false);
  const [filePreview, setFilePreview] = useState<{ file: File; url?: string } | null>(null);
  const [audioPreview, setAudioPreview] = useState<{ file: File; url: string } | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [assigningConversationId, setAssigningConversationId] = useState<string | null>(null);
  const [unassignOpen, setUnassignOpen] = useState(false);
  const [unassignSaving, setUnassignSaving] = useState(false);
  const [contactEditOpen, setContactEditOpen] = useState(false);
  const [contactEditForm, setContactEditForm] = useState({ name: "", cpf: "" });
  const [contactEditSaving, setContactEditSaving] = useState(false);
  const [contactEditError, setContactEditError] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [internalNoteSaving, setInternalNoteSaving] = useState(false);
  const [internalNoteStatus, setInternalNoteStatus] = useState("");
  const [internalNoteError, setInternalNoteError] = useState("");
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpForm, setFollowUpForm] = useState({
    reason: followUpReasons[0],
    note: "",
    dueAt: "",
    assigneeId: ""
  });
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [followUpError, setFollowUpError] = useState("");
  const [followUpSuccess, setFollowUpSuccess] = useState("");
  const [scheduledReturnsOpen, setScheduledReturnsOpen] = useState(false);
  const [scheduledReturns, setScheduledReturns] = useState<TaskRow[]>([]);
  const [scheduledReturnsLoading, setScheduledReturnsLoading] = useState(false);
  const [scheduledReturnsError, setScheduledReturnsError] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [aiSidebarCollapsed, setAiSidebarCollapsed] = useState(false);
  const [opportunitySummary, setOpportunitySummary] = useState<OpportunitySummary | null>(null);
  const [opportunityLoading, setOpportunityLoading] = useState(false);
  const [opportunityError, setOpportunityError] = useState("");
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const mobileInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const draftsByConversationRef = useRef<Record<string, string>>({});
  const selectedConversationIdRef = useRef<string | null>(selectedConversation?.id ?? null);
  const opportunityRequestIdRef = useRef(0);
  const activeConversationId = selectedConversation?.id ?? null;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [selectedConversation?.id, selectedConversation?.messages.length]);

  useEffect(() => {
    setFollowUpSuccess("");
  }, [selectedConversation?.id]);

  useEffect(() => {
    if (!selectedConversation) {
      setMobileConversationOpen(false);
      setMobileDetailsOpen(false);
      setMobileActionsOpen(false);
    }
  }, [selectedConversation]);

  useEffect(() => {
    if (!mobileDetailsOpen && !mobileActionsOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileDetailsOpen(false);
        setMobileActionsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileActionsOpen, mobileDetailsOpen]);

  useEffect(() => {
    if (!templatesOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !templateVariableDialogOpen) {
        setSelectedTemplate(null);
        setTemplateValues([]);
        setTemplateVariableDialogOpen(false);
        setTemplatesOpen(false);
        setTemplateSearch("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [templatesOpen, templateVariableDialogOpen]);

  useEffect(() => {
    const conversationId = selectedConversation?.id ?? null;
    selectedConversationIdRef.current = conversationId;
    setMessage(conversationId ? draftsByConversationRef.current[conversationId] ?? "" : "");
    setSelectedTemplate(null);
    setTemplateValues([]);
    setTemplateVariableDialogOpen(false);
    setTemplatesOpen(false);
    setTemplates([]);
    setTemplateSearch("");
    setTemplatesLoading(false);
  }, [selectedConversation?.id]);

  useEffect(() => {
    setInternalNote(selectedConversation?.contact.internalNote ?? "");
    setInternalNoteStatus("");
    setInternalNoteError("");
  }, [selectedConversation?.contact.internalNote, selectedConversation?.id]);

  useEffect(() => {
    if (!activeConversationId) {
      opportunityRequestIdRef.current += 1;
      setOpportunitySummary(null);
      setOpportunityLoading(false);
      setOpportunityError("");
      return;
    }

    const conversationId = activeConversationId;
    const requestId = opportunityRequestIdRef.current + 1;
    opportunityRequestIdRef.current = requestId;
    const controller = new AbortController();

    setOpportunitySummary(null);
    setOpportunityLoading(true);
    setOpportunityError("");

    async function loadOpportunitySummary() {
      try {
        const response = await fetch(
          `/api/conversations/${encodeURIComponent(conversationId)}/opportunity-summary`,
          {
            credentials: "same-origin",
            signal: controller.signal
          }
        );

        const data = (await response.json().catch(() => null)) as
          | OpportunitySummaryResponse
          | null;

        if (!response.ok) {
          throw new Error(data?.error ?? "Nao foi possivel carregar a oportunidade.");
        }

        if (!data?.summary) {
          throw new Error("A oportunidade retornou uma resposta inesperada.");
        }

        if (
          !controller.signal.aborted &&
          opportunityRequestIdRef.current === requestId
        ) {
          setOpportunitySummary(data.summary);
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          opportunityRequestIdRef.current !== requestId
        ) {
          return;
        }

        setOpportunitySummary(null);
        setOpportunityError(
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar a oportunidade."
        );
      } finally {
        if (
          !controller.signal.aborted &&
          opportunityRequestIdRef.current === requestId
        ) {
          setOpportunityLoading(false);
        }
      }
    }

    void loadOpportunitySummary();

    return () => controller.abort();
  }, [activeConversationId]);

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
    if (sendingMessage || !selectedConversation || !message.trim()) return;

    const conversationId = selectedConversation.id;
    const messageToSend = message;

    setSendingMessage(true);
    try {
      const sent = await onSendMessage(conversationId, messageToSend);
      if (sent) {
        setMessage((current) =>
          selectedConversationIdRef.current === conversationId
            ? current.startsWith(messageToSend)
              ? current.slice(messageToSend.length)
              : current
            : current
        );
        const currentDraft = draftsByConversationRef.current[conversationId];
        if (currentDraft?.startsWith(messageToSend)) {
          const nextDraft = currentDraft.slice(messageToSend.length);
          if (nextDraft) {
            draftsByConversationRef.current[conversationId] = nextDraft;
          } else {
            delete draftsByConversationRef.current[conversationId];
          }
        }
      }
    } finally {
      setSendingMessage(false);
    }
  }

  function updateComposerMessage(value: string | ((current: string) => string)) {
    setMessage((current) => {
      const next = typeof value === "function" ? value(current) : value;
      const conversationId = selectedConversationIdRef.current;

      if (conversationId) {
        if (next) {
          draftsByConversationRef.current[conversationId] = next;
        } else {
          delete draftsByConversationRef.current[conversationId];
        }
      }

      return next;
    });
  }

  function insertComposerLineBreak(target: HTMLTextAreaElement) {
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    const nextCursorPosition = selectionStart + 1;

    updateComposerMessage((current) =>
      `${current.slice(0, selectionStart)}\n${current.slice(selectionEnd)}`
    );

    window.requestAnimationFrame(() => {
      target.selectionStart = nextCursorPosition;
      target.selectionEnd = nextCursorPosition;
    });
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.key !== "Enter") return;

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      insertComposerLineBreak(event.currentTarget);
      return;
    }

    if (!event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }
  function focusComposerInput() {
    const shouldUseMobileInput =
      typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches;
    const target = shouldUseMobileInput ? mobileInputRef.current : inputRef.current;

    target?.focus();
  }

  function getRetryableFailedTextBody(message: ConversationMessageRow) {
    const type = message.type?.trim().toLowerCase() ?? "text";
    const status = message.status?.trim().toLowerCase();

    if (message.direction !== "outbound" || status !== "failed" || type !== "text") {
      return null;
    }

    const failureSuffixIndex = message.body.lastIndexOf("\n\nFalha:");
    const originalBody =
      failureSuffixIndex >= 0 ? message.body.slice(0, failureSuffixIndex) : message.body;
    const trimmedBody = originalBody.trim();

    return trimmedBody || null;
  }

  async function retryFailedTextMessage(message: ConversationMessageRow) {
    if (!selectedConversation || retryingMessageId) return;

    const conversationId = selectedConversation.id;
    const originalBody = getRetryableFailedTextBody(message);

    if (!originalBody) return;

    setRetryingMessageId(message.id);
    try {
      await onSendMessage(conversationId, originalBody);
    } finally {
      setRetryingMessageId((current) => (current === message.id ? null : current));
    }
  }

  function insertEmoji(emoji: string) {
    updateComposerMessage((current) => `${current}${emoji}`);
    setEmojiOpen(false);
    setQuickRepliesOpen(false);
    window.setTimeout(focusComposerInput, 0);
  }

  function insertQuickReply(body: string) {
    updateComposerMessage((current) => {
      const trimmed = current.trim();
      return trimmed ? `${trimmed}\n${body}` : body;
    });
    setQuickRepliesOpen(false);
    setEmojiOpen(false);
    window.setTimeout(focusComposerInput, 0);
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

  function clearTemplateSelection() {
    setSelectedTemplate(null);
    setTemplateValues([]);
    setTemplateVariableDialogOpen(false);
  }

  function closeTemplatesPanel() {
    clearTemplateSelection();
    setTemplatesOpen(false);
    setTemplateSearch("");
  }

  const filteredTemplates = useMemo(() => {
    const term = templateSearch
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    if (!term) return templates;

    return templates.filter((template) => {
      const searchableText = `${template.name} ${template.preview ?? ""}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

      return searchableText.includes(term);
    });
  }, [templateSearch, templates]);

  function selectTemplate(template: WhatsAppTemplateRow) {
    const initialValues = Array.from({ length: template.variableCount }, () => "");
    setSelectedTemplate(template);
    setTemplateValues(initialValues);
    setTemplateVariableDialogOpen(template.variableCount > 0);
  }

  function updateTemplateValue(index: number, value: string) {
    setTemplateValues((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? value : item))
    );
  }

  async function openTemplates() {
    if (!selectedConversation) return;
    setQuickRepliesOpen(false);
    setEmojiOpen(false);
    if (templatesOpen) {
      closeTemplatesPanel();
      return;
    }
    setTemplatesOpen(true);
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

  async function sendTemplate(values = templateValues) {
    if (!selectedConversation || !selectedTemplate || sendingAttachment) return;
    setSendingAttachment(true);
    setComposerError("");
    try {
      await onSendTemplate(selectedConversation.id, {
        templateName: selectedTemplate.name,
        language: selectedTemplate.language,
        variables: values
      });
      closeTemplatesPanel();
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Falha ao enviar template.");
    } finally {
      setSendingAttachment(false);
    }
  }

  const selectedConversationChannelId = selectedConversation
    ? resolveConversationChannelId(selectedConversation)
    : null;
  const selectedConversationChannel = selectedConversationChannelId
    ? channels.find((channel) => channel.id === selectedConversationChannelId) ?? null
    : null;
  const hasConversationChannelData = Boolean(
    selectedConversation?.channelId || selectedConversation?.channel?.trim()
  );
  const conversationChannelLabel = selectedConversation
    ? selectedConversationChannel
      ? `${selectedConversationChannel.name.trim() || "WhatsApp"} · ${
          selectedConversationChannel.displayPhone?.trim() || "Telefone não informado"
        }`
      : hasConversationChannelData
        ? "WhatsApp · canal não identificado"
        : "Canal não informado"
    : null;
  const conversationHeaderChannelLabel = selectedConversation
    ? selectedConversationChannel
      ? buildShortChannelLabel(selectedConversationChannel.name)
      : hasConversationChannelData
        ? "WhatsApp"
        : "Canal -"
    : null;
  const selectedContactPhoneTitle = selectedConversation?.contact.phone?.trim() || undefined;
  const selectedContactPhoneLabel = selectedConversation
    ? formatPhoneForHeader(selectedConversation.contact.phone) || "Tel -"
    : "Inbox";
  const selectedContactCpfLabel = selectedConversation?.contact.cpf
    ? formatCpf(selectedConversation.contact.cpf)
    : "CPF -";
  const selectedAgentFullName = selectedConversation?.agent?.name?.trim() || "";
  const selectedAgentHeaderName = selectedAgentFullName
    ? selectedAgentFullName.split(/\s+/)[0]
    : "Sem resp.";

  const showMobileConversationDetail = mobileConversationOpen && Boolean(selectedConversation);

  function selectConversation(conversation: ConversationRow) {
    onSelectConversation(conversation);
    setMobileConversationOpen(true);
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

  function openContactEdit() {
    if (!selectedConversation) return;
    setContactEditForm({
      name: selectedConversation.contact.name,
      cpf: selectedConversation.contact.cpf ?? ""
    });
    setContactEditError("");
    setContactEditOpen(true);
  }

  function openFollowUp() {
    if (!selectedConversation) return;

    setFollowUpForm({
      reason: followUpReasons[0],
      note: "",
      dueAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString().slice(0, 16),
      assigneeId:
        selectedConversation.agent?.id ??
        selectedConversation.contact.ownerId ??
        currentUserId
    });
    setFollowUpError("");
    setFollowUpSuccess("");
    setFollowUpOpen(true);
  }

  async function loadScheduledReturns() {
    setScheduledReturnsLoading(true);
    setScheduledReturnsError("");

    try {
      const query = isAdmin
        ? "status=PENDING"
        : `assigneeId=${encodeURIComponent(currentUserId)}&status=PENDING`;
      const response = await fetch(`/api/tasks?${query}`);

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Nao foi possivel carregar retornos.");
      }

      const data = (await response.json()) as { tasks?: TaskRow[] };
      setScheduledReturns(data.tasks ?? []);
    } catch (error) {
      setScheduledReturnsError(
        error instanceof Error ? error.message : "Nao foi possivel carregar retornos."
      );
    } finally {
      setScheduledReturnsLoading(false);
    }
  }

  function openScheduledReturns() {
    setScheduledReturnsOpen(true);
    void loadScheduledReturns();
  }

  async function submitContactEdit() {
    if (!selectedConversation) return;

    setContactEditSaving(true);
    setContactEditError("");

    try {
      const updated = await onUpdateContact(selectedConversation.contact.id, {
        name: contactEditForm.name,
        cpf: contactEditForm.cpf
      });

      if (updated) {
        setContactEditOpen(false);
      } else {
        setContactEditError("Nao foi possivel atualizar o contato.");
      }
    } catch (error) {
      setContactEditError(
        error instanceof Error ? error.message : "Nao foi possivel atualizar o contato."
      );
    } finally {
      setContactEditSaving(false);
    }
  }

  async function submitInternalNote() {
    if (!selectedConversation) return;

    setInternalNoteSaving(true);
    setInternalNoteStatus("");
    setInternalNoteError("");

    try {
      const updated = await onUpdateContact(selectedConversation.contact.id, {
        internalNote
      });

      if (updated) {
        setInternalNoteStatus("Observacao salva.");
      } else {
        setInternalNoteError("Nao foi possivel salvar a observacao.");
      }
    } catch (error) {
      setInternalNoteError(
        error instanceof Error ? error.message : "Nao foi possivel salvar a observacao."
      );
    } finally {
      setInternalNoteSaving(false);
    }
  }

  async function submitFollowUp() {
    if (!selectedConversation) return;

    const dueAt = followUpForm.dueAt ? new Date(followUpForm.dueAt) : null;
    if (!followUpForm.reason.trim() || !dueAt || Number.isNaN(dueAt.getTime())) {
      setFollowUpError("Informe motivo e data/hora de retorno validos.");
      return;
    }

    setFollowUpSaving(true);
    setFollowUpError("");
    setFollowUpSuccess("");

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: selectedConversation.contact.id,
          title: `Retorno: ${followUpForm.reason.trim()}`,
          note: followUpForm.note,
          dueAt: dueAt.toISOString(),
          assigneeId: followUpForm.assigneeId
        })
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Nao foi possivel agendar o retorno.");
      }

      setFollowUpOpen(false);
      setFollowUpSuccess("Retorno agendado");
    } catch (error) {
      setFollowUpError(
        error instanceof Error ? error.message : "Nao foi possivel agendar o retorno."
      );
    } finally {
      setFollowUpSaving(false);
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

  function renderDetailsPanelContent({ allowCollapse }: { allowCollapse: boolean }) {
    return (
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
          onCollapse={allowCollapse ? () => setAiSidebarCollapsed(true) : undefined}
        />
        {aiAnalysis && (
          <button
            className="flex h-10 w-full items-center justify-center gap-2 rounded bg-brand px-3 text-sm font-semibold text-white"
            disabled={!selectedConversation}
            onClick={() => updateComposerMessage(aiAnalysis.suggestedReply)}
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
        <OpportunitySummaryCard
          error={opportunityError}
          loading={opportunityLoading}
          summary={opportunitySummary}
          onFollowUp={openFollowUp}
          onFocusComposer={focusComposerInput}
          onOpenCltSimulation={() =>
            selectedConversation ? onOpenCltSimulation(selectedConversation) : undefined
          }
          onOpenTemplates={() => void openTemplates()}
        />
        <div className="rounded border border-line bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold">Observacao interna</h3>
            {internalNoteStatus && (
              <span className="text-xs font-semibold text-emerald-600">
                {internalNoteStatus}
              </span>
            )}
          </div>
          <textarea
            className="mt-3 min-h-[104px] w-full resize-y rounded-2xl border border-line bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand focus:bg-white focus:ring-2 focus:ring-blue-100"
            disabled={!selectedConversation || internalNoteSaving}
            maxLength={2000}
            placeholder="Anotacoes internas sobre este cliente."
            value={internalNote}
            onChange={(event) => {
              setInternalNote(event.target.value);
              setInternalNoteStatus("");
              setInternalNoteError("");
            }}
          />
          {internalNoteError && (
            <p className="mt-2 text-xs font-semibold text-rose-600">
              {internalNoteError}
            </p>
          )}
          <button
            type="button"
            className="mt-3 flex h-10 w-full items-center justify-center rounded-2xl bg-brand px-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!selectedConversation || internalNoteSaving}
            onClick={() => void submitInternalNote()}
          >
            {internalNoteSaving ? "Salvando..." : "Salvar"}
          </button>
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
    );
  }

  return (
    <div
      className={clsx(
        "grid h-full min-h-0 gap-3 overflow-hidden transition-[grid-template-columns] duration-300 ease-out md:gap-4",
        aiSidebarCollapsed
          ? leftSidebarCollapsed
            ? "xl:grid-cols-[400px_minmax(0,1fr)_64px]"
            : "xl:grid-cols-[340px_minmax(0,1fr)_64px]"
          : leftSidebarCollapsed
            ? "xl:grid-cols-[400px_minmax(0,1fr)_320px]"
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
      {contactEditOpen && selectedConversation && (
        <EditConversationContactModal
          contactName={contactEditForm.name}
          contactCpf={contactEditForm.cpf}
          error={contactEditError}
          saving={contactEditSaving}
          onChange={setContactEditForm}
          onClose={() => setContactEditOpen(false)}
          onSubmit={() => void submitContactEdit()}
        />
      )}
      {followUpOpen && selectedConversation && (
        <ScheduleFollowUpModal
          attendants={attendants}
          currentUserId={currentUserId}
          conversation={selectedConversation}
          error={followUpError}
          form={followUpForm}
          saving={followUpSaving}
          onChange={setFollowUpForm}
          onClose={() => setFollowUpOpen(false)}
          onSubmit={() => void submitFollowUp()}
        />
      )}
      {scheduledReturnsOpen && (
        <ScheduledReturnsModal
          error={scheduledReturnsError}
          loading={scheduledReturnsLoading}
          tasks={scheduledReturns}
          onClose={() => setScheduledReturnsOpen(false)}
          onRefresh={() => void loadScheduledReturns()}
          onTaskCompleted={(taskId) =>
            setScheduledReturns((current) => current.filter((task) => task.id !== taskId))
          }
          onTaskUpdated={(updatedTask) =>
            setScheduledReturns((current) =>
              current.map((task) => (task.id === updatedTask.id ? updatedTask : task))
            )
          }
        />
      )}
      <div className={clsx(showMobileConversationDetail ? "hidden xl:contents" : "contents")}>
        <ConversationList
          conversations={conversations}
          statusCounts={statusCounts}
          filters={filters}
          availableTags={availableTags}
          attendants={attendants}
          isAdmin={isAdmin}
          loading={loading}
          selectedConversation={selectedConversation}
          highlightedConversationId={highlightedConversationId}
          onFiltersChange={onFiltersChange}
          onSearchSettlingChange={onSearchSettlingChange}
          onSelectConversation={selectConversation}
        />
      </div>

      <section
        className={clsx(
          "min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-line/80 bg-white shadow-soft",
          showMobileConversationDetail ? "flex" : "hidden xl:flex"
        )}
      >
        {selectedConversation && (
          <div className="flex shrink-0 flex-col gap-2 border-b border-line/70 px-3 py-2 xl:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
                onClick={() => {
                  setMobileConversationOpen(false);
                  setMobileDetailsOpen(false);
                  setMobileActionsOpen(false);
                }}
              >
                <ArrowRight className="h-4 w-4 rotate-180" />
                Voltar
              </button>
              <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-50 text-sm font-black text-slate-700 shadow-sm ring-1 ring-slate-200">
                {formatContactNameForUi(selectedConversation.contact.name)
                  .slice(0, 1)
                  .toUpperCase() || "C"}
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 ring-1 ring-emerald-100" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-black leading-5 text-slate-950">
                  {formatContactNameForUi(selectedConversation.contact.name)}
                </h3>
                <p className="truncate text-xs font-medium text-slate-500">
                  {selectedConversation.contact.phone}
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-9 shrink-0 items-center rounded-full border border-line bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
                onClick={() => setMobileActionsOpen(true)}
              >
                Ações
              </button>
              <button
                type="button"
                className="inline-flex h-9 shrink-0 items-center rounded-full border border-line bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm hover:border-blue-200 hover:bg-blue-50 hover:text-brand"
                onClick={() => setMobileDetailsOpen(true)}
              >
                Detalhes
              </button>
            </div>
            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
              <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 shadow-sm">
                {conversationStatusLabels[selectedConversation.status] ?? selectedConversation.status}
              </span>
              <span
                className="min-w-0 truncate rounded-full border border-blue-100 bg-blue-50/70 px-2 py-0.5 text-[11px] font-semibold text-blue-700 shadow-sm"
                title={conversationChannelLabel ?? undefined}
              >
                {conversationChannelLabel}
              </span>
            </div>
          </div>
        )}

        <div className="hidden shrink-0 items-center gap-1 border-b border-line/70 px-2 py-1.5 md:px-3 xl:flex 2xl:gap-2 2xl:px-4">
          <div className="flex min-w-0 w-[6rem] shrink-0 items-center gap-1 xl:w-[6.5rem] 2xl:w-[13rem] 2xl:gap-1.5">
            {selectedConversation && (
              <button
                type="button"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 xl:hidden"
                onClick={() => {
                  setMobileConversationOpen(false);
                  setMobileDetailsOpen(false);
                  setMobileActionsOpen(false);
                }}
              >
                <ArrowRight className="h-4 w-4 rotate-180" />
                Voltar
              </button>
            )}
            {selectedConversation && (
              <button
                type="button"
                className="inline-flex h-9 shrink-0 items-center rounded-full border border-line bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm hover:border-blue-200 hover:bg-blue-50 hover:text-brand xl:hidden"
                onClick={() => setMobileDetailsOpen(true)}
              >
                Detalhes
              </button>
            )}
            <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-50 text-sm font-black text-slate-700 shadow-sm ring-1 ring-slate-200 2xl:h-10 2xl:w-10">
              {formatContactNameForUi(selectedConversation?.contact.name)
                .slice(0, 1)
                .toUpperCase() ?? "C"}
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 ring-1 ring-emerald-100" />
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <h3
                className="min-w-0 truncate text-sm font-black leading-5 text-slate-950 2xl:text-base"
                title={
                  selectedConversation
                    ? formatContactNameForUi(selectedConversation.contact.name)
                    : undefined
                }
              >
                {selectedConversation
                  ? formatContactNameForUi(selectedConversation.contact.name)
                  : "Selecione uma conversa"}
              </h3>
              {selectedConversation && (
                <button
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-white text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-brand 2xl:h-7 2xl:w-7"
                  onClick={openContactEdit}
                  title="Editar contato"
                  type="button"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          {selectedConversation && (
            <span className="h-5 w-px shrink-0 bg-slate-200/80" aria-hidden="true" />
          )}
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden 2xl:gap-2">
            <p
              className="inline-flex min-w-0 basis-[6.25rem] items-center gap-1 truncate text-xs font-semibold text-slate-700 2xl:basis-[8.75rem]"
              title={selectedContactPhoneTitle}
            >
                {selectedConversation && <Phone className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
                <span className="min-w-0 truncate">{selectedContactPhoneLabel}</span>
              </p>
              {selectedConversation && (
                <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden 2xl:gap-2">
                  <span className="h-5 w-px shrink-0 bg-slate-200/80" aria-hidden="true" />
                  <span
                    className="inline-flex min-w-[2rem] basis-[6rem] items-center gap-1 truncate text-xs font-semibold text-slate-700 2xl:basis-[7.75rem]"
                    title={
                      selectedConversation.contact.cpf
                        ? formatCpf(selectedConversation.contact.cpf)
                        : "CPF nao informado"
                    }
                  >
                    <IdCard className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className="min-w-0 truncate">{selectedContactCpfLabel}</span>
                  </span>
                  <span className="h-5 w-px shrink-0 bg-slate-200/80" aria-hidden="true" />
                  <span
                    className="inline-flex min-w-[3rem] flex-1 items-center gap-1 truncate text-xs font-bold text-slate-800 2xl:min-w-[8rem]"
                    title={conversationChannelLabel ?? undefined}
                  >
                    <MessageCircle className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span className="min-w-0 truncate">{conversationHeaderChannelLabel}</span>
                  </span>
                  <span className="h-5 w-px shrink-0 bg-slate-200/80" aria-hidden="true" />
                  <span
                    className={clsx(
                      "inline-flex min-w-[3rem] basis-[4.75rem] items-center gap-1 truncate text-xs font-semibold 2xl:basis-[8rem]",
                      selectedConversation.agent
                        ? "text-slate-800"
                        : "text-slate-600"
                    )}
                    title={selectedAgentFullName || "Sem responsavel"}
                  >
                    <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className="min-w-0 truncate">{selectedAgentHeaderName}</span>
                  </span>
                </div>
              )}
          </div>
          {selectedConversation && (
            <div className="ml-auto flex shrink-0 items-center gap-0.5 2xl:gap-2">
              {followUpSuccess && (
                  <span className="inline-flex h-8 items-center rounded-full bg-emerald-50 px-2.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
                  {followUpSuccess}
                </span>
              )}
              <button
                type="button"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line/80 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 2xl:h-8 2xl:w-8"
                onClick={openScheduledReturns}
                title="Retorno"
              >
                <Clock3 className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line/80 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 2xl:h-8 2xl:w-8"
                onClick={openFollowUp}
                title="Agendar"
              >
                <CalendarClock className="h-4 w-4" />
              </button>
              {!selectedConversation.agent && (
                <button
                  type="button"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line/80 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-70 2xl:h-8 2xl:w-8"
                  disabled={assigningConversationId === selectedConversation.id}
                  onClick={() => void submitAssign(selectedConversation.id)}
                  title="Assumir"
                >
                  {assigningConversationId === selectedConversation.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </button>
              )}
              {isAdmin && selectedConversation.agent && (
                <button
                  type="button"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line/80 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 2xl:h-8 2xl:w-8"
                  onClick={() => setUnassignOpen(true)}
                  title="Devolver"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line/80 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 2xl:h-8 2xl:w-8"
                  onClick={() => setTransferOpen(true)}
                  title="Transferir"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
              <ConversationTagSelector
                iconOnly
                availableTags={availableTags}
                selectedTags={selectedConversation.tags}
                onAdd={(tagIds) => onAddTags(selectedConversation.id, tagIds)}
                onRemove={(tagId) => onRemoveTag(selectedConversation.id, tagId)}
              />
              <div
                className="relative grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line/80 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 focus-within:border-slate-300 focus-within:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-100 2xl:h-8 2xl:w-8"
                title={`Status: ${
                  conversationStatusLabels[selectedConversation.status] ??
                  selectedConversation.status
                }`}
              >
                <span
                  className={clsx(
                    "h-2.5 w-2.5 rounded-full",
                    conversationStatusIndicatorClasses[selectedConversation.status]
                  )}
                />
                <select
                  aria-label="Alterar status da conversa"
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
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
            </div>
          )}
        </div>

        {selectedConversation && selectedConversation.tags.length > 0 && (
          <div className="hidden flex-wrap items-center gap-1.5 border-b border-line/60 bg-slate-50/30 px-5 py-2 xl:flex">
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
            const retryableTextBody = getRetryableFailedTextBody(item);
            const isRetryingMessage = retryingMessageId === item.id;

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
                  isAiMessage={item.direction === "outbound" && item.senderType === "ai"}
                >
                  {item.type === "audio" || item.mimeType?.startsWith("audio/") ? (
                    <AudioMessage
                      messageId={item.id}
                      body={item.body}
                      mediaUrl={item.mediaUrl}
                      hasMediaId={Boolean(item.mediaId)}
                      side={side}
                    />
                  ) : item.type === "image" || item.mimeType?.startsWith("image/") ? (
                    <ImageMessage
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
                      templateLanguage={item.templateLanguage}
                      templateVariables={item.templateVariables}
                      side={side}
                    />
                  ) : (
                    item.body
                  )}
                </ChatBubble>
                {retryableTextBody && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      aria-label="Tentar enviar novamente esta mensagem"
                      className="inline-flex items-center gap-1.5 rounded-full border border-rose-100 bg-white px-3 py-1 text-[11px] font-bold text-rose-600 shadow-sm transition hover:border-rose-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isRetryingMessage}
                      onClick={() => void retryFailedTextMessage(item)}
                    >
                      {isRetryingMessage && (
                        <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                      )}
                      {isRetryingMessage ? "Tentando..." : "Tentar novamente"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        <form className="shrink-0 border-t border-slate-200 bg-white px-2 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-10px_28px_rgba(15,23,42,0.06)] sm:px-3" onSubmit={handleSubmit}>
          {composerError && (
            <div role="alert" className="mb-3 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
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
                      <FileIcon aria-hidden="true" className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{filePreview.file.name}</p>
                    <p className="text-xs text-slate-500">{formatFileSize(filePreview.file.size)}</p>
                  </div>
                  <button type="button" className="rounded-full px-3 py-1 text-sm text-slate-500 hover:bg-white" onClick={() => setFilePreview(null)}>
                    Remover
                  </button>
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-sm font-semibold text-white disabled:opacity-50" disabled={sendingAttachment} onClick={() => void sendMediaPreview(filePreview, message)}>
                    {sendingAttachment ? (
                      <>
                        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      "Enviar"
                    )}
                  </button>
                </div>
              )}
              {audioPreview && (
                <div className="flex items-center gap-3">
                  <audio className="min-w-0 flex-1" controls src={audioPreview.url} />
                  <button type="button" className="rounded-full px-3 py-1 text-sm text-slate-500 hover:bg-white" onClick={() => setAudioPreview(null)}>
                    Descartar
                  </button>
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-sm font-semibold text-white disabled:opacity-50" disabled={sendingAttachment} onClick={() => void sendMediaPreview(audioPreview)}>
                    {sendingAttachment ? (
                      <>
                        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      "Enviar audio"
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {templatesOpen && (
            <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/40 p-3 backdrop-blur-sm sm:items-center">
              <div
                aria-labelledby="conversation-template-picker-title"
                aria-modal="true"
                className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-3xl border border-line bg-white shadow-2xl"
                role="dialog"
              >
                <div className="border-b border-line p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">
                        Atendimento
                      </p>
                      <h3
                        className="mt-1 text-lg font-black text-slate-950"
                        id="conversation-template-picker-title"
                      >
                        Templates aprovados
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Escolha um template aprovado para esta conversa.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                      onClick={closeTemplatesPanel}
                    >
                      Fechar
                    </button>
                  </div>

                  <label className="mt-4 block">
                    <span className="sr-only">Buscar template</span>
                    <input
                      className="h-11 w-full rounded-2xl border border-line bg-white px-4 text-sm outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
                      placeholder="Buscar template..."
                      type="search"
                      value={templateSearch}
                      onChange={(event) => setTemplateSearch(event.target.value)}
                    />
                  </label>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:max-h-[68vh] sm:p-5">
                  {templatesLoading && (
                    <div className="rounded-2xl border border-dashed border-line p-5 text-sm text-slate-500">
                      Buscando templates...
                    </div>
                  )}
                  {!templatesLoading && templates.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-line p-5 text-sm text-slate-500">
                      Nenhum template aprovado encontrado para este numero.
                    </div>
                  )}
                  {!templatesLoading && templates.length > 0 && filteredTemplates.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-line p-5 text-sm text-slate-500">
                      Nenhum template corresponde à busca.
                    </div>
                  )}
                  {!templatesLoading && filteredTemplates.length > 0 && (
                    <div className="grid gap-2 md:grid-cols-2">
                      {filteredTemplates.map((template) => (
                        <button
                          key={`${template.name}-${template.language}`}
                          type="button"
                          className={clsx(
                            "w-full rounded-2xl border p-3 text-left transition hover:bg-slate-50",
                            selectedTemplate?.name === template.name &&
                              selectedTemplate.language === template.language
                              ? "border-blue-200 bg-blue-50"
                              : "border-line"
                          )}
                          onClick={() => {
                            selectTemplate(template);
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-slate-900">{template.name}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {template.category} - {template.language}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                              {template.status}
                            </span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">
                            {template.preview}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedTemplate && (
                  <div className="border-t border-line bg-slate-50 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {selectedTemplate.name}
                        </p>
                        {selectedTemplate.variableCount > 0 && (
                          <p className="mt-1 text-xs text-slate-500">
                            Preencha as variaveis antes de enviar.
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-brand px-5 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={sendingAttachment || !selectedTemplate}
                        onClick={() => {
                          if (selectedTemplate.variableCount > 0) {
                            setTemplateVariableDialogOpen(true);
                            return;
                          }
                          void sendTemplate();
                        }}
                      >
                        {sendingAttachment ? (
                          <>
                            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                            Enviando...
                          </>
                        ) : (
                          selectedTemplate.variableCount > 0 ? "Preencher variaveis" : "Enviar template"
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {templateVariableDialogOpen && selectedTemplate && selectedTemplate.variableCount > 0 && (
            <TemplateVariableDialog
              template={selectedTemplate}
              values={templateValues}
              sending={sendingAttachment}
              onChange={updateTemplateValue}
              onCancel={clearTemplateSelection}
              onConfirm={() => void sendTemplate(templateValues)}
            />
          )}

          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="image/jpeg,image/png,application/pdf,audio/mpeg,audio/ogg,audio/webm,video/mp4,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];

              if (file) {
                handleFileChange(file);
              }

              event.currentTarget.value = "";
            }}
          />

          <div className="space-y-2 xl:hidden">
            <div className="relative flex items-end gap-1.5 rounded-[1.75rem] border border-slate-300 bg-white px-2 py-2 shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_22px_rgba(15,23,42,0.07)] transition focus-within:border-brand/60 focus-within:shadow-[0_1px_0_rgba(37,99,235,0.08),0_10px_28px_rgba(37,99,235,0.10)] focus-within:ring-4 focus-within:ring-blue-50">
              <ComposerButton title="Emoji" disabled={!selectedConversation} onClick={() => setEmojiOpen((current) => !current)}>
                <Smile aria-hidden="true" className="h-4 w-4" />
              </ComposerButton>

              {emojiOpen && (
                <div className="absolute bottom-14 left-2 z-20 grid max-w-[calc(100vw-2rem)] grid-cols-8 gap-1 rounded-2xl border border-line bg-white p-2 shadow-lift">
                  {commonEmojis.map((emoji) => (
                    <button key={emoji} type="button" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-50" onClick={() => insertEmoji(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              <textarea
                ref={mobileInputRef}
                aria-label="Mensagem"
                className="max-h-32 min-h-10 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-2 text-sm font-medium leading-5 text-slate-800 outline-none placeholder:text-slate-500 disabled:text-slate-400 disabled:placeholder:text-slate-400"
                disabled={!selectedConversation}
                placeholder="Digite uma mensagem..."
                rows={1}
                value={message}
                onChange={(event) => updateComposerMessage(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <ComposerButton title="Anexar arquivo" disabled={!selectedConversation} onClick={() => fileInputRef.current?.click()}>
                <Paperclip aria-hidden="true" className="h-4 w-4" />
              </ComposerButton>
              <ComposerButton title="Gravar audio" disabled={!selectedConversation || recording} onClick={() => void startRecording()}>
                {recording ? <Square aria-hidden="true" className="h-4 w-4 text-rose-500" /> : <Mic aria-hidden="true" className="h-4 w-4" />}
              </ComposerButton>
              <button
                type="submit"
                aria-label={sendingMessage ? "Enviando mensagem" : "Enviar mensagem"}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-white shadow-[0_8px_18px_rgba(37,99,235,0.25)] transition hover:bg-blue-700 active:scale-95 disabled:bg-slate-300 disabled:opacity-70 disabled:shadow-none"
                disabled={!selectedConversation || !message.trim() || sendingMessage}
              >
                {sendingMessage ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Send aria-hidden="true" className="h-4 w-4" />
                )}
              </button>
            </div>

            <div className="relative flex items-center gap-2 px-1">
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-bold text-slate-600 shadow-sm hover:border-blue-200 hover:bg-blue-50 hover:text-brand disabled:opacity-50"
                disabled={!selectedConversation}
                onClick={() => void openTemplates()}
              >
                <FileText aria-hidden="true" className="h-3.5 w-3.5" />
                Templates
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-bold text-slate-600 shadow-sm hover:border-blue-200 hover:bg-blue-50 hover:text-brand disabled:opacity-50"
                disabled={!selectedConversation}
                onClick={() => {
                  setQuickRepliesOpen((current) => !current);
                  setEmojiOpen(false);
                  closeTemplatesPanel();
                }}
              >
                <MessageSquareText aria-hidden="true" className="h-3.5 w-3.5" />
                Respostas
              </button>

              {quickRepliesOpen && (
                <div className="absolute bottom-10 left-0 z-30 w-[min(520px,calc(100vw-2rem))] min-w-0 rounded-2xl border border-line bg-white p-3 shadow-lift">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-900">Respostas rapidas</p>
                      <p className="text-xs text-slate-500">Clique para inserir no campo e revisar antes de enviar.</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-full px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100"
                      onClick={() => setQuickRepliesOpen(false)}
                    >
                      Fechar
                    </button>
                  </div>
                  <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                    {quickReplyTemplates.map((reply) => (
                      <button
                        key={reply.id}
                        type="button"
                        className="rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-200 hover:bg-blue-50"
                        onClick={() => insertQuickReply(reply.body)}
                      >
                        <span className="text-xs font-black text-slate-900">{reply.title}</span>
                        <span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-500">
                          {reply.body}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="relative hidden items-center gap-1.5 rounded-2xl border border-slate-300 bg-white px-2 py-2 shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_22px_rgba(15,23,42,0.07)] transition focus-within:border-brand/60 focus-within:shadow-[0_1px_0_rgba(37,99,235,0.08),0_10px_28px_rgba(37,99,235,0.10)] focus-within:ring-4 focus-within:ring-blue-50 sm:gap-2 sm:px-3 xl:flex">
            <ComposerButton title="Anexar arquivo" disabled={!selectedConversation} onClick={() => fileInputRef.current?.click()}>
              <Paperclip aria-hidden="true" className="h-4 w-4" />
            </ComposerButton>
            <ComposerButton title="Emoji" disabled={!selectedConversation} onClick={() => setEmojiOpen((current) => !current)}>
              <Smile aria-hidden="true" className="h-4 w-4" />
            </ComposerButton>
            <ComposerButton title="Gravar audio" disabled={!selectedConversation || recording} onClick={() => void startRecording()}>
              {recording ? <Square aria-hidden="true" className="h-4 w-4 text-rose-500" /> : <Mic aria-hidden="true" className="h-4 w-4" />}
            </ComposerButton>
            <ComposerButton title="Templates Meta" disabled={!selectedConversation} onClick={() => void openTemplates()}>
              <FileText aria-hidden="true" className="h-4 w-4" />
            </ComposerButton>
            <ComposerButton
              title="Respostas rapidas"
              disabled={!selectedConversation}
              onClick={() => {
                setQuickRepliesOpen((current) => !current);
                setEmojiOpen(false);
                closeTemplatesPanel();
              }}
            >
              <MessageSquareText aria-hidden="true" className="h-4 w-4" />
            </ComposerButton>

            {emojiOpen && (
              <div className="absolute bottom-14 left-12 z-20 grid max-w-[calc(100vw-2rem)] grid-cols-8 gap-1 rounded-2xl border border-line bg-white p-2 shadow-lift">
                {commonEmojis.map((emoji) => (
                  <button key={emoji} type="button" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-50" onClick={() => insertEmoji(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {quickRepliesOpen && (
              <div className="absolute bottom-14 left-2 z-30 w-[min(520px,calc(100vw-2rem))] min-w-0 rounded-2xl border border-line bg-white p-3 shadow-lift">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-slate-900">Respostas rapidas</p>
                    <p className="text-xs text-slate-500">Clique para inserir no campo e revisar antes de enviar.</p>
                  </div>
                  <button
                    type="button"
                    className="rounded-full px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100"
                    onClick={() => setQuickRepliesOpen(false)}
                  >
                    Fechar
                  </button>
                </div>
                <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                  {quickReplyTemplates.map((reply) => (
                    <button
                      key={reply.id}
                      type="button"
                      className="rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-200 hover:bg-blue-50"
                      onClick={() => insertQuickReply(reply.body)}
                    >
                      <span className="text-xs font-black text-slate-900">{reply.title}</span>
                      <span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-500">
                        {reply.body}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <textarea
              ref={inputRef}
              aria-label="Mensagem"
              className="max-h-32 min-h-10 w-full resize-none overflow-y-auto bg-transparent text-sm font-medium leading-5 text-slate-800 outline-none placeholder:text-slate-500 disabled:text-slate-400 disabled:placeholder:text-slate-400"
              disabled={!selectedConversation}
              placeholder="Digite uma mensagem..."
              rows={1}
              value={message}
              onChange={(event) => updateComposerMessage(event.target.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <button
              type="submit"
              aria-label={sendingMessage ? "Enviando mensagem" : "Enviar mensagem"}
              className="grid h-10 w-10 place-items-center rounded-full bg-brand text-white shadow-[0_8px_18px_rgba(37,99,235,0.25)] transition hover:bg-blue-700 active:scale-95 disabled:bg-slate-300 disabled:opacity-70 disabled:shadow-none"
              disabled={!selectedConversation || !message.trim() || sendingMessage}
            >
              {sendingMessage ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Send aria-hidden="true" className="h-4 w-4" />
              )}
            </button>
          </div>
        </form>
      </section>

      {mobileActionsOpen && selectedConversation && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="Fechar ações"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => setMobileActionsOpen(false)}
          />
          <section className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-[1.75rem] border border-line/80 bg-white shadow-lift">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
              <h3 className="text-base font-black text-slate-950">Ações</h3>
              <button
                type="button"
                aria-label="Fechar ações"
                className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                onClick={() => setMobileActionsOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {followUpSuccess && (
                <span className="inline-flex h-9 items-center rounded-full bg-emerald-50 px-3 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
                  {followUpSuccess}
                </span>
              )}
              <div className="grid gap-2">
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-3 text-sm font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
                  onClick={() => {
                    setMobileActionsOpen(false);
                    openScheduledReturns();
                  }}
                >
                  <Clock3 className="h-4 w-4" />
                  Retorno
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-3 text-sm font-semibold text-slate-600 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"
                  onClick={() => {
                    setMobileActionsOpen(false);
                    openFollowUp();
                  }}
                >
                  <CalendarClock className="h-4 w-4" />
                  Agendar
                </button>
                {!selectedConversation.agent && (
                  <button
                    type="button"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
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
                    className="inline-flex h-11 items-center justify-center rounded-2xl border border-line bg-white px-3 text-sm font-semibold text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
                    onClick={() => {
                      setMobileActionsOpen(false);
                      setUnassignOpen(true);
                    }}
                  >
                    Devolver
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-3 text-sm font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
                    onClick={() => {
                      setMobileActionsOpen(false);
                      setTransferOpen(true);
                    }}
                  >
                    <ArrowRight className="h-4 w-4" />
                    Transferir
                  </button>
                )}
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-3 text-sm font-semibold text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-brand"
                  onClick={() => {
                    setMobileActionsOpen(false);
                    openContactEdit();
                  }}
                >
                  <Edit3 className="h-4 w-4" />
                  Editar contato
                </button>
              </div>

              <div className="rounded-2xl border border-line/70 bg-slate-50/60 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Etapa
                </p>
                <select
                  className="h-10 w-full rounded-full border border-line bg-white px-3 text-sm font-medium text-slate-700 outline-none hover:bg-white focus:border-blue-200 focus:bg-white"
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

              <div className="rounded-2xl border border-line/70 bg-slate-50/60 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Tags
                </p>
                <ConversationTagSelector
                  availableTags={availableTags}
                  selectedTags={selectedConversation.tags}
                  onAdd={(tagIds) => onAddTags(selectedConversation.id, tagIds)}
                  onRemove={(tagId) => onRemoveTag(selectedConversation.id, tagId)}
                />
                {selectedConversation.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {selectedConversation.tags.map((tag) => (
                      <TagBadge
                        key={tag.id}
                        tag={tag}
                        onRemove={() => onRemoveTag(selectedConversation.id, tag.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {mobileDetailsOpen && selectedConversation && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="Fechar detalhes"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => setMobileDetailsOpen(false)}
          />
          <section className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-[1.75rem] border border-line/80 bg-white shadow-lift">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
              <h3 className="text-base font-black text-slate-950">Detalhes</h3>
              <button
                type="button"
                aria-label="Fechar detalhes"
                className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                onClick={() => setMobileDetailsOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {renderDetailsPanelContent({ allowCollapse: false })}
            </div>
          </section>
        </div>
      )}

      <section
        className={clsx(
          "hidden min-h-0 overflow-hidden transition-all duration-300 ease-out xl:block",
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
          renderDetailsPanelContent({ allowCollapse: true })
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
  const textColor = tag.textColor || "#ffffff";

  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center gap-1 rounded-full border font-bold shadow-sm ring-1 ring-black/5",
        compact
          ? "max-w-[8rem] shrink-0 px-2 py-0.5 text-[11px] leading-4"
          : "px-2.5 py-1 text-xs"
      )}
      style={{
        backgroundColor: tag.color,
        borderColor: tag.color,
        color: textColor,
        boxShadow: `0 6px 14px ${tag.color}26`
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
  iconOnly,
  availableTags,
  selectedTags,
  onAdd,
  onRemove
}: {
  iconOnly?: boolean;
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
        className={clsx(
          "inline-flex items-center rounded-full border border-line bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50",
          iconOnly
            ? "h-5 w-5 shrink-0 justify-center border-line/80 text-slate-700 shadow-sm hover:border-slate-300 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 2xl:h-8 2xl:w-8"
            : "h-10 gap-2 px-3"
        )}
        onClick={() => setOpen((current) => !current)}
        title="Tags"
        type="button"
      >
        <Tags className="h-4 w-4" />
        {!iconOnly && "Tags"}
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

  if (type === "button" || type === "interactive") {
    return {
      label: "Cliente respondeu botao",
      detail: cleanTimelineDetail(message.body),
      tone: "interaction" as TimelineEventTone
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
  isAiMessage,
  children
}: {
  side: "left" | "right";
  status?: string;
  readAt?: string | null;
  timestamp?: string;
  isAiMessage?: boolean;
  children: React.ReactNode;
}) {
  const rawStatus = status?.trim().toLowerCase();
  const normalizedStatus =
    rawStatus === undefined || rawStatus === ""
      ? "sent"
      : ["sending", "sent", "delivered", "read", "failed"].includes(rawStatus)
        ? rawStatus
        : "unavailable";
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
            : normalizedStatus === "unavailable"
              ? "Status indisponível"
              : "Enviada";
  const DeliveryIcon =
    normalizedStatus === "sending"
      ? Loader2
      : failed
        ? AlertTriangle
        : normalizedStatus === "sent"
          ? Check
          : normalizedStatus === "unavailable"
            ? Clock3
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
        {(timestamp || showDeliveryStatus) && (
          <div
            className={clsx(
              "mt-1 flex items-center gap-1 px-1 text-[11px] text-slate-400",
              side === "right" && "justify-end text-right"
            )}
          >
            {timestamp && <span>{timestamp}</span>}
            {isAiMessage && (
              <span
                aria-label="Mensagem enviada por IA"
                className="inline-flex items-center gap-1 font-semibold text-saffron"
                title="Mensagem enviada por IA"
              >
                <Sparkles className="h-3 w-3" />
                IA
              </span>
            )}
            {showDeliveryStatus && (
              <span
                className={clsx(
                  "inline-flex items-center gap-1 font-medium",
                  normalizedStatus === "read" && "text-sky-500",
                  normalizedStatus === "delivered" && "text-slate-500",
                  normalizedStatus === "unavailable" && "text-slate-400",
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

function cleanImageCaption(body: string) {
  return body
    .replace(/^\[Imagem recebida\]\s*/i, "")
    .replace(/^Imagem recebida\.?\s*/i, "")
    .trim();
}

function ImageMessage({
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
  const caption = cleanImageCaption(body);

  return (
    <div className="w-full max-w-[18rem] space-y-2 sm:max-w-sm">
      {sourceUrl && !failed ? (
        <a
          className="block overflow-hidden rounded-2xl border border-white/20 bg-slate-100"
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          <NextImage
            src={sourceUrl}
            alt={caption || "Imagem recebida"}
            width={640}
            height={640}
            loading="lazy"
            className="max-h-80 w-full object-contain"
            unoptimized
            onError={() => setFailed(true)}
          />
        </a>
      ) : (
        <div
          className={clsx(
            "rounded-2xl border px-3 py-2 text-sm",
            side === "right"
              ? "border-white/20 bg-white/10 text-white"
              : "border-slate-200 bg-white text-slate-700 shadow-sm"
          )}
        >
          Imagem recebida
        </div>
      )}

      {caption && (
        <p className={clsx("text-sm", side === "right" ? "text-white" : "text-slate-700")}>
          {caption}
        </p>
      )}

      {sourceUrl && failed && (
        <a
          className={clsx(
            "inline-flex rounded-full px-3 py-1.5 text-xs font-bold",
            side === "right"
              ? "bg-white/15 text-white hover:bg-white/20"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          )}
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Abrir imagem
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
  templateLanguage,
  templateVariables,
  side
}: {
  body: string;
  mediaUrl?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  templateVariables?: string | null;
  side: "left" | "right";
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = resolveTemplateImageForDisplay({ mediaUrl, templateName });
  const parsedVariables = parseTemplateVariablesForDisplay(templateVariables);
  const cleanBody = imageUrl
    ? body
        .replace(/\[Imagem no cabecalho\]\s*/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : body;

  return (
    <div className="space-y-3">
      <div
        className={clsx(
          "rounded-2xl px-3 py-2 text-xs",
          side === "right"
            ? "bg-white/15 text-white/90 ring-1 ring-white/20"
            : "bg-blue-50 text-slate-600 ring-1 ring-blue-100"
        )}
      >
        <p className={clsx("text-[13px] font-black", side === "right" ? "text-white" : "text-brand")}>
          {templateName ? `Template: ${templateName}` : "Template WhatsApp"}
        </p>
        {(templateLanguage || parsedVariables.length > 0) && (
          <div className="mt-1 space-y-0.5">
            {templateLanguage && <p>Idioma: {templateLanguage}</p>}
            {parsedVariables.length > 0 && (
              <p className="break-words">
                Variaveis: {parsedVariables.join(", ")}
              </p>
            )}
          </div>
        )}
      </div>
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

function parseTemplateVariablesForDisplay(value?: string | null) {
  if (!value?.trim()) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    const variables = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          "variables" in parsed &&
          Array.isArray((parsed as { variables?: unknown }).variables)
        ? (parsed as { variables: unknown[] }).variables
        : [];

    return variables
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
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
      aria-label={title}
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
        <div className="flex flex-col gap-4 border-b border-line/80 p-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h3 className="text-2xl font-bold tracking-tight text-slate-950">Contatos</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Gerencie leads, clientes e historico comercial em uma visao unificada.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="flex h-10 items-center gap-2 rounded-full border border-line/80 bg-white px-4 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-blue-100 hover:bg-blue-50/60 hover:text-brand"
              onClick={() => void handleExportContacts()}
            >
              <Download className="h-4 w-4" />
              Exportar
            </button>
            <button
              className="flex h-10 items-center gap-2 rounded-full border border-line/80 bg-white px-4 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-blue-100 hover:bg-blue-50/60 hover:text-brand"
              onClick={() => setShowImport((current) => !current)}
            >
              <Upload className="h-4 w-4" />
              Importar
            </button>
            <button
              className="flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-blue-700"
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

        <div className="grid gap-3 border-b border-line/80 bg-slate-50/50 p-5 [&_select]:rounded-full [&_select]:border-line/80 [&_select]:bg-white [&_select]:text-sm [&_select]:text-slate-600 [&_select]:shadow-sm [&_select]:transition [&_select]:hover:border-blue-100 [&_select]:hover:bg-white [&_select]:focus:border-blue-200 [&_select]:focus:shadow-soft lg:grid-cols-[1.4fr_150px_150px_150px_150px_130px_120px]">
          <div className="flex h-11 items-center gap-2 rounded-full border border-line/80 bg-white px-4 shadow-sm transition focus-within:border-blue-200 focus-within:shadow-soft">
            <Search className="h-4 w-4 text-brand" />
            <input
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
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
            className="h-10 rounded-full border border-line/80 bg-white px-3 text-sm text-slate-600 shadow-sm transition outline-none hover:border-blue-100 hover:bg-white focus:border-blue-200 focus:shadow-soft"
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
            className="h-10 rounded-full border border-line/80 bg-white px-3 text-sm text-slate-600 shadow-sm transition outline-none hover:border-blue-100 hover:bg-white focus:border-blue-200 focus:shadow-soft"
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
            <div className="m-5 rounded-2xl border border-dashed border-line bg-slate-50/70 p-8 text-center">
              <p className="text-sm font-semibold text-slate-700">Nenhum contato encontrado</p>
              <p className="mt-1 text-sm text-slate-500">
                Ajuste a busca ou os filtros para localizar contatos na base.
              </p>
            </div>
          )}
          {loading && (
            <div className="m-5 flex items-center justify-center gap-3 rounded-2xl border border-line bg-slate-50/70 p-8 text-sm font-medium text-slate-500">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand" />
              Carregando contatos da base comercial...
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
        <div className="rounded-2xl border border-dashed border-line bg-slate-50/70 p-5">
          <h3 className="font-bold text-slate-950">Ficha do cliente</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Selecione um contato na lista para visualizar historico, dados comerciais e proximas acoes.
          </p>
        </div>
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
                        "rounded-full border p-0.5 transition-colors",
                        active
                          ? "border-slate-300 bg-slate-50 ring-2 ring-slate-200"
                          : "border-transparent opacity-80 hover:bg-slate-50 hover:opacity-100"
                      )}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          tagIds: active
                            ? current.tagIds.filter((id) => id !== tag.id)
                            : [...current.tagIds, tag.id]
                        }))
                      }
                      type="button"
                    >
                      <TagBadge tag={tag} compact />
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
                <TagBadge key={tag.id} tag={tag} compact />
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

function createEmptyMulticredClientForm(): MulticredClientForm {
  return {
    contactId: "",
    name: "",
    cpf: "",
    rg: "",
    birthDate: "",
    motherName: "",
    maritalStatus: "",
    phone: "",
    whatsapp: "",
    email: "",
    zipCode: "",
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    state: "",
    bank: "",
    agency: "",
    account: "",
    accountType: "",
    pixKey: "",
    notes: ""
  };
}

function multicredClientToForm(client: MulticredClientRow): MulticredClientForm {
  return {
    contactId: client.contactId ?? "",
    name: client.name ?? "",
    cpf: client.cpf ?? "",
    rg: client.rg ?? "",
    birthDate: client.birthDate ? client.birthDate.slice(0, 10) : "",
    motherName: client.motherName ?? "",
    maritalStatus: client.maritalStatus ?? "",
    phone: client.phone ?? "",
    whatsapp: client.whatsapp ?? "",
    email: client.email ?? "",
    zipCode: client.zipCode ?? "",
    street: client.street ?? "",
    number: client.number ?? "",
    complement: client.complement ?? "",
    district: client.district ?? "",
    city: client.city ?? "",
    state: client.state ?? "",
    bank: client.bank ?? "",
    agency: client.agency ?? "",
    account: client.account ?? "",
    accountType: client.accountType ?? "",
    pixKey: client.pixKey ?? "",
    notes: client.notes ?? ""
  };
}

function QuickSelectGroup({
  label,
  options,
  value,
  otherValue,
  onChange,
  onOtherChange
}: {
  label: string;
  options: string[];
  value: string;
  otherValue: string;
  onChange: (value: string) => void;
  onOtherChange: (value: string) => void;
}) {
  const isOther = value === "Outros" || (value && !options.includes(value));

  return (
    <div>
      <p className="text-sm font-bold">{label}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            className={clsx(
              "rounded-full border px-3 py-2 text-sm font-semibold transition",
              (value === option || (option === "Outros" && isOther))
                ? "border-brand bg-blue-50 text-brand"
                : "border-line bg-white text-slate-600 hover:bg-slate-50"
            )}
            onClick={() => onChange(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
      {isOther && (
        <input
          className="mt-3 h-10 w-full rounded border border-line px-3 text-sm outline-none"
          placeholder="Digite manualmente"
          value={otherValue}
          onChange={(event) => onOtherChange(event.target.value)}
        />
      )}
    </div>
  );
}

function ProductQuickSelect({
  options,
  value,
  onChange
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const isKnown = options.includes(value);
  return (
    <QuickSelectGroup
      label="Produto"
      options={options}
      value={isKnown ? value : value ? "Outros" : ""}
      otherValue={isKnown ? "" : value}
      onChange={(next) => onChange(next === "Outros" ? "" : next)}
      onOtherChange={onChange}
    />
  );
}

function BankQuickSelect({
  options,
  value,
  onChange
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const isKnown = options.includes(value);
  return (
    <QuickSelectGroup
      label="Banco"
      options={options}
      value={isKnown ? value : value ? "Outros" : ""}
      otherValue={isKnown ? "" : value}
      onChange={(next) => onChange(next === "Outros" ? "" : next)}
      onOtherChange={onChange}
    />
  );
}

function Multicred({
  attendants,
  contacts,
  clients,
  clientsLoading,
  clientSearch,
  filters,
  loading,
  metrics,
  products,
  productsLoading,
  proposals,
  onClientSearchChange,
  onCreateClient,
  onCreateProduct,
  onCreateProposal,
  onDeleteProposal,
  onFiltersChange,
  onLoadClientDetail,
  onRefreshClients,
  onRefreshProducts,
  onUpdateClient,
  onUpdateProposal
}: {
  attendants: AttendantRow[];
  contacts: ContactRow[];
  clients: MulticredClientRow[];
  clientsLoading: boolean;
  clientSearch: string;
  filters: ProposalFilters;
  loading: boolean;
  metrics: ProposalMetrics;
  products: MulticredProductShortcut[];
  productsLoading: boolean;
  proposals: ProposalRow[];
  onClientSearchChange: (search: string) => void;
  onCreateClient: (payload: MulticredClientForm) => Promise<MulticredClientRow | null>;
  onCreateProduct: (payload: MulticredProductForm) => Promise<MulticredProductShortcut | null>;
  onCreateProposal: (payload: MulticredProposalPayload) => Promise<void>;
  onDeleteProposal: (id: string) => Promise<void>;
  onFiltersChange: (filters: ProposalFilters) => void;
  onLoadClientDetail: (id: string) => Promise<MulticredClientRow | null>;
  onRefreshClients: () => Promise<void>;
  onRefreshProducts: () => Promise<void>;
  onUpdateClient: (
    id: string,
    payload: MulticredClientForm
  ) => Promise<MulticredClientRow | null>;
  onUpdateProposal: (
    id: string,
    payload: Partial<{
      bank: string;
      multicredClientId?: string | null;
      assignedUserId?: string | null;
      agreement: string;
      product: string;
      operation: string;
      proposalNumber: string;
      contractNumber: string;
      amount: string;
      financedAmount: string;
      releasedAmount: string;
      installmentAmount: string;
      term: string;
      commission: string;
      commissionReceived: string;
      notes: string;
      status: ProposalStatus;
    }>
  ) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<"proposals" | "clients">("proposals");
  const [showForm, setShowForm] = useState(false);
  const [proposalStep, setProposalStep] = useState<1 | 2 | 3 | 4>(1);
  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<ProposalRow | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showClientForm, setShowClientForm] = useState(false);
  const [clientFormTab, setClientFormTab] = useState<
    "personal" | "address" | "bank" | "notes"
  >("personal");
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [selectedClientDetail, setSelectedClientDetail] =
    useState<MulticredClientRow | null>(null);
  const [clientDetailLoading, setClientDetailLoading] = useState(false);
  const [clientForm, setClientForm] = useState<MulticredClientForm>(
    createEmptyMulticredClientForm
  );
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
  const [form, setForm] = useState({
    contactId: "",
    multicredClientId: "",
    bank: "Banco Master",
    agreement: "FGTS",
    product: "Antecipacao FGTS",
    operation: "",
    proposalNumber: "",
    contractNumber: "",
    amount: "",
    financedAmount: "",
    releasedAmount: "",
    installmentAmount: "",
    term: "",
    commission: "",
    commissionReceived: "",
    notes: "",
    assignedUserId: "",
    status: "NEW" as ProposalStatus
  });
  const [editForm, setEditForm] = useState({
    multicredClientId: "",
    bank: "",
    agreement: "",
    product: "",
    operation: "",
    proposalNumber: "",
    contractNumber: "",
    amount: "",
    financedAmount: "",
    releasedAmount: "",
    installmentAmount: "",
    term: "",
    commission: "",
    commissionReceived: "",
    notes: "",
    assignedUserId: "",
    status: "NEW" as ProposalStatus
  });
  const [productForm, setProductForm] = useState<MulticredProductForm>({
    bankName: "",
    bankCode: "",
    bankColor: "blue",
    bankCategory: "",
    agreement: "",
    product: "",
    description: ""
  });
  const clientFormTabs = [
    { id: "personal", label: "Dados pessoais" },
    { id: "address", label: "Endereco" },
    { id: "bank", label: "Dados bancarios" },
    { id: "notes", label: "Observacoes" }
  ] as const;

  const selectedMulticredClient =
    clients.find((client) => client.id === form.multicredClientId) ?? null;
  const selectedContactId =
    form.contactId || selectedMulticredClient?.contactId || "";
  const visibleProducts = products.length > 0 ? products : fallbackMulticredProducts;
  const statusOptions = Object.entries(proposalStatusLabels) as Array<
    [ProposalStatus, string]
  >;
  const productColorOptions = ["blue", "emerald", "violet", "amber", "slate"] as const;
  const proposalSteps = [
    { id: 1, label: "Cliente" },
    { id: 2, label: "Produto" },
    { id: 3, label: "Banco" },
    { id: 4, label: "Dados" }
  ] as const;
  const quickProducts = [
    "FGTS",
    "CLT",
    "INSS",
    "Portabilidade",
    "Cartao",
    "Refin",
    "Saque",
    "Outros"
  ];
  const quickBanks = [
    "V8",
    "PAN",
    "C6",
    "BMG",
    "Mercantil",
    "Facta",
    "Caixa",
    "Daycoval",
    "Outros"
  ];
  const productFilters = ["FGTS", "CLT", "INSS", "Portabilidade", "Cartao", "Refin", "Saque"];
  const bankFilters = ["V8", "PAN", "C6", "BMG", "Mercantil", "Facta", "Caixa", "Daycoval"];
  const periodOptions = [
    ["today", "Hoje"],
    ["yesterday", "Ontem"],
    ["7d", "7 dias"],
    ["30d", "30 dias"],
    ["custom", "Personalizado"]
  ] as const;
  const stats = [
    {
      label: "Total de propostas",
      value: String(metrics.totalProposals ?? metrics.count),
      icon: FileText
    },
    {
      label: "Em analise",
      value: String(metrics.analysisCount ?? 0),
      icon: Clock3
    },
    {
      label: "Pendentes",
      value: String(metrics.pendingCount ?? 0),
      icon: AlertTriangle
    },
    {
      label: "Aprovadas",
      value: String(metrics.approvedCount ?? 0),
      icon: Check
    },
    {
      label: "Pagas",
      value: String(metrics.paidCount ?? 0),
      icon: CheckCheck
    },
    {
      label: "Comissao prevista",
      value: formatCurrency(metrics.commissionForecast),
      icon: Banknote
    },
    {
      label: "Comissao recebida",
      value: formatCurrency(metrics.commissionReceived ?? 0),
      icon: CircleDollarSign
    },
    {
      label: "Ticket medio",
      value: formatCurrency(metrics.ticketAverage),
      icon: TrendingUp
    }
  ];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedContactId && !form.multicredClientId) return;

    await onCreateProposal({
      ...form,
      contactId: selectedContactId || undefined,
      amount: form.releasedAmount || form.amount || form.financedAmount,
      commission: form.commission || "0"
    });
    setForm((current) => ({
      ...current,
      proposalNumber: "",
      contractNumber: "",
      amount: "",
      financedAmount: "",
      releasedAmount: "",
      installmentAmount: "",
      term: "",
      commission: "",
      commissionReceived: "",
      notes: "",
      multicredClientId: form.multicredClientId,
      contactId: selectedContactId,
      assignedUserId: form.assignedUserId
    }));
    setShowForm(false);
    setProposalStep(1);
  }

  function startEdit(proposal: ProposalRow) {
    setEditingProposalId(proposal.id);
    setEditForm({
      multicredClientId: proposal.multicredClientId ?? "",
      bank: proposal.bank,
      agreement: proposal.agreement,
      product: proposal.product,
      operation: proposal.operation ?? "",
      proposalNumber: proposal.proposalNumber ?? "",
      contractNumber: proposal.contractNumber ?? "",
      amount: proposal.amount,
      financedAmount: proposal.financedAmount ?? "",
      releasedAmount: proposal.releasedAmount ?? "",
      installmentAmount: proposal.installmentAmount ?? "",
      term: proposal.term ? String(proposal.term) : "",
      commission: proposal.commission,
      commissionReceived: proposal.commissionReceived ?? "",
      notes: proposal.notes ?? "",
      assignedUserId: proposal.assignedUserId ?? "",
      status: proposal.status
    });
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProposalId) return;

    await onUpdateProposal(editingProposalId, editForm);
    setEditingProposalId(null);
  }

  function updateClientForm(field: keyof MulticredClientForm, value: string) {
    setClientForm((current) => ({ ...current, [field]: value }));
  }

  function startNewClient() {
    setEditingClientId(null);
    setClientForm(createEmptyMulticredClientForm());
    setClientFormTab("personal");
    setShowClientForm(true);
  }

  function startEditClient(client: MulticredClientRow) {
    setEditingClientId(client.id);
    setClientForm(multicredClientToForm(client));
    setClientFormTab("personal");
    setShowClientForm(true);
  }

  async function handleClientSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const saved = editingClientId
      ? await onUpdateClient(editingClientId, clientForm)
      : await onCreateClient(clientForm);

    if (!saved) return;

    setShowClientForm(false);
    setEditingClientId(null);
    setClientForm(createEmptyMulticredClientForm());
    setSelectedClientDetail(saved);
    await onRefreshClients();
  }

  async function handleQuickClientSubmit() {
    const saved = await onCreateClient(clientForm);
    if (!saved) return;

    setForm((current) => ({
      ...current,
      multicredClientId: saved.id,
      contactId: saved.contactId ?? current.contactId
    }));
    setClientForm(createEmptyMulticredClientForm());
    setQuickClientOpen(false);
    await onRefreshClients();
  }

  async function openClientDetail(clientId: string) {
    setClientDetailLoading(true);
    const detail = await onLoadClientDetail(clientId);
    if (detail) setSelectedClientDetail(detail);
    setClientDetailLoading(false);
  }

  function applyBankShortcut(shortcut: MulticredProductShortcut) {
    setActiveTab("proposals");
    setShowForm(true);
    setForm((current) => ({
      ...current,
      bank: shortcut.bankName,
      agreement: shortcut.agreement,
      product: shortcut.product
    }));
  }

  async function handleProductSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await onCreateProduct(productForm);
    if (!saved) return;

    setProductForm({
      bankName: "",
      bankCode: "",
      bankColor: "blue",
      bankCategory: "",
      agreement: "",
      product: "",
      description: ""
    });
    setShowProductForm(false);
    await onRefreshProducts();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 rounded-full border border-line bg-white p-1 shadow-soft">
        <button
          className={clsx(
            "rounded-full px-4 py-2 text-sm font-semibold transition",
            activeTab === "proposals"
              ? "bg-brand text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-50"
          )}
          onClick={() => setActiveTab("proposals")}
          type="button"
        >
          Propostas
        </button>
        <button
          className={clsx(
            "rounded-full px-4 py-2 text-sm font-semibold transition",
            activeTab === "clients"
              ? "bg-brand text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-50"
          )}
          onClick={() => setActiveTab("clients")}
          type="button"
        >
          Clientes
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
      {activeTab === "clients" && (
        <section className="rounded border border-line bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-bold">Clientes Multicred</h3>
              <p className="text-sm text-slate-500">
                Cadastro completo para propostas, bancos e operacao interna.
              </p>
            </div>
            <button
              className="flex h-10 items-center gap-2 rounded bg-brand px-3 text-sm font-semibold text-white"
              onClick={startNewClient}
              type="button"
            >
              <Plus className="h-4 w-4" />
              Novo cliente
            </button>
          </div>

          <div className="mt-5 flex h-10 items-center gap-2 rounded border border-line px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              className="w-full bg-transparent text-sm outline-none"
              placeholder="Buscar por nome, CPF ou telefone"
              value={clientSearch}
              onChange={(event) => onClientSearchChange(event.target.value)}
            />
          </div>

          {showClientForm && (
            <form
              className="mt-5 rounded border border-line bg-slate-50 p-4"
              onSubmit={handleClientSubmit}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-bold">
                    {editingClientId ? "Editar cliente" : "Novo cliente"}
                  </p>
                  <p className="text-xs text-slate-500">
                    Preencha os dados por etapa para manter o cadastro organizado.
                  </p>
                </div>
                <button
                  className="flex h-9 items-center justify-center gap-2 rounded border border-line bg-white px-3 text-sm font-semibold"
                  onClick={() => {
                    setShowClientForm(false);
                    setEditingClientId(null);
                  }}
                  type="button"
                >
                  <X className="h-4 w-4" />
                  Fechar
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {clientFormTabs.map((tab) => (
                  <button
                    key={tab.id}
                    className={clsx(
                      "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                      clientFormTab === tab.id
                        ? "bg-brand text-white"
                        : "border border-line bg-white text-slate-600 hover:bg-slate-50"
                    )}
                    onClick={() => setClientFormTab(tab.id)}
                    type="button"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {clientFormTab === "personal" && (
                  <>
                    <ContactInput
                      placeholder="Nome"
                      required
                      value={clientForm.name}
                      onChange={(value) => updateClientForm("name", value)}
                    />
                    <ContactInput
                      placeholder="CPF"
                      required
                      value={clientForm.cpf}
                      onChange={(value) => updateClientForm("cpf", value)}
                    />
                    <ContactInput
                      placeholder="RG"
                      value={clientForm.rg}
                      onChange={(value) => updateClientForm("rg", value)}
                    />
                    <input
                      className="h-10 rounded border border-line px-3 outline-none"
                      type="date"
                      value={clientForm.birthDate}
                      onChange={(event) => updateClientForm("birthDate", event.target.value)}
                    />
                    <ContactInput
                      placeholder="Nome da mae"
                      value={clientForm.motherName}
                      onChange={(value) => updateClientForm("motherName", value)}
                    />
                    <ContactInput
                      placeholder="Estado civil"
                      value={clientForm.maritalStatus}
                      onChange={(value) => updateClientForm("maritalStatus", value)}
                    />
                    <ContactInput
                      placeholder="Telefone"
                      value={clientForm.phone}
                      onChange={(value) => updateClientForm("phone", value)}
                    />
                    <ContactInput
                      placeholder="WhatsApp"
                      value={clientForm.whatsapp}
                      onChange={(value) => updateClientForm("whatsapp", value)}
                    />
                    <ContactInput
                      placeholder="Email"
                      type="email"
                      value={clientForm.email}
                      onChange={(value) => updateClientForm("email", value)}
                    />
                  </>
                )}

                {clientFormTab === "address" && (
                  <>
                    <ContactInput
                      placeholder="CEP"
                      value={clientForm.zipCode}
                      onChange={(value) => updateClientForm("zipCode", value)}
                    />
                    <ContactInput
                      placeholder="Rua"
                      value={clientForm.street}
                      onChange={(value) => updateClientForm("street", value)}
                    />
                    <ContactInput
                      placeholder="Numero"
                      value={clientForm.number}
                      onChange={(value) => updateClientForm("number", value)}
                    />
                    <ContactInput
                      placeholder="Complemento"
                      value={clientForm.complement}
                      onChange={(value) => updateClientForm("complement", value)}
                    />
                    <ContactInput
                      placeholder="Bairro"
                      value={clientForm.district}
                      onChange={(value) => updateClientForm("district", value)}
                    />
                    <ContactInput
                      placeholder="Cidade"
                      value={clientForm.city}
                      onChange={(value) => updateClientForm("city", value)}
                    />
                    <ContactInput
                      placeholder="UF"
                      maxLength={2}
                      value={clientForm.state}
                      onChange={(value) => updateClientForm("state", value.toUpperCase())}
                    />
                  </>
                )}

                {clientFormTab === "bank" && (
                  <>
                    <ContactInput
                      placeholder="Banco"
                      value={clientForm.bank}
                      onChange={(value) => updateClientForm("bank", value)}
                    />
                    <ContactInput
                      placeholder="Agencia"
                      value={clientForm.agency}
                      onChange={(value) => updateClientForm("agency", value)}
                    />
                    <ContactInput
                      placeholder="Conta"
                      value={clientForm.account}
                      onChange={(value) => updateClientForm("account", value)}
                    />
                    <ContactInput
                      placeholder="Tipo de conta"
                      value={clientForm.accountType}
                      onChange={(value) => updateClientForm("accountType", value)}
                    />
                    <ContactInput
                      placeholder="Chave Pix"
                      value={clientForm.pixKey}
                      onChange={(value) => updateClientForm("pixKey", value)}
                    />
                  </>
                )}

                {clientFormTab === "notes" && (
                  <textarea
                    className="min-h-28 rounded border border-line px-3 py-2 text-sm outline-none md:col-span-3"
                    placeholder="Observacoes"
                    value={clientForm.notes}
                    onChange={(event) => updateClientForm("notes", event.target.value)}
                  />
                )}
              </div>

              <button className="mt-4 h-10 rounded bg-brand px-4 text-sm font-semibold text-white">
                {editingClientId ? "Salvar alteracoes" : "Criar cliente"}
              </button>
            </form>
          )}

          <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="overflow-hidden rounded border border-line">
              <div className="hidden grid-cols-[1.3fr_0.8fr_0.9fr_0.7fr] bg-slate-50 px-4 py-3 text-xs font-semibold uppercase text-slate-500 md:grid">
                <span>Cliente</span>
                <span>CPF</span>
                <span>Contato</span>
                <span>Acoes</span>
              </div>
              <div className="divide-y divide-line">
                {clients.map((client) => (
                  <div
                    key={client.id}
                    className={clsx(
                      "grid gap-3 px-4 py-4 text-sm md:grid-cols-[1.3fr_0.8fr_0.9fr_0.7fr]",
                      selectedClientDetail?.id === client.id && "bg-blue-50"
                    )}
                  >
                    <div>
                      <p className="font-semibold">{client.name}</p>
                      <p className="text-xs text-slate-500">
                        {client.city || client.state
                          ? `${client.city ?? ""}${client.city && client.state ? " / " : ""}${client.state ?? ""}`
                          : "Cliente Multicred"}
                      </p>
                    </div>
                    <p className="text-slate-700">{formatCpf(client.cpf)}</p>
                    <div>
                      <p>{client.whatsapp ?? client.phone ?? "-"}</p>
                      <p className="text-xs text-slate-500">{client.email ?? "Sem email"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="grid h-9 w-9 place-items-center rounded border border-line text-slate-600 hover:bg-slate-50"
                        onClick={() => void openClientDetail(client.id)}
                        title="Ver propostas"
                        type="button"
                      >
                        <FileText className="h-4 w-4" />
                      </button>
                      <button
                        className="grid h-9 w-9 place-items-center rounded border border-line text-slate-600 hover:bg-slate-50"
                        onClick={() => startEditClient(client)}
                        title="Editar cliente"
                        type="button"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {!clientsLoading && clients.length === 0 && (
                  <div className="p-6 text-sm text-slate-500">
                    Nenhum cliente Multicred encontrado.
                  </div>
                )}
                {clientsLoading && (
                  <div className="p-6 text-sm text-slate-500">
                    Carregando clientes Multicred...
                  </div>
                )}
              </div>
            </div>

            <aside className="rounded border border-line bg-slate-50 p-4">
              <h4 className="font-bold">Detalhes do cliente</h4>
              {!selectedClientDetail && (
                <p className="mt-3 text-sm text-slate-500">
                  Selecione um cliente para visualizar dados e propostas vinculadas.
                </p>
              )}
              {clientDetailLoading && (
                <p className="mt-3 text-sm text-slate-500">Carregando detalhes...</p>
              )}
              {selectedClientDetail && !clientDetailLoading && (
                <div className="mt-3 space-y-4 text-sm">
                  <div>
                    <p className="font-semibold">{selectedClientDetail.name}</p>
                    <p className="text-slate-500">
                      CPF {formatCpf(selectedClientDetail.cpf)} ·{" "}
                      {selectedClientDetail.whatsapp ?? selectedClientDetail.phone ?? "sem telefone"}
                    </p>
                  </div>
                  <div className="rounded border border-line bg-white p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">
                      Propostas vinculadas
                    </p>
                    <div className="mt-2 space-y-2">
                      {(selectedClientDetail.proposals ?? []).map((proposal) => (
                        <div key={proposal.id} className="rounded bg-slate-50 p-2">
                          <p className="font-semibold">{proposal.product}</p>
                          <p className="text-xs text-slate-500">
                            {proposal.bank} · {formatCurrency(proposal.amount)} ·{" "}
                            {proposalStatusLabels[proposal.status]}
                          </p>
                        </div>
                      ))}
                      {(!selectedClientDetail.proposals ||
                        selectedClientDetail.proposals.length === 0) && (
                        <p className="text-xs text-slate-500">
                          Nenhuma proposta vinculada ainda.
                        </p>
                      )}
                    </div>
                  </div>
                  {selectedClientDetail.notes && (
                    <div className="rounded border border-line bg-white p-3">
                      <p className="text-xs font-semibold uppercase text-slate-500">
                        Observacoes
                      </p>
                      <p className="mt-2 text-slate-700">{selectedClientDetail.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>
        </section>
      )}
      {activeTab === "proposals" && (
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
            onClick={() => {
              setProposalStep(1);
              setShowForm(true);
            }}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Nova proposta
          </button>
        </div>

        <div className="mt-5 rounded border border-line bg-slate-50 p-4">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-bold">Atalhos de bancos e produtos</p>
              <p className="text-xs text-slate-500">
                Cadastre bancos e produtos para preencher propostas rapidamente.
              </p>
            </div>
            <button
              className="flex h-9 items-center gap-2 rounded border border-line bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => setShowProductForm((current) => !current)}
              type="button"
            >
              <Plus className="h-3.5 w-3.5" />
              Novo atalho
            </button>
          </div>
          {showProductForm && (
            <form
              className="mt-4 grid gap-3 rounded border border-line bg-white p-3 md:grid-cols-4"
              onSubmit={handleProductSubmit}
            >
              <ContactInput
                placeholder="Banco"
                required
                value={productForm.bankName}
                onChange={(value) =>
                  setProductForm((current) => ({ ...current, bankName: value }))
                }
              />
              <ContactInput
                placeholder="Convenio"
                required
                value={productForm.agreement}
                onChange={(value) =>
                  setProductForm((current) => ({ ...current, agreement: value }))
                }
              />
              <ContactInput
                placeholder="Produto"
                required
                value={productForm.product}
                onChange={(value) =>
                  setProductForm((current) => ({ ...current, product: value }))
                }
              />
              <select
                className="h-10 rounded border border-line px-3 text-sm outline-none"
                value={productForm.bankColor}
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    bankColor: event.target.value
                  }))
                }
              >
                {productColorOptions.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
              <ContactInput
                placeholder="Codigo do banco"
                value={productForm.bankCode}
                onChange={(value) =>
                  setProductForm((current) => ({ ...current, bankCode: value }))
                }
              />
              <ContactInput
                placeholder="Categoria"
                value={productForm.bankCategory}
                onChange={(value) =>
                  setProductForm((current) => ({ ...current, bankCategory: value }))
                }
              />
              <ContactInput
                placeholder="Descricao curta"
                value={productForm.description}
                onChange={(value) =>
                  setProductForm((current) => ({ ...current, description: value }))
                }
              />
              <button className="h-10 rounded bg-brand px-3 text-sm font-semibold text-white">
                Salvar atalho
              </button>
            </form>
          )}
          <div className="mt-3 grid gap-2 md:grid-cols-5">
            {visibleProducts.map((shortcut) => (
              <button
                key={shortcut.id}
                className={clsx(
                  "rounded border bg-white p-3 text-left text-sm transition hover:-translate-y-0.5 hover:shadow-soft",
                  shortcut.bankColor === "blue" && "border-blue-100 hover:bg-blue-50",
                  shortcut.bankColor === "emerald" &&
                    "border-emerald-100 hover:bg-emerald-50",
                  shortcut.bankColor === "violet" &&
                    "border-violet-100 hover:bg-violet-50",
                  shortcut.bankColor === "amber" && "border-amber-100 hover:bg-amber-50",
                  shortcut.bankColor === "slate" && "border-slate-200 hover:bg-slate-50"
                )}
                onClick={() => applyBankShortcut(shortcut)}
                type="button"
              >
                <span className="block font-bold">{shortcut.bankName}</span>
                <span className="mt-1 block text-xs font-semibold text-brand">
                  {shortcut.agreement}
                </span>
                <span className="mt-2 block text-xs text-slate-500">
                  {shortcut.description ?? shortcut.product}
                </span>
              </button>
            ))}
            {productsLoading && (
              <div className="rounded border border-line bg-white p-3 text-sm text-slate-500">
                Carregando atalhos...
              </div>
            )}
          </div>
        </div>

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
            <form
              className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl"
              onSubmit={handleSubmit}
            >
              <div className="flex items-start justify-between border-b border-line p-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand">
                    Multicred
                  </p>
                  <h3 className="text-xl font-bold">Nova proposta</h3>
                  <p className="text-sm text-slate-500">
                    Cadastre a proposta em etapas e vincule ao cliente Multicred.
                  </p>
                </div>
                <button
                  className="grid h-9 w-9 place-items-center rounded-full border border-line text-slate-500 hover:bg-slate-50"
                  onClick={() => setShowForm(false)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="border-b border-line px-5 py-3">
                <div className="grid gap-2 md:grid-cols-4">
                  {proposalSteps.map((step) => (
                    <button
                      key={step.id}
                      className={clsx(
                        "rounded-full border px-3 py-2 text-sm font-semibold transition",
                        proposalStep === step.id
                          ? "border-brand bg-blue-50 text-brand"
                          : "border-line bg-white text-slate-500 hover:bg-slate-50"
                      )}
                      onClick={() => setProposalStep(step.id)}
                      type="button"
                    >
                      {step.id}. {step.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                {proposalStep === 1 && (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-bold">Cliente</p>
                        <p className="text-sm text-slate-500">
                          Busque por nome, CPF ou telefone e selecione o cliente.
                        </p>
                      </div>
                      <button
                        className="h-10 rounded border border-line px-3 text-sm font-semibold hover:bg-slate-50"
                        onClick={() => {
                          setClientForm(createEmptyMulticredClientForm());
                          setQuickClientOpen((current) => !current);
                        }}
                        type="button"
                      >
                        Cadastrar novo cliente
                      </button>
                    </div>

                    <label className="flex h-11 items-center gap-2 rounded border border-line px-3">
                      <Search className="h-4 w-4 text-slate-400" />
                      <input
                        className="w-full bg-transparent text-sm outline-none"
                        placeholder="Buscar cliente Multicred"
                        value={clientSearch}
                        onChange={(event) => onClientSearchChange(event.target.value)}
                      />
                    </label>

                    {quickClientOpen && (
                      <div className="rounded border border-blue-100 bg-blue-50 p-4">
                        <p className="text-sm font-bold">Cadastro rapido</p>
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <ContactInput
                            placeholder="Nome"
                            required
                            value={clientForm.name}
                            onChange={(value) => updateClientForm("name", value)}
                          />
                          <ContactInput
                            placeholder="CPF"
                            required
                            value={clientForm.cpf}
                            onChange={(value) => updateClientForm("cpf", value)}
                          />
                          <ContactInput
                            placeholder="WhatsApp"
                            required
                            value={clientForm.whatsapp}
                            onChange={(value) => updateClientForm("whatsapp", value)}
                          />
                        </div>
                        <button
                          className="mt-3 h-10 rounded bg-brand px-4 text-sm font-semibold text-white"
                          onClick={() => void handleQuickClientSubmit()}
                          type="button"
                        >
                          Salvar e selecionar
                        </button>
                      </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-2">
                      {clients.map((client) => (
                        <button
                          key={client.id}
                          className={clsx(
                            "rounded border p-4 text-left transition hover:bg-slate-50",
                            form.multicredClientId === client.id
                              ? "border-brand bg-blue-50"
                              : "border-line bg-white"
                          )}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              multicredClientId: client.id,
                              contactId: client.contactId ?? current.contactId
                            }))
                          }
                          type="button"
                        >
                          <p className="font-bold">{client.name}</p>
                          <p className="mt-1 text-sm text-slate-500">
                            CPF {formatCpf(client.cpf)} -{" "}
                            {client.whatsapp ?? client.phone ?? "sem telefone"}
                          </p>
                        </button>
                      ))}
                      {!clientsLoading && clients.length === 0 && (
                        <div className="rounded border border-dashed border-line p-4 text-sm text-slate-500 md:col-span-2">
                          Nenhum cliente encontrado. Cadastre rapidamente acima.
                        </div>
                      )}
                    </div>

                    <div className="rounded border border-line bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase text-slate-500">
                        Compatibilidade com contatos antigos
                      </p>
                      <select
                        className="mt-2 h-10 w-full rounded border border-line bg-white px-3 text-sm outline-none"
                        value={form.contactId}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, contactId: event.target.value }))
                        }
                      >
                        <option value="">Usar contato vinculado ao cliente</option>
                        {contacts.map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.name} - {contact.phone}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {proposalStep === 2 && (
                  <ProductQuickSelect
                    options={quickProducts}
                    value={form.agreement}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        agreement: value,
                        product: value || current.product,
                        operation: value || current.operation
                      }))
                    }
                  />
                )}

                {proposalStep === 3 && (
                  <BankQuickSelect
                    options={quickBanks}
                    value={form.bank}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, bank: value }))
                    }
                  />
                )}

                {proposalStep === 4 && (
                  <div className="grid gap-3 md:grid-cols-3">
                    <ContactInput
                      placeholder="Operacao"
                      value={form.operation}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, operation: value }))
                      }
                    />
                    <ContactInput
                      placeholder="Numero da proposta"
                      value={form.proposalNumber}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, proposalNumber: value }))
                      }
                    />
                    <ContactInput
                      placeholder="Numero do contrato"
                      value={form.contractNumber}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, contractNumber: value }))
                      }
                    />
                    <ContactInput
                      placeholder="Valor financiado"
                      value={form.financedAmount}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, financedAmount: value }))
                      }
                    />
                    <ContactInput
                      placeholder="Valor liberado"
                      value={form.releasedAmount}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          releasedAmount: value,
                          amount: value
                        }))
                      }
                    />
                    <ContactInput
                      placeholder="Valor parcela"
                      value={form.installmentAmount}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, installmentAmount: value }))
                      }
                    />
                    <ContactInput
                      placeholder="Prazo"
                      value={form.term}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, term: value }))
                      }
                    />
                    <ContactInput
                      placeholder="Comissao prevista"
                      value={form.commission}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, commission: value }))
                      }
                    />
                    <ContactInput
                      placeholder="Comissao recebida"
                      value={form.commissionReceived}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, commissionReceived: value }))
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
                    <select
                      className="h-10 rounded border border-line px-3 text-sm outline-none"
                      value={form.assignedUserId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          assignedUserId: event.target.value
                        }))
                      }
                    >
                      <option value="">Sem responsavel</option>
                      {attendants.map((attendant) => (
                        <option key={attendant.id} value={attendant.id}>
                          {attendant.name}
                        </option>
                      ))}
                    </select>
                    <textarea
                      className="min-h-24 rounded border border-line px-3 py-2 text-sm outline-none md:col-span-3"
                      placeholder="Observacoes"
                      value={form.notes}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, notes: event.target.value }))
                      }
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-line bg-slate-50 p-4">
                <button
                  className="h-10 rounded border border-line bg-white px-4 text-sm font-semibold disabled:opacity-40"
                  disabled={proposalStep === 1}
                  onClick={() =>
                    setProposalStep((current) => Math.max(1, current - 1) as 1 | 2 | 3 | 4)
                  }
                  type="button"
                >
                  Voltar
                </button>
                {proposalStep < 4 ? (
                  <button
                    className="h-10 rounded bg-brand px-4 text-sm font-semibold text-white"
                    onClick={() =>
                      setProposalStep((current) => Math.min(4, current + 1) as 1 | 2 | 3 | 4)
                    }
                    type="button"
                  >
                    Proximo
                  </button>
                ) : (
                  <button
                    className="h-10 rounded bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={!selectedContactId && !form.multicredClientId}
                  >
                    Salvar proposta
                  </button>
                )}
              </div>
            </form>
          </div>
        )}

        <div className="mt-5 rounded border border-line bg-slate-50 p-4">
          <div className="grid gap-3 xl:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <label className="flex h-10 items-center gap-2 rounded border border-line bg-white px-3">
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
              className="h-10 rounded border border-line bg-white px-3 text-sm outline-none"
              value={filters.period}
              onChange={(event) => onFiltersChange({ ...filters, period: event.target.value })}
            >
              {periodOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              className="h-10 rounded border border-line bg-white px-3 text-sm outline-none"
              value={filters.assignedUserId}
              onChange={(event) =>
                onFiltersChange({ ...filters, assignedUserId: event.target.value })
              }
            >
              <option value="">Todos os operadores</option>
              {attendants.map((attendant) => (
                <option key={attendant.id} value={attendant.id}>
                  {attendant.name}
                </option>
              ))}
            </select>
            <select
              className="h-10 rounded border border-line bg-white px-3 text-sm outline-none"
              value={`${filters.sort}:${filters.direction}`}
              onChange={(event) => {
                const [sort, direction] = event.target.value.split(":");
                onFiltersChange({ ...filters, sort, direction });
              }}
            >
              <option value="date:desc">Mais recentes</option>
              <option value="date:asc">Mais antigas</option>
              <option value="value:desc">Maior valor</option>
              <option value="value:asc">Menor valor</option>
              <option value="bank:asc">Banco A-Z</option>
              <option value="product:asc">Produto A-Z</option>
              <option value="status:asc">Status A-Z</option>
            </select>
          </div>

          {filters.period === "custom" && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <input
                className="h-10 rounded border border-line bg-white px-3 text-sm outline-none"
                type="date"
                value={filters.from}
                onChange={(event) => onFiltersChange({ ...filters, from: event.target.value })}
              />
              <input
                className="h-10 rounded border border-line bg-white px-3 text-sm outline-none"
                type="date"
                value={filters.to}
                onChange={(event) => onFiltersChange({ ...filters, to: event.target.value })}
              />
            </div>
          )}

          <div className="mt-4 space-y-3">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Status</p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={clsx(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold",
                    !filters.status ? "border-brand bg-blue-50 text-brand" : "border-line bg-white"
                  )}
                  onClick={() => onFiltersChange({ ...filters, status: "" })}
                  type="button"
                >
                  Todos
                </button>
                {statusOptions.map(([value, label]) => (
                  <button
                    key={value}
                    className={clsx(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold",
                      filters.status === value
                        ? "border-brand bg-blue-50 text-brand"
                        : "border-line bg-white text-slate-600"
                    )}
                    onClick={() => onFiltersChange({ ...filters, status: value })}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Produto</p>
              <div className="flex flex-wrap gap-2">
                {productFilters.map((product) => (
                  <button
                    key={product}
                    className={clsx(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold",
                      filters.product === product
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-line bg-white text-slate-600"
                    )}
                    onClick={() =>
                      onFiltersChange({
                        ...filters,
                        product: filters.product === product ? "" : product
                      })
                    }
                    type="button"
                  >
                    {product}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Banco</p>
              <div className="flex flex-wrap gap-2">
                {bankFilters.map((bank) => (
                  <button
                    key={bank}
                    className={clsx(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold",
                      filters.bank === bank
                        ? "border-violet-300 bg-violet-50 text-violet-700"
                        : "border-line bg-white text-slate-600"
                    )}
                    onClick={() =>
                      onFiltersChange({
                        ...filters,
                        bank: filters.bank === bank ? "" : bank
                      })
                    }
                    type="button"
                  >
                    {bank}
                  </button>
                ))}
              </div>
            </div>
          </div>
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
            <select
              className="h-10 rounded border border-line px-3 text-sm outline-none md:col-span-3"
              value={editForm.multicredClientId}
              onChange={(event) =>
                setEditForm((current) => ({
                  ...current,
                  multicredClientId: event.target.value
                }))
              }
            >
              <option value="">Sem cliente Multicred vinculado</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} - {formatCpf(client.cpf)}
                </option>
              ))}
            </select>
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
            <select
              className="h-10 rounded border border-line px-3 text-sm outline-none"
              value={editForm.assignedUserId}
              onChange={(event) =>
                setEditForm((current) => ({
                  ...current,
                  assignedUserId: event.target.value
                }))
              }
            >
              <option value="">Sem responsavel</option>
              {attendants.map((attendant) => (
                <option key={attendant.id} value={attendant.id}>
                  {attendant.name}
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

        <div className="mt-5 overflow-hidden rounded border border-line bg-white">
          <div className="hidden grid-cols-[1.4fr_1fr_0.9fr_0.9fr_0.8fr_0.9fr_0.9fr_0.7fr] bg-slate-50 px-4 py-3 text-xs font-semibold uppercase text-slate-500 xl:grid">
            <span>Cliente</span>
            <span>Produto</span>
            <span>Banco</span>
            <span>Valores</span>
            <span>Comissao</span>
            <span>Status</span>
            <span>Responsavel</span>
            <span>Acoes</span>
          </div>
          <div className="divide-y divide-line">
            {proposals.map((proposal) => (
              <div
                key={proposal.id}
                className={clsx(
                  "grid cursor-pointer gap-3 px-4 py-4 text-sm transition hover:bg-slate-50 xl:grid-cols-[1.4fr_1fr_0.9fr_0.9fr_0.8fr_0.9fr_0.9fr_0.7fr]",
                  editingProposalId === proposal.id && "bg-teal-50"
                )}
                onClick={() => setSelectedProposal(proposal)}
              >
                <div>
                  <p className="font-semibold">
                    {proposal.multicredClient?.name ?? proposal.contact.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {proposal.multicredClient
                      ? `${proposal.multicredClient.whatsapp ?? proposal.multicredClient.phone ?? proposal.contact.phone} - ${formatCpf(proposal.multicredClient.cpf)}`
                      : `${proposal.contact.phone} ${
                          proposal.contact.cpf ? `- ${proposal.contact.cpf}` : ""
                        }`}
                  </p>
                  {proposal.multicredClient && (
                    <p className="mt-1 text-xs text-slate-500">
                      Contato CRM: {proposal.contact.name}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    Criada {formatRelativeDate(proposal.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="font-medium">{proposal.product}</p>
                  <p className="text-xs text-slate-500">
                    {proposal.operation || proposal.agreement}
                  </p>
                  {proposal.proposalNumber && (
                    <p className="text-xs text-slate-500">Prop. {proposal.proposalNumber}</p>
                  )}
                </div>
                <div>
                  <p>{proposal.bank}</p>
                  {proposal.contractNumber && (
                    <p className="text-xs text-slate-500">Contrato {proposal.contractNumber}</p>
                  )}
                  <p className="text-xs text-slate-500">Prazo {proposal.term ?? "-"}x</p>
                </div>
                <div>
                  <p className="font-semibold">
                    {formatCurrency(proposal.releasedAmount ?? proposal.amount)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Parcela {proposal.installmentAmount ? formatCurrency(proposal.installmentAmount) : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">
                    Prev. {formatCurrency(proposal.commission)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Rec. {proposal.commissionReceived ? formatCurrency(proposal.commissionReceived) : "-"}
                  </p>
                </div>
                <select
                  className={clsx(
                    "h-9 rounded border px-2 text-xs font-semibold outline-none",
                    ["PAID", "APPROVED"].includes(proposal.status) &&
                      "border-emerald-200 bg-emerald-50 text-emerald-700",
                    ["FORMALIZING", "ANALYSIS", "TYPED"].includes(proposal.status) &&
                      "border-amber-200 bg-amber-50 text-amber-700",
                    proposal.status === "CANCELED" && "border-rose-200 bg-rose-50 text-rose-700",
                    ["REWORK", "PENDING", "REJECTED"].includes(proposal.status) &&
                      "border-orange-200 bg-orange-50 text-orange-700",
                    ["DRAFT", "NEW"].includes(proposal.status) &&
                      "border-line bg-white text-slate-700"
                  )}
                  value={proposal.status}
                  onChange={(event) =>
                    void onUpdateProposal(proposal.id, {
                      status: event.target.value as ProposalStatus
                    })
                  }
                  onClick={(event) => event.stopPropagation()}
                >
                  {statusOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 rounded border border-line bg-white px-2 text-xs font-semibold outline-none"
                  value={proposal.assignedUserId ?? ""}
                  onChange={(event) =>
                    void onUpdateProposal(proposal.id, {
                      assignedUserId: event.target.value || null
                    })
                  }
                  onClick={(event) => event.stopPropagation()}
                >
                  <option value="">Sem responsavel</option>
                  {attendants.map((attendant) => (
                    <option key={attendant.id} value={attendant.id}>
                      {attendant.name}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <button
                    className="grid h-9 w-9 place-items-center rounded border border-line text-slate-600 hover:bg-slate-50"
                    onClick={(event) => {
                      event.stopPropagation();
                      startEdit(proposal);
                    }}
                    title="Editar proposta"
                    type="button"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    className="grid h-9 w-9 place-items-center rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                    onClick={(event) => {
                      event.stopPropagation();
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
      )}
      {selectedProposal && (
        <div className="fixed inset-0 z-40 bg-slate-950/20" onClick={() => setSelectedProposal(null)}>
          <aside
            className="ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-line p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-brand">
                    Detalhe da proposta
                  </p>
                  <h3 className="mt-1 text-xl font-bold">
                    {selectedProposal.multicredClient?.name ?? selectedProposal.contact.name}
                  </h3>
                  <p className="text-sm text-slate-500">
                    CPF{" "}
                    {formatCpf(
                      selectedProposal.multicredClient?.cpf ??
                        selectedProposal.contact.cpf ??
                        ""
                    )}{" "}
                    - {selectedProposal.multicredClient?.whatsapp ??
                      selectedProposal.multicredClient?.phone ??
                      selectedProposal.contact.phone}
                  </p>
                </div>
                <button
                  className="grid h-10 w-10 place-items-center rounded-full border border-line text-slate-500 hover:bg-slate-50"
                  onClick={() => setSelectedProposal(null)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded border border-line p-4">
                  <p className="text-xs uppercase text-slate-500">Produto</p>
                  <p className="mt-1 font-bold">{selectedProposal.product}</p>
                  <p className="text-sm text-slate-500">
                    {selectedProposal.operation || selectedProposal.agreement}
                  </p>
                </div>
                <div className="rounded border border-line p-4">
                  <p className="text-xs uppercase text-slate-500">Banco</p>
                  <p className="mt-1 font-bold">{selectedProposal.bank}</p>
                  <p className="text-sm text-slate-500">
                    Contrato {selectedProposal.contractNumber ?? "-"}
                  </p>
                </div>
                <div className="rounded border border-line p-4">
                  <p className="text-xs uppercase text-slate-500">Valor liberado</p>
                  <p className="mt-1 font-bold">
                    {formatCurrency(selectedProposal.releasedAmount ?? selectedProposal.amount)}
                  </p>
                  <p className="text-sm text-slate-500">
                    Parcela{" "}
                    {selectedProposal.installmentAmount
                      ? formatCurrency(selectedProposal.installmentAmount)
                      : "-"}
                  </p>
                </div>
                <div className="rounded border border-line p-4">
                  <p className="text-xs uppercase text-slate-500">Status atual</p>
                  <p className="mt-1 font-bold">
                    {proposalStatusLabels[selectedProposal.status]}
                  </p>
                  <p className="text-sm text-slate-500">
                    Resp. {selectedProposal.assignedUser?.name ?? "Sem responsavel"}
                  </p>
                </div>
              </div>

              {selectedProposal.multicredClient && (
                <div className="rounded border border-line p-4">
                  <p className="font-bold">Dados bancarios do cliente</p>
                  <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                    <span>Banco: {selectedProposal.multicredClient.bank ?? "-"}</span>
                    <span>Agencia: {selectedProposal.multicredClient.agency ?? "-"}</span>
                    <span>Conta: {selectedProposal.multicredClient.account ?? "-"}</span>
                    <span>Pix: {selectedProposal.multicredClient.pixKey ?? "-"}</span>
                  </div>
                </div>
              )}

              <div className="rounded border border-line p-4">
                <p className="font-bold">Observacoes</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                  {selectedProposal.notes || "Nenhuma observacao registrada."}
                </p>
              </div>

              <div className="rounded border border-line p-4">
                <p className="font-bold">Historico da proposta</p>
                <div className="mt-4 space-y-4">
                  {(selectedProposal.history ?? []).length > 0 ? (
                    selectedProposal.history?.map((event) => (
                      <div key={event.id} className="border-l-2 border-brand pl-3">
                        <p className="text-xs text-slate-500">
                          {new Date(event.createdAt).toLocaleString("pt-BR")}
                          {event.user ? ` - ${event.user.name}` : ""}
                        </p>
                        <p className="font-semibold">{event.title}</p>
                        {event.detail && (
                          <p className="text-sm text-slate-600">{event.detail}</p>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">
                      Historico ainda nao registrado para esta proposta.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Canais({
  channels,
  channelStatus,
  messageLogs,
  messageLogFilters,
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
  const [isConnectChannelOpen, setIsConnectChannelOpen] = useState(false);
  const [areLogsOpen, setAreLogsOpen] = useState(false);
  const [areTechnicalToolsOpen, setAreTechnicalToolsOpen] = useState(false);
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

  function getPrimaryChannelWarning(item: ChannelStatusRow) {
    const priority = [
      "Canal inativo.",
      "Token ausente.",
      "Phone Number ID ausente.",
      "WABA ID ausente."
    ];

    return (
      priority.find((warning) => item.warnings.includes(warning)) ??
      (item.meta.error && item.warnings.includes(item.meta.error) ? item.meta.error : null) ??
      item.warnings.find((warning) => warning.includes("Meta")) ??
      item.warnings.find((warning) => warning.includes("Webhook sem assinatura")) ??
      item.warnings[0] ??
      ""
    );
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
                <h3 className="text-lg font-bold">Canais</h3>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Acompanhe canais conectados, status e pendencias de operacao.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-white shadow-sm hover:bg-brand-strong"
                onClick={() => setIsConnectChannelOpen(true)}
              >
                <Plus className="h-4 w-4" />
                Conectar canal
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                onClick={() => setAreLogsOpen((current) => !current)}
              >
                {areLogsOpen ? "Ocultar logs" : "Ver logs"}
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                onClick={() => setAreTechnicalToolsOpen((current) => !current)}
              >
                {areTechnicalToolsOpen ? "Ocultar ferramentas" : "Ferramentas tecnicas"}
              </button>
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
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
            <span className="rounded-full border border-line bg-slate-50 px-3 py-1">
              {channelStatus?.summary.total ?? channels.length} canal(is)
            </span>
            {Boolean(channelStatus?.summary.withWarnings) && (
              <span className="rounded-full border border-rose-100 bg-rose-50 px-3 py-1 text-rose-700">
                {channelStatus?.summary.withWarnings} com atencao
              </span>
            )}
          </div>

          <div className="mt-5 grid gap-3">
            {(channelStatus?.channels ?? []).map((item) => {
              const primaryWarning = getPrimaryChannelWarning(item);
              const mainStatusLabel = !item.checks.active
                ? "Inativo"
                : item.ready
                  ? "Operacional"
                  : "Atencao";
              const needsWebhookSubscription = primaryWarning.includes("Webhook sem assinatura");

              return (
                <div key={item.id} className="rounded-2xl border border-line bg-slate-50/70 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={clsx(
                            "h-2.5 w-2.5 rounded-full",
                            item.ready ? "bg-emerald-500" : "bg-rose-500"
                          )}
                        />
                        <p className="font-bold text-slate-950">{item.name}</p>
                        <span
                          className={clsx(
                            "rounded-full px-2 py-0.5 text-[11px] font-bold",
                            item.ready
                              ? "bg-emerald-50 text-emerald-700"
                              : item.checks.active
                                ? "bg-amber-50 text-amber-700"
                                : "bg-rose-50 text-rose-700"
                          )}
                        >
                          {mainStatusLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        {item.displayPhone ?? "Telefone nao informado"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.metrics.lastActivityAt
                          ? `Ultima atividade ${formatRelativeDate(item.metrics.lastActivityAt)}`
                          : "Sem atividade registrada"}
                      </p>
                      {primaryWarning && (
                        <p className="mt-2 inline-flex rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                          {primaryWarning}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      {item.provider === "meta" && needsWebhookSubscription ? (
                        <button
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-brand px-3 text-xs font-bold text-white hover:bg-brand-strong disabled:opacity-60"
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
                      ) : (
                        <button
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-brand px-3 text-xs font-bold text-white hover:bg-brand-strong"
                          onClick={() => setEditingChannel(findChannel(item.id))}
                          type="button"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Configurar
                        </button>
                      )}
                      {needsWebhookSubscription && (
                        <button
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-line bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                          onClick={() => setEditingChannel(findChannel(item.id))}
                          type="button"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Editar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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

        {areLogsOpen && (
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
        )}

      </div>

      {areTechnicalToolsOpen && (
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
      )}
      {isConnectChannelOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 py-6 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[1.5rem] border border-line bg-white shadow-soft">
            <div className="flex items-start justify-between gap-4 border-b border-line/70 p-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
                  Canais
                </p>
                <h3 className="mt-1 text-xl font-bold text-slate-950">Conectar canal</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Valide token, WABA e numero antes de ativar uma BM no CRM.
                </p>
              </div>
              <button
                aria-label="Fechar formulario de conexao"
                className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-slate-500 hover:bg-slate-50"
                onClick={() => setIsConnectChannelOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              <form className="grid gap-3 lg:grid-cols-2" onSubmit={handleCreate}>
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
            </div>

            <div className="flex justify-end border-t border-line/70 p-5">
              <button
                className="h-10 rounded-full border border-line bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                onClick={() => setIsConnectChannelOpen(false)}
                type="button"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
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

function templateParameterErrorMessage(error: unknown) {
  if (error instanceof TemplateParameterError) {
    if (error.code === "TEMPLATE_VARIABLE_MAPPING_INCOMPLETE") {
      return error.variableIndex
        ? `Variavel {{${error.variableIndex}}} sem coluna mapeada.`
        : "Mapeamento incompleto.";
    }
    if (error.code === "TEMPLATE_VARIABLE_COLUMN_NOT_FOUND") {
      return error.variableIndex
        ? `Coluna da variavel {{${error.variableIndex}}} nao encontrada.`
        : "Coluna mapeada nao encontrada.";
    }
    if (error.code === "TEMPLATE_VARIABLE_VALUE_EMPTY") {
      return error.variableIndex
        ? `Valor vazio para {{${error.variableIndex}}}.`
        : "Valor vazio em coluna mapeada.";
    }
    if (error.code === "TEMPLATE_VARIABLE_SEQUENCE_INVALID") {
      return "Variaveis numericas fora de sequencia.";
    }
  }

  return "Nao foi possivel resolver as variaveis desta linha.";
}

function summarizeTemplateImportValidation(
  rows: TemplateImportRowValidation[]
): TemplateImportValidationSummary {
  const reasonCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "INVALID") continue;
    for (const reason of row.reasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }

  return {
    totalRows: rows.length,
    readyRows: rows.filter((row) => row.status === "VALID").length,
    invalidRows: rows.filter((row) => row.status === "INVALID").length,
    reasons: Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 4),
    rows
  };
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
    templateVariableMapping?: TemplateVariableMappingV1;
    recipientTemplateVariables?: Array<{
      contactId: string;
      rowNumber: number;
      resolved: ResolvedTemplateVariablesV1;
    }>;
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
  const [templateColumnMapping, setTemplateColumnMapping] =
    useState<TemplateVariableMapping>({});
  const [templatePreviewRowNumber, setTemplatePreviewRowNumber] =
    useState<number | null>(null);
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
    setTemplateColumnMapping({});
    setTemplatePreviewRowNumber(null);

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
  const templateVariableIndexes = selectedCampaignTemplate
    ? Array.from(
        { length: selectedCampaignTemplate.variableCount },
        (_, index) => index + 1
      )
    : [];
  const hasTemplateColumnMapping =
    messageMode === "TEMPLATE" &&
    Boolean(selectedCampaignTemplate?.variableCount) &&
    Boolean(importPreview?.columns.length);
  const templateImportValidation = useMemo(() => {
    if (!selectedCampaignTemplate || !importPreview) return null;
    if (selectedCampaignTemplate.variableCount === 0) {
      return summarizeTemplateImportValidation(
        importPreview.rows.map((row) => ({
          row,
          status: row.status,
          reasons: row.status === "INVALID" ? row.errors : [],
          resolved:
            row.status === "VALID"
              ? {
                  version: 1,
                  body: []
                }
              : undefined,
          renderedBody:
            row.status === "VALID" ? selectedCampaignTemplate.preview : undefined
        }))
      );
    }

    return summarizeTemplateImportValidation(
      importPreview.rows.map((row) => {
        if (row.status === "INVALID") {
          return {
            row,
            status: "INVALID",
            reasons: row.errors.length ? row.errors : ["Linha invalida."]
          };
        }
        if (!row.rawValues) {
          return {
            row,
            status: "INVALID",
            reasons: ["Linha sem valores preservados da planilha."]
          };
        }

        try {
          const resolved = resolveTemplateColumnParameters({
            templateBody: selectedCampaignTemplate.preview,
            mapping: templateColumnMapping,
            columns: importPreview.columns,
            rawValues: row.rawValues
          });

          return {
            row,
            status: "VALID",
            reasons: [],
            resolved: {
              version: 1,
              body: resolved.variables
            },
            renderedBody: resolved.renderedBody
          };
        } catch (validationError) {
          return {
            row,
            status: "INVALID",
            reasons: [templateParameterErrorMessage(validationError)]
          };
        }
      })
    );
  }, [importPreview, selectedCampaignTemplate, templateColumnMapping]);
  const resolvedTemplatePreviewRows = useMemo(
    () => templateImportValidation?.rows.filter((row) => row.status === "VALID") ?? [],
    [templateImportValidation]
  );
  const templatePreviewRow = useMemo(
    () =>
      resolvedTemplatePreviewRows.find(
        (row) => row.row.rowNumber === templatePreviewRowNumber
      ) ??
      resolvedTemplatePreviewRows[0] ??
      null,
    [resolvedTemplatePreviewRows, templatePreviewRowNumber]
  );
  const selectedTemplateVariableMappingPayload =
    selectedCampaignTemplate &&
    hasTemplateColumnMapping &&
    templateVariableIndexes.every((index) => templateColumnMapping[String(index)])
      ? ({
          version: 1,
          mode: "COLUMN_MAPPING",
          body: templateColumnMapping,
          columns: importPreview?.columns ?? []
        } satisfies TemplateVariableMappingV1)
      : null;
  const recipientTemplateVariables = useMemo(() => {
    if (!selectedTemplateVariableMappingPayload || !importConfirm || !templateImportValidation) {
      return [];
    }

    const confirmedByRow = new Map(
      importConfirm.rows.map((row) => [row.rowNumber, row])
    );
    const recipients: Array<{
      contactId: string;
      rowNumber: number;
      resolved: ResolvedTemplateVariablesV1;
    }> = [];
    const seen = new Set<string>();

    for (const rowValidation of templateImportValidation.rows) {
      if (rowValidation.status !== "VALID" || !rowValidation.resolved) continue;

      const confirmed = confirmedByRow.get(rowValidation.row.rowNumber);
      if (!confirmed) continue;

      const stableKey = `${confirmed.contactId}:${confirmed.rowNumber}`;
      if (seen.has(stableKey)) continue;
      seen.add(stableKey);

      recipients.push({
        contactId: confirmed.contactId,
        rowNumber: confirmed.rowNumber,
        resolved: rowValidation.resolved
      });
    }

    return recipients;
  }, [importConfirm, selectedTemplateVariableMappingPayload, templateImportValidation]);

  useEffect(() => {
    const firstRowNumber = resolvedTemplatePreviewRows[0]?.row.rowNumber ?? null;
    if (!firstRowNumber) {
      setTemplatePreviewRowNumber(null);
      return;
    }
    setTemplatePreviewRowNumber((current) =>
      current && resolvedTemplatePreviewRows.some((row) => row.row.rowNumber === current)
        ? current
        : firstRowNumber
    );
  }, [resolvedTemplatePreviewRows]);

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
    if (
      messageMode === "TEMPLATE" &&
      selectedCampaignTemplate &&
      hasTemplateColumnMapping &&
      templatePreviewRow?.renderedBody
    ) {
      return templatePreviewRow.renderedBody;
    }

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
    setTemplateColumnMapping({});
    setTemplatePreviewRowNumber(null);

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

    const preview = (await response.json()) as SpreadsheetImportPreview;
    setImportPreview(preview);
    setTemplatePreviewRowNumber(
      preview.rows.find((row) => row.status === "VALID")?.rowNumber ?? null
    );
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
        | { error?: string; message?: string }
        | null;
      setError(
        data?.message ?? data?.error ?? "Nao foi possivel confirmar a importacao."
      );
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

  async function downloadImportTemplate() {
    const XLSX = await import("xlsx");
    const contactsRows = [
      ["CPF", "Nome", "Telefone", "Valor Liberado", "Data Concessao", "Beneficio", "Cidade", "Estado"],
      ["12345678900", "Maria Silva", "5533999999999", "350,00", "01/04/2026", "Aposentadoria", "Governador Valadares", "MG"],
      ["98765432100", "Joao Pereira", "5533998888776", "50,00", "15/06/2026", "Pensao", "Caratinga", "MG"]
    ];
    const instructionsRows = [
      ["Como usar variaveis nos disparos"],
      [""],
      ["1. CPF, Nome e Telefone sao obrigatorios."],
      ["2. Voce pode adicionar quantas colunas extras precisar."],
      ["3. Cada coluna extra pode ser usada como variavel do template."],
      ["4. Na tela de Disparos, apos escolher o template, faca o mapeamento entre a variavel e a coluna."],
      [""],
      ["Exemplo"],
      ["Template:"],
      ["Ola {{1}}, tudo bem?"],
      ["Verificamos que hoje voce possui R$ {{2}} disponivel para antecipacao do seu FGTS."],
      [""],
      ["Mapeamento:"],
      ["{{1}} -> Nome"],
      ["{{2}} -> Valor Liberado"],
      [""],
      ["Resultado:"],
      ["Ola Maria Silva, tudo bem?"],
      ["Verificamos que hoje voce possui R$ 350,00 disponivel para antecipacao do seu FGTS."],
      [""],
      ["Avisos"],
      ["- Nao coloque R$ na coluna Valor Liberado se o template ja contem R$."],
      ["- Nao altere os nomes de CPF, Nome e Telefone."],
      ["- Colunas extras podem ter qualquer nome."],
      ["- Linhas com variavel vazia podem ser consideradas invalidas no disparo."],
      ["- Use somente numeros autorizados para testes."]
    ];
    const workbook = XLSX.utils.book_new();
    const contactsSheet = XLSX.utils.aoa_to_sheet(contactsRows);
    contactsSheet["!cols"] = [
      { wch: 14 },
      { wch: 20 },
      { wch: 18 },
      { wch: 16 },
      { wch: 16 },
      { wch: 18 },
      { wch: 22 },
      { wch: 10 }
    ];
    contactsSheet["!autofilter"] = { ref: "A1:H3" };
    const instructionsSheet = XLSX.utils.aoa_to_sheet(instructionsRows);
    instructionsSheet["!cols"] = [{ wch: 100 }];
    XLSX.utils.book_append_sheet(workbook, contactsSheet, "Contatos");
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, "Como usar");
    const workbookBytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const url = URL.createObjectURL(
      new Blob([workbookBytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "modelo-importacao-contatos.xlsx";
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
    const effectiveContactIds =
      hasTemplateColumnMapping && recipientTemplateVariables.length
        ? recipientTemplateVariables.map((recipient) => recipient.contactId)
        : selectedIds;

    if (!channelId) {
      setError("Selecione um canal WhatsApp Meta ativo.");
      return;
    }
    if (!effectiveContactIds.length) {
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
      if (hasTemplateColumnMapping) {
        if (!selectedTemplateVariableMappingPayload) {
          setError("Mapeie todas as variaveis do template antes de continuar.");
          return;
        }
        if (!templateImportValidation?.readyRows) {
          setError("Nenhuma linha valida possui todos os valores exigidos pelo template.");
          return;
        }
        if (!importConfirm) {
          setError("Confirme a importacao da planilha antes de criar a campanha.");
          return;
        }
        if (!recipientTemplateVariables.length) {
          setError("Nenhum contato confirmado possui variaveis resolvidas para envio.");
          return;
        }
      } else if (
        campaignTemplateValues.length < selectedCampaignTemplate.variableCount ||
        campaignTemplateValues.some((value) => !value.trim())
      ) {
        setError("Preencha todas as variaveis obrigatorias do template.");
        return;
      }
    }

    const confirmed = window.confirm(
      `Enviar disparo para ${effectiveContactIds.length} contato(s)?`
    );
    if (!confirmed) return;

    setSending(true);
    const campaign = await onCreateCampaign({
      channelId,
      contactIds: effectiveContactIds,
      message: messageMode === "TEMPLATE" ? renderMessagePreview() : message,
      image: messageMode === "TEMPLATE" ? null : image,
      messageType: messageMode,
      templateName: selectedCampaignTemplate?.name,
      templateLanguage: selectedCampaignTemplate?.language,
      templateVariables: campaignTemplateValues,
      templateVariableMapping: selectedTemplateVariableMappingPayload ?? undefined,
      recipientTemplateVariables:
        recipientTemplateVariables.length > 0 ? recipientTemplateVariables : undefined
    });
    setSending(false);

    if (campaign) {
      setLastCampaign(campaign);
      setSelectedIds([]);
      setMessage("");
      setImage(null);
      setSelectedCampaignTemplate(null);
      setCampaignTemplateValues([]);
      setImportFile(null);
      setImportPreview(null);
      setImportConfirm(null);
      setTemplateColumnMapping({});
      setTemplatePreviewRowNumber(null);
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
                Aceita CSV ou Excel .xlsx. CPF, Nome e Telefone sao obrigatorios.
                Colunas extras podem ser usadas como variaveis do template.
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
                    setTemplateColumnMapping({});
                    setTemplatePreviewRowNumber(null);
                  }}
                />
              </label>
              {importFile && (
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-blue-200 bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm"
                  type="button"
                  onClick={() => {
                    setImportFile(null);
                    setImportPreview(null);
                    setImportConfirm(null);
                    setTemplateColumnMapping({});
                    setTemplatePreviewRowNumber(null);
                  }}
                >
                  <X className="h-4 w-4" />
                  Remover
                </button>
              )}
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
                      {importPreview.rows.slice(0, 80).map((row) => {
                        const conflictError = row.errors.find((error) =>
                          error.toLowerCase().includes("contatos diferentes")
                        );

                        return (
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
                                  {conflictError ? `Conflito: ${conflictError}` : row.errors[0]}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
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
              {selectedTemplateVariableMappingPayload && (
                <div className="mt-2 rounded-lg bg-white/70 p-2 text-xs">
                  Campanha com variaveis por coluna:{" "}
                  <b>{recipientTemplateVariables.length}</b> destinatario(s) pronto(s)
                  para envio
                  {templateImportValidation
                    ? ` e ${Math.max(
                        templateImportValidation.totalRows -
                          recipientTemplateVariables.length,
                        0
                      )} linha(s) fora do envio.`
                    : "."}
                </div>
              )}
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
                        setTemplateColumnMapping({});
                        setTemplatePreviewRowNumber(null);
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
                      {campaignTemplateValues.length > 0 && !hasTemplateColumnMapping && (
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
                      {selectedCampaignTemplate.variableCount > 0 &&
                        importPreview?.columns.length ? (
                          <div className="mt-4 rounded-xl border border-blue-100 bg-white p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold text-slate-900">
                                  Mapeamento das variaveis
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  Escolha quais colunas da planilha alimentam cada
                                  variavel numerica do template.
                                </p>
                              </div>
                              {templateImportValidation && (
                                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                  <span className="rounded-lg bg-slate-50 px-2 py-1.5">
                                    <b className="block text-slate-900">
                                      {templateImportValidation.totalRows}
                                    </b>
                                    total
                                  </span>
                                  <span className="rounded-lg bg-emerald-50 px-2 py-1.5 text-emerald-700">
                                    <b className="block">
                                      {templateImportValidation.readyRows}
                                    </b>
                                    prontas
                                  </span>
                                  <span className="rounded-lg bg-rose-50 px-2 py-1.5 text-rose-700">
                                    <b className="block">
                                      {templateImportValidation.invalidRows}
                                    </b>
                                    invalidas
                                  </span>
                                </div>
                              )}
                            </div>

                            <div className="mt-3 grid gap-2">
                              {templateVariableIndexes.map((variableIndex) => (
                                <label
                                  key={variableIndex}
                                  className="grid gap-2 text-xs font-bold text-slate-600 sm:grid-cols-[70px_minmax(0,1fr)] sm:items-center"
                                >
                                  <span>{`{{${variableIndex}}}`}</span>
                                  <select
                                    className="h-10 rounded border border-line bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-brand"
                                    value={templateColumnMapping[String(variableIndex)] ?? ""}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setTemplateColumnMapping((current) => ({
                                        ...current,
                                        [String(variableIndex)]: value
                                      }));
                                      setTemplatePreviewRowNumber(null);
                                    }}
                                  >
                                    <option value="">Selecionar coluna</option>
                                    {importPreview.columns.map((column) => (
                                      <option key={column.key} value={column.key}>
                                        {column.label || "Coluna sem nome"} - coluna{" "}
                                        {column.index + 1}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ))}
                            </div>

                            {templateImportValidation?.reasons.length ? (
                              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                                <p className="font-bold">Principais motivos</p>
                                <ul className="mt-1 space-y-1">
                                  {templateImportValidation.reasons.map((item) => (
                                    <li key={item.reason}>
                                      {item.count} linha(s): {item.reason}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {templatePreviewRow ? (
                              <div className="mt-3 rounded-lg border border-line bg-slate-50 p-3 text-xs text-slate-600">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="font-bold uppercase text-slate-500">
                                    Preview por coluna
                                  </p>
                                  {resolvedTemplatePreviewRows.length > 1 && (
                                    <select
                                      className="h-8 rounded border border-line bg-white px-2 text-xs outline-none focus:border-brand"
                                      value={templatePreviewRow.row.rowNumber}
                                      onChange={(event) =>
                                        setTemplatePreviewRowNumber(Number(event.target.value))
                                      }
                                    >
                                      {resolvedTemplatePreviewRows.slice(0, 20).map((item) => (
                                        <option
                                          key={item.row.rowNumber}
                                          value={item.row.rowNumber}
                                        >
                                          Linha {item.row.rowNumber} -{" "}
                                          {item.row.name || item.row.whatsapp}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                                <div className="mt-3 grid gap-3">
                                  <div>
                                    <p className="font-bold text-slate-700">Template</p>
                                    <p className="mt-1 whitespace-pre-wrap">
                                      {selectedCampaignTemplate.preview}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-bold text-slate-700">Mapeamento</p>
                                    <div className="mt-1 flex flex-wrap gap-2">
                                      {templateVariableIndexes.map((variableIndex) => {
                                        const column = importPreview.columns.find(
                                          (item) =>
                                            item.key ===
                                            templateColumnMapping[String(variableIndex)]
                                        );
                                        return (
                                          <span
                                            key={variableIndex}
                                            className="rounded-full bg-white px-2 py-1"
                                          >
                                            {`{{${variableIndex}}}`} -{" "}
                                            {column
                                              ? `${column.label || "Coluna sem nome"} (coluna ${
                                                  column.index + 1
                                                })`
                                              : "nao mapeada"}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <div>
                                    <p className="font-bold text-slate-700">
                                      Linha {templatePreviewRow.row.rowNumber}
                                    </p>
                                    <p className="mt-1 truncate">
                                      {templatePreviewRow.resolved?.body.join(" | ") || "-"}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-bold text-slate-700">Preview</p>
                                    <p className="mt-1 whitespace-pre-wrap rounded bg-white p-2 text-slate-800">
                                      {templatePreviewRow.renderedBody}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                                Complete o mapeamento e garanta que ao menos uma linha
                                possua todos os valores exigidos para gerar o preview.
                              </div>
                            )}
                          </div>
                        ) : null}
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
