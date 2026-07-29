import {
  createMetaMessageTemplate,
  createTemplateUploadSession,
  uploadTemplateFile,
  type CreateMetaMessageTemplateInput
} from "@/lib/meta-template-client";
import { buildMetaTemplateComponents } from "@/lib/meta-template-component-builder";
import {
  mapLocalPersistenceError,
  mapMetaError,
  mapStorageError,
  MetaTemplateCreationServiceError,
  storageRecoveryContext
} from "@/lib/meta-template-creation-errors";
import {
  type CreateImageHeaderTemplateInput,
  type CreateImageHeaderTemplateResult,
  type CreateMetaTemplateInput,
  type MetaTemplateCreationDependencies,
  type ValidatedCreateMetaTemplateInput
} from "@/lib/meta-template-creation-types";
import { validateCreateMetaTemplateInput } from "@/lib/meta-template-creation-validation";
import {
  persistCreatedMetaTemplate,
  persistTemplateHeaderMediaAsset,
  updateTemplateHeaderMediaHandle
} from "@/lib/meta-template-service";
import {
  saveTemplateHeaderMedia,
  saveTemplateImage,
  type StoredTemplateMedia,
  type TemplateHeaderMediaExtension,
  type TemplateHeaderMediaMimeType
} from "@/lib/template-media-storage";

type TemplateCreationDependencies = MetaTemplateCreationDependencies & {
  saveTemplateHeaderMedia?: typeof saveTemplateHeaderMedia;
};

type StoredHeaderMedia = StoredTemplateMedia<
  TemplateHeaderMediaMimeType,
  TemplateHeaderMediaExtension
>;
type ValidatedMediaHeader = Extract<
  ValidatedCreateMetaTemplateInput["header"],
  { type: "IMAGE" | "DOCUMENT" | "VIDEO" }
>;
type ValidatedCreateMetaTemplateInputWithMediaHeader = ValidatedCreateMetaTemplateInput & {
  header: ValidatedMediaHeader;
};

type PersistedHeaderMedia = Awaited<ReturnType<typeof persistTemplateHeaderMediaAsset>>;

export type CreateMetaTemplateResult = {
  mediaAssetId: string | null;
  metaTemplateLocalId: string;
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: string | null;
  metaStatus: string | null;
  operationalStatus: string;
  defaultHeaderMediaAssetId: string | null;
  storageKey: string | null;
  checksum: string | null;
  headerHandle: string | null;
  metaTemplate: {
    id: string | null;
    localId: string;
    name: string;
    language: string;
    category: string | null;
    status: string | null;
    operationalStatus: string;
    defaultHeaderMediaAssetId: string | null;
  };
  media: {
    id: string;
    storageProvider: string;
    storageKey: string;
    publicUrl: string;
    checksum: string;
    checksumAlgorithm: "sha256";
    mimeType: string;
    sizeBytes: number;
    originalFileName: string;
    storedFileName: string;
    headerHandle: string;
  } | null;
  components: CreateMetaMessageTemplateInput["components"];
};

export type {
  CreateImageHeaderTemplateInput,
  CreateImageHeaderTemplateResult,
  CreateMetaTemplateInput,
  MetaTemplateButtonInput,
  MetaTemplateCreationDependencies
} from "@/lib/meta-template-creation-types";
export {
  MetaTemplateCreationServiceError,
  type MetaTemplateCreationRecoveryContext,
  type MetaTemplateCreationServiceErrorCode,
  type MetaTemplateCreationStage
} from "@/lib/meta-template-creation-errors";

function isMediaHeader(
  header: ValidatedCreateMetaTemplateInput["header"]
): header is ValidatedMediaHeader {
  return header.type === "IMAGE" || header.type === "DOCUMENT" || header.type === "VIDEO";
}

function createDefaultDependencies(dependencies: TemplateCreationDependencies = {}) {
  return {
    saveTemplateImage,
    saveTemplateHeaderMedia,
    persistTemplateHeaderMediaAsset,
    createTemplateUploadSession,
    uploadTemplateFile,
    updateTemplateHeaderMediaHandle,
    createMetaMessageTemplate,
    persistCreatedMetaTemplate,
    now: () => new Date(),
    ...dependencies
  };
}

async function saveHeaderMedia({
  deps,
  input,
  validated
}: {
  deps: ReturnType<typeof createDefaultDependencies>;
  input: CreateMetaTemplateInput;
  validated: ValidatedCreateMetaTemplateInputWithMediaHeader;
}) {
  try {
    return await deps.saveTemplateHeaderMedia({
      fileName: validated.header.media.fileName,
      mimeType: validated.header.media.mimeType,
      bytes: validated.header.media.bytes,
      namespace: input.storageNamespace
    });
  } catch (error) {
    throw mapStorageError(error);
  }
}

