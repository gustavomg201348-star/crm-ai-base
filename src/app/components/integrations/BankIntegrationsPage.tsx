"use client";
import { useEffect, useState, useRef } from "react";
import clsx from "clsx";
type CltIntegrationRow = {
  id: string;
  bankId: string;
  bankName: string;
  provider: string;
  baseUrl?: string | null;
  authType: string;
  hasApiKey: boolean;
  apiKeyPreview?: string | null;
  hasUsername: boolean;
  usernamePreview?: string | null;
  hasPassword: boolean;
  hasNewcorbanIdentifier: boolean;
  hasDigitadorCode: boolean;
  hasCertifiedAgentCpf: boolean;
  certifiedAgentCpfPreview?: string | null;
  actingUf?: string | null;
  smsStatus?: string | null;
  smsRequestedAt?: string | null;
  status: string;
  lastTestAt?: string | null;
  lastTestStatus?: string | null;
  lastTestMessage?: string | null;
  updatedAt: string;
};

export function BankIntegrationsPage() {
  const [busy, setBusy] = useState(false),
    [fallback, setFallback] = useState(false);
  const mutation = useRef(false);
  const [catalog, setCatalog] = useState<
    Array<{ id: string; name: string; provider: string }>
  >([]);
  const [catalogError, setCatalogError] = useState("");
  async function loadCatalog(signal?: AbortSignal) {
    try {
      const r = await fetch("/api/clt/banks", { cache: "no-store", signal });
      if (!r.ok) throw Error("CATALOG_FAILED");
      const data = await r.json();
      if (!signal?.aborted) {
        setCatalog(data.banks);
        setCatalogError("");
      }
    } catch {
      if (!signal?.aborted)
        setCatalogError(
          "Catálogo bancário indisponível. Atualize para tentar novamente; configurações já cadastradas continuam listadas.",
        );
    }
  }
  async function runAction(work: () => Promise<void>) {
    if (mutation.current || fallback) return;
    mutation.current = true;
    setBusy(true);
    try {
      await work();
    } catch {
      setMessage(
        "Não foi possível confirmar a operação. Atualize antes de tentar novamente.",
      );
    } finally {
      mutation.current = false;
      setBusy(false);
      setTestingBankId("");
      setAuthenticatingBankId("");
      setVerifyingSmsBankId("");
    }
  }
  const [integrations, setIntegrations] = useState<CltIntegrationRow[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [testingBankId, setTestingBankId] = useState("");
  const [authenticatingBankId, setAuthenticatingBankId] = useState("");
  const [verifyingSmsBankId, setVerifyingSmsBankId] = useState("");
  const [message, setMessage] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [integrationForm, setIntegrationForm] = useState({
    bankId: "",
    provider: "manual",
    baseUrl: "",
    authType: "none",
    apiKey: "",
    username: "",
    password: "",
    newcorbanIdentifier: "",
    smsCode: "",
    digitadorCode: "",
    certifiedAgentCpf: "",
    actingUf: "",
    status: "MANUAL",
  });

  const selectedIntegration = integrations.find(
    (integration) => integration.bankId === integrationForm.bankId,
  );
  async function loadCltIntegrations(signal?: AbortSignal) {
    setLoadingIntegrations(true);
    setLoadError("");
    try {
      const response = await fetch("/api/clt/integrations", {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw Error("READ_FAILED");
      if (response.ok) {
        const data = (await response.json()) as {
          integrations: CltIntegrationRow[];
          fallback?: boolean;
        };
        if (signal?.aborted) return;
        setFallback(Boolean(data.fallback));
        if (!data.fallback) setUpdatedAt(new Date().toISOString());
        setIntegrations(data.integrations);
        const first = data.integrations[0];
        if (first) {
          setIntegrationForm((current) => {
            const selected =
              data.integrations.find((i) => i.bankId === current.bankId) ??
              first;
            return {
              bankId: selected.bankId,
              provider: selected.provider,
              baseUrl: selected.baseUrl || "",
              authType: selected.authType,
              apiKey: "",
              username: "",
              password: "",
              newcorbanIdentifier: "",
              smsCode: "",
              digitadorCode: "",
              certifiedAgentCpf: "",
              actingUf: selected.actingUf || "",
              status: selected.status,
            };
          });
        }
      }
    } catch {
      setIntegrations([]);
      setFallback(true);
      throw Error("READ_FAILED");
    } finally {
      setLoadingIntegrations(false);
    }
  }

  useEffect(() => {
    const abort = new AbortController();
    void loadCatalog(abort.signal);
    void loadCltIntegrations(abort.signal).catch(() => {
      if (abort.signal.aborted) return;
      setIntegrations([]);
      setLoadingIntegrations(false);
      setLoadError("Não foi possível carregar as integrações bancárias.");
    });
    return () => abort.abort();
  }, []);
  const [loadError, setLoadError] = useState("");
  async function reload() {
    try {
      await Promise.all([loadCltIntegrations(), loadCatalog()]);
    } catch {
      setLoadingIntegrations(false);
      setIntegrations([]);
      setFallback(true);
      setLoadError("Não foi possível carregar as integrações bancárias.");
    }
  }
  function selectIntegration(bankId: string) {
    const integration = integrations.find((item) => item.bankId === bankId);
    if (!integration) {
      const bank = catalog.find((b) => b.id === bankId);
      if (bank)
        setIntegrationForm({
          bankId: bank.id,
          provider: bank.provider,
          baseUrl: "",
          authType: bank.provider === "newcorban" ? "login-sms" : "none",
          apiKey: "",
          username: "",
          password: "",
          newcorbanIdentifier: "",
          smsCode: "",
          digitadorCode: "",
          certifiedAgentCpf: "",
          actingUf: "",
          status: bank.provider === "manual" ? "MANUAL" : "PENDING",
        });
      return;
    }
    setIntegrationForm({
      bankId: integration.bankId,
      provider: integration.provider,
      baseUrl: integration.baseUrl || "",
      authType: integration.authType,
      apiKey: "",
      username: "",
      password: "",
      newcorbanIdentifier: "",
      smsCode: "",
      digitadorCode: "",
      certifiedAgentCpf: "",
      actingUf: integration.actingUf || "",
      status: integration.status,
    });
  }

  function cltSensitiveValue(value: string) {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  function cltSensitivePasswordValue(value: string) {
    return value.trim() ? value : undefined;
  }

  async function saveIntegration() {
    setMessage("");
    const payload = {
      bankId: integrationForm.bankId,
      provider: integrationForm.provider,
      baseUrl: integrationForm.baseUrl,
      authType: integrationForm.authType,
      ...(cltSensitiveValue(integrationForm.apiKey)
        ? { apiKey: cltSensitiveValue(integrationForm.apiKey) }
        : {}),
      ...(cltSensitiveValue(integrationForm.username)
        ? { username: cltSensitiveValue(integrationForm.username) }
        : {}),
      ...(cltSensitivePasswordValue(integrationForm.password)
        ? { password: cltSensitivePasswordValue(integrationForm.password) }
        : {}),
      ...(cltSensitiveValue(integrationForm.newcorbanIdentifier)
        ? {
            newcorbanIdentifier: cltSensitiveValue(
              integrationForm.newcorbanIdentifier,
            ),
          }
        : {}),
      ...(cltSensitiveValue(integrationForm.digitadorCode)
        ? { digitadorCode: cltSensitiveValue(integrationForm.digitadorCode) }
        : {}),
      ...(cltSensitiveValue(integrationForm.certifiedAgentCpf)
        ? {
            certifiedAgentCpf: cltSensitiveValue(
              integrationForm.certifiedAgentCpf,
            ),
          }
        : {}),
      actingUf: integrationForm.actingUf,
      status: integrationForm.status,
    };
    const response = await fetch("/api/clt/integrations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (response.ok) {
      setMessage("Integracao CLT salva.");
      await loadCltIntegrations();
    } else {
      setMessage(data?.error || "Nao foi possivel salvar integracao CLT.");
    }
  }

  async function authenticateNewcorban() {
    if (!integrationForm.bankId) return;
    if (!integrationForm.username.trim() && !selectedIntegration?.hasUsername) {
      setMessage(
        "Informe o usuario do banco ou salve a integracao com o usuario antes de entrar no perfil.",
      );
      return;
    }
    if (!integrationForm.password.trim() && !selectedIntegration?.hasPassword) {
      setMessage(
        "Informe a senha do banco ou salve a integracao com a senha antes de entrar no perfil.",
      );
      return;
    }
    setAuthenticatingBankId(integrationForm.bankId);
    setMessage("");
    const payload = {
      bankId: integrationForm.bankId,
      ...(cltSensitiveValue(integrationForm.username)
        ? { username: cltSensitiveValue(integrationForm.username) }
        : {}),
      ...(cltSensitivePasswordValue(integrationForm.password)
        ? { password: cltSensitivePasswordValue(integrationForm.password) }
        : {}),
    };
    try {
      const response = await fetch("/api/clt/integrations/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        integration?: CltIntegrationRow;
      } | null;

      if (response.ok) {
        setMessage(data?.message || "Fluxo assistido preparado.");
        if (data?.integration) {
          setIntegrations((current) =>
            current.map((item) =>
              item.bankId === data.integration!.bankId
                ? data.integration!
                : item,
            ),
          );
        }
        await loadCltIntegrations();
      } else {
        setMessage(data?.error || "Nao foi possivel autenticar Newcorban.");
      }
    } catch {
      setMessage(
        "Falha de conexao ao preparar autenticacao Newcorban. Tente novamente.",
      );
    } finally {
      setAuthenticatingBankId("");
    }
  }

  async function verifyNewcorbanSms() {
    if (!integrationForm.bankId) return;
    setVerifyingSmsBankId(integrationForm.bankId);
    setMessage("");
    const payload = {
      bankId: integrationForm.bankId,
      smsCode: integrationForm.smsCode,
      ...(cltSensitiveValue(integrationForm.newcorbanIdentifier)
        ? {
            newcorbanIdentifier: cltSensitiveValue(
              integrationForm.newcorbanIdentifier,
            ),
          }
        : {}),
      ...(cltSensitiveValue(integrationForm.digitadorCode)
        ? { digitadorCode: cltSensitiveValue(integrationForm.digitadorCode) }
        : {}),
      ...(cltSensitiveValue(integrationForm.certifiedAgentCpf)
        ? {
            certifiedAgentCpf: cltSensitiveValue(
              integrationForm.certifiedAgentCpf,
            ),
          }
        : {}),
      actingUf: integrationForm.actingUf,
    };
    const response = await fetch("/api/clt/integrations/verify-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
      integration?: CltIntegrationRow;
    } | null;

    if (response.ok) {
      setMessage(data?.message || "Credenciais salvas.");
      if (data?.integration) {
        setIntegrations((current) =>
          current.map((item) =>
            item.bankId === data.integration!.bankId ? data.integration! : item,
          ),
        );
        setIntegrationForm((current) => ({
          ...current,
          smsCode: "",
          status: data.integration!.status,
        }));
      }
      await loadCltIntegrations();
    } else {
      setMessage(data?.error || "Nao foi possivel validar SMS.");
    }
    setVerifyingSmsBankId("");
  }

  async function testIntegration(bankId: string) {
    setTestingBankId(bankId);
    setMessage("");
    const response = await fetch("/api/clt/integrations/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankId }),
    });
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (response.ok) {
      setMessage("Teste de integracao CLT concluido.");
      await loadCltIntegrations();
    } else {
      setMessage(data?.error || "Nao foi possivel testar integracao CLT.");
    }
    setTestingBankId("");
  }

  return (
    <section className="space-y-4">
      <header className="rounded-2xl bg-[#0b2445] p-5 text-white">
        <h1 className="text-xl font-bold">Integrações bancárias</h1>
        <p className="mt-1 text-sm text-blue-100">
          Configuração administrativa · Simulação CLT permanece no módulo
          operacional.
        </p>
        <button
          type="button"
          className="mt-3 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-50"
          disabled={busy || loadingIntegrations}
          onClick={() => void reload()}
        >
          Atualizar integrações bancárias
        </button>
        <p className="mt-2 text-xs text-blue-200">
          Última leitura confirmada:{" "}
          {updatedAt
            ? new Date(updatedAt).toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo",
              })
            : "Não registrada"}{" "}
          · Atualização manual
        </p>
      </header>
      <p className="rounded-xl border bg-amber-50 p-3 text-sm text-amber-900">
        Estado cadastrado não comprova disponibilidade atual do banco. Nenhuma
        conexão é testada ao abrir esta página. Verificar configuração valida
        dados locais, sem comprovar conexão externa. Autenticação exige ação explícita.
      </p>
      {loadError && <p role="alert">{loadError}</p>}
      {catalogError && <p role="alert">{catalogError}</p>}
      {fallback && (
        <p
          role="alert"
          className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
        >
          Estado do banco indisponível. O catálogo retornado é fallback, não
          configuração comprovada. Ações bloqueadas até atualizar com sucesso.
        </p>
      )}
      {loadingIntegrations && <p role="status">Carregando integrações…</p>}
      {message && (
        <p role="status" className="rounded-xl border bg-white p-3 text-sm">
          {message}
        </p>
      )}{" "}
      <fieldset
        disabled={busy || loadingIntegrations || fallback}
        className="rounded-[24px] border border-line bg-white p-5 shadow-soft"
      >
        <label className="mb-4 block text-sm font-semibold">
          Instituição financeira
          <select
            aria-label="Instituição financeira"
            className="ml-2 max-w-full rounded-xl border p-2"
            value={integrationForm.bankId}
            onChange={(e) => selectIntegration(e.target.value)}
          >
            <option value="">Selecione um banco</option>
            {catalog.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {integrations.some((i) => i.bankId === b.id)
                  ? ""
                  : " · Sem configuração local"}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-950">
              Integrações CLT
            </h3>
            <p className="text-sm text-slate-500">
              Configure o provider de cada banco antes da API real.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[0.8fr_1.2fr]">
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {integrations.map((integration) => (
              <button
                key={integration.id}
                type="button"
                className={clsx(
                  "w-full rounded-2xl border p-3 text-left",
                  integrationForm.bankId === integration.bankId
                    ? "border-brand bg-blue-50"
                    : "border-line bg-white hover:bg-slate-50",
                )}
                onClick={() => selectIntegration(integration.bankId)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-black text-slate-900">
                    {integration.bankName}
                  </p>
                  <IntegrationStatusBadge status={integration.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {integration.provider} · {integration.authType}
                  <span className="mt-1 block">
                    Última verificação:{" "}
                    {integration.lastTestAt
                      ? new Date(integration.lastTestAt).toLocaleString("pt-BR")
                      : "Não registrada"}{" "}
                    ·{" "}
                    {integration.lastTestStatus === "SUCCESS"
                      ? "Sucesso registrado"
                      : integration.lastTestStatus === "ERROR"
                        ? "Erro registrado"
                        : "Desconhecida"}
                  </span>
                </p>
                {integration.lastTestMessage && (
                  <p className="mt-2 line-clamp-2 text-xs text-slate-500">
                    Há um diagnóstico registrado; consulte o estado técnico e a
                    data da última verificação.
                  </p>
                )}
              </button>
            ))}
            {!loadingIntegrations && !integrations.length && (
              <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-slate-500">
                Nenhuma integração CLT cadastrada.
              </p>
            )}
          </div>

          <div className="grid gap-3 rounded-2xl border border-line bg-slate-50 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold uppercase text-slate-500">
                Provider
                <select
                  className="mt-2 h-10 w-full rounded-2xl border border-line bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-brand"
                  value={integrationForm.provider}
                  onChange={(event) =>
                    setIntegrationForm((current) => ({
                      ...current,
                      provider: event.target.value,
                      status:
                        event.target.value === "manual" ? "MANUAL" : "PENDING",
                    }))
                  }
                >
                  <option value="manual">Manual</option>
                  <option value="newcorban">New Corban</option>
                  <option value="bank-api">API do banco</option>
                </select>
              </label>
              <label className="text-xs font-bold uppercase text-slate-500">
                Autenticação
                <select
                  className="mt-2 h-10 w-full rounded-2xl border border-line bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none focus:border-brand"
                  value={integrationForm.authType}
                  onChange={(event) =>
                    setIntegrationForm((current) => ({
                      ...current,
                      authType: event.target.value,
                    }))
                  }
                >
                  <option value="none">Sem autenticação</option>
                  <option value="login-sms">Login + SMS</option>
                  <option value="api-key">API Key</option>
                  <option value="basic">Usuário e senha</option>
                  <option value="oauth">OAuth/Token</option>
                </select>
              </label>
            </div>
            <ContactInput
              placeholder="URL base da API"
              value={integrationForm.baseUrl}
              onChange={(value) =>
                setIntegrationForm((current) => ({
                  ...current,
                  baseUrl: value,
                }))
              }
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <ContactInput
                placeholder={
                  selectedIntegration?.apiKeyPreview
                    ? `Token (${selectedIntegration.apiKeyPreview})`
                    : "Token/API key"
                }
                value={integrationForm.apiKey}
                onChange={(value) =>
                  setIntegrationForm((current) => ({
                    ...current,
                    apiKey: value,
                  }))
                }
              />
              <ContactInput
                placeholder={
                  selectedIntegration?.usernamePreview
                    ? `Usuario (${selectedIntegration.usernamePreview})`
                    : selectedIntegration?.hasUsername
                      ? "Usuario cadastrado"
                      : "Usuario"
                }
                value={integrationForm.username}
                onChange={(value) =>
                  setIntegrationForm((current) => ({
                    ...current,
                    username: value,
                  }))
                }
              />
              <ContactInput
                placeholder={
                  selectedIntegration?.hasPassword
                    ? "Senha cadastrada"
                    : "Senha"
                }
                value={integrationForm.password}
                onChange={(value) =>
                  setIntegrationForm((current) => ({
                    ...current,
                    password: value,
                  }))
                }
              />
            </div>
            {integrationForm.provider === "newcorban" && (
              <div className="grid gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-3">
                <div>
                  <p className="text-sm font-black text-brand">
                    Credenciais Mercantil/Newcorban
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Primeiro salve ou confirme o login e a senha. Nesta etapa o
                    CRM apenas prepara a autenticacao assistida; o SMS real
                    ainda precisa ser solicitado no Newcorban ate conectarmos a
                    automacao/API do banco.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    className="h-10 flex-1 rounded-2xl bg-brand px-4 text-sm font-bold text-white shadow-soft disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                    disabled={
                      !integrationForm.bankId ||
                      (!integrationForm.username.trim() &&
                        !selectedIntegration?.hasUsername) ||
                      (!integrationForm.password.trim() &&
                        !selectedIntegration?.hasPassword) ||
                      authenticatingBankId === integrationForm.bankId
                    }
                    onClick={() => void runAction(authenticateNewcorban)}
                  >
                    {authenticatingBankId === integrationForm.bankId
                      ? "Preparando..."
                      : "Preparar autenticacao assistida"}
                  </button>
                  <span className="flex items-center rounded-2xl bg-white px-3 text-xs font-bold text-slate-500">
                    SMS: {selectedIntegration?.smsStatus || "nao solicitado"}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ContactInput
                    placeholder="Codigo SMS"
                    value={integrationForm.smsCode}
                    onChange={(value) =>
                      setIntegrationForm((current) => ({
                        ...current,
                        smsCode: value,
                      }))
                    }
                  />
                  <ContactInput
                    placeholder={
                      selectedIntegration?.hasNewcorbanIdentifier
                        ? "Identificador ja configurado"
                        : "Identificador (opcional)"
                    }
                    value={integrationForm.newcorbanIdentifier}
                    onChange={(value) =>
                      setIntegrationForm((current) => ({
                        ...current,
                        newcorbanIdentifier: value,
                      }))
                    }
                  />
                  <ContactInput
                    placeholder={
                      selectedIntegration?.hasDigitadorCode
                        ? "Cod. Usuario Digitador cadastrado"
                        : "Cod. Usuario Digitador"
                    }
                    value={integrationForm.digitadorCode}
                    onChange={(value) =>
                      setIntegrationForm((current) => ({
                        ...current,
                        digitadorCode: value,
                      }))
                    }
                  />
                  <ContactInput
                    placeholder={
                      selectedIntegration?.certifiedAgentCpfPreview
                        ? `CPF Agente Certificado (${selectedIntegration.certifiedAgentCpfPreview})`
                        : selectedIntegration?.hasCertifiedAgentCpf
                          ? "CPF Agente Certificado cadastrado"
                          : "CPF Agente Certificado"
                    }
                    value={integrationForm.certifiedAgentCpf}
                    onChange={(value) =>
                      setIntegrationForm((current) => ({
                        ...current,
                        certifiedAgentCpf: value,
                      }))
                    }
                  />
                  <ContactInput
                    placeholder="UF Atuacao"
                    value={integrationForm.actingUf}
                    onChange={(value) =>
                      setIntegrationForm((current) => ({
                        ...current,
                        actingUf: value.toUpperCase(),
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="h-10 rounded-2xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-60"
                    disabled={
                      !integrationForm.bankId ||
                      !integrationForm.smsCode.trim() ||
                      (!integrationForm.digitadorCode.trim() &&
                        !selectedIntegration?.hasDigitadorCode) ||
                      (!integrationForm.certifiedAgentCpf.trim() &&
                        !selectedIntegration?.hasCertifiedAgentCpf) ||
                      !integrationForm.actingUf.trim() ||
                      verifyingSmsBankId === integrationForm.bankId
                    }
                    onClick={() => void runAction(verifyNewcorbanSms)}
                  >
                    {verifyingSmsBankId === integrationForm.bankId
                      ? "Validando..."
                      : "Validar SMS e salvar"}
                  </button>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={!integrationForm.bankId}
                className="h-10 flex-1 rounded-2xl bg-brand px-4 text-sm font-bold text-white shadow-soft hover:bg-blue-700"
                onClick={() => void runAction(saveIntegration)}
              >
                Salvar login e senha
              </button>
              <button
                type="button"
                className="h-10 flex-1 rounded-2xl border border-line bg-white px-4 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                disabled={
                  !integrationForm.bankId ||
                  testingBankId === integrationForm.bankId
                }
                onClick={() =>
                  void runAction(() => testIntegration(integrationForm.bankId))
                }
              >
                {testingBankId === integrationForm.bankId
                  ? "Testando..."
                  : "Verificar configuração"}
              </button>
            </div>
          </div>
        </div>
      </fieldset>
    </section>
  );
}
function ContactInput({
  value,
  onChange,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange">) {
  return (
    <input
      className="h-10 rounded border border-line px-3 outline-none"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...props}
      autoComplete="off"
      aria-label={props.placeholder}
      type={
        props.type ??
        (/Token|Senha|Usuario|Identificador|Digitador|CPF|SMS/i.test(
          props.placeholder ?? "",
        )
          ? "password"
          : "text")
      }
    />
  );
}

function IntegrationStatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const label =
    normalized === "CONNECTED"
      ? "Conectado"
      : normalized === "ASSISTED"
        ? "Assistido"
        : normalized === "PENDING"
          ? "Pendente"
          : normalized === "ERROR"
            ? "Erro"
            : normalized === "MANUAL"
              ? "Manual"
              : "Desconhecido";

  return (
    <span
      className={clsx(
        "rounded-full px-2 py-1 text-[11px] font-black",
        normalized === "CONNECTED"
          ? "bg-emerald-50 text-emerald-700"
          : normalized === "ASSISTED"
            ? "bg-blue-50 text-brand"
            : normalized === "ERROR"
              ? "bg-rose-50 text-rose-700"
              : normalized === "PENDING"
                ? "bg-amber-50 text-amber-700"
                : "bg-slate-100 text-slate-600",
      )}
    >
      {label}
    </span>
  );
}
