"use client";

import { FormEvent, useState } from "react";
import { BarChart3, Check, Eye, EyeOff, LockKeyhole, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";

type LoginScreenProps = {
  error: string;
  onLogin: (email: string, password: string) => Promise<void>;
};

const benefits = [
  { title: "Atendimento centralizado", description: "Conversas em um só lugar", Icon: MessageSquareText },
  { title: "Oportunidades inteligentes", description: "Priorização comercial", Icon: BarChart3 },
  { title: "Contexto preservado", description: "Histórico da operação", Icon: ShieldCheck }
];

export function LoginScreen({ error, onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setValidationError("Informe um e-mail válido.");
      return;
    }
    if (!password) {
      setValidationError("Informe sua senha.");
      return;
    }
    setValidationError("");
    setLoading(true);
    try {
      await onLogin(normalizedEmail, password);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#030a1c] text-[#f1f5ff]">
      <div className="relative grid min-h-screen grid-cols-1 overflow-hidden bg-[radial-gradient(ellipse_750px_520px_at_30%_15%,rgba(26,63,208,0.34),transparent_65%),radial-gradient(ellipse_540px_420px_at_100%_100%,rgba(14,127,166,0.2),transparent_65%),linear-gradient(160deg,#071638,#030a1c_65%)] lg:grid-cols-[1.3fr_1fr]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.07)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_35%_35%,black_15%,transparent_75%)]" />

        <section className="relative flex flex-col border-white/10 px-6 pt-7 lg:min-h-screen lg:border-r lg:px-12 lg:pb-10 lg:pt-11 xl:px-14">
          <div>
            <p className="text-[27px] font-black leading-none tracking-[0.17em] sm:text-[30px]">QE<span className="text-[#5aa2ff]">V</span>ORA</p>
            <p className="mt-2.5 text-[10px] font-semibold tracking-[0.2em] text-[#86b2f3] sm:text-[11px]">INTELIGÊNCIA PARA OPERAÇÕES COMERCIAIS</p>
            <div className="mt-9 hidden w-fit items-center gap-2 rounded-full border border-[#5aa2ff]/35 bg-blue-600/10 px-4 py-2 text-[11px] font-semibold tracking-[0.09em] text-[#a8cdff] lg:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[#5aa2ff]" /> PLATAFORMA DE OPERAÇÕES COMERCIAIS
            </div>
            <h1 className="mt-7 max-w-[650px] text-[27px] font-bold leading-[1.12] tracking-tight sm:text-4xl lg:text-[clamp(34px,3.7vw,52px)]">
              Operações comerciais, com <span className="bg-gradient-to-r from-[#7db4ff] to-[#a99bff] bg-clip-text text-transparent">inteligência</span> e contexto.
            </h1>
            <p className="mt-4 hidden max-w-lg text-base leading-7 text-[#9db0d3] lg:block">Conecte conversas, oportunidades e decisões em uma única operação.</p>

            <div className="mt-8 hidden max-w-3xl grid-cols-3 gap-3 lg:grid">
              {benefits.map(({ title, description, Icon }) => (
                <div key={title} className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-5 backdrop-blur-sm">
                  <Icon aria-hidden="true" className="mb-4 h-7 w-7 text-[#5aa2ff]" strokeWidth={1.6} />
                  <h2 className="text-sm font-semibold">{title}</h2>
                  <p className="mt-1 text-xs leading-5 text-[#9db0d3]">{description}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 hidden flex-wrap gap-2 lg:flex">
              {["WhatsApp", "Instagram", "IA contextual", "Analytics"].map(item => (
                <span key={item} className="rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-xs text-[#dce6fb]">{item}</span>
              ))}
            </div>
          </div>

          <div className="mt-auto hidden max-w-3xl pt-10 lg:block">
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.15em] text-[#8ba4d0]"><Sparkles aria-hidden="true" className="h-4 w-4 text-emerald-300" /> ORGANIZAÇÃO COMERCIAL EM UM SÓ LUGAR</p>
            <div className="mt-3 flex items-center gap-4 rounded-2xl border border-white/10 bg-[#0a173a]/70 px-5 py-5">
              <div aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 text-sm font-bold">Q</div>
              <p className="text-sm leading-6 text-[#dbe6fb]">Atendimento, histórico e oportunidades conectados para sua equipe trabalhar com mais contexto.</p>
            </div>
          </div>
        </section>

        <section className="relative flex min-h-[620px] flex-col px-4 pb-6 pt-4 sm:px-7 lg:min-h-screen lg:px-8 lg:pt-7">
          <div className="flex flex-1 items-center justify-center py-5">
            <form onSubmit={handleSubmit} noValidate className="w-full max-w-[410px] rounded-[22px] border border-white/15 bg-[#0d1a3a]/90 px-6 pb-7 pt-9 shadow-[0_30px_70px_-20px_rgba(0,0,0,0.65)] backdrop-blur-xl sm:px-8">
              <p className="text-center text-xs font-bold tracking-[0.2em] text-[#c9d8f5]">QE<span className="text-[#5aa2ff]">V</span>ORA</p>
              <h2 className="mt-4 text-center text-2xl font-bold tracking-tight">Bem-vindo à QEVORA</h2>
              <p className="mb-7 mt-2 text-center text-sm text-[#9db0d3]">Acesse sua operação para continuar.</p>

              <label htmlFor="qevora-login-email" className="mb-2 block text-[13px] font-semibold text-[#dfe8fb]">E-mail</label>
              <input id="qevora-login-email" name="email" autoComplete="username" inputMode="email" type="email" value={email} onChange={event => { setEmail(event.target.value); setValidationError(""); }}
                placeholder="voce@empresa.com.br" aria-invalid={Boolean(validationError && (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())))}
                className="mb-4 h-[46px] w-full rounded-xl border border-transparent bg-[#e9f0fd] px-4 text-sm text-[#0b1530] outline-none placeholder:text-[#7c88a3] focus:border-[#5aa2ff] focus:ring-4 focus:ring-[#5aa2ff]/20" />

              <label htmlFor="qevora-login-password" className="mb-2 block text-[13px] font-semibold text-[#dfe8fb]">Senha</label>
              <div className="relative">
                <input id="qevora-login-password" name="password" autoComplete="current-password" type={showPassword ? "text" : "password"} value={password}
                  onChange={event => { setPassword(event.target.value); setValidationError(""); }}
                  onKeyUp={event => setCapsLock(event.getModifierState("CapsLock"))} onBlur={() => setCapsLock(false)}
                  placeholder="Sua senha" className="h-[46px] w-full rounded-xl border border-transparent bg-[#e9f0fd] py-2 pl-4 pr-12 text-sm text-[#0b1530] outline-none placeholder:text-[#7c88a3] focus:border-[#5aa2ff] focus:ring-4 focus:ring-[#5aa2ff]/20" />
                <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute inset-y-1 right-1 grid w-10 place-items-center rounded-lg text-[#596b91] hover:text-[#0b1530] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5aa2ff]">
                  {showPassword ? <EyeOff aria-hidden="true" size={19} /> : <Eye aria-hidden="true" size={19} />}
                </button>
              </div>
              {capsLock && <p className="mt-2 text-xs text-amber-300">Caps Lock está ativado.</p>}
              {(validationError || error) && <p role="alert" className="mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">{validationError || error}</p>}

              <button type="submit" disabled={loading} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2b3cf0] via-[#5b6ef0] to-[#6d7cff] text-sm font-semibold text-white shadow-[0_10px_26px_-10px_#4a5cff] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a8cdff] disabled:cursor-wait disabled:opacity-70">
                {loading ? <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <LockKeyhole aria-hidden="true" size={16} />}
                {loading ? "Entrando..." : "Entrar"}
              </button>
              <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-[#8ea2c7]"><ShieldCheck aria-hidden="true" size={15} className="text-emerald-400" /> Acesso protegido</p>
            </form>
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-[#8ea2c7]">
            <span className="flex items-center gap-2"><Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-400" /> QEVORA CRM</span>
            <span>© 2026 QEVORA</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