async function persistHeaderMediaAsset({
  deps,
  validated,
  storedMedia
}: {
  deps: ReturnType<typeof createDefaultDependencies>;
  validated: ValidatedCreateMetaTemplateInputWithMediaHeader;
  storedMedia: StoredHeaderMedia;
}) {
  try {
    return await deps.persistTemplateHeaderMediaAsset({
      companyId: validated.companyId,
      channelId: validated.channelId,
      headerType: validated.header.type,
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
}

async function uploadHeaderMediaToMeta({
  deps,
  validated,
  storedMedia,
  mediaAsset
}: {
  deps: ReturnType<typeof createDefaultDependencies>;
  validated: ValidatedCreateMetaTemplateInputWithMediaHeader;
  storedMedia: StoredHeaderMedia;
  mediaAsset: PersistedHeaderMedia;
}) {
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

  try {
    const uploaded = await deps.uploadTemplateFile({
      uploadSessionId,
      accessToken: validated.accessToken,
      fileBuffer: validated.header.media.bytes,
      fileType: storedMedia.mimeType
    });
    return uploaded.headerHandle;
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
}

async function persistHeaderHandle({
  deps,
  validated,
  storedMedia,
  mediaAsset,
  headerHandle
}: {
  deps: ReturnType<typeof createDefaultDependencies>;
  validated: ValidatedCreateMetaTemplateInput;
  storedMedia: StoredHeaderMedia;
  mediaAsset: PersistedHeaderMedia;
  headerHandle: string;
}) {
  try {
    return await deps.updateTemplateHeaderMediaHandle({
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
}

async function createTemplateInMeta({
  deps,
  validated,
  components,
  storedMedia,
  mediaAsset,
  headerHandle
}: {
  deps: ReturnType<typeof createDefaultDependencies>;
  validated: ValidatedCreateMetaTemplateInput;
  components: CreateMetaMessageTemplateInput["components"];
  storedMedia: StoredHeaderMedia | null;
  mediaAsset: PersistedHeaderMedia | null;
  headerHandle: string | null;
}) {
  try {
    return await deps.createMetaMessageTemplate({
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
        ...storageRecoveryContext(storedMedia ?? undefined),
        ...(mediaAsset ? { mediaAssetId: mediaAsset.id } : {}),
        ...(headerHandle ? { headerHandle } : {})
      }
    });
  }
}

async function persistCreatedTemplate({
  deps,
  validated,
  components,
  created,
  storedMedia,
  mediaAsset,
  headerHandle
}: {
  deps: ReturnType<typeof createDefaultDependencies>;
  validated: ValidatedCreateMetaTemplateInput;
  components: CreateMetaMessageTemplateInput["components"];
  created: Awaited<ReturnType<typeof createMetaMessageTemplate>>;
  storedMedia: StoredHeaderMedia | null;
  mediaAsset: PersistedHeaderMedia | null;
  headerHandle: string | null;
}) {
  try {
    return await deps.persistCreatedMetaTemplate({
      companyId: validated.companyId,
      wabaId: validated.wabaId,
      metaTemplateId: created.id,
      name: validated.name,
      language: validated.language,
      category: created.category,
      metaStatus: created.status,
      components,
      rawPayload: created.rawPayload,
      defaultHeaderMediaAssetId: mediaAsset?.id ?? null,
      now: deps.now()
    });
  } catch (error) {
    throw mapLocalPersistenceError({
      error,
      code: "META_TEMPLATE_PERSIST_FAILED",
      stage: "META_TEMPLATE_PERSIST",
      recoveryContext: {
        ...storageRecoveryContext(storedMedia ?? undefined),
        ...(mediaAsset ? { mediaAssetId: mediaAsset.id } : {}),
        ...(headerHandle ? { headerHandle } : {}),
        ...(created.id ? { metaTemplateId: created.id } : {}),
        name: validated.name,
        language: validated.language,
        wabaId: validated.wabaId
      }
    });
  }
}

function mapCreateMetaTemplateResult({
  validated,
  created,
  localTemplate,
  components,
  storedMedia,
  mediaAsset,
  headerHandle
}: {
  validated: ValidatedCreateMetaTemplateInput;
  created: Awaited<ReturnType<typeof createMetaMessageTemplate>>;
  localTemplate: Awaited<ReturnType<typeof persistCreatedMetaTemplate>>;
  components: CreateMetaMessageTemplateInput["components"];
  storedMedia: StoredHeaderMedia | null;
  mediaAsset: PersistedHeaderMedia | null;
  headerHandle: string | null;
}): CreateMetaTemplateResult {
  const defaultHeaderMediaAssetId = localTemplate.defaultHeaderMediaAssetId ?? mediaAsset?.id ?? null;

  return {
    mediaAssetId: mediaAsset?.id ?? null,
    metaTemplateLocalId: localTemplate.id,
    metaTemplateId: created.id,
    name: validated.name,
    language: validated.language,
    category: created.category,
    metaStatus: created.status,
    operationalStatus: localTemplate.operationalStatus,
    defaultHeaderMediaAssetId,
    storageKey: storedMedia?.storageKey ?? null,
    checksum: storedMedia?.checksum ?? null,
    headerHandle,
    metaTemplate: {
      id: created.id,
      localId: localTemplate.id,
      name: validated.name,
      language: validated.language,
      category: created.category,
      status: created.status,
      operationalStatus: localTemplate.operationalStatus,
      defaultHeaderMediaAssetId
    },
    media:
      storedMedia && mediaAsset && headerHandle
        ? {
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
          }
        : null,
    components
  };
}

export async function createMetaTemplate(
  input: CreateMetaTemplateInput,
  dependencies: TemplateCreationDependencies = {}
): Promise<CreateMetaTemplateResult> {
  const deps = createDefaultDependencies(dependencies);
  const validated = validateCreateMetaTemplateInput(input);
  let storedMedia: StoredHeaderMedia | null = null;
  let mediaAsset: PersistedHeaderMedia | null = null;
  let headerHandle: string | null = null;

  if (isMediaHeader(validated.header)) {
    const validatedWithMediaHeader = {
      ...validated,
      header: validated.header
    } satisfies ValidatedCreateMetaTemplateInputWithMediaHeader;

    storedMedia = await saveHeaderMedia({ deps, input, validated: validatedWithMediaHeader });
    mediaAsset = await persistHeaderMediaAsset({
      deps,
      validated: validatedWithMediaHeader,
      storedMedia
    });
    headerHandle = await uploadHeaderMediaToMeta({
      deps,
      validated: validatedWithMediaHeader,
      storedMedia,
      mediaAsset
    });
    mediaAsset = await persistHeaderHandle({
      deps,
      validated,
      storedMedia,
      mediaAsset,
      headerHandle
    });
  }

  const components = buildMetaTemplateComponents({
    bodyText: validated.bodyText,
    bodyExamples: validated.bodyExamples,
    footerText: validated.footerText,
    buttons: validated.buttons,
    header: validated.header,
    ...(headerHandle ? { headerHandle } : {})
  });

  const created = await createTemplateInMeta({
    deps,
    validated,
    components,
    storedMedia,
    mediaAsset,
    headerHandle
  });
  const localTemplate = await persistCreatedTemplate({
    deps,
    validated,
    components,
    created,
    storedMedia,
    mediaAsset,
    headerHandle
  });

  return mapCreateMetaTemplateResult({
    validated,
    created,
    localTemplate,
    components,
    storedMedia,
    mediaAsset,
    headerHandle
  });
}

export async function createImageHeaderTemplate(
  input: CreateImageHeaderTemplateInput,
  dependencies: MetaTemplateCreationDependencies = {}
): Promise<CreateImageHeaderTemplateResult> {
  const result = await createMetaTemplate(
    {
      ...input,
      header: {
        type: "IMAGE",
        media: input.image
      }
    },
    {
      ...dependencies,
      saveTemplateHeaderMedia: dependencies.saveTemplateImage ?? saveTemplateHeaderMedia
    }
  );

  if (!result.media || !result.mediaAssetId || !result.defaultHeaderMediaAssetId || !result.headerHandle) {
    throw new MetaTemplateCreationServiceError({
      code: "META_TEMPLATE_CREATION_FAILED",
      message: "Fluxo legado de HEADER IMAGE nao retornou midia obrigatoria.",
      stage: "META_TEMPLATE_CREATE",
      retryable: false,
      recoveryContext: {
        ...(result.metaTemplateId ? { metaTemplateId: result.metaTemplateId } : {}),
        name: result.name,
        language: result.language
      }
    });
  }

  return {
    mediaAssetId: result.mediaAssetId,
    metaTemplateLocalId: result.metaTemplateLocalId,
    metaTemplateId: result.metaTemplateId,
    name: result.name,
    language: result.language,
    category: result.category,
    metaStatus: result.metaStatus,
    operationalStatus: result.operationalStatus,
    defaultHeaderMediaAssetId: result.defaultHeaderMediaAssetId,
    storageKey: result.storageKey ?? result.media.storageKey,
    checksum: result.checksum ?? result.media.checksum,
    headerHandle: result.headerHandle,
    metaTemplate: {
      ...result.metaTemplate,
      defaultHeaderMediaAssetId: result.defaultHeaderMediaAssetId
    },
    media: {
      ...result.media,
      mimeType: result.media.mimeType as "image/jpeg" | "image/png"
    },
    components: result.components
  };
}
