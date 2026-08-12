import { Bot, Clock3, ExternalLink } from "lucide-react";
import { ControlRoomMetric } from "@/app/components/commercial-control/ControlRoomMetric";
import type {
  CommercialControlAiAttentionItem,
  CommercialControlAiIntelligence,
  CommercialControlAiStaleItem
} from "@/lib/commercial-control-types";

const stageLabels: Record<string, string> = {
  NEW: "Novo",
  INTEREST: "Interesse",
  SIMULATION: "Simulacao",
  NEGOTIATION: "Negociacao",
  FORMALIZATION: "Formalizacao",
  CLOSED_WON: "Fechado ganho",
  CLOSED_LOST: "Fechado perdido",
  UNKNOWN: "Nao determinado"
};

const interestLabels: Record<string, string> = {
  LOW: "Baixo",
  MEDIUM: "Medio",
  HIGH: "Alto",
  UNKNOWN: "Nao determinado"
};

const riskLabels: Record<string, string> = {
  NONE: "Sem risco",
  LOW: "Baixo",
  MEDIUM: "Medio",
  HIGH: "Alto",
  UNKNOWN: "Nao determinado"
};

const actionLabels: Record<string, string> = {
  RESPOND: "Responder",
  CALL: "Ligar",
  SEND_SIMULATION: "Enviar simulacao",
  FOLLOW_UP: "Fazer follow-up",
  REQUEST_DOCUMENTS: "Solicitar documentos",
  FORMALIZE: "Formalizar",
  WAIT: "Aguardar",
  CLOSE_LOST: "Encerrar como perdido",
  NO_ACTION: "Sem acao sugerida"
};

const staleStatusLabels: Record<string, string> = {
  STALE: "Desatualizada",
  PENDING: "Aguardando atualizacao",
  PROCESSING: "Em processamento",
  ERROR: "Falha de analise"
};

function formatDateTime(value: string | null) {
  if (!value) return "Sem data";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
function formatConfidence(value: number) {
  return `${Math.round(value * 100)}% confianca`;
}

function AiAttentionItem({
  item,
  onOpenConversation
}: {
  item: CommercialControlAiAttentionItem;
  onOpenConversation?: (conversationId: string) => void | Promise<void>;
}) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-black text-ink">{item.contact.name}</p>
          <p className="mt-1 text-sm leading-5 text-slate-600">{item.primaryReason}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
            <span className="rounded-full bg-slate-100 px-2.5 py-1">
              {stageLabels[item.stage] ?? item.stage}
            </span>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">
              Interesse {interestLabels[item.interest] ?? item.interest}
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
              Risco {riskLabels[item.risk] ?? item.risk}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">
              {formatConfidence(item.confidence)}
            </span>
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-500">
            {item.owner?.name ?? "Sem responsavel"} - analisado em {formatDateTime(item.analyzedAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 lg:w-56 lg:items-end">
          <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
            {actionLabels[item.nextBestAction.action] ?? item.nextBestAction.action}
          </span>
          <p className="text-xs leading-5 text-slate-500 lg:text-right">
            {item.nextBestAction.reason}
          </p>
          {onOpenConversation && (
            <button
              type="button"
              onClick={() => {
                void onOpenConversation(item.conversationId);
              }}
              className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-brand/40 hover:text-brand"
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
function StaleItem({ item }: { item: CommercialControlAiStaleItem }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-slate-50 p-3 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm font-bold text-ink">{item.contact.name}</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">
          {item.owner?.name ?? "Sem responsavel"} - {formatDateTime(item.staleSince)}
        </p>
      </div>
      <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600">
        {staleStatusLabels[item.status] ?? item.status}
      </span>
    </div>
  );
}
export function ControlRoomAiIntelligence({
  aiIntelligence,
  onOpenConversation
}: {
  aiIntelligence: CommercialControlAiIntelligence;
  onOpenConversation?: (conversationId: string) => void | Promise<void>;
}) {
  const hasAnyObservation =
    aiIntelligence.current +
      aiIntelligence.stale +
      aiIntelligence.pending +
      aiIntelligence.processing +
      aiIntelligence.errors >
    0;

  return (
    <div className="space-y-4">
      {!hasAnyObservation ? (
        <p className="rounded-2xl border border-line bg-slate-50 p-4 text-sm text-slate-500">
          Nenhuma conversa analisada pela IA ainda.
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <ControlRoomMetric
              label="Atuais"
              value={aiIntelligence.current}
              description="Analises CURRENT disponiveis para leitura operacional."
              tone="brand"
            />
            <ControlRoomMetric
              label="Desatualizadas"
              value={aiIntelligence.stale}
              description="Contexto mudou desde a ultima analise."
              tone={aiIntelligence.stale > 0 ? "attention" : "default"}
            />
            <ControlRoomMetric
              label="Aguardando"
              value={aiIntelligence.pending + aiIntelligence.processing}
              description="Pendentes ou em processamento pelo fluxo controlado."
            />
            <ControlRoomMetric
              label="Erros"
              value={aiIntelligence.errors}
              description="Falhas de analise registradas para revisao tecnica."
              tone={aiIntelligence.errors > 0 ? "attention" : "default"}
            />
            <ControlRoomMetric
              label="Risco IA"
              value={aiIntelligence.atRisk}
              description="CURRENT com risco MEDIUM ou HIGH."
              tone={aiIntelligence.atRisk > 0 ? "attention" : "default"}
            />
            <ControlRoomMetric
              label="Interesse alto"
              value={aiIntelligence.highInterest}
              description="CURRENT com interesse HIGH."
              tone={aiIntelligence.highInterest > 0 ? "success" : "default"}
            />
          </div>

          {aiIntelligence.limitation && (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Limite do MVP: {aiIntelligence.limitation}
            </p>
          )}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
            <div className="rounded-[1.25rem] border border-line bg-slate-50 p-4">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-brand" />
                <h3 className="text-sm font-black text-ink">Atencao da IA</h3>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Apenas analises CURRENT com risco ou interesse relevante. Nenhuma acao e executada por esta lista.
              </p>
              <div className="mt-4 space-y-3">
                {aiIntelligence.attention.length === 0 ? (
                  <p className="rounded-2xl border border-line bg-white p-4 text-sm text-slate-500">
                    Nenhuma analise atual com risco ou interesse alto.
                  </p>
                ) : (
                  aiIntelligence.attention.map((item) => (
                    <AiAttentionItem
                      key={item.id}
                      item={item}
                      onOpenConversation={onOpenConversation}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[1.25rem] border border-line bg-white p-4">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-slate-500" />
                <h3 className="text-sm font-black text-ink">Analises que precisam ser atualizadas</h3>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Estados STALE, PENDING, PROCESSING e ERROR aparecem separados dos indicadores atuais.
              </p>
              <div className="mt-4 space-y-2">
                {aiIntelligence.staleItems.length === 0 ? (
                  <p className="rounded-2xl border border-line bg-slate-50 p-4 text-sm text-slate-500">
                    Nenhuma analise desatualizada ou pendente.
                  </p>
                ) : (
                  aiIntelligence.staleItems.map((item) => <StaleItem key={item.id} item={item} />)
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}