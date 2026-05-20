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
