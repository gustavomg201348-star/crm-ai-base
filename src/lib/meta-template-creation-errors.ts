import { MetaTemplateClientRequestError } from "@/lib/meta-template-client";
import {
  TemplateMediaStorageError,
  type StoredTemplateMedia,
  type TemplateHeaderMediaExtension,
  type TemplateHeaderMediaMimeType
} from "@/lib/template-media-storage";

export type MetaTemplateCreationStage =
  | "VALIDATION"
  | "STORAGE"
  | "MEDIA_ASSET_PERSIST"
  | "META_UPLOAD_SESSION"
  | "META_FILE_UPLOAD"
  | "MEDIA_ASSET_UPDATE"
  | "META_TEMPLATE_PERSIST"
  | "META_TEMPLATE_CREATE";

export type MetaTemplateCreationServiceErrorCode =
  | "INVALID_TEMPLATE_NAME"
  | "INVALID_LANGUAGE"
  | "INVALID_CATEGORY"
  | "EMPTY_BODY"
  | "INVALID_PLACEHOLDERS"
  | "INVALID_BODY_EXAMPLES"
  | "INVALID_FOOTER"
  | "INVALID_BUTTONS"
  | "STORAGE_FAILED"
  | "MEDIA_ASSET_PERSIST_FAILED"
  | "META_UPLOAD_SESSION_FAILED"
  | "META_FILE_UPLOAD_FAILED"
  | "MEDIA_ASSET_UPDATE_FAILED"
  | "META_TEMPLATE_PERSIST_FAILED"
  | "META_TEMPLATE_CREATION_FAILED";

export type MetaTemplateCreationRecoveryContext = {
  storageKey?: string;
  checksum?: string;
  mediaAssetId?: string;
  headerHandle?: string;
  metaTemplateId?: string;
  name?: string;
  language?: string;
  wabaId?: string;
};

export class MetaTemplateCreationServiceError extends Error {
  readonly code: MetaTemplateCreationServiceErrorCode;
  readonly stage: MetaTemplateCreationStage;
  readonly retryable: boolean;
  readonly recoveryContext?: MetaTemplateCreationRecoveryContext;
  readonly cause?: unknown;

  constructor({
    code,
    message,
    stage,
    retryable,
    recoveryContext,
    cause
  }: {
    code: MetaTemplateCreationServiceErrorCode;
    message: string;
    stage: MetaTemplateCreationStage;
    retryable: boolean;
    recoveryContext?: MetaTemplateCreationRecoveryContext;
    cause?: unknown;
  }) {
    super(message);
    this.name = "MetaTemplateCreationServiceError";
    this.code = code;
    this.stage = stage;
    this.retryable = retryable;
    this.recoveryContext = recoveryContext;
    this.cause = cause;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      stage: this.stage,
      retryable: this.retryable,
      recoveryContext: this.recoveryContext
    };
  }
}

export function createValidationError({
  code,
  message
}: {
  code: Extract<
    MetaTemplateCreationServiceErrorCode,
    | "INVALID_TEMPLATE_NAME"
    | "INVALID_LANGUAGE"
    | "INVALID_CATEGORY"
    | "EMPTY_BODY"
    | "INVALID_PLACEHOLDERS"
    | "INVALID_BODY_EXAMPLES"
    | "INVALID_FOOTER"
    | "INVALID_BUTTONS"
  >;
  message: string;
}) {
  return new MetaTemplateCreationServiceError({
    code,
    message,
    stage: "VALIDATION",
    retryable: false
  });
}

export function storageRecoveryContext(
  media?: StoredTemplateMedia<TemplateHeaderMediaMimeType, TemplateHeaderMediaExtension>
) {
  return media
    ? {
        storageKey: media.storageKey,
        checksum: media.checksum
      }
    : undefined;
}

function sanitizeCause(error: unknown) {
  if (error instanceof MetaTemplateClientRequestError) {
    return {
      name: error.name,
      code: error.code,
      retryable: error.retryable,
      operation: error.operation,
      httpStatus: error.httpStatus,
      metaCode: error.metaCode,
      metaSubcode: error.metaSubcode,
      metaType: error.metaType,
      fbtraceId: error.fbtraceId
    };
  }

  if (error instanceof TemplateMediaStorageError) {
    return {
      name: error.name,
      code: error.code
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name
    };
  }

  return undefined;
}

export function mapStorageError(error: unknown): MetaTemplateCreationServiceError {
  return new MetaTemplateCreationServiceError({
    code: "STORAGE_FAILED",
    message:
      error instanceof TemplateMediaStorageError
        ? error.message
        : "Falha ao armazenar imagem do template.",
    stage: "STORAGE",
    retryable: false,
    cause: sanitizeCause(error)
  });
}

export function mapLocalPersistenceError({
  error,
  code,
  stage,
  recoveryContext,
  message
}: {
  error: unknown;
  code:
    | "MEDIA_ASSET_PERSIST_FAILED"
    | "MEDIA_ASSET_UPDATE_FAILED"
    | "META_TEMPLATE_PERSIST_FAILED";
  stage: Extract<
    MetaTemplateCreationStage,
    "MEDIA_ASSET_PERSIST" | "MEDIA_ASSET_UPDATE" | "META_TEMPLATE_PERSIST"
  >;
  recoveryContext?: MetaTemplateCreationRecoveryContext;
  message?: string;
}) {
  return new MetaTemplateCreationServiceError({
    code,
    message:
      message ??
      (stage === "MEDIA_ASSET_PERSIST"
        ? "Falha ao persistir midia local do template."
        : stage === "MEDIA_ASSET_UPDATE"
          ? "Falha ao atualizar midia local com dados da Meta."
          : "Template pode ter sido criado na Meta, mas nao foi persistido localmente."),
    stage,
    retryable: true,
    recoveryContext,
    cause: sanitizeCause(error)
  });
}

export function mapMetaError({
  error,
  code,
  stage,
  recoveryContext
}: {
  error: unknown;
  code:
    | "META_UPLOAD_SESSION_FAILED"
    | "META_FILE_UPLOAD_FAILED"
    | "META_TEMPLATE_CREATION_FAILED";
  stage: Exclude<MetaTemplateCreationStage, "VALIDATION" | "STORAGE">;
  recoveryContext?: MetaTemplateCreationRecoveryContext;
}) {
  const retryable =
    error instanceof MetaTemplateClientRequestError ? error.retryable : true;
  const message =
    stage === "META_UPLOAD_SESSION"
      ? "Falha ao iniciar upload resumable na Meta."
      : stage === "META_FILE_UPLOAD"
        ? "Falha ao enviar arquivo do template para a Meta."
        : "Falha ao criar template na Meta.";

  return new MetaTemplateCreationServiceError({
    code,
    message,
    stage,
    retryable,
    recoveryContext,
    cause: sanitizeCause(error)
  });
}
