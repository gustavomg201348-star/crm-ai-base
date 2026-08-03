import type { MediaAsset } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";
import {
  MetaTemplateServiceError,
  validateTemplateHeaderImageMediaAssetForAssociation
} from "./meta-template-service";
import { TemplateMediaStorageError } from "./template-media-storage";

function createReadyHeaderImageAsset(
  overrides: Partial<MediaAsset> = {}
): MediaAsset {
  const now = new Date("2026-08-03T00:00:00.000Z");

  return {
    id: "media-asset-id",
    companyId: "company-id",
    type: "TEMPLATE_HEADER_IMAGE",
    mimeType: "image/png",
    fileName: "clt disparo 03.png",
    sizeBytes: 123,
    storageProvider: "r2",
    storageKey: "templates/company-id/hash/image.png",
    publicUrl: "https://cdn.example.com/templates/company-id/hash/image.png",
    metaMediaId: null,
    headerHandle: null,
    metaExpiresAt: null,
    status: "READY",
    checksum: "checksum",
    metadata: null,
    lastValidatedAt: null,
    validationError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

test("permite associar media R2 legivel", async () => {
  const mediaAsset = createReadyHeaderImageAsset();
  let markedUnavailable = false;

  await validateTemplateHeaderImageMediaAssetForAssociation({
    companyId: mediaAsset.companyId,
    mediaAsset,
    readMedia: async () => ({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "image/png",
      fileName: mediaAsset.fileName,
      sizeBytes: mediaAsset.sizeBytes
    }),
    markUnavailable: async () => {
      markedUnavailable = true;
    }
  });

  assert.equal(markedUnavailable, false);
});

test("permite associar media local legivel", async () => {
  const mediaAsset = createReadyHeaderImageAsset({
    storageProvider: "local",
    storageKey: "templates/company-id/hash/image.png",
    publicUrl: "https://crm.example.com/templates/company-id/hash/image.png"
  });

  await validateTemplateHeaderImageMediaAssetForAssociation({
    companyId: mediaAsset.companyId,
    mediaAsset,
    readMedia: async () => ({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "image/png",
      fileName: mediaAsset.fileName,
      sizeBytes: mediaAsset.sizeBytes
    })
  });
});

test("bloqueia associacao e marca como BROKEN quando arquivo nao existe", async () => {
  const mediaAsset = createReadyHeaderImageAsset({ storageProvider: "local" });
  const markedStatuses: string[] = [];

  await assert.rejects(
    validateTemplateHeaderImageMediaAssetForAssociation({
      companyId: mediaAsset.companyId,
      mediaAsset,
      readMedia: async () => {
        throw new TemplateMediaStorageError(
          "STORAGE_FILE_NOT_FOUND",
          "Midia de template nao encontrada."
        );
      },
      markUnavailable: async ({ error }) => {
        markedStatuses.push(error.code === "STORAGE_FILE_NOT_FOUND" ? "BROKEN" : "OTHER");
      }
    }),
    (error: unknown) =>
      error instanceof MetaTemplateServiceError &&
      error.code === "TEMPLATE_MEDIA_UNAVAILABLE" &&
      error.message === "Esta imagem nao esta mais disponivel. Envie uma nova imagem."
  );

  assert.deepEqual(markedStatuses, ["BROKEN"]);
});

test("bloqueia associacao de objeto R2 inexistente", async () => {
  const mediaAsset = createReadyHeaderImageAsset({ storageProvider: "r2" });
  let markedUnavailable = false;

  await assert.rejects(
    validateTemplateHeaderImageMediaAssetForAssociation({
      companyId: mediaAsset.companyId,
      mediaAsset,
      readMedia: async () => {
        throw new TemplateMediaStorageError(
          "STORAGE_FILE_NOT_FOUND",
          "Midia de template nao encontrada."
        );
      },
      markUnavailable: async ({ error }) => {
        if (error.code === "STORAGE_FILE_NOT_FOUND") {
          markedUnavailable = true;
        }
      }
    }),
    (error: unknown) =>
      error instanceof MetaTemplateServiceError &&
      error.code === "TEMPLATE_MEDIA_UNAVAILABLE"
  );

  assert.equal(markedUnavailable, true);
});

test("timeout bloqueia associacao sem marcar permanentemente como BROKEN", async () => {
  const mediaAsset = createReadyHeaderImageAsset();
  let markedUnavailable = false;

  await assert.rejects(
    validateTemplateHeaderImageMediaAssetForAssociation({
      companyId: mediaAsset.companyId,
      mediaAsset,
      readMedia: async () => {
        throw new TemplateMediaStorageError(
          "STORAGE_OPERATION_TIMEOUT",
          "Operacao de storage R2 excedeu o tempo limite."
        );
      },
      markUnavailable: async () => {
        markedUnavailable = true;
      }
    }),
    (error: unknown) =>
      error instanceof MetaTemplateServiceError &&
      error.code === "TEMPLATE_MEDIA_UNAVAILABLE"
  );

  assert.equal(markedUnavailable, false);
});

test("falha ao marcar BROKEN nao substitui erro publico de midia indisponivel", async () => {
  const mediaAsset = createReadyHeaderImageAsset();
  let markAttempted = false;

  await assert.rejects(
    validateTemplateHeaderImageMediaAssetForAssociation({
      companyId: mediaAsset.companyId,
      templateId: "template-id",
      mediaAsset,
      readMedia: async () => {
        throw new TemplateMediaStorageError(
          "STORAGE_FILE_NOT_FOUND",
          "Midia de template nao encontrada."
        );
      },
      markUnavailable: async () => {
        markAttempted = true;
        throw new Error("database unavailable");
      }
    }),
    (error: unknown) =>
      error instanceof MetaTemplateServiceError &&
      error.code === "TEMPLATE_MEDIA_UNAVAILABLE" &&
      error.message === "Esta imagem nao esta mais disponivel. Envie uma nova imagem."
  );

  assert.equal(markAttempted, true);
});

test("media BROKEN nao passa na validacao de associacao", async () => {
  const mediaAsset = createReadyHeaderImageAsset({ status: "BROKEN" });

  await assert.rejects(
    validateTemplateHeaderImageMediaAssetForAssociation({
      companyId: mediaAsset.companyId,
      mediaAsset,
      readMedia: async () => ({
        bytes: Buffer.from([1, 2, 3]),
        mimeType: "image/png",
        fileName: mediaAsset.fileName,
        sizeBytes: mediaAsset.sizeBytes
      })
    }),
    (error: unknown) =>
      error instanceof MetaTemplateServiceError &&
      error.code === "MEDIA_ASSET_INCOMPATIBLE"
  );
});
