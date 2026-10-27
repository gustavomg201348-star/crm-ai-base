"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OpenCreditCreateClientReconciliationPanel } from "./OpenCreditCreateClientReconciliationPanel";
import { parseOpenCreditCreateClientPhonePolicy, type OpenCreditCreateClientPhonePolicy } from "@/lib/opencredit-create-client-phone-policy";
import { createClientErrorMessage, isOpenCreditCommandId, parseCreateClientContext, parseCreateClientDispatchResponse,
  resolveCreateClientCommandId, type CreateClientContext } from "@/lib/opencredit-create-client-ui";

type Props = { enabled: boolean; companyId: string; contactId: string; authorizationActive: boolean };
const contextEndpoint = "/api/admin/integrations/opencredit/create-client/context";
const dispatchEndpoint = "/api/admin/integrations/opencredit/create-client/dispatch";
export function OpenCreditCreateClientPanel(props: Props) {
  if (!props.enabled) return null;
  return <Command key={JSON.stringify([props.companyId, props.contactId])} {...props} />;
}
function Command({ enabled, companyId, contactId, authorizationActive }: Props) {
  const [context, setContext] = useState<CreateClientContext | null>(null);
  const [confirmed, setConfirmed] = useState(false), [hidden, setHidden] = useState(false), [busy, setBusy] = useState(true);
  const [phonePolicy, setPhonePolicy] = useState<OpenCreditCreateClientPhonePolicy>("include");
  const [error, setError] = useState("");
  const working = useRef(false), sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const storageKey = "opencredit:create-client-command:" + companyId + ":" + contactId;
  const load = useCallback(async (message = "") => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const epoch = ++sequence.current; working.current = true; setBusy(true); setContext(null); setConfirmed(false); setError(message);
    try {
      const response = await fetch(contextEndpoint, { method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, contactId }) });
      if (abort.signal.aborted || sequence.current !== epoch) return;
      if (response.status === 401 || response.status === 403) { setHidden(true); return; }
      const raw: unknown = await response.json(); if (abort.signal.aborted || sequence.current !== epoch) return;
      const parsed = response.ok ? parseCreateClientContext(raw) : null;
      if (!parsed) { setError(response.ok ? createClientErrorMessage(null) : createClientErrorMessage(raw)); return; }
      // Persist only the server's authoritative UUID for PREPARED. Never clear pending on uncertainty.
      if (parsed.operation?.state === "PREPARED") sessionStorage.setItem(storageKey, parsed.operation.commandId);
      setContext(parsed);
    } catch { if (!abort.signal.aborted && sequence.current === epoch) { setContext(null); setError(createClientErrorMessage(null)); } }
    finally { if (!abort.signal.aborted && sequence.current === epoch) { working.current = false; setBusy(false); } }
  }, [companyId, contactId, storageKey]);
  const invalidate = useCallback(() => { sequence.current++; controller.current?.abort(); }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  async function send() {
    if (working.current || busy || hidden || !enabled || !authorizationActive || !confirmed || !context
      || context.operation !== null && context.operation.state !== "PREPARED") return;
    if (!window.confirm("Confirma o envio deste cliente à OpenCredit? Esta ação pode realizar um cadastro ou atualização externa e não deve ser repetida se o resultado ficar pendente.")) return;
    working.current = true; setBusy(true); setConfirmed(false); setError("");
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; const epoch = ++sequence.current;
    let message = createClientErrorMessage(null);
    try {
      const pending = sessionStorage.getItem(storageKey);
      let commandId: string | null;
      if (context.operation !== null) {
        commandId = context.operation.state === "PREPARED" ? context.operation.commandId : null;
      } else {
        commandId = resolveCreateClientCommandId({ operation: null, pendingCommandId: pending });
        if (!commandId) commandId = resolveCreateClientCommandId({ operation: null, pendingCommandId: null, generatedCommandId: crypto.randomUUID() });
      }
      if (!isOpenCreditCommandId(commandId)) throw Error("INVALID_COMMAND");
      sessionStorage.setItem(storageKey, commandId);
      const response = await fetch(dispatchEndpoint, { method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, contactId, commandId, phonePolicy }) });
      if (abort.signal.aborted || sequence.current !== epoch) return;
      if (response.status === 401 || response.status === 403) { setHidden(true); setContext(null); return; }
      const raw: unknown = await response.json(); if (abort.signal.aborted || sequence.current !== epoch) return;
      message = response.ok && parseCreateClientDispatchResponse(raw) ? "" : createClientErrorMessage(raw);
    } catch { if (abort.signal.aborted || sequence.current !== epoch) return; }
    // A browser abort does not cancel a committed server POST. Never reload another target.
    if (!abort.signal.aborted && sequence.current === epoch) await load(message);
  }
  if (hidden) return null;
  const state = context?.operation?.state;
  const canCommand = context !== null && (context.operation === null || state === "PREPARED");
  const labels = {
    PREPARED: "Existe uma solicitação preparada que ainda não iniciou o envio.",
    IN_FLIGHT: "Operação comprometida localmente para envio. Recebimento e processamento externos não confirmados. Não reenvie.",
    UNKNOWN: "O resultado do envio não foi confirmado. Não reenvie. É necessária conferência manual antes de qualquer nova ação.",
    SUCCEEDED: "Envio concluído na OpenCredit.", FAILED: "Operação bloqueada para revisão manual.",
  };
  return <section aria-label="Cadastro OpenCredit" className="mt-4 rounded border border-line p-3">
    <h4 className="font-bold">Cadastro OpenCredit</h4>
    {busy && <p role="status" className="mt-2 text-xs">Atualizando estado...</p>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
    {state && <p role="status" className="mt-2 text-sm">{labels[state]}</p>}
    {(state === "IN_FLIGHT" || state === "UNKNOWN" || state === "SUCCEEDED" || state === "PREPARED") && <OpenCreditCreateClientReconciliationPanel companyId={companyId} contactId={contactId} />}
    {canCommand && <>
      {!authorizationActive && <p className="mt-2 text-xs">Registre uma autorização OpenCredit ativa antes do cadastro.</p>}
      <label className="mt-3 block text-xs">Celular no payload OpenCredit
        <select aria-label="Política do celular OpenCredit" value={phonePolicy} disabled={busy || !authorizationActive}
          onChange={e => { setPhonePolicy(parseOpenCreditCreateClientPhonePolicy(e.target.value)); setConfirmed(false); }}
          className="mt-1 block w-full rounded border border-line p-2">
          <option value="include">INCLUDE — enviar como cadastrado (padrão)</option>
          <option value="omit">OMIT — não enviar celular</option>
        </select>
      </label>
      <p role="status" className="mt-2 text-xs">Phone policy: {phonePolicy.toUpperCase()}. {phonePolicy === "omit"
        ? "A propriedade celular será omitida do payload. O telefone no cadastro permanece preservado."
        : "O telefone será enviado exatamente como cadastrado, sem normalização."}</p>
      <label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} disabled={busy || !authorizationActive} onChange={e => setConfirmed(e.target.checked)} />Revisei o cadastro e confirmo o envio deste cliente à OpenCredit.</label>
      <button type="button" disabled={busy || !authorizationActive || !confirmed} onClick={() => void send()} className="mt-3 w-full rounded bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{state === "PREPARED" ? "Continuar cadastro na OpenCredit" : "Cadastrar na OpenCredit"}</button>
    </>}
    <button type="button" disabled={busy} onClick={() => void load()} className="mt-2 text-xs underline disabled:opacity-50">Atualizar painel</button>
  </section>;
}
