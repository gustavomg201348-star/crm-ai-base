"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { simulationParameters, reaisToCents, parseSimulationReply, simulationCapabilityKeys, type SimulationBank, type SimulationParameters, type SimulationReply } from "@/lib/opencredit-clt-simulation";
type Props = { companyId: string; contactId: string; authorizationActive: boolean };
const base = "/api/admin/integrations/opencredit/clt-simulation";
export function OpenCreditCltSimulationPanel(props: Props) { return <Simulation key={JSON.stringify([props.companyId, props.contactId, props.authorizationActive])} {...props} />; }
function Simulation({ companyId, contactId, authorizationActive }: Props) {
  const [banks, setBanks] = useState<SimulationBank[]>([]), [bankId, setBankId] = useState("");
  const [mode, setMode] = useState<SimulationParameters["mode"]>("maximum"), [amountBRL, setAmount] = useState("");
  const [review, setReview] = useState(false), [risk, setRisk] = useState(false), [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(false);
  const [contextReady, setContextReady] = useState(false), [reply, setReply] = useState<SimulationReply | null>(null), [error, setError] = useState("");
  const working = useRef(false), epoch = useRef(0), controller = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => { epoch.current++; controller.current?.abort(); }, []);
  useEffect(() => invalidate, [invalidate]); // Cleanup only: NEVER load banks or dispatch on mount.
  const selected = banks.find(b => b.bankId === bankId);
  const reset = () => { setReview(false); setRisk(false); };
  const fields = { bankId, mode, amountBRL };
  let valid = false; try { simulationParameters(fields); valid = true; } catch { /* Closed local validation. */ }
  const eligible = selected?.enabled !== false && selected?.capabilities.simulacaoAtiva === true && (mode === "maximum" || mode === "parcela" && selected.capabilities.suportaParcela === true || mode === "liberado" && selected.capabilities.suportaLiquido === true);
  async function request(action: "banks" | "context" | "dispatch" | "poll") {
    if (working.current || action === "dispatch" && (attempted || !authorizationActive || !contextReady || reply?.operation || !eligible || !valid || !review || !risk)) return;
    if (action === "poll" && !["PENDING", "SUCCEEDED"].includes(reply?.operation?.displayState ?? "")) return;
    working.current = true; setBusy(true); setError("");
    if (action === "dispatch") setAttempted(true);
    if (action === "banks") { setBanks([]); setBankId(""); reset(); }
    const abort = new AbortController(); controller.current = abort; const sequence = ++epoch.current;
    try {
      const response = await fetch(base + "/" + action, { method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, contactId, ...(action === "dispatch" ? simulationParameters(fields) : {}) }) });
      const raw: unknown = await response.json(); if (abort.signal.aborted || epoch.current !== sequence) return;
      if (!response.ok) throw Error(); const parsed = parseSimulationReply(raw);
      if (action === "banks") { if (!parsed.banks) throw Error(); setBanks(parsed.banks); }
      else { if (!Object.hasOwn(parsed, "operation")) throw Error(); setReply(parsed); if (action === "context") setContextReady(true); }
    } catch { if (!abort.signal.aborted && epoch.current === sequence) { if (action === "context") setContextReady(false); setError(action === "dispatch" ? "Resultado não confirmado. NÃO REPITA o POST. Consulte somente a intenção existente." : "Consulta indisponível. Nenhuma nova simulação deve ser presumida segura."); } }
    finally { if (!abort.signal.aborted && epoch.current === sequence) { working.current = false; setBusy(false); } }
  }
  return <section aria-label="Preparar simulação CLT" className="mt-4 rounded border border-line p-3">
    <h3 className="font-bold">Bancos disponíveis para simulação CLT</h3>
    <button type="button" disabled={busy} onClick={() => void request("banks")}>Carregar bancos CLT — somente leitura</button>
    <fieldset disabled={busy || attempted || !!reply?.operation}>
      <label>Escolha exatamente um banco<select value={bankId} onChange={e => { setBankId(e.target.value); reset(); }}><option value="">Selecione</option>{banks.map(b => <option key={b.bankId} value={b.bankId}>{b.bankName}</option>)}</select></label>
      {selected && <dl><div><dt>enabled</dt><dd>{Object.hasOwn(selected, "enabled") ? String(selected.enabled) : "unknown"}</dd></div>{simulationCapabilityKeys.map(key => <div key={key}><dt>{key}</dt><dd>{Object.hasOwn(selected.capabilities, key) ? String(selected.capabilities[key]) : "unknown"}</dd></div>)}</dl>}
      <p>Ausência de capability NÃO autoriza simular. Cadastro/validate devem ser revisados manualmente antes do envio.</p>
      <h3 className="font-bold">Preparar simulação CLT</h3>
      <label>Tipo de valor<select value={mode} onChange={e => { setMode(e.target.value as SimulationParameters["mode"]); setAmount(""); reset(); }}><option value="maximum">Margem máxima — valor omitido</option><option value="parcela">Parcela específica</option><option value="liberado">Valor liberado específico</option></select></label>
      {mode !== "maximum" && <label>Valor em reais, sem milhares (ex.: 1050,00)<input inputMode="decimal" value={amountBRL} onChange={e => { setAmount(e.target.value); reset(); }} /></label>}
      <div aria-label="Preview da simulação"><p>Produto: CLT. Banco: {selected?.bankName ?? "não escolhido"}.</p><p>Modo: {mode}.</p><p>{mode === "maximum" ? "valorSolicitado/tipoValorSolicitado omitidos explicitamente." : valid ? "R$ " + Math.floor(reaisToCents(amountBRL) / 100).toLocaleString("pt-BR") + "," + String(reaisToCents(amountBRL) % 100).padStart(2, "0") + " → " + reaisToCents(amountBRL) + " centavos." : "Informe um valor monetário válido."}</p></div>
      <label className="block"><input type="checkbox" checked={review} onChange={e => setReview(e.target.checked)} />Revisei cadastro, banco, parâmetros e autorização específica de simulação CLT.</label>
      <label className="block"><input type="checkbox" checked={risk} onChange={e => setRisk(e.target.checked)} />Entendo que esta consulta pode ser paga e não devo repetir se o resultado ficar pendente ou ambíguo.</label>
    </fieldset>
    <button type="button" disabled={busy || !authorizationActive} onClick={() => void request("context")}>Consultar intenção atual — sem simular</button>
    <button type="button" disabled={busy || attempted || !authorizationActive || !contextReady || !!reply?.operation || !eligible || !valid || !review || !risk} onClick={() => void request("dispatch")}>Executar simulação CLT</button>
    {reply?.operation && <p role="status">{reply.operation.displayState} — intenção {reply.operation.operationId}. UNKNOWN: DO NOT RETRY.</p>}
    {["PENDING", "SUCCEEDED"].includes(reply?.operation?.displayState ?? "") && <button type="button" disabled={busy} onClick={() => void request("poll")}>Consultar resultado por GET — sem novo POST de simulação</button>}
    {reply?.result && <div><p>Banco: {reply.result.bankId}; simulationId: {reply.result.simulationId}; status: {reply.result.status}; modo efetivo: {reply.result.simulationType ?? "não informado"}.</p><p>SUCCEEDED é conclusão técnica, não aprovação de crédito. Confira o modo efetivo retornado: o banco pode ignorar um valor específico.</p>{reply.result.offers.map(o => <div key={o.offerId}><p>Prazo: {o.installments}; parcela R$ {o.installmentAmount.toFixed(2)}; liberado: {o.liquidAmount === null ? "não informado" : "R$ " + o.liquidAmount.toFixed(2)}; taxa mensal: {o.interestRate === null ? "não informada" : o.interestRate + "%"}.</p></div>)}</div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
