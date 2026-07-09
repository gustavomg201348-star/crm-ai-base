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
import { convertWebmAudioToOgg } from "@/lib/media-conversion";
import { digitsOnlyPhone } from "@/lib/phone-normalization.service";

export const allowedMediaTypes = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "audio/aac",
  "audio/amr",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/webm",
  "video/mp4",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

export const maxMediaSize = 16 * 1024 * 1024;

export function normalizeMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

async function prepareMediaForMeta({
  fileName,
  mimeType,
  bytes
}: {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}) {
  const normalizedMimeType = normalizeMimeType(mimeType);

  if (normalizedMimeType === "audio/webm") {
    return convertWebmAudioToOgg({ bytes, fileName });
  }

  return {
    fileName,
    mimeType: normalizedMimeType,
    bytes
  };
}

export function resolveMetaMediaType(mimeType: string): MetaMediaType {
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (normalizedMimeType.startsWith("image/")) return "image";
  if (normalizedMimeType.startsWith("audio/")) return "audio";
  if (normalizedMimeType.startsWith("video/")) return "video";
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
  const preparedMedia = await prepareMediaForMeta({ fileName, mimeType, bytes });

  if (!allowedMediaTypes.has(preparedMedia.mimeType)) {
    throw new Error("Tipo de arquivo nao aceito para envio pelo WhatsApp.");
  }

  if (preparedMedia.bytes.byteLength > maxMediaSize) {
    throw new Error("Arquivo acima do limite de 16 MB.");
  }

  const { conversation, channel } = await getConversationIntegration({
    conversationId,
    companyId
  });

  const uploaded = await uploadMetaMedia({
    phoneNumberId: channel.phoneNumberId!,
    accessToken: channel.accessToken!,
    fileName: preparedMedia.fileName,
    mimeType: preparedMedia.mimeType,
    bytes: preparedMedia.bytes
  });
  const mediaType = resolveMetaMediaType(preparedMedia.mimeType);
  const metaResponse = await sendMetaMediaMessage({
    phoneNumberId: channel.phoneNumberId!,
    accessToken: channel.accessToken!,
    to: digitsOnlyPhone(conversation.contact.phone),
    mediaId: uploaded.id,
    mediaType,
    caption,
    fileName
  });
  const label = mediaType === "audio" ? "Audio" : mediaType === "image" ? "Imagem" : mediaType === "video" ? "Video" : "Arquivo";
  const body = caption?.trim() || `[${label}: ${preparedMedia.fileName}]`;

  return saveOutboundMessage({
    conversationId,
    userId,
    body,
    type: mediaType,
    mediaId: uploaded.id,
    fileName: preparedMedia.fileName,
    mimeType: preparedMedia.mimeType,
    providerMessageId: readMetaMessageId(metaResponse)
  });
}
