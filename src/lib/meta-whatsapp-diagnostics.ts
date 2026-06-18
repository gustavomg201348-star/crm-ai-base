type MetaErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    subcode?: number;
  };
};

type GraphResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; raw?: MetaErrorPayload };

const REQUIRED_PERMISSIONS = [
  "whatsapp_business_management",
  "whatsapp_business_messaging"
];
const OPTIONAL_PERMISSIONS = ["whatsapp_business_manage_events"];

function graphVersion() {
  return process.env.META_GRAPH_VERSION || "v20.0";
}

export function maskMetaToken(token?: string | null) {
  if (!token) return null;
  const trimmed = token.trim();
  if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}...`;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function translateMetaError(payload: unknown, fallback = "Falha ao consultar a Meta.") {
  const data = payload as MetaErrorPayload | null;
  const error = data?.error;
  const message = error?.message ?? "";
  const code = error?.code;
  const subcode = error?.error_subcode ?? error?.subcode;
  const lower = message.toLowerCase();

  if (code === 100 && subcode === 33) {
    return "Objeto nao encontrado ou token sem permissao para acessar esta WABA.";
  }

  if (lower.includes("missing permission") || lower.includes("permission")) {
    return "Token sem permissao necessaria. Verifique whatsapp_business_management e whatsapp_business_messaging.";
  }

  if (lower.includes("invalid oauth access token") || lower.includes("session has expired")) {
    return "Token invalido ou expirado. Gere um novo token no Business Manager/Meta.";
  }

  if (lower.includes("business account locked")) {
    return "Conta empresarial bloqueada na Meta. Isso pode impedir envios e operacoes de assinatura/permissao ate a restricao ser resolvida no Business Manager.";
  }

  if (lower.includes("business") && (lower.includes("locked") || lower.includes("disabled"))) {
    return "Conta empresarial com restricao na Meta. Revise a qualidade/restricoes da BM antes de usar a API em producao.";
  }

  if (lower.includes("unsupported get request") || lower.includes("unsupported post request")) {
    return "A WABA ID pode estar incorreta ou o token nao tem acesso ao ativo informado.";
  }

  return message || fallback;
}

async function graphGet<T>(path: string, accessToken: string): Promise<GraphResult<T>> {
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  const data = (await response.json().catch(() => null)) as T & MetaErrorPayload;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: translateMetaError(data),
      raw: data
    };
  }

  return { ok: true, data };
}

async function graphPost<T>(path: string, accessToken: string): Promise<GraphResult<T>> {
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  const data = (await response.json().catch(() => null)) as T & MetaErrorPayload;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: translateMetaError(data, "Nao foi possivel assinar o webhook na Meta."),
      raw: data
    };
  }

  return { ok: true, data };
}

async function debugToken(accessToken: string) {
  const params = new URLSearchParams({
    input_token: accessToken,
    access_token: accessToken
  });
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion()}/debug_token?${params.toString()}`,
    { cache: "no-store" }
  );
  const data = (await response.json().catch(() => null)) as
    | {
        data?: {
          is_valid?: boolean;
          scopes?: string[];
          granular_scopes?: Array<{ scope?: string }>;
          app_id?: string;
          type?: string;
          expires_at?: number;
        };
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    return { ok: false, permissions: [], error: translateMetaError(data) };
  }

  const scopes = [
    ...(data?.data?.scopes ?? []),
    ...(data?.data?.granular_scopes ?? []).map((item) => item.scope).filter(Boolean)
  ] as string[];

  return {
    ok: Boolean(data?.data?.is_valid),
    permissions: Array.from(new Set(scopes)),
    appId: data?.data?.app_id ?? null,
    tokenType: data?.data?.type ?? null,
    expiresAt: data?.data?.expires_at ?? null,
    error: data?.data?.is_valid ? null : "Token invalido ou expirado."
  };
}

