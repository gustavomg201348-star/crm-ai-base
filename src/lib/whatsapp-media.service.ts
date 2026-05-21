import {
  readMetaMessageId,
  sendMetaMediaMessage,
  uploadMetaMedia,
  type MetaMediaType
} from "@/lib/meta-whatsapp";
import {
  getConversationIntegration,
  saveOutboundMessage
} from "@/lib/conversation-message.service";

export const allowedMediaTypes = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "audio/mpeg",
  "audio/ogg",
  "audio/webm",
  "video/mp4",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

export const maxMediaSize = 16 * 1024 * 1024;

export function resolveMetaMediaType(mimeType: string): MetaMediaType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

export async function sendConversationMedia({
  conversationId,
  companyId,
  userId,
  fileName,
  mimeType,
  bytes,
  caption
}: {
  conversationId: string;
  companyId: string;
  userId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  caption?: string;
}) {
  if (!allowedMediaTypes.has(mimeType)) {
    throw new Error("Tipo de arquivo nao aceito para envio pelo WhatsApp.");
  }

  if (bytes.byteLength > maxMediaSize) {
    throw new Error("Arquivo acima do limite de 16 MB.");
  }

  const { conversation, channel } = await getConversationIntegration({
    conversationId,
    companyId
  });

  const uploaded = await uploadMetaMedia({
    phoneNumberId: channel.phoneNumberId!,
    accessToken: channel.accessToken!,
    fileName,
    mimeType,
    bytes
  });
  const mediaType = resolveMetaMediaType(mimeType);
  const metaResponse = await sendMetaMediaMessage({
    phoneNumberId: channel.phoneNumberId!,
    accessToken: channel.accessToken!,
    to: conversation.contact.phone.replace(/\D/g, ""),
    mediaId: uploaded.id,
    mediaType,
    caption,
    fileName
  });
  const label = mediaType === "audio" ? "Audio" : mediaType === "image" ? "Imagem" : mediaType === "video" ? "Video" : "Arquivo";
  const body = caption?.trim() || `[${label}: ${fileName}]`;

  return saveOutboundMessage({
    conversationId,
    userId,
    body,
    type: mediaType,
    mediaId: uploaded.id,
    fileName,
    mimeType,
    providerMessageId: readMetaMessageId(metaResponse)
  });
}
