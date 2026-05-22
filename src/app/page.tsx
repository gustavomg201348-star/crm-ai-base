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
  Banknote,
  Bell,
  Check,
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
  Paperclip,
  Plus,
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
    role: string;
  };
  company: {
    id: string;
    name: string;
    segment?: string | null;
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
  unreadCount: number;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  lastInboundMessageAt?: string | null;
  lastReadAt?: string | null;
  createdAt: string;
  updatedAt: string;
  agent: { id: string; name: string; email: string } | null;
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
  createdAt: string;
  updatedAt: string;
};

type AiAnalysis = {
  summary: string;
  temperature: ContactRow["temperature"];
  nextAction: string;
  suggestedReply: string;
  confidence: number;
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

function formatCurrency(value: number | string) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
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
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboardData);
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationRow | null>(null);
  const selectedConversationRef = useRef<string | null>(null);
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
    phone: ""
  });
  const [desktopPermission, setDesktopPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [conversationFilters, setConversationFilters] = useState({
    search: "",
    status: "OPEN",
    tagIds: [] as string[]
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
  const [tagsLoading, setTagsLoading] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [kanbanLoading, setKanbanLoading] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [appError, setAppError] = useState("");

  useEffect(() => {
    selectedConversationRef.current = selectedConversation?.id ?? null;
  }, [selectedConversation?.id]);

  const pageTitle = useMemo(() => {
    return navItems.find((item) => item.id === active)?.label ?? "Dashboard";
  }, [active]);

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

        if (value) params.set(key, value);
      });

      const response = await fetch(`/api/conversations?${params.toString()}`);
      if (response.ok) {
        const data = (await response.json()) as {
          conversations: ConversationRow[];
        };
        setConversationList(data.conversations);
        setSelectedConversation((current) => {
          if (!current) return null;
          return data.conversations.find((conversation) => conversation.id === current.id) ?? null;
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

  const mergeConversation = useCallback((conversation: ConversationRow) => {
    setSelectedConversation((current) =>
      current?.id === conversation.id ? conversation : current
    );
    setConversationList((current) => {
      const exists = current.some((item) => item.id === conversation.id);
      const next = exists
        ? current.map((item) => (item.id === conversation.id ? conversation : item))
        : [conversation, ...current];

      return [...next].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    });
  }, []);

  const refreshConversation = useCallback(
    async (conversationId?: string | null) => {
      const id = conversationId ?? selectedConversationRef.current;
      if (!id) return null;

      const response = await fetch(`/api/conversations/${id}`);
      if (!response.ok) return null;

      const data = (await response.json()) as { conversation: ConversationRow };
      mergeConversation(data.conversation);
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
      mergeConversation(data.conversation);
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
        setSelectedConversation(data.conversation);
        setConversationList((current) => {
          const exists = current.some((conversation) => conversation.id === data.conversation.id);
          return exists
            ? current.map((conversation) =>
                conversation.id === data.conversation.id ? data.conversation : conversation
              )
            : [data.conversation, ...current];
        });
        await markConversationRead(conversationId);
        await markNotificationsRead({ conversationId });
      }
    },
    [markConversationRead, markNotificationsRead]
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

  async function handleStartNewConversation() {
    const selectedContact = contacts.find(
      (contact) => contact.id === newConversationForm.contactId
    );
    const payload = selectedContact
      ? { contactId: selectedContact.id, status: "OPEN" }
      : {
          name: newConversationForm.name.trim(),
          phone: newConversationForm.phone.trim(),
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
    setConversationFilters({ search: "", status: "OPEN", tagIds: [] });
    setSelectedConversation(data.conversation);
    mergeConversation(data.conversation);
    setNewConversationOpen(false);
    setNewConversationForm({ search: "", contactId: "", name: "", phone: "" });
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

  async function handleCreateCampaign(payload: {
    channelId: string;
    contactIds: string[];
    message: string;
    image?: File | null;
  }) {
    const formData = new FormData();
    formData.set("channelId", payload.channelId);
    formData.set("message", payload.message);
    formData.set("contactIds", JSON.stringify(payload.contactIds));
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
    setSelectedConversation(data.conversation);
    setConversationList((current) =>
      current.map((conversation) =>
        conversation.id === data.conversation.id ? data.conversation : conversation
      )
    );
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
        createdAt: now
      },
      messages: [
        ...conversation.messages,
        {
          id: `optimistic-${now}`,
          direction: "outbound",
          body: messageBody,
          createdAt: now
        }
      ]
    };

    mergeConversation(optimisticConversation);

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
    mergeConversation(data.conversation);
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
    mergeConversation(data.conversation);
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
    mergeConversation(data.conversation);
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
    mergeConversation(data.conversation);
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
    mergeConversation(data.conversation);
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
    setSelectedConversation(data.conversation);
    setConversationList((current) =>
      current.map((conversation) =>
        conversation.id === data.conversation.id ? data.conversation : conversation
      )
    );
    setAiLoading(false);
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
    setSelectedConversation(data.conversation);
    setConversationFilters({ search: "", status: "OPEN", tagIds: [] });
    await loadConversations({ search: "", status: "OPEN", tagIds: [] });
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

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    if (!session) return;

    void loadContacts(contactFilters);
    void loadSettingsTags();
    void loadReference();
    void loadKanban();
    void loadChannels();
    void loadCampaigns();
    void loadConversations(conversationFilters);
    void loadNotifications({ silent: true });
    void loadProposals(proposalFilters);
  }, [
    contactFilters,
    conversationFilters,
    loadContacts,
    loadSettingsTags,
    loadConversations,
    loadNotifications,
    loadProposals,
    proposalFilters,
    session
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDesktopPermission(
      "Notification" in window ? window.Notification.permission : "unsupported"
    );
  }, []);

  useEffect(() => {
    if (!session) return;

    void loadDashboard(dashboardFilters);
  }, [dashboardFilters, loadDashboard, session]);

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
    <main className="min-h-screen bg-paper text-ink">
      <aside className="fixed left-0 top-0 hidden h-screen w-[264px] border-r border-line/80 bg-white/95 backdrop-blur xl:block">
        <div className="flex h-20 items-center gap-3 px-5">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand text-sm font-bold text-white shadow-soft">
            AI
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
              CRM
            </p>
            <h1 className="truncate text-[15px] font-bold text-slate-950">
              Operacao Inteligente
            </h1>
          </div>
        </div>

        <div className="mx-4 rounded-2xl border border-line/80 bg-slate-50/80 p-3">
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

        <nav className="mt-5 space-y-1 px-3">
          <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Navegacao
          </p>
          {navItems.map((item) => {
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
                  "group flex h-10 w-full items-center justify-between rounded-xl px-3 text-left text-sm font-medium",
                  active === item.id
                    ? "bg-blue-50 text-brand shadow-[inset_0_0_0_1px_rgba(37,99,235,0.10)]"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
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
        </nav>

        <div className="absolute bottom-0 left-0 right-0 space-y-3 border-t border-line/70 p-4">
          <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-white p-3 ring-1 ring-blue-100">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand" />
              <p className="text-xs font-bold uppercase tracking-wide text-brand">
                IA ativa
              </p>
            </div>
            <p className="mt-2 text-sm leading-5 text-slate-600">
              Correspondente bancario com foco em FGTS, CLT e INSS.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl p-2 hover:bg-slate-50">
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

      <section className="xl:pl-[264px]">
        <header className="sticky top-0 z-10 flex min-h-20 items-center justify-between border-b border-line/70 bg-white/90 px-4 backdrop-blur-xl md:px-8">
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

        <div className="p-4 md:p-8">
          {appError && (
            <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
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
            <Atendimento
              conversations={conversationList}
              filters={conversationFilters}
              availableTags={reference.tags}
              loading={conversationLoading}
              selectedConversation={selectedConversation}
              onFiltersChange={setConversationFilters}
              onSelectConversation={(conversation) => void handleSelectConversation(conversation)}
              onSendMessage={handleSendMessage}
              onSendMedia={handleSendMedia}
              onLoadTemplates={handleLoadTemplates}
              onSendTemplate={handleSendTemplate}
              onUpdateStatus={handleConversationStatus}
              aiAnalysis={aiAnalysis}
              aiLoading={aiLoading}
              onAnalyzeConversation={handleAnalyzeConversation}
              onAddTags={handleAddConversationTags}
              onRemoveTag={handleRemoveConversationTag}
            />
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
          {active === "multicred" && (
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
          {active === "canais" && (
            <Canais
              channels={channels}
              loading={channelsLoading}
              onCreateChannel={handleCreateChannel}
              onSimulateInbound={handleSimulateInboundMessage}
            />
          )}
          {active === "disparos" && (
            <Disparos
              campaigns={campaigns}
              channels={channels}
              contacts={contacts}
              loading={campaignsLoading}
              onCreateCampaign={handleCreateCampaign}
            />
          )}
          {active === "chatbot" && <Chatbot />}
          {active === "tags" && (
            <TagsSettingsPage
              tags={settingsTags}
              loading={tagsLoading}
              onCreateTag={handleCreateTag}
              onUpdateTag={handleUpdateTag}
              onDeleteTag={handleDeleteTag}
            />
          )}
          {active === "config" && (
            <Configuracoes
              reference={reference}
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
  form: { search: string; contactId: string; name: string; phone: string };
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (form: { search: string; contactId: string; name: string; phone: string }) => void;
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
                        phone: selected ? form.phone : contact.phone
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
                        {contact.phone} - {contact.origin}
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

          <div className="grid gap-3 md:grid-cols-2">
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

function LoginScreen({
  error,
  onLogin
}: {
  error: string;
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("admin@crm.local");
  const [password, setPassword] = useState("admin123");
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
              placeholder="admin123"
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
          Rode `npm run prisma:push` e `npm run prisma:seed` para criar o usuario
          inicial.
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
  filters,
  availableTags,
  loading,
  selectedConversation,
  onFiltersChange,
  onSelectConversation,
  onSendMessage,
  onSendMedia,
  onLoadTemplates,
  onSendTemplate,
  onUpdateStatus,
  aiAnalysis,
  aiLoading,
  onAnalyzeConversation,
  onAddTags,
  onRemoveTag
}: {
  conversations: ConversationRow[];
  filters: { search: string; status: string; tagIds: string[] };
  availableTags: ReferenceData["tags"];
  loading: boolean;
  selectedConversation: ConversationRow | null;
  onFiltersChange: (filters: { search: string; status: string; tagIds: string[] }) => void;
  onSelectConversation: (conversation: ConversationRow) => void;
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
  onAnalyzeConversation: (conversationId: string) => Promise<void>;
  onAddTags: (conversationId: string, tagIds: string[]) => Promise<void>;
  onRemoveTag: (conversationId: string, tagId: string) => Promise<void>;
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
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
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
      const recorder = new MediaRecorder(stream);
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
        const file = new File([blob], `audio-${Date.now()}.webm`, {
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

  return (
    <div className="grid h-[calc(100vh-8.5rem)] min-h-0 gap-4 overflow-hidden xl:grid-cols-[340px_minmax(0,1fr)_320px]">
      <ConversationList
        conversations={conversations}
        filters={filters}
        availableTags={availableTags}
        loading={loading}
        selectedConversation={selectedConversation}
        onFiltersChange={onFiltersChange}
        onSelectConversation={onSelectConversation}
      />

      <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-line/80 bg-white shadow-soft">
        <div className="flex min-h-20 items-center justify-between gap-3 border-b border-line/70 px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative grid h-11 w-11 place-items-center rounded-full bg-blue-50 text-sm font-bold text-brand ring-1 ring-blue-100">
              {selectedConversation?.contact.name.slice(0, 1).toUpperCase() ?? "C"}
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-bold text-slate-950">
                {selectedConversation?.contact.name ?? "Selecione uma conversa"}
              </h3>
              <p className="truncate text-sm text-slate-500">
                {selectedConversation?.contact.phone ?? "Inbox interno"}
              </p>
            </div>
          </div>
          {selectedConversation && (
            <div className="flex items-center gap-2">
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
          {selectedConversation?.messages.map((item) => (
            <ChatBubble
              key={item.id}
              side={item.direction === "outbound" ? "right" : "left"}
              timestamp={formatRelativeDate(item.createdAt)}
            >
              {item.body}
            </ChatBubble>
          ))}
          <div ref={chatEndRef} />
        </div>

        <form className="border-t border-line/70 bg-white p-4" onSubmit={handleSubmit}>
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

          <div className="relative flex items-center gap-2 rounded-2xl border border-line bg-slate-50 px-3 py-2 focus-within:border-blue-200 focus-within:bg-white focus-within:shadow-soft">
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
              className="w-full bg-transparent text-sm outline-none"
              disabled={!selectedConversation}
              placeholder="Digite uma mensagem..."
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <button
              className="grid h-10 w-10 place-items-center rounded-full bg-brand text-white shadow-soft disabled:opacity-40"
              disabled={!selectedConversation || !message.trim()}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </section>

      <section className="min-h-0 space-y-4 overflow-y-auto overscroll-contain pr-1">
        <AiPanel
          compact
          analysis={aiAnalysis}
          loading={aiLoading}
          disabled={!selectedConversation}
          onAnalyze={() =>
            selectedConversation
              ? void onAnalyzeConversation(selectedConversation.id)
              : undefined
          }
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
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
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
  filters,
  availableTags,
  loading,
  selectedConversation,
  onFiltersChange,
  onSelectConversation
}: {
  conversations: ConversationRow[];
  filters: { search: string; status: string; tagIds: string[] };
  availableTags: ReferenceData["tags"];
  loading: boolean;
  selectedConversation: ConversationRow | null;
  onFiltersChange: (filters: { search: string; status: string; tagIds: string[] }) => void;
  onSelectConversation: (conversation: ConversationRow) => void;
}) {
  const activeTags = availableTags.filter((tag) => tag.isActive !== false);

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-line/80 bg-white shadow-soft">
      <div className="border-b border-line/70 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-950">Conversas</h3>
            <p className="text-sm text-slate-500">{conversations.length} atendimentos</p>
          </div>
          <button className="grid h-9 w-9 place-items-center rounded-full border border-line bg-slate-50 text-slate-500 hover:bg-white">
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-line bg-slate-50 px-3 py-2 focus-within:border-blue-200 focus-within:bg-white">
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
        <div className="mt-3 grid grid-cols-4 gap-1.5 text-xs">
          {[
            ["OPEN", "Aberto"],
            ["PENDING", "Pend."],
            ["BOT", "Robo"],
            ["SOLD", "Vendas"]
          ].map(([value, label]) => (
            <button
              key={value}
              className={clsx(
                "rounded-full border px-2 py-2 font-semibold",
                filters.status === value
                  ? "border-blue-200 bg-blue-50 text-brand"
                  : "border-line bg-white text-slate-500 hover:bg-slate-50"
              )}
              onClick={() => onFiltersChange({ ...filters, status: value })}
            >
              {label}
            </button>
          ))}
        </div>
        {activeTags.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-500">Filtrar por tag</p>
              {filters.tagIds.length > 0 && (
                <button
                  className="text-xs font-semibold text-brand"
                  onClick={() => onFiltersChange({ ...filters, tagIds: [] })}
                  type="button"
                >
                  Limpar
                </button>
              )}
            </div>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {activeTags.map((tag) => {
                const selected = filters.tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    className={clsx(
                      "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
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
            </div>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 divide-y divide-line/70 overflow-y-auto overscroll-contain">
        {conversations.map((item) => {
          const selected = selectedConversation?.id === item.id;
          const unread = item.unreadCount ?? 0;
          const hasUnread = unread > 0;
          const preview =
            item.lastMessagePreview ??
            item.lastMessage?.body ??
            item.summary ??
            "Sem mensagens.";
          const messageTime = item.lastMessageAt ?? item.lastMessage?.createdAt;
          return (
            <button
              key={item.id}
              className={clsx(
                "group block w-full p-4 text-left transition-colors hover:bg-slate-50",
                hasUnread && "bg-emerald-50/45",
                selected && "bg-blue-50/70"
              )}
              onClick={() => onSelectConversation(item)}
            >
              <div className="flex items-start gap-3">
                <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                  {item.contact.name.slice(0, 2).toUpperCase()}
                  <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={clsx(
                        "truncate text-slate-950",
                        hasUnread ? "font-bold" : "font-semibold"
                      )}
                    >
                      {item.contact.name}
                    </p>
                    <span
                      className={clsx(
                        "shrink-0 text-[11px]",
                        hasUnread ? "font-bold text-emerald-600" : "text-slate-400"
                      )}
                    >
                      {messageTime ? formatRelativeDate(messageTime) : item.status}
                    </span>
                  </div>
                  <div className="mt-1 flex items-start justify-between gap-3">
                    <p
                      className={clsx(
                        "line-clamp-2 min-w-0 text-sm",
                        hasUnread ? "font-semibold text-slate-800" : "text-slate-500"
                      )}
                    >
                      {preview}
                    </p>
                    {hasUnread && (
                      <span className="grid h-5 min-w-[1.25rem] shrink-0 place-items-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold leading-none text-white shadow-sm">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {item.tags.slice(0, 3).map((tag) => (
                      <TagBadge key={tag.id} tag={tag} compact />
                    ))}
                    {item.tags.length > 3 && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                        +{item.tags.length - 3}
                      </span>
                    )}
                    {item.tags.length === 0 && (
                      <span
                        className={clsx(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          hasUnread ? "bg-white text-brand" : "bg-blue-50 text-brand"
                        )}
                      >
                        {item.contact.origin}
                      </span>
                    )}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                      {temperatureLabels[item.contact.temperature as keyof typeof temperatureLabels] ?? item.contact.temperature}
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

function ChatBubble({
  side,
  timestamp,
  children
}: {
  side: "left" | "right";
  timestamp?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx("flex", side === "right" && "justify-end")}>
      <div className={clsx("max-w-[76%]", side === "right" && "text-right")}>
        <div
          className={clsx(
            "rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm",
            side === "right"
              ? "rounded-br-md bg-brand text-white"
              : "rounded-bl-md border border-line/70 bg-white text-slate-800"
          )}
        >
          {children}
        </div>
        {timestamp && (
          <p className="mt-1 px-1 text-[11px] text-slate-400">{timestamp}</p>
        )}
      </div>
    </div>
  );
}

const commonEmojis = ["😀", "🙂", "😉", "👍", "🙏", "✅", "🔥", "🚀", "📌", "💬", "📄", "⏰", "❤️", "👏", "🤝", "💰"];

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
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-white hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
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
  loading,
  onCreateChannel,
  onSimulateInbound
}: {
  channels: ChannelRow[];
  loading: boolean;
  onCreateChannel: (payload: {
    name: string;
    displayPhone: string;
    phoneNumberId: string;
    wabaId: string;
    accessToken: string;
    verifyToken: string;
    appSecret: string;
  }) => Promise<void>;
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

  const selectedChannelId = form.channelId || channels[0]?.id || "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSimulateInbound({ ...form, channelId: selectedChannelId });
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <div className="space-y-4">
        <section className="rounded border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">Adicionar WhatsApp Meta</h3>
              <p className="text-sm text-slate-500">
                Cadastre um numero da Cloud API por canal. O roteamento usa o Phone Number ID.
              </p>
            </div>
            <Plus className="h-5 w-5 text-slate-400" />
          </div>

          <form className="mt-5 grid gap-3 lg:grid-cols-2" onSubmit={handleCreate}>
            <ContactInput
              placeholder="Nome do canal"
              required
              value={channelForm.name}
              onChange={(value) =>
                setChannelForm((current) => ({ ...current, name: value }))
              }
            />
            <ContactInput
              placeholder="Telefone exibido"
              value={channelForm.displayPhone}
              onChange={(value) =>
                setChannelForm((current) => ({ ...current, displayPhone: value }))
              }
            />
            <ContactInput
              placeholder="Phone Number ID"
              required
              value={channelForm.phoneNumberId}
              onChange={(value) =>
                setChannelForm((current) => ({ ...current, phoneNumberId: value }))
              }
            />
            <ContactInput
              placeholder="WABA ID"
              value={channelForm.wabaId}
              onChange={(value) =>
                setChannelForm((current) => ({ ...current, wabaId: value }))
              }
            />
            <ContactInput
              placeholder="Access token"
              required
              value={channelForm.accessToken}
              onChange={(value) =>
                setChannelForm((current) => ({ ...current, accessToken: value }))
              }
            />
            <ContactInput
              placeholder="Verify token"
              required
              value={channelForm.verifyToken}
              onChange={(value) =>
                setChannelForm((current) => ({ ...current, verifyToken: value }))
              }
            />
            <ContactInput
              placeholder="App secret"
              value={channelForm.appSecret}
              onChange={(value) =>
                setChannelForm((current) => ({ ...current, appSecret: value }))
              }
            />
            <button className="h-10 rounded bg-brand px-4 text-sm font-semibold text-white">
              Cadastrar canal Meta
            </button>
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
                  ["Assinatura", channel.hasAppSecret]
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
    </div>
  );
}

function Disparos({
  campaigns,
  channels,
  contacts,
  loading,
  onCreateCampaign
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
  }) => Promise<CampaignRow | null>;
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
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [lastCampaign, setLastCampaign] = useState<CampaignRow | null>(null);

  useEffect(() => {
    if (!channelId && metaChannels[0]?.id) {
      setChannelId(metaChannels[0].id);
    }
  }, [channelId, metaChannels]);

  useEffect(() => {
    if (!image) {
      setImagePreview("");
      return;
    }

    const url = URL.createObjectURL(image);
    setImagePreview(url);

    return () => URL.revokeObjectURL(url);
  }, [image]);

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
    if (!message.trim()) {
      setError("Escreva a mensagem do disparo.");
      return;
    }

    const confirmed = window.confirm(
      `Enviar disparo para ${selectedIds.length} contato(s)?`
    );
    if (!confirmed) return;

    setSending(true);
    const campaign = await onCreateCampaign({
      channelId,
      contactIds: selectedIds,
      message,
      image
    });
    setSending(false);

    if (campaign) {
      setLastCampaign(campaign);
      setSelectedIds([]);
      setMessage("");
      setImage(null);
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

            <label className="block text-sm font-semibold">
              Mensagem do disparo
              <textarea
                className="mt-2 min-h-36 w-full rounded border border-line px-3 py-3 font-normal outline-none focus:border-brand"
                placeholder="Digite a mensagem que sera enviada para os contatos selecionados."
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>

            <div className="rounded border border-line bg-slate-50 p-3">
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
              {message || "Sua mensagem aparecera aqui."}
            </p>
          </div>
          <div className="mt-3 rounded border border-line p-3 text-xs text-slate-500">
            {selectedContacts.slice(0, 3).map((contact) => contact.name).join(", ") ||
              "Selecione contatos para ver destinatarios."}
            {selectedContacts.length > 3
              ? ` e mais ${selectedContacts.length - 3}`
              : ""}
          </div>
        </div>

        <div className="rounded border border-line bg-white p-4 shadow-soft">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold">Historico de disparos</h3>
            <span className="text-xs text-slate-500">
              {loading ? "Carregando..." : `${campaigns.length} campanhas`}
            </span>
          </div>
          <div className="space-y-3">
            {campaigns.slice(0, 8).map((campaign) => (
              <div key={campaign.id} className="rounded border border-line p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{campaign.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatRelativeDate(campaign.createdAt)}
                    </p>
                  </div>
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold">
                    {campaign.status}
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
              </div>
            ))}
            {!campaigns.length && (
              <p className="rounded border border-dashed border-line p-4 text-center text-sm text-slate-500">
                Nenhum disparo registrado ainda.
              </p>
            )}
          </div>
        </div>
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
  );
}

function AiPanel({
  compact = false,
  analysis,
  loading = false,
  disabled = false,
  onAnalyze
}: {
  compact?: boolean;
  analysis?: AiAnalysis | null;
  loading?: boolean;
  disabled?: boolean;
  onAnalyze?: () => void;
}) {
  return (
    <aside className="rounded border border-line bg-white p-5 shadow-soft">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-saffron" />
        <h3 className="font-bold">Copiloto IA</h3>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {compact
          ? "Sugestao para a conversa atual."
          : "Analise do funil e proximas acoes recomendadas."}
      </p>
      {onAnalyze && (
        <button
          className="mt-4 h-10 w-full rounded bg-saffron px-3 text-sm font-semibold text-white disabled:opacity-50"
          disabled={disabled || loading}
          onClick={onAnalyze}
        >
          {loading ? "Analisando..." : "Gerar analise IA"}
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
          <p className="text-sm text-amber-950">{analysis.summary}</p>
          <p className="text-sm font-semibold text-amber-950">
            {analysis.nextAction}
          </p>
          <p className="rounded bg-white p-2 text-sm text-slate-700">
            {analysis.suggestedReply}
          </p>
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
