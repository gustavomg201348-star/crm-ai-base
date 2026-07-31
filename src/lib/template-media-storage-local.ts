import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteStoredTemplateMediaResult,
  ReadTemplateMediaInput,
  ReadTemplateMediaResult,
  StoredTemplateMedia,
  TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL,
  TemplateHeaderMediaExtension,
  TemplateHeaderMediaMimeType,
  TemplateMediaStorageOptions,
  TemplateMediaStorageError
} from "@/lib/template-media-storage-types";
import {
  readFileNameFromStorageKey,
  resolveLocalStoragePath
} from "@/lib/template-media-storage-key";
import {
  fileExists,
  resolveOptionalLocalPublicBaseUrl,
  toPublicUrl
} from "@/lib/template-media-storage-utils";
import { withStorageLocation } from "@/lib/template-media-storage-validation";

export async function saveLocalTemplateMedia<
  TMimeType extends TemplateHeaderMediaMimeType,
  TExtension extends TemplateHeaderMediaExtension
>({
  storageKey,
  bytes,
  publicRootDir,
  publicBaseUrl,
  storedMedia
}: {
  storageKey: string;
  bytes: Buffer;
  publicRootDir?: string;
  publicBaseUrl?: string | null;
  storedMedia: Omit<
    StoredTemplateMedia<TMimeType, TExtension>,
    "storageProvider" | "storageKey" | "publicUrl"
  >;
}): Promise<StoredTemplateMedia<TMimeType, TExtension>> {
  const { safeStorageKey, targetPath } = resolveLocalStoragePath(storageKey, publicRootDir);
  const targetDir = path.dirname(targetPath);

  try {
    await mkdir(targetDir, { recursive: true });

    if (!(await fileExists(targetPath))) {
      await writeFile(targetPath, bytes, { flag: "wx" });
    }
  } catch (error) {
    throw new TemplateMediaStorageError(
      "STORAGE_WRITE_FAILED",
      "Nao foi possivel armazenar a midia do template.",
      error
    );
  }

  return withStorageLocation(storedMedia, {
    storageProvider: TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL,
    storageKey: safeStorageKey,
    publicUrl: toPublicUrl(
      publicBaseUrl ?? resolveOptionalLocalPublicBaseUrl(),
      safeStorageKey
    )
  });
}

export async function readLocalTemplateMedia(
  input: ReadTemplateMediaInput,
  options: Pick<TemplateMediaStorageOptions, "publicRootDir"> = {}
): Promise<ReadTemplateMediaResult> {
  const storageKey = input.storageKey?.trim() ?? "";
  const { targetPath } = resolveLocalStoragePath(storageKey, options.publicRootDir);

  let bytes: Buffer;
  let fileStat: Awaited<ReturnType<typeof stat>>;

  try {
    [bytes, fileStat] = await Promise.all([readFile(targetPath), stat(targetPath)]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TemplateMediaStorageError(
        "STORAGE_FILE_NOT_FOUND",
        "Midia de template nao encontrada."
      );
    }

    throw new TemplateMediaStorageError(
      "STORAGE_READ_FAILED",
      "Nao foi possivel ler a midia do template.",
      error
    );
  }

  if (bytes.byteLength === 0 || fileStat.size === 0) {
    throw new TemplateMediaStorageError("STORAGE_EMPTY_FILE", "Arquivo vazio.");
  }

  return {
    bytes,
    mimeType: input.mimeType?.trim() || "application/octet-stream",
    fileName: input.fileName?.trim() || readFileNameFromStorageKey(storageKey),
    sizeBytes: bytes.byteLength
  };
}

export async function deleteLocalTemplateMedia({
  storageKey,
  storageProvider,
  publicRootDir
}: {
  storageKey: string;
  storageProvider: DeleteStoredTemplateMediaResult["storageProvider"];
  publicRootDir?: string;
}): Promise<DeleteStoredTemplateMediaResult> {
  const { safeStorageKey, targetPath } = resolveLocalStoragePath(storageKey, publicRootDir);

  try {
    await rm(targetPath, { force: true });
  } catch (error) {
    throw new TemplateMediaStorageError(
      "STORAGE_DELETE_FAILED",
      "Nao foi possivel remover a midia do template.",
      error
    );
  }

  return {
    deleted: true,
    storageProvider,
    storageKey: safeStorageKey
  };
}
