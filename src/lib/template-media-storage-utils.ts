import { Readable } from "node:stream";
import { TemplateMediaStorageError } from "@/lib/template-media-storage-types";

export function normalizePublicBaseUrl(value?: string | null) {
  const normalized = value?.trim().replace(/\/+$/g, "") ?? "";
  return normalized || null;
}

export function resolveOptionalLocalPublicBaseUrl(configured?: string | null) {
  return normalizePublicBaseUrl(
    configured ??
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.APP_URL ??
      process.env.PUBLIC_APP_URL ??
      (process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()
            .replace(/^https?:\/\//i, "")
            .replace(/\/+$/g, "")}`
        : null)
  );
}

export function toPublicUrl(baseUrl: string | null, storageKey: string) {
  if (!baseUrl) return null;
  return `${baseUrl}/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

export async function fileExists(filePath: string) {
  const { access } = await import("node:fs/promises");
  const { constants: fsConstants } = await import("node:fs");

  return access(filePath, fsConstants.F_OK)
    .then(() => true)
    .catch(() => false);
}

function isAsyncIterableBytes(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value
  );
}

function hasTransformToByteArray(
  value: unknown
): value is { transformToByteArray: () => Promise<Uint8Array> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "transformToByteArray" in value &&
    typeof value.transformToByteArray === "function"
  );
}

function hasArrayBuffer(value: unknown): value is { arrayBuffer: () => Promise<ArrayBuffer> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function"
  );
}

export async function s3BodyToBuffer(body: unknown) {
  if (!body) {
    throw new TemplateMediaStorageError(
      "STORAGE_READ_FAILED",
      "Storage retornou conteudo vazio."
    );
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (hasTransformToByteArray(body)) {
    return Buffer.from(await body.transformToByteArray());
  }

  if (hasArrayBuffer(body)) {
    return Buffer.from(await body.arrayBuffer());
  }

  if (body instanceof Readable || isAsyncIterableBytes(body)) {
    const chunks: Buffer[] = [];

    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  throw new TemplateMediaStorageError(
    "STORAGE_READ_FAILED",
    "Formato de resposta do storage nao suportado."
  );
}
