"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import {
  parseSimulationReply,
  simulationParameters,
  type SimulationBank,
  type SimulationParameters,
  type SimulationReply
} from "@/lib/opencredit-clt-simulation";
import {
  parsePrequalificationView,
  type PrequalificationView,
  type PrequalificationBankResult
} from "@/lib/opencredit-clt-prequalification";

type Props = {
  companyId: string;
  contactId: string;
  conversationId: string;
  cpf?: string | null;
  enabled: boolean;
  onSaveCpf: (cpf: string) => Promise<boolean>;
};

const base = "/api/admin/integrations/opencredit/clt-simulation";

function money(value: number | null) {
  if (value === null) return "Nao informado";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function parsePrequalificationApi(raw: unknown): PrequalificationView | null | undefined {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const record = raw as { prequalification?: unknown };
    if (!Object.hasOwn(record, "prequalification")) return undefined;
    if (record.prequalification === null) return null;
    return parsePrequalificationView(record.prequalification);
  } catch { return undefined; }
}
function bankStatus(bank: PrequalificationBankResult) {
  if (bank.status === "aprovado") return "Oferta encontrada";
  if (bank.status === "pendente") return "Processando";
  if (bank.status === "waiting_authorization") return "Aguardando autorizacao";
  return "Sem oferta";
}
function reasonLabel(bank: PrequalificationBankResult) {
  switch (bank.reasonType) {
    case "no_offer": return "Sem oferta disponivel";
    case "timeout": return "Tempo de resposta excedido";
    case "unavailable": return "Banco indisponivel";
    case "business_rule": return "Fora da politica do banco";
    case "pre_validation": return "Pre-validacao nao elegivel";
    case "waiting_authorization": return "Aguardando autorizacao do banco/DataPrev";
    default: return null;
  }
}

