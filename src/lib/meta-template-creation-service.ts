import {
  createMetaMessageTemplate,
  createTemplateUploadSession,
  uploadTemplateFile,
  type CreateMetaMessageTemplateInput
} from "@/lib/meta-template-client";
import { buildImageHeaderTemplateComponents } from "@/lib/meta-template-component-builder";
import {
  mapLocalPersistenceError,
  mapMetaError,
  mapStorageError,
  storageRecoveryContext
} from "@/lib/meta-template-creation-errors";
import {
  type CreateImageHeaderTemplateInput,
  type CreateImageHeaderTemplateResult,
  type MetaTemplateCreationDependencies
} from "@/lib/meta-template-creation-types";
import { validateImageHeaderTemplateInput } from "@/lib/meta-template-creation-validation";
import {
  persistCreatedMetaTemplate,
  persistTemplateHeaderMediaAsset,
  updateTemplateHeaderMediaHandle
} from "@/lib/meta-template-service";
import {
  saveTemplateImage,
  type StoredTemplateMedia
} from "@/lib/template-media-storage";

export type {
  CreateImageHeaderTemplateInput,
  CreateImageHeaderTemplateResult,
  MetaTemplateButtonInput,
  MetaTemplateCreationDependencies
} from "@/lib/meta-template-creation-types";
export {
  MetaTemplateCreationServiceError,
  type MetaTemplateCreationRecoveryContext,
  type MetaTemplateCreationServiceErrorCode,
  type MetaTemplateCreationStage
} from "@/lib/meta-template-creation-errors";

