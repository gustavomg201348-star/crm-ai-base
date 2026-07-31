import path from "node:path";
import {
  LEGACY_TEMPLATE_MEDIA_STORAGE_PREFIX,
  TEMPLATE_MEDIA_STORAGE_PREFIX,
  TemplateMediaStorageError
} from "@/lib/template-media-storage-types";

export function readSafeNamespace(namespace?: string) {
  const normalized = namespace
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return normalized || "default";
}

export function buildTemplateStorageKey({
  namespace,
  checksum,
  storedFileName
}: {
  namespace?: string;
  checksum: string;
  storedFileName: string;
}) {
  return [
    TEMPLATE_MEDIA_STORAGE_PREFIX,
    readSafeNamespace(namespace),
    checksum.slice(0, 2),
    storedFileName
  ].join("/");
}

export function assertTemplateStorageKey(storageKey: string) {
  const normalized = storageKey.replace(/\\/g, "/").replace(/^\/+/, "");
  const validPrefix =
    normalized.startsWith(`${TEMPLATE_MEDIA_STORAGE_PREFIX}/`) ||
    normalized.startsWith(`${LEGACY_TEMPLATE_MEDIA_STORAGE_PREFIX}/`);

  if (
    !validPrefix ||
    normalized.includes("../") ||
    normalized.includes("/..") ||
    path.isAbsolute(storageKey)
  ) {
    throw new TemplateMediaStorageError(
      "STORAGE_INVALID_KEY",
      "Chave de armazenamento invalida."
    );
  }

  return normalized;
}

export function resolvePublicRootDir(configured?: string) {
  return path.resolve(configured ?? path.join(process.cwd(), "public"));
}

export function resolveLocalStoragePath(storageKey: string, publicRootDir?: string) {
  const safeStorageKey = assertTemplateStorageKey(storageKey);
  const rootDir = resolvePublicRootDir(publicRootDir);
  const targetPath = path.resolve(rootDir, safeStorageKey);
  const expectedPrefix = `${rootDir}${path.sep}`;

  if (targetPath !== rootDir && !targetPath.startsWith(expectedPrefix)) {
    throw new TemplateMediaStorageError(
      "STORAGE_INVALID_KEY",
      "Chave de armazenamento invalida."
    );
  }

  return { safeStorageKey, targetPath };
}

export function readFileNameFromStorageKey(storageKey: string) {
  return path.posix.basename(storageKey.replace(/\\/g, "/"));
}