export function CltSidebarSimulationPanel({
  companyId,
  contactId,
  conversationId,
  cpf,
  enabled,
  onSaveCpf
}: Props) {
  const [prequalification, setPrequalification] = useState<PrequalificationView | null>(null);
  const [prequalificationLoading, setPrequalificationLoading] = useState(true);
  const [cpfInput, setCpfInput] = useState(cpf ?? "");
  const [banks, setBanks] = useState<SimulationBank[]>([]);
  const [bankId, setBankId] = useState("");
  const [mode, setMode] = useState<SimulationParameters["mode"]>("maximum");
  const [amountBRL, setAmountBRL] = useState("");
  const [contextReady, setContextReady] = useState(false);
  const [reply, setReply] = useState<SimulationReply | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setCpfInput(cpf ?? "");
    setBanks([]);
    setBankId("");
    setMode("maximum");
    setAmountBRL("");
    setReply(null);
    setAttempted(false);
    setContextReady(false);
    setMessage("");
  }, [contactId, cpf]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function load() {
      try {
        const response = await fetch("/api/conversations/" + encodeURIComponent(conversationId) + "/clt-prequalification", {
          credentials: "same-origin",
          cache: "no-store"
        });
        const raw: unknown = await response.json().catch(() => null);
        const parsed = response.ok ? parsePrequalificationApi(raw) : undefined;
        if (cancelled) return;
        if (parsed !== undefined) setPrequalification(parsed);
        setPrequalificationLoading(false);
        if (parsed?.state === "PENDING" || parsed?.state === "PROCESSING") {
          timer = setTimeout(load, 4000);
        }
      } catch {
        if (!cancelled) setPrequalificationLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [conversationId]);

  async function refreshPrequalification() {
    setPrequalificationLoading(true);
    try {
      const response = await fetch("/api/conversations/" + encodeURIComponent(conversationId) + "/clt-prequalification", {
        credentials: "same-origin",
        cache: "no-store"
      });
      const raw: unknown = await response.json().catch(() => null);
      const parsed = response.ok ? parsePrequalificationApi(raw) : undefined;
      if (parsed !== undefined) setPrequalification(parsed);
    } finally { setPrequalificationLoading(false); }
  }

  const selectedBank = useMemo(
    () => banks.find((bank) => bank.bankId === bankId),
    [banks, bankId]
  );
  const bestOffer = useMemo(() => {
    const candidates = prequalification?.result?.banks.flatMap(bank =>
      bank.offers.map(offer => ({ bank, offer }))
    ) ?? [];
    return candidates.sort((a, b) =>
      (b.offer.liquidAmount ?? -1) - (a.offer.liquidAmount ?? -1)
      || a.offer.installments - b.offer.installments
    )[0] ?? null;
  }, [prequalification]);

  const validCpf = cpfInput.replace(/\D/g, "").length === 11;
  let validParameters = false;
  try {
    if (bankId) {
      simulationParameters({ bankId, mode, amountBRL: mode === "maximum" ? "" : amountBRL });
      validParameters = true;
    }
  } catch {
    validParameters = false;
  }

  const eligible =
    selectedBank?.enabled !== false &&
    selectedBank?.capabilities.simulacaoAtiva === true &&
    (mode === "maximum" ||
      (mode === "parcela" && selectedBank?.capabilities.suportaParcela === true) ||
      (mode === "liberado" && selectedBank?.capabilities.suportaLiquido === true));

  async function request(action: "banks" | "context" | "dispatch" | "poll") {
    if (!enabled || busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (action === "dispatch") {
        if (attempted) return;
        const digits = cpfInput.replace(/\D/g, "");
        if (digits !== (cpf ?? "").replace(/\D/g, "")) {
          const saved = await onSaveCpf(digits);
          if (!saved) {
            setMessage("Nao foi possivel salvar o CPF antes da simulacao.");
            return;
          }
        }
        setAttempted(true);
      }

      const response = await fetch(base + "/" + action, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          contactId,
          ...(action === "dispatch"
            ? simulationParameters({
                bankId,
                mode,
                amountBRL: mode === "maximum" ? "" : amountBRL
              })
            : {})
        })
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error();

      const parsed = parseSimulationReply(raw);
      if (action === "banks") {
        setBanks(parsed.banks ?? []);
        setBankId(parsed.banks?.[0]?.bankId ?? "");
        setMessage(parsed.banks?.length ? "" : "Nenhum banco CLT disponivel.");
        return;
      }
      if (action === "context") {
        setReply(parsed);
        setContextReady(true);
        return;
      }
      setReply(parsed);
      setContextReady(true);
    } catch {
      setMessage(
        action === "dispatch"
          ? "Nao foi possivel confirmar a simulacao. Nao repita automaticamente."
          : "Consulta indisponivel no momento."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-brand">
            Consulta automatica
          </p>
          <h3 className="font-bold text-slate-950">Simulacao CLT</h3>
        </div>
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-full border border-line text-slate-500 hover:bg-slate-50"
          disabled={prequalificationLoading}
          title="Atualizar resultado"
          onClick={() => void refreshPrequalification()}
        >
          {prequalificationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {prequalificationLoading && !prequalification ? (
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Verificando simulacao automatica...
          </div>
        ) : prequalification?.state === "PENDING" || prequalification?.state === "PROCESSING" ? (
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Loader2 className="h-4 w-4 animate-spin text-brand" />
              Consultando todos os bancos
            </div>
            <p className="mt-1 text-xs text-slate-600">A consulta foi iniciada automaticamente apos o cliente clicar em Conferir/Verificar.</p>
          </div>
        ) : prequalification?.state === "FAILED" ? (
          <div className="rounded-xl bg-amber-50 px-3 py-3 text-xs font-semibold text-amber-800">
            A pre-simulacao nao foi concluida. Nenhuma nova consulta sera repetida automaticamente.
          </div>
        ) : prequalification?.state === "COMPLETED" && prequalification.result ? (
          <>
            {bestOffer ? (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                <p className="text-[11px] font-black uppercase tracking-wide text-emerald-700">Maior valor encontrado</p>
                <p className="mt-1 text-sm font-bold text-slate-950">{bestOffer.bank.bankName}</p>
                <p className="text-lg font-black text-slate-950">{money(bestOffer.offer.liquidAmount)}</p>
                <p className="text-xs text-slate-600">{bestOffer.offer.installments}x de {money(bestOffer.offer.installmentAmount)}</p>
              </div>
            ) : (
              <div className="rounded-xl bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-700">
                Nenhum banco retornou oferta nesta pre-simulacao.
              </div>
            )}

            <div className="space-y-2">
              {prequalification.result.banks.map(bank => {
                const offer = [...bank.offers].sort((a, b) => (b.liquidAmount ?? -1) - (a.liquidAmount ?? -1))[0];
                const reason = reasonLabel(bank);
                return (
                  <div key={bank.bankId} className="rounded-xl border border-line bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900">{bank.bankName}</p>
                      <span className="rounded-full bg-slate-50 px-2 py-1 text-[10px] font-bold uppercase text-slate-600">{bankStatus(bank)}</span>
                    </div>
                    {offer && (
                      <p className="mt-1 text-xs text-slate-700">
                        {offer.installments}x de {money(offer.installmentAmount)} → <strong>{money(offer.liquidAmount)}</strong>
                      </p>
                    )}
                    {reason && <p className="mt-1 text-xs text-slate-500">{reason}</p>}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-600">
            A simulacao sera iniciada automaticamente quando o cliente clicar em Conferir ou Verificar. O CPF salvo no cadastro sera usado e todos os bancos elegiveis serao consultados.
          </div>
        )}

        {enabled && (
          <details className="border-t border-line pt-3">
            <summary className="cursor-pointer text-xs font-bold text-slate-600">Refinar manualmente em um banco</summary>
            <div className="mt-3 space-y-3">
              <label className="block text-xs font-bold text-slate-500">
                CPF
                <input
                  className="mt-1 h-10 w-full rounded-xl border border-line bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-brand focus:bg-white"
                  inputMode="numeric"
                  maxLength={14}
                  value={cpfInput}
                  onChange={(event) => setCpfInput(event.target.value)}
                  placeholder="000.000.000-00"
                />
              </label>

              {!banks.length ? (
                <button
                  type="button"
                  className="h-10 w-full rounded-xl bg-brand px-3 text-sm font-bold text-white disabled:opacity-50"
                  disabled={busy || !validCpf}
                  onClick={() => void request("banks")}
                >
                  {busy ? "Carregando..." : "Carregar bancos"}
                </button>
              ) : (
                <>
                  <label className="block text-xs font-bold text-slate-500">
                    Banco
                    <select
                      className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-semibold text-slate-800"
                      value={bankId}
                      onChange={(event) => {
                        setBankId(event.target.value);
                        setReply(null);
                        setContextReady(false);
                      }}
                    >
                      {banks.map((bank) => (
                        <option key={bank.bankId} value={bank.bankId}>{bank.bankName}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs font-bold text-slate-500">
                    Simular por
                    <select
                      className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-semibold text-slate-800"
                      value={mode}
                      onChange={(event) => {
                        setMode(event.target.value as SimulationParameters["mode"]);
                        setAmountBRL("");
                        setReply(null);
                        setContextReady(false);
                      }}
                    >
                      <option value="maximum">Melhor valor disponivel</option>
                      <option value="parcela">Valor da parcela</option>
                      <option value="liberado">Valor liberado</option>
                    </select>
                  </label>

                  {mode !== "maximum" && (
                    <label className="block text-xs font-bold text-slate-500">
                      Valor
                      <input
                        className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-semibold text-slate-800"
                        inputMode="decimal"
                        value={amountBRL}
                        onChange={(event) => setAmountBRL(event.target.value)}
                        placeholder="Ex.: 500,00"
                      />
                    </label>
                  )}

                  <button
                    type="button"
                    className="h-10 w-full rounded-xl bg-brand px-3 text-sm font-bold text-white disabled:opacity-50"
                    disabled={busy || attempted || !validCpf || !eligible || !validParameters}
                    onClick={async () => {
                      if (!contextReady) await request("context");
                      await request("dispatch");
                    }}
                  >
                    {busy ? "Consultando..." : attempted ? "Simulacao enviada" : "Simular"}
                  </button>
                </>
              )}

              {reply?.result && (
                <div className="space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-slate-900">{selectedBank?.bankName ?? "Resultado"}</p>
                    <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold uppercase text-emerald-700">{reply.result.status}</span>
                  </div>
                  {reply.result.offers.map((offer) => (
                    <div key={offer.offerId} className="rounded-lg bg-white p-2 text-xs text-slate-700">
                      <p><strong>Liberado:</strong> {money(offer.liquidAmount)}</p>
                      <p><strong>Parcela:</strong> {money(offer.installmentAmount)}</p>
                      <p><strong>Prazo:</strong> {offer.installments}x</p>
                      <p><strong>Taxa:</strong> {offer.interestRate === null ? "Nao informada" : offer.interestRate + "% a.m."}</p>
                    </div>
                  ))}
                </div>
              )}

              {reply?.operation?.displayState === "PENDING" && (
                <button
                  type="button"
                  className="h-9 w-full rounded-xl border border-line bg-white px-3 text-xs font-bold text-slate-700"
                  disabled={busy}
                  onClick={() => void request("poll")}
                >
                  Atualizar resultado
                </button>
              )}

              {message && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{message}</p>
              )}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
