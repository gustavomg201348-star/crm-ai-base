"use client";

import { useRef, useState } from "react";

export const canaryMessages: Readonly<Record<string, string>> = {
  SENT: "Template enviado pelo WhatsApp configurado.",
  ALREADY_STARTED: "Este lead já teve o atendimento WhatsApp iniciado.",
  UNKNOWN: "O resultado do envio é incerto. Não tente novamente até verificar o status.",
  TEMPLATE_UNAVAILABLE: "Template configurado indisponível.",
  IDENTITY_UNAVAILABLE: "Telefone ou identidade do lead indisponível.",
  AUTOMATION_NOT_ALLOWED: "A configuração atual da IA ou do atendimento não permite iniciar este lead.",
  CONFIGURATION_MISSING: "Configuração OpenCredit → WhatsApp incompleta.",
  CHANNEL_INVALID: "Configuração OpenCredit → WhatsApp incompleta.",
  RATE_LIMITED: "Limite de tentativas atingido. Aguarde antes de tentar novamente.",
};
export function OpenCreditWhatsappCanary({ conversationId, onStarted }: { conversationId: string; onStarted(): void }) {
  const busy = useRef(false);
  const [confirm, setConfirm] = useState(false), [sending, setSending] = useState(false);
  const [message, setMessage] = useState(""), [locked, setLocked] = useState(false);
  async function send() {
    if (busy.current || locked) return;
    busy.current = true; setSending(true); setMessage("");
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/opencredit/bootstrap`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const data = await response.json();
      const status = response.ok ? data.status : data.error;
      setMessage(canaryMessages[status] ?? "Não foi possível confirmar o envio. Verifique o atendimento antes de tentar novamente.");
      // Ambiguous transport/errors must not invite an automatic retry.
      if (["SENT", "ALREADY_STARTED", "UNKNOWN"].includes(status) || !canaryMessages[status]) setLocked(true);
      if (status === "SENT") onStarted();
    } catch {
      setMessage(canaryMessages.UNKNOWN); setLocked(true);
    } finally { busy.current = false; setSending(false); setConfirm(false); }
  }
  return <div className="shrink-0 border-b border-line/70 px-3 py-2 text-sm">
    <button type="button" disabled={sending || locked} onClick={() => setConfirm(true)}
      className="rounded-lg border border-blue-200 px-3 py-2 font-semibold text-blue-700 disabled:opacity-50">
      {sending ? "Enviando..." : "Iniciar WhatsApp"}
    </button>
    {message && <p role="status" className="mt-2">{message}</p>}
    {confirm && <div role="dialog" aria-modal="true" aria-label="Iniciar WhatsApp" className="mt-2 rounded-lg border bg-white p-3">
      <p>Enviar o template inicial configurado para este lead pelo WhatsApp padrão da OpenCredit? Esta ação afeta somente este lead e não ativa o AutoStart.</p>
      <div className="mt-3 flex gap-3">
        <button type="button" disabled={sending} onClick={() => setConfirm(false)}>Cancelar</button>
        <button type="button" disabled={sending} onClick={() => void send()}>{sending ? "Enviando..." : "Enviar template"}</button>
      </div>
    </div>}
  </div>;
}
