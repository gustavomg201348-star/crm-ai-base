import clsx from "clsx";
import { AlertCircle, Clock3, ExternalLink } from "lucide-react";
import type {
  CommercialControlOperationalBucket,
  CommercialControlOperationalItem
} from "@/lib/commercial-control-types";

type OperationalControlKey =
  | "forgottenClients"
  | "overdueNextActions"
  | "overdueAppointments"
  | "riskyNegotiations";

type OperationalControlCard = {
  key: OperationalControlKey;
  title: string;
  description: string;
  bucket: CommercialControlOperationalBucket;
};

type ControlRoomOperationalControlProps = {
  cards: OperationalControlCard[];
  selectedKey: OperationalControlKey;
  onSelect: (key: OperationalControlKey) => void;
  onOpenConversation?: (conversationId: string) => void | Promise<void>;
};

function formatDueAt(value: string | null) {
  if (!value) return "Sem prazo";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatOverdueMinutes(value: number | null) {
  if (value === null) return null;
  if (value < 60) return `${value} min vencido`;

  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}min vencido` : `${hours}h vencido`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  return remainingHours > 0 ? `${days}d ${remainingHours}h vencido` : `${days}d vencido`;
}

function OperationalItem({
  item,
  onOpenConversation
}: {
  item: CommercialControlOperationalItem;
  onOpenConversation?: (conversationId: string) => void | Promise<void>;
}) {
  const overdueLabel = formatOverdueMinutes(item.overdueMinutes);
  const conversationId = item.conversationId;

  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-black text-ink">{item.contact.name}</p>
          <p className="mt-1 text-sm font-semibold text-slate-700">{item.title}</p>
          <p className="mt-1 text-sm leading-5 text-slate-500">{item.reason}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
            <span className="rounded-full bg-slate-100 px-2.5 py-1">
              {item.owner?.name ?? "Sem responsavel"}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">
              {formatDueAt(item.dueAt)}
            </span>
            {overdueLabel && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
                {overdueLabel}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 md:items-end">
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
            {item.actionLabel}
          </span>
          {conversationId && onOpenConversation && (
            <button
              type="button"
              onClick={() => {
                void onOpenConversation(conversationId);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-brand/40 hover:text-brand"
            >
              Abrir conversa
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export type { OperationalControlKey };

export function ControlRoomOperationalControl({
  cards,
  selectedKey,
  onSelect,
  onOpenConversation
}: ControlRoomOperationalControlProps) {
  const selectedCard = cards.find((card) => card.key === selectedKey) ?? cards[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const isActive = card.key === selectedCard.key;
          const hasItems = card.bucket.total > 0;

          return (
            <button
              key={card.key}
              type="button"
              onClick={() => onSelect(card.key)}
              className={clsx(
                "rounded-2xl border p-4 text-left shadow-sm transition",
                isActive
                  ? "border-blue-300 bg-blue-50 text-blue-950"
                  : "border-line bg-white text-slate-900 hover:border-brand/40",
                hasItems && !isActive ? "ring-1 ring-amber-100" : null
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    {card.title}
                  </p>
                  <p className="mt-2 text-3xl font-black">{card.bucket.total.toLocaleString("pt-BR")}</p>
                </div>
                {hasItems && <AlertCircle className="mt-1 h-5 w-5 text-amber-500" />}
              </div>
              <p className="mt-2 text-sm leading-5 text-slate-600">{card.description}</p>
            </button>
          );
        })}
      </div>

      <div className="rounded-[1.25rem] border border-line bg-slate-50 p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-sm font-black text-ink">{selectedCard.title}</h3>
            <p className="mt-1 text-sm text-slate-500">{selectedCard.description}</p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-500">
            <Clock3 className="h-3.5 w-3.5" />
            {selectedCard.bucket.total.toLocaleString("pt-BR")} item(ns)
          </span>
        </div>

        {selectedCard.bucket.limitation && (
          <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            Limite do MVP: {selectedCard.bucket.limitation}
          </p>
        )}

        <div className="mt-4 space-y-3">
          {selectedCard.bucket.items.length === 0 ? (
            <p className="rounded-2xl border border-line bg-white p-4 text-sm text-slate-500">
              Nenhum item confiavel encontrado neste grupo.
            </p>
          ) : (
            selectedCard.bucket.items.map((item) => (
              <OperationalItem
                key={item.id}
                item={item}
                onOpenConversation={onOpenConversation}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
