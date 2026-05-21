import { createHmac, timingSafeEqual } from "node:crypto";

type MetaTextMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
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

function readMessageBody(message: MetaTextMessage) {
  if (message.type === "text") return message.text?.body;
  if (message.type === "button") return message.button?.text;
  if (message.type === "interactive") {
    return (
      message.interactive?.button_reply?.title ??
      message.interactive?.list_reply?.title
    );
  }

  return message.text?.body ?? `[${message.type ?? "mensagem"} recebida]`;
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
        const text = readMessageBody(message);
        const contact = value.contacts?.find((item) => item.wa_id === from);

        if (!from || !text) continue;

        messages.push({
          phoneNumberId,
          from,
          name: contact?.profile?.name ?? null,
          body: text,
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
