"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { correctionFields, type CorrectionFields } from "@/lib/opencredit-client-correction";

type Props = { companyId: string; contactId: string; authorizationActive: boolean };
type Operation = { operationId: string; state: string; revision: number };
const base = "/api/admin/integrations/opencredit/client-correction";
export function OpenCreditClientCorrectionPanel(props: Props) {
  return <Correction key={JSON.stringify([props.companyId, props.contactId, props.authorizationActive])} {...props} />;
}
function Correction({ companyId, contactId, authorizationActive }: Props) {
  const [fields, setFields] = useState<CorrectionFields>({ dataNascimento: "", nomeMae: "", email: "" });
  const [review, setReview] = useState(false), [risk, setRisk] = useState(false);
  const [preview, setPreview] = useState("");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const working = useRef(false), epoch = useRef(0), controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    const sequence = ++epoch.current; setReady(false); setReview(false); setRisk(false);
    if (!authorizationActive) return;
    working.current = true; setBusy(true);
    try {
      const response = await fetch(base + "/context", { method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, contactId }) });
      const value: unknown = await response.json();
      if (abort.signal.aborted || epoch.current !== sequence) return;
      if (!response.ok || !value || typeof value !== "object" || !("ok" in value) || value.ok !== true || !("phonePreview" in value)
        || value.phonePreview !== null && (typeof value.phonePreview !== "string" || !/^\(\*\*\) \*{5}-\d{4}$/.test(value.phonePreview)) || !("operation" in value)) throw Error();
      const op = value.operation;
      if (op !== null && (!op || typeof op !== "object" || !("operationId" in op) || typeof op.operationId !== "string" || !("state" in op)
        || typeof op.state !== "string" || !["PREPARED", "IN_FLIGHT", "SUCCEEDED", "FAILED", "UNKNOWN"].includes(op.state) || !("revision" in op) || !Number.isSafeInteger(op.revision))) throw Error();
      setPreview(value.phonePreview === null ? "" : value.phonePreview as string); setOperation(op as Operation | null); setReady(true); setError("");
    } catch { if (!abort.signal.aborted && epoch.current === sequence) setError("Contexto indisponível. Nenhuma atualização foi enviada."); }
    finally { if (!abort.signal.aborted && epoch.current === sequence) { working.current = false; setBusy(false); } }
  }, [companyId, contactId, authorizationActive]);
  const invalidate = useCallback(() => { epoch.current++; controller.current?.abort(); }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  function change(key: keyof CorrectionFields, value: string) { setFields(current => ({ ...current, [key]: value })); setReview(false); setRisk(false); }
  let valid = false; try { correctionFields(fields); valid = true; } catch { /* Show no raw validation error. */ }
  async function dispatch() {
    if (working.current || attempted || !ready || operation || !authorizationActive || !valid || !review || !risk) return;
    working.current = true; setBusy(true); setAttempted(true); setError("");
    const abort = new AbortController(); controller.current = abort; const sequence = ++epoch.current;
    try {
      const response = await fetch(base + "/dispatch", { method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, contactId, ...correctionFields(fields) }) });
      const value: unknown = await response.json(); if (abort.signal.aborted || epoch.current !== sequence) return;
      if (!response.ok || !value || typeof value !== "object" || !("operationId" in value) || typeof value.operationId !== "string"
        || !("state" in value) || typeof value.state !== "string" || !["PREPARED", "IN_FLIGHT", "SUCCEEDED", "FAILED", "UNKNOWN"].includes(value.state)
        || !("revision" in value) || !Number.isSafeInteger(value.revision)) throw Error();
      setOperation({ operationId: value.operationId, state: value.state, revision: value.revision as number });
    } catch { if (!abort.signal.aborted && epoch.current === sequence) setError("Resultado não confirmado. Não repita a atualização; reconcilie a intenção existente."); }
    finally { if (!abort.signal.aborted && epoch.current === sequence) { working.current = false; setBusy(false); } }
  }
  return <section aria-label="Corrigir cadastro OpenCredit" className="mt-4 rounded border border-line p-3">
    <h3 className="font-bold">Corrigir cadastro OpenCredit</h3>
    <p className="text-xs">Requer autorização operacional específica de atualização cadastral. Cada GRANTED permite uma única intenção. UNKNOWN: NÃO REPETIR.</p>
    {!authorizationActive && <p role="status">Registre primeiro a autorização de atualização cadastral.</p>}
    {error && <p role="alert">{error}</p>}
    {operation && <p role="status">Intenção atual: {operation.state}. Nenhum reenvio permitido para este GRANTED.</p>}
    <fieldset disabled={busy || attempted || !!operation || !ready} className="mt-2 space-y-2">
      <label className="block">Nascimento (DD/MM/AAAA)<input value={fields.dataNascimento} maxLength={10} onChange={e => change("dataNascimento", e.target.value)} /></label>
      <label className="block">Nome da mãe<input value={fields.nomeMae} maxLength={160} onChange={e => change("nomeMae", e.target.value)} /></label>
      <label className="block">Email<input type="email" value={fields.email} maxLength={254} onChange={e => change("email", e.target.value)} /></label>
      <div aria-label="Preview de correção"><p>Nascimento: {fields.dataNascimento}</p><p>Nome da mãe: {fields.nomeMae.trim()}</p><p>Email: {fields.email.trim()}</p><p>Celular: {preview || "indisponível"} — DDD+número, sem DDI. Contact preservado.</p></div>
      <label className="block"><input type="checkbox" checked={review} onChange={e => setReview(e.target.checked)} />Revisei os dados e confirmo a atualização cadastral na OpenCredit.</label>
      <label className="block"><input type="checkbox" checked={risk} onChange={e => setRisk(e.target.checked)} />Entendo que esta ação altera o cadastro externo e não deve ser repetida se o resultado ficar pendente ou ambíguo.</label>
    </fieldset>
    <button type="button" disabled={busy || attempted || !ready || !!operation || !authorizationActive || !valid || !review || !risk} onClick={() => void dispatch()}>Confirmar atualização cadastral</button>
    <button type="button" disabled={busy || !authorizationActive} onClick={() => void load()}>Consultar estado — sem reenvio</button>
  </section>;
}
