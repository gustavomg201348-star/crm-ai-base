import { createHmac, timingSafeEqual } from "node:crypto";

type MetaTextMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  image?: { id?: string; caption?: string; mime_type?: string; sha256?: string };
  audio?: { id?: string; mime_type?: string; sha256?: string; voice?: boolean };
  document?: { id?: string; caption?: string; filename?: string; mime_type?: string; sha256?: string };
  video?: { id?: string; caption?: string; mime_type?: string; sha256?: string };
  sticker?: { id?: string; mime_type?: string; sha256?: string; animated?: boolean };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string; wa_id?: string }> }>;
  reaction?: { message_id?: string; emoji?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
};

export type MetaWebhookMessage = {
  phoneNumberId: string;
  from: string;
  name?: string | null;
  body: string;
  type?: string | null;
  mediaId?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  messageId?: string | null;
};

export type MetaWebhookStatus = {
  phoneNumberId: string;
  messageId: string;
  status: string;
  recipientId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export function verifyMetaSignature({
  appSecret,
  rawBody,
  signature
}: {
  appSecret?: string | null;
  rawBody: string;
  signature?: string | null;
}) {
  if (!appSecret) return true;
  if (!signature?.startsWith("sha256=")) return false;

  const expected = `sha256=${createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  return (
    expectedBuffer.length === signatureBuffer.length &&
    timingSafeEqual(expectedBuffer, signatureBuffer)
  );
}

function readMessageContent(message: MetaTextMessage) {
  if (message.type === "text") {
    return { body: message.text?.body, type: "text" };
  }

  if (message.type === "button") {
    return { body: message.button?.text, type: "button" };
  }

  if (message.type === "interactive") {
    const body =
      message.interactive?.button_reply?.title ??
      message.interactive?.list_reply?.title;

    return { body: body ? `Resposta interativa: ${body}` : "Resposta interativa recebida", type: "interactive" };
  }

  if (message.type === "image") {
    return {
      body: message.image?.caption ? `[Imagem recebida] ${message.image.caption}` : "Imagem recebida",
      type: "image",
      mediaId: message.image?.id ?? null,
      mimeType: message.image?.mime_type ?? null
    };
  }

  if (message.type === "audio") {
    return {
      body: message.audio?.voice ? "Mensagem de voz recebida" : "Audio recebido",
      type: "audio",
      mediaId: message.audio?.id ?? null,
      mimeType: message.audio?.mime_type ?? null
    };
  }

  if (message.type === "document") {
    return {
      body: message.document?.caption
        ? `[Documento recebido] ${message.document.caption}`
        : `Documento recebido${message.document?.filename ? `: ${message.document.filename}` : ""}`,
      type: "document",
      mediaId: message.document?.id ?? null,
      fileName: message.document?.filename ?? null,
      mimeType: message.document?.mime_type ?? null
    };
  }

  if (message.type === "video") {
    return {
      body: message.video?.caption ? `[Video recebido] ${message.video.caption}` : "Video recebido",
      type: "video",
      mediaId: message.video?.id ?? null,
      mimeType: message.video?.mime_type ?? null
    };
  }

  if (message.type === "sticker") {
    return {
      body: message.sticker?.animated ? "Figurinha animada recebida" : "Figurinha recebida",
      type: "sticker",
      mediaId: message.sticker?.id ?? null,
      mimeType: message.sticker?.mime_type ?? null
    };
  }

  if (message.type === "location") {
    const details = [message.location?.name, message.location?.address].filter(Boolean).join(" - ");
    return {
      body: details ? `Localizacao recebida: ${details}` : "Localizacao recebida",
      type: "location"
    };
  }

  if (message.type === "contacts") {
    const contactName = message.contacts?.[0]?.name?.formatted_name;
    return {
      body: contactName ? `Contato recebido: ${contactName}` : "Contato recebido",
      type: "contacts"
    };
  }

  if (message.type === "reaction") {
    return {
      body: message.reaction?.emoji ? `Reacao recebida: ${message.reaction.emoji}` : "Reacao recebida",
      type: "reaction"
    };
  }

  return {
    body: message.text?.body ?? `Mensagem ${message.type ?? "desconhecida"} recebida`,
    type: message.type ?? "unsupported"
  };
}

export function parseMetaWebhookMessages(payload: unknown): MetaWebhookMessage[] {
  const body = payload as
    | {
        entry?: Array<{
          changes?: Array<{
            value?: {
              metadata?: { phone_number_id?: string };
              contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
              messages?: MetaTextMessage[];
            };
          }>;
        }>;
      }
    | null;
  const messages: MetaWebhookMessage[] = [];

  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;

      if (!phoneNumberId) continue;

      for (const message of value?.messages ?? []) {
        const from = message.from;
        const content = readMessageContent(message);
        const text = content.body;
        const contact = value.contacts?.find((item) => item.wa_id === from);

        if (!from || !text) continue;

        messages.push({
          phoneNumberId,
          from,
          name: contact?.profile?.name ?? null,
          body: text,
          type: content.type ?? null,
          mediaId: content.mediaId ?? null,
          fileName: content.fileName ?? null,
          mimeType: content.mimeType ?? null,
          messageId: message.id ?? null
        });
      }
    }
  }

  return messages;
}

export function parseMetaWebhookStatuses(payload: unknown): MetaWebhookStatus[] {
  const body = payload as
    | {
        entry?: Array<{
          changes?: Array<{
            value?: {
              metadata?: { phone_number_id?: string };
              statuses?: Array<{
                id?: string;
                status?: string;
                recipient_id?: string;
                errors?: Array<{ code?: number | string; title?: string; message?: string }>;
              }>;
            };
          }>;
        }>;
      }
    | null;
  const statuses: MetaWebhookStatus[] = [];

  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;

      if (!phoneNumberId) continue;

      for (const status of value?.statuses ?? []) {
        if (!status.id || !status.status) continue;

        const error = status.errors?.[0];
        statuses.push({
          phoneNumberId,
          messageId: status.id,
          status: status.status,
          recipientId: status.recipient_id ?? null,
          errorCode: error?.code ? String(error.code) : null,
          errorMessage: error?.message ?? error?.title ?? null
        });
      }
    }
  }

  return statuses;
}

export async function sendMetaTextMessage({
  phoneNumberId,
  accessToken,
  to,
  body
}: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  body: string;
}) {
  const apiVersion = process.env.META_GRAPH_VERSION || "v20.0";
  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body }
      })
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : "Falha ao enviar mensagem pela Meta."
    );
  }

  return data;
}

export async function uploadMetaMedia({
  phoneNumberId,
  accessToken,
  fileName,
  mimeType,
  bytes
}: {
  phoneNumberId: string;
  accessToken: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}) {
  const apiVersion = process.env.META_GRAPH_VERSION || "v20.0";
  const formData = new FormData();
  const fileBytes = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  formData.set("messaging_product", "whatsapp");
  formData.set("type", mimeType);
  formData.set("file", new Blob([fileBytes], { type: mimeType }), fileName);

  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      body: formData
    }
  );
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.id) {
    throw new Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : "Falha ao enviar midia para a Meta."
    );
  }

  return data as { id: string };
}

export async function sendMetaImageMessage({
  phoneNumberId,
  accessToken,
  to,
  mediaId,
  caption
}: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  mediaId: string;
  caption?: string;
}) {
  const apiVersion = process.env.META_GRAPH_VERSION || "v20.0";
  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: {
          id: mediaId,
          ...(caption ? { caption } : {})
        }
      })
    }
  );
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : "Falha ao enviar imagem pela Meta."
    );
  }

  return data;
}

export type MetaMediaType = "image" | "audio" | "document" | "video";

export async function sendMetaMediaMessage({
  phoneNumberId,
  accessToken,
  to,
  mediaId,
  mediaType,
  caption,
  fileName
}: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  mediaId: string;
  mediaType: MetaMediaType;
  caption?: string;
  fileName?: string;
}) {
  const apiVersion = process.env.META_GRAPH_VERSION || "v20.0";
  const mediaPayload =
    mediaType === "document"
      ? { id: mediaId, ...(caption ? { caption } : {}), ...(fileName ? { filename: fileName } : {}) }
      : mediaType === "image" || mediaType === "video"
        ? { id: mediaId, ...(caption ? { caption } : {}) }
        : { id: mediaId };

  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: mediaType,
        [mediaType]: mediaPayload
      })
    }
  );
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : "Falha ao enviar midia pela Meta."
    );
  }

  return data;
}

export type MetaTemplate = {
  id?: string;
  name: string;
  status: string;
  category?: string;
  language: string;
  components?: Array<{
    type?: string;
    format?: string;
    text?: string;
    buttons?: Array<{
      type?: string;
      text?: string;
      url?: string;
      phone_number?: string;
    }>;
  }>;
};

export async function getMetaApprovedTemplates({
  wabaId,
  accessToken
}: {
  wabaId: string;
  accessToken: string;
}) {
  const apiVersion = process.env.META_GRAPH_VERSION || "v20.0";
  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates?fields=id,name,status,category,language,components&limit=100`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : "Falha ao buscar templates da Meta."
    );
  }

  const templates = (data?.data ?? []) as MetaTemplate[];
  return templates.filter((template) => template.status === "APPROVED");
}

export async function sendMetaTemplateMessage({
  phoneNumberId,
  accessToken,
  to,
  name,
  language,
  variables
}: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  name: string;
  language: string;
  variables: string[];
}) {
  const apiVersion = process.env.META_GRAPH_VERSION || "v20.0";
  const components = variables.length
    ? [
        {
          type: "body",
          parameters: variables.map((value) => ({
            type: "text",
            text: value
          }))
        }
      ]
    : undefined;

  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name,
          language: { code: language },
          ...(components ? { components } : {})
        }
      })
    }
  );
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : "Falha ao enviar template pela Meta."
    );
  }

  return data;
}

export function readMetaMessageId(response: unknown) {
  const data = response as { messages?: Array<{ id?: string }> } | null;
  return data?.messages?.[0]?.id ?? null;
}
