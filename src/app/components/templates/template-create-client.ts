import type { TemplateButtonDraft, TemplateCreateDraft } from "./TemplateCreatePanel";

type CreateTemplateSuccess = {
  template: {
    id: string;
    metaTemplateId: string | null;
    name: string;
    language: string;
    category: string | null;
    metaStatus: string | null;
    operationalStatus: string;
    defaultHeaderMediaAssetId: string | null;
  };
  media?: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  };
};

type ApiErrorPayload = {
  error?: {
    code?: unknown;
    message?: unknown;
    requiresManualReconciliation?: unknown;
  };
};

function readBodyPlaceholderNumbers(body: string) {
  const tokens = body.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
  return Array.from(
    new Set(
      tokens.map((token) => Number(token.replace(/[{}]/g, "").trim()))
    )
  ).filter((value) => Number.isInteger(value) && value > 0);
}

function mapButton(button: TemplateButtonDraft) {
  if (button.type === "URL") {
    return {
      type: "URL",
      text: button.text.trim(),
      url: button.url.trim()
    };
  }

  if (button.type === "PHONE_NUMBER") {
    return {
      type: "PHONE_NUMBER",
      text: button.text.trim(),
      phone_number: button.phoneNumber.trim()
    };
  }

  return {
    type: "QUICK_REPLY",
    text: button.text.trim()
  };
}

export function buildCreateTemplateFormData(draft: TemplateCreateDraft) {
  if (readBodyPlaceholderNumbers(draft.body).length > 0) {
    throw new Error(
      "Templates com variáveis no BODY precisam de exemplos. Essa etapa ainda não está disponível na tela."
    );
  }

  const formData = new FormData();
  const buttons = draft.buttons.map(mapButton);

  formData.set("name", draft.name.trim());
  formData.set("language", draft.language.trim());
  formData.set("category", draft.category.trim());
  formData.set("bodyText", draft.body.trim());
  formData.set("headerType", draft.header.type);

  if (draft.header.type === "TEXT") {
    formData.set("headerText", draft.header.text.trim());
  }

  if (
    (draft.header.type === "IMAGE" ||
      draft.header.type === "DOCUMENT" ||
      draft.header.type === "VIDEO") &&
    draft.header.media
  ) {
    formData.set("media", draft.header.media.file, draft.header.media.name);
  }

  if (draft.footer.trim()) formData.set("footerText", draft.footer.trim());
  if (buttons.length > 0) formData.set("buttons", JSON.stringify(buttons));

  return formData;
}

async function readCreateTemplateError(response: Response) {
  const data = (await response.json().catch(() => null)) as ApiErrorPayload | null;
  const message = data?.error && typeof data.error.message === "string"
    ? data.error.message
    : "Não foi possível criar o template. Tente novamente.";
  const code = data?.error && typeof data.error.code === "string" ? data.error.code : null;
  const reconciliation =
    data?.error && typeof data.error.requiresManualReconciliation === "boolean"
      ? data.error.requiresManualReconciliation
      : false;

  return reconciliation
    ? `${message} Será necessário reconciliar manualmente antes de tentar novamente.`
    : code
      ? `${message} (${code})`
      : message;
}

export async function createTemplateRequest({
  channelId,
  formData,
  signal
}: {
  channelId: string;
  formData: FormData;
  signal?: AbortSignal;
}) {
  const response = await fetch(`/api/channels/${encodeURIComponent(channelId)}/templates`, {
    method: "POST",
    credentials: "same-origin",
    body: formData,
    signal
  });

  if (!response.ok) {
    throw new Error(await readCreateTemplateError(response));
  }

  return (await response.json()) as CreateTemplateSuccess;
}
