"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Search, SlidersHorizontal, X } from "lucide-react";

type ConversationStatus = "OPEN" | "PENDING" | "BOT" | "SOLD" | "RESOLVED";

type AiMode = "OFF" | "COPILOT" | "AUTO" | "HYBRID";

type ConversationStatusCounts = Record<ConversationStatus, number>;

type ConversationFilters = {
  search: string;
  status: string;
  tagIds: string[];
  assignedTo: string;
};

type TagRow = {
  id: string;
  name: string;
  color: string;
  textColor?: string | null;
  category?: string | null;
  isActive?: boolean;
};

type AttendantRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  availabilityStatus?: string;
  lastSeenAt?: string | null;
  openConversations?: number;
};

type ConversationRow = {
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

type ConversationListProps = {
  conversations: ConversationRow[];
  statusCounts: ConversationStatusCounts;
  filters: ConversationFilters;
  availableTags: TagRow[];
  attendants: AttendantRow[];
  isAdmin: boolean;
  loading: boolean;
  selectedConversation: ConversationRow | null;
  onFiltersChange: (filters: ConversationFilters) => void;
  onSearchSettlingChange?: (settling: boolean) => void;
  onSelectConversation: (conversation: ConversationRow) => void;
};

const temperatureLabels = {
  HOT: "Quente",
  WARM: "Morno",
  COLD: "Frio"
} as const;

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));

  if (minutes < 60) return `ha ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `ha ${hours}h`;

  return `ha ${Math.floor(hours / 24)}d`;
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

  if (item.status === "PENDING") {
    return {
      label: "Pendente",
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

function getConversationActionBadges(item: ConversationRow) {
  const badges: Array<{ label: string; tone: "green" | "amber" | "rose" | "slate" }> = [];

  if ((item.unreadCount ?? 0) > 0) {
    badges.push({ label: "Nova mensagem", tone: "green" });
  }

  if (item.assignmentStatus === "UNASSIGNED" || !item.agent) {
    badges.push({ label: "Sem responsavel", tone: "rose" });
  }

  if (item.status === "PENDING") {
    badges.push({ label: "Pendente", tone: "amber" });
  }

  return badges;
}

function getConversationActionBadgeClass(tone: "green" | "amber" | "rose" | "slate") {
  if (tone === "green") return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  if (tone === "amber") return "bg-amber-100 text-amber-800 ring-amber-200";
  if (tone === "rose") return "bg-rose-100 text-rose-800 ring-rose-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
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

export function ConversationList({
  conversations,
  statusCounts,
  filters,
  availableTags,
  attendants,
  isAdmin,
  loading,
  selectedConversation,
  onFiltersChange,
  onSearchSettlingChange,
  onSelectConversation
}: ConversationListProps) {
  const activeTags = availableTags.filter((tag) => tag.isActive !== false);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [conversationSearchDraft, setConversationSearchDraft] = useState(filters.search);
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
    value: ConversationStatus;
    label: string;
  }> = [
    { value: "OPEN", label: "Aberto" },
    { value: "PENDING", label: "Pendentes" },
    { value: "BOT", label: "Robo" },
    { value: "RESOLVED", label: "Resolvidos" },
    { value: "SOLD", label: "Vendas" }
  ];

  useEffect(() => {
    setConversationSearchDraft(filters.search);
  }, [filters.search]);

  useEffect(() => {
    if (conversationSearchDraft === filters.search) {
      onSearchSettlingChange?.(false);
      return;
    }

    onSearchSettlingChange?.(true);

    const timeout = window.setTimeout(() => {
      onFiltersChange({ ...filters, search: conversationSearchDraft });
      onSearchSettlingChange?.(false);
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [conversationSearchDraft, filters, onFiltersChange, onSearchSettlingChange]);

  useEffect(() => {
    return () => onSearchSettlingChange?.(false);
  }, [onSearchSettlingChange]);

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-line/80 bg-white shadow-soft">
      <div className="border-b border-line/70 bg-slate-50/35 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-950">Conversas</h3>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{conversations.length} atendimentos</p>
          </div>
          <div className="relative">
            <button
              className={clsx(
                "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-bold shadow-sm transition-colors",
                filters.tagIds.length
                  ? "border-blue-200 bg-blue-50 text-brand"
                  : "border-line bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800"
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
                          "rounded-full border p-0.5 transition-colors",
                          selected
                            ? "border-slate-300 bg-slate-50 ring-2 ring-slate-200"
                            : "border-transparent hover:bg-slate-50"
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
                        <TagBadge tag={tag} compact />
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
        <div className="mt-4 flex h-10 items-center gap-2 rounded-2xl border border-line bg-white px-3 shadow-sm transition focus-within:border-blue-200 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-50">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            className="w-full bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
            placeholder="Buscar conversas..."
            value={conversationSearchDraft}
            onChange={(event) => setConversationSearchDraft(event.target.value)}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-4">
          {[
            {
              label: "Minhas",
              active: filters.assignedTo === "me",
              next: { ...filters, assignedTo: "me" }
            },
            {
              label: "Pendentes",
              active: filters.status === "PENDING",
              next: { ...filters, status: "PENDING" }
            },
            {
              label: "Sem responsavel",
              active: filters.assignedTo === "unassigned",
              next: { ...filters, assignedTo: "unassigned" }
            },
            {
              label: "Todas abertas",
              active: filters.status === "OPEN" && filters.assignedTo === "default",
              next: { ...filters, status: "OPEN", assignedTo: "default" }
            }
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              className={clsx(
                "h-8 rounded-xl border px-2 font-bold shadow-sm transition-colors",
                item.active
                  ? "border-blue-200 bg-white text-brand"
                  : "border-line bg-white/80 text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-800"
              )}
              onClick={() => onFiltersChange(item.next)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto rounded-2xl bg-white p-1 text-[11px] shadow-sm ring-1 ring-line/80">
          {statusFilterItems.map(({ value, label }) => {
            const count = statusCounts[value] ?? 0;
            const active = filters.status === value;

            return (
            <button
              key={value}
              className={clsx(
                "inline-flex h-8 min-w-max flex-1 items-center justify-center gap-1.5 rounded-xl px-2 font-bold transition-colors",
                active
                  ? "bg-blue-50 text-brand shadow-sm"
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
                      : "bg-slate-200 text-slate-600"
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
              className="h-9 min-w-0 flex-1 rounded-full border border-line bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm outline-none hover:border-slate-300 focus:border-blue-200"
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
                className="h-9 rounded-full border border-line bg-white px-3 text-xs font-bold text-slate-500 shadow-sm hover:border-slate-300 hover:text-slate-800"
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
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain bg-slate-50/35 p-2">
        {conversations.map((item) => {
          const selected = selectedConversation?.id === item.id;
          const unread = item.unreadCount ?? 0;
          const hasUnread = unread > 0;
          const contactName = formatContactNameForUi(item.contact.name);
          const preview = formatConversationPreview(item);
          const channelLine = formatConversationChannelLine(item);
          const messageTime = item.lastMessageAt ?? item.lastMessage?.createdAt;
          const attention = getConversationAttention(item);
          const actionBadges = getConversationActionBadges(item);
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
                "group relative block min-h-[116px] w-full overflow-hidden rounded-2xl border border-transparent bg-white px-3.5 py-3 text-left shadow-sm transition-all hover:border-slate-200 hover:bg-white hover:shadow-md",
                hasUnread && "ring-1 ring-inset ring-emerald-200",
                attention.tone === "green" && "bg-emerald-50/45",
                attention.tone === "amber" && !selected && "bg-amber-50/30",
                attention.tone === "rose" && !selected && "bg-rose-50/30",
                selected && "border-blue-200 bg-blue-50/80 shadow-md ring-1 ring-inset ring-blue-100"
              )}
              onClick={() => onSelectConversation(item)}
            >
              <span
                className={clsx(
                  "absolute left-0 top-4 h-10 w-1 rounded-r-full opacity-80",
                  attention.tone === "green" && "bg-emerald-500",
                  attention.tone === "amber" && "bg-amber-400",
                  attention.tone === "rose" && "bg-rose-500",
                  attention.tone === "slate" && "bg-transparent"
                )}
              />
              <div className="flex min-h-[90px] items-start gap-3">
                <div className="relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
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
                        "min-w-0 flex-1 truncate text-sm leading-5 text-slate-950",
                        hasUnread ? "font-bold" : "font-semibold"
                      )}
                      title={contactName}
                    >
                      {contactName}
                    </p>
                    <span
                      className={clsx(
                        "w-16 shrink-0 truncate text-right text-[10px] font-medium tabular-nums",
                        hasUnread ? "font-bold text-emerald-600" : "text-slate-400"
                      )}
                      title={messageTime ? formatRelativeDate(messageTime) : item.status}
                    >
                      {messageTime ? formatRelativeDate(messageTime) : item.status}
                    </span>
                  </div>

                  <div className="mt-1.5 flex h-5 items-center justify-between gap-2 overflow-hidden">
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
                      <span className="grid h-5 min-w-[1.25rem] shrink-0 place-items-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold leading-none text-white shadow-sm ring-1 ring-emerald-600/10">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </div>

                  <p className="mt-1 h-4 truncate text-[10px] font-semibold leading-4 text-slate-400" title={channelLine}>
                    {channelLine}
                  </p>

                  <div className="mt-2 flex max-h-10 flex-wrap items-center gap-1.5 overflow-hidden">
                    {actionBadges.map((badge) => (
                      <span
                        key={badge.label}
                        className={clsx(
                          "max-w-[8.5rem] truncate rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4 ring-1",
                          getConversationActionBadgeClass(badge.tone)
                        )}
                        title={badge.label}
                      >
                        {badge.label}
                      </span>
                    ))}
                    {visibleTags.map((tag) => (
                      <TagBadge key={tag.id} tag={tag} compact />
                    ))}
                    {extraTagCount > 0 && (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold leading-4 text-slate-500 ring-1 ring-slate-200">
                        +{extraTagCount}
                      </span>
                    )}
                    <span
                      className={clsx(
                        "max-w-[5.5rem] truncate rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4 ring-1",
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
          <div className="rounded-2xl border border-dashed border-line bg-white p-6 text-center text-sm text-slate-500">
            Nenhuma conversa nesta fila.
          </div>
        )}
        {loading && (
          <div className="space-y-3 p-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-2xl bg-white shadow-sm ring-1 ring-line/70" />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
