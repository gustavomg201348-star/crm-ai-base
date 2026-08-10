"use client";

import clsx from "clsx";
import { X } from "lucide-react";
import type { ConversationRow } from "./types";

type ConversationCardProps = {
  conversation: ConversationRow;
  selected: boolean;
  highlighted?: boolean;
  onSelect: (conversation: ConversationRow) => void;
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

export function ConversationCard({
  conversation,
  selected,
  highlighted,
  onSelect
}: ConversationCardProps) {
  const unread = conversation.unreadCount ?? 0;
  const hasUnread = unread > 0;
  const contactName = formatContactNameForUi(conversation.contact.name);
  const preview = formatConversationPreview(conversation);
  const channelLine = formatConversationChannelLine(conversation);
  const messageTime = conversation.lastMessageAt ?? conversation.lastMessage?.createdAt;
  const attention = getConversationAttention(conversation);
  const actionBadges = getConversationActionBadges(conversation);
  const temperatureLabel =
    temperatureLabels[conversation.contact.temperature as keyof typeof temperatureLabels] ??
    conversation.contact.temperature;
  const visibleTags = conversation.tags.slice(0, 2);
  const extraTagCount = Math.max(0, conversation.tags.length - visibleTags.length);

  return (
    <button
      key={conversation.id}
      type="button"
      data-conversation-row="true"
      data-conversation-id={conversation.id}
      data-contact-id={conversation.contact.id}
      data-contact-phone={conversation.contact.phone}
      data-contact-name={contactName}
      className={clsx(
        "group relative block min-h-[116px] w-full overflow-hidden rounded-2xl border border-transparent bg-white px-3.5 py-3 text-left shadow-sm transition-all hover:border-slate-200 hover:bg-white hover:shadow-md",
        hasUnread && "ring-1 ring-inset ring-emerald-200",
        attention.tone === "green" && "bg-emerald-50/45",
        attention.tone === "amber" && !selected && "bg-amber-50/30",
        attention.tone === "rose" && !selected && "bg-rose-50/30",
        highlighted && !selected && !hasUnread && attention.tone === "slate" && "bg-blue-50/70 ring-2 ring-blue-200/70",
        selected && "border-blue-200 bg-blue-50/80 shadow-md ring-1 ring-inset ring-blue-100"
      )}
      onClick={() => onSelect(conversation)}
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
              title={messageTime ? formatRelativeDate(messageTime) : conversation.status}
            >
              {messageTime ? formatRelativeDate(messageTime) : conversation.status}
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
}