export async function createImageHeaderTemplate(
  input: CreateImageHeaderTemplateInput,
  dependencies: MetaTemplateCreationDependencies = {}
): Promise<CreateImageHeaderTemplateResult> {
  const deps = {
    saveTemplateImage,
    persistTemplateHeaderMediaAsset,
    createTemplateUploadSession,
    uploadTemplateFile,
    updateTemplateHeaderMediaHandle,
    createMetaMessageTemplate,
    persistCreatedMetaTemplate,
    now: () => new Date(),
    ...dependencies
  };
  const validated = validateImageHeaderTemplateInput(input);
  let storedMedia: StoredTemplateMedia;

  try {
    storedMedia = await deps.saveTemplateImage({
      fileName: input.image.fileName,
      mimeType: input.image.mimeType,
      bytes: input.image.bytes,
      namespace: input.storageNamespace
    });
  } catch (error) {
    throw mapStorageError(error);
  }

  let mediaAsset: Awaited<ReturnType<typeof persistTemplateHeaderMediaAsset>>;

  try {
    mediaAsset = await deps.persistTemplateHeaderMediaAsset({
      companyId: validated.companyId,
      channelId: validated.channelId,
      storedMedia,
      now: deps.now()
    });
  } catch (error) {
    throw mapLocalPersistenceError({
      error,
      code: "MEDIA_ASSET_PERSIST_FAILED",
      stage: "MEDIA_ASSET_PERSIST",
      recoveryContext: storageRecoveryContext(storedMedia)
    });
  }

  let uploadSessionId: string;

  try {
    const uploadSession = await deps.createTemplateUploadSession({
      appId: validated.appId,
      accessToken: validated.accessToken,
      fileName: storedMedia.storedFileName,
      fileLength: storedMedia.sizeBytes,
      fileType: storedMedia.mimeType
    });
    uploadSessionId = uploadSession.uploadSessionId;
  } catch (error) {
    throw mapMetaError({
      error,
      code: "META_UPLOAD_SESSION_FAILED",
      stage: "META_UPLOAD_SESSION",
      recoveryContext: {
        ...storageRecoveryContext(storedMedia),
        mediaAssetId: mediaAsset.id
      }
    });
  }

  let headerHandle: string;

  try {
    const uploaded = await deps.uploadTemplateFile({
      uploadSessionId,
      accessToken: validated.accessToken,
      fileBuffer: input.image.bytes,
      fileType: storedMedia.mimeType
    });
    headerHandle = uploaded.headerHandle;
  } catch (error) {
    throw mapMetaError({
      error,
      code: "META_FILE_UPLOAD_FAILED",
      stage: "META_FILE_UPLOAD",
      recoveryContext: {
        ...storageRecoveryContext(storedMedia),
        mediaAssetId: mediaAsset.id
      }
    });
  }

  try {
    mediaAsset = await deps.updateTemplateHeaderMediaHandle({
      companyId: validated.companyId,
      mediaAssetId: mediaAsset.id,
      headerHandle,
      now: deps.now()
    });
  } catch (error) {
    throw mapLocalPersistenceError({
      error,
      code: "MEDIA_ASSET_UPDATE_FAILED",
      stage: "MEDIA_ASSET_UPDATE",
      recoveryContext: {
        ...storageRecoveryContext(storedMedia),
        mediaAssetId: mediaAsset.id,
        headerHandle
      }
    });
  }

  const components = buildImageHeaderTemplateComponents({
    bodyText: validated.bodyText,
    bodyExamples: validated.bodyExamples,
    footerText: validated.footerText,
    buttons: validated.buttons,
    headerHandle
  });

  let created: Awaited<ReturnType<typeof createMetaMessageTemplate>>;

  try {
    created = await deps.createMetaMessageTemplate({
      wabaId: validated.wabaId,
      accessToken: validated.accessToken,
      name: validated.name,
      language: validated.language,
      category: validated.category,
      components
    } satisfies CreateMetaMessageTemplateInput);
  } catch (error) {
    throw mapMetaError({
      error,
      code: "META_TEMPLATE_CREATION_FAILED",
      stage: "META_TEMPLATE_CREATE",
      recoveryContext: {
        ...storageRecoveryContext(storedMedia),
        mediaAssetId: mediaAsset.id,
        headerHandle
      }
    });
  }

  let localTemplate: Awaited<ReturnType<typeof persistCreatedMetaTemplate>>;

  try {
    localTemplate = await deps.persistCreatedMetaTemplate({
      companyId: validated.companyId,
      wabaId: validated.wabaId,
      metaTemplateId: created.id,
      name: validated.name,
      language: validated.language,
      category: created.category,
      metaStatus: created.status,
      components,
      rawPayload: created.rawPayload,
      defaultHeaderMediaAssetId: mediaAsset.id,
      now: deps.now()
    });
  } catch (error) {
    throw mapLocalPersistenceError({
      error,
      code: "META_TEMPLATE_PERSIST_FAILED",
      stage: "META_TEMPLATE_PERSIST",
      recoveryContext: {
        ...storageRecoveryContext(storedMedia),
        mediaAssetId: mediaAsset.id,
        headerHandle,
        ...(created.id ? { metaTemplateId: created.id } : {}),
        name: validated.name,
        language: validated.language,
        wabaId: validated.wabaId
      }
    });
  }

  return {
      mediaAssetId: mediaAsset.id,
      metaTemplateLocalId: localTemplate.id,
      metaTemplateId: created.id,
      name: validated.name,
      language: validated.language,
      category: created.category,
      metaStatus: created.status,
      operationalStatus: localTemplate.operationalStatus,
      defaultHeaderMediaAssetId: localTemplate.defaultHeaderMediaAssetId ?? mediaAsset.id,
      storageKey: storedMedia.storageKey,
      checksum: storedMedia.checksum,
      headerHandle,
      metaTemplate: {
        id: created.id,
        localId: localTemplate.id,
        name: validated.name,
        language: validated.language,
        category: created.category,
        status: created.status,
        operationalStatus: localTemplate.operationalStatus,
        defaultHeaderMediaAssetId: localTemplate.defaultHeaderMediaAssetId ?? mediaAsset.id
      },
      media: {
        id: mediaAsset.id,
        storageProvider: storedMedia.storageProvider,
        storageKey: storedMedia.storageKey,
        publicUrl: storedMedia.publicUrl,
        checksum: storedMedia.checksum,
        checksumAlgorithm: storedMedia.checksumAlgorithm,
        mimeType: storedMedia.mimeType,
        sizeBytes: storedMedia.sizeBytes,
        originalFileName: storedMedia.originalFileName,
        storedFileName: storedMedia.storedFileName,
        headerHandle
      },
      components
    };
}