export async function validateMetaWhatsAppCredentials({
  accessToken,
  wabaId,
  phoneNumberId
}: {
  accessToken?: string | null;
  wabaId?: string | null;
  phoneNumberId?: string | null;
}) {
  const token = accessToken?.trim();
  const waba = wabaId?.trim();
  const phone = phoneNumberId?.trim();
  const tokenPreview = maskMetaToken(token);

  if (!token) {
    return {
      ok: false,
      tokenPreview,
      token: { ok: false, error: "Access token obrigatorio." },
      permissions: {
        ok: false,
        detected: [],
        required: REQUIRED_PERMISSIONS,
        missing: REQUIRED_PERMISSIONS,
        optionalMissing: OPTIONAL_PERMISSIONS
      },
      waba: { ok: false, id: waba ?? null, error: "Informe o token antes de validar a WABA." },
      phone: { ok: false, id: phone ?? null, error: "Informe o token antes de validar o numero." },
      checklist: {
        tokenValid: false,
        permissionsChecked: false,
        wabaAccessible: false,
        phoneFound: false,
        phoneBelongsToWaba: false
      }
    };
  }

  const me = await graphGet<{ id?: string; name?: string }>("/me?fields=id,name", token);
  const tokenOk = me.ok;
  const debug = tokenOk ? await debugToken(token) : null;
  const detected = debug?.permissions ?? [];
  const missing = REQUIRED_PERMISSIONS.filter((permission) => !detected.includes(permission));
  const optionalMissing = OPTIONAL_PERMISSIONS.filter(
    (permission) => !detected.includes(permission)
  );

  let wabaResult: {
    ok: boolean;
    id?: string | null;
    name?: string | null;
    error?: string | null;
  } = {
    ok: false,
    id: waba ?? null,
    error: waba ? "Token invalido." : "WABA ID obrigatorio."
  };

  if (tokenOk && waba) {
    const result = await graphGet<{
      id?: string;
      name?: string;
      account_review_status?: string;
      business_verification_status?: string;
    }>(
      `/${waba}?fields=id,name,account_review_status,business_verification_status`,
      token
    );
    wabaResult = result.ok
      ? {
          ok: true,
          id: result.data.id ?? waba,
          name: result.data.name ?? null
        }
      : {
          ok: false,
          id: waba,
          error:
            result.error ||
            "Token nao tem acesso a esta conta WhatsApp Business. Verifique se o usuario do sistema recebeu controle total sobre a WABA correta."
        };
  }

  let phoneResult: {
    ok: boolean;
    id?: string | null;
    displayPhone?: string | null;
    verifiedName?: string | null;
    qualityRating?: string | null;
    wabaId?: string | null;
    belongsToWaba?: boolean;
    error?: string | null;
  } = {
    ok: false,
    id: phone ?? null,
    belongsToWaba: false,
    error: phone ? "Token invalido." : "Phone Number ID obrigatorio."
  };

  if (tokenOk && phone) {
    const result = await graphGet<{
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
      whatsapp_business_account?: { id?: string; name?: string };
    }>(
      `/${phone}?fields=id,display_phone_number,verified_name,quality_rating,whatsapp_business_account`,
      token
    );
    if (result.ok) {
      const linkedWaba = result.data.whatsapp_business_account?.id ?? null;
      const belongsToWaba = Boolean(waba && linkedWaba === waba);
      phoneResult = {
        ok: true,
        id: result.data.id ?? phone,
        displayPhone: result.data.display_phone_number ?? null,
        verifiedName: result.data.verified_name ?? null,
        qualityRating: result.data.quality_rating ?? null,
        wabaId: linkedWaba,
        belongsToWaba,
        error:
          waba && !belongsToWaba
            ? "Phone Number ID encontrado, mas nao pertence a WABA informada."
            : null
      };
    } else {
      phoneResult = {
        ok: false,
        id: phone,
        belongsToWaba: false,
        error: result.error
      };
    }
  }

  const permissionsChecked = tokenOk && (!debug || debug.ok) && missing.length === 0;
  const ok =
    tokenOk &&
    permissionsChecked &&
    wabaResult.ok &&
    phoneResult.ok &&
    Boolean(phoneResult.belongsToWaba);

  return {
    ok,
    tokenPreview,
    token: {
      ok: tokenOk,
      id: me.ok ? me.data.id ?? null : null,
      name: me.ok ? me.data.name ?? null : null,
      appId: debug?.appId ?? null,
      tokenType: debug?.tokenType ?? null,
      expiresAt: debug?.expiresAt ?? null,
      error: me.ok ? debug?.error ?? null : me.error
    },
    permissions: {
      ok: permissionsChecked,
      detected,
      required: REQUIRED_PERMISSIONS,
      missing,
      optionalMissing,
      error:
        tokenOk && debug && !debug.ok
          ? debug.error
          : tokenOk && !debug
            ? "Nao foi possivel ler as permissoes do token."
            : null
    },
    waba: wabaResult,
    phone: phoneResult,
    checklist: {
      tokenValid: tokenOk,
      permissionsChecked,
      wabaAccessible: wabaResult.ok,
      phoneFound: phoneResult.ok,
      phoneBelongsToWaba: Boolean(phoneResult.belongsToWaba)
    }
  };
}

export async function subscribeMetaWebhook({
  wabaId,
  accessToken
}: {
  wabaId: string;
  accessToken: string;
}) {
  const result = await graphPost<{ success?: boolean }>(
    `/${wabaId}/subscribed_apps`,
    accessToken
  );

  if (!result.ok) {
    return {
      ok: false,
      error: result.error
    };
  }

  if (result.data.success === false) {
    return {
      ok: false,
      error: "A Meta respondeu a assinatura do webhook sem confirmar sucesso."
    };
  }

  return {
    ok: true,
    response: result.data
  };
}
