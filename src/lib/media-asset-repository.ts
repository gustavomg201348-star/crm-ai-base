import { Prisma, type MediaAsset, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

function isPrismaRecordNotFoundError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

export type CreateMediaAssetInput = {
  companyId: string;
  type: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  status: string;
  storageProvider?: string | null;
  storageKey?: string | null;
  publicUrl?: string | null;
  metaMediaId?: string | null;
  headerHandle?: string | null;
  metaExpiresAt?: Date | null;
  checksum?: string | null;
  metadata?: string | null;
  lastValidatedAt?: Date | null;
  validationError?: string | null;
};

export type UpdateMediaAssetStatusInput = {
  status: string;
  lastValidatedAt?: Date | null;
  validationError?: string | null;
  metaMediaId?: string | null;
  headerHandle?: string | null;
  metaExpiresAt?: Date | null;
};

export type UpdateMediaAssetStorageDetailsInput = Partial<
  Pick<
    CreateMediaAssetInput,
    | "type"
    | "mimeType"
    | "fileName"
    | "sizeBytes"
    | "status"
    | "storageProvider"
    | "storageKey"
    | "publicUrl"
    | "checksum"
    | "metadata"
  >
>;

export function findMediaAssetById(companyId: string, id: string, db: DbClient = prisma) {
  return db.mediaAsset.findFirst({
    where: {
      companyId,
      id
    }
  });
}

export function createMediaAsset(input: CreateMediaAssetInput, db: DbClient = prisma) {
  const data: Prisma.MediaAssetUncheckedCreateInput = {
    companyId: input.companyId,
    type: input.type,
    mimeType: input.mimeType,
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
    status: input.status,
    storageProvider: input.storageProvider ?? null,
    storageKey: input.storageKey ?? null,
    publicUrl: input.publicUrl ?? null,
    metaMediaId: input.metaMediaId ?? null,
    headerHandle: input.headerHandle ?? null,
    metaExpiresAt: input.metaExpiresAt ?? null,
    checksum: input.checksum ?? null,
    metadata: input.metadata ?? null,
    lastValidatedAt: input.lastValidatedAt ?? null,
    validationError: input.validationError ?? null
  };

  return db.mediaAsset.create({ data });
}

export function findMediaAssetByStorageIdentity(
  companyId: string,
  storageProvider: string,
  checksum: string,
  db: DbClient = prisma
) {
  return db.mediaAsset.findFirst({
    where: {
      companyId,
      storageProvider,
      checksum
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

export async function findMediaAssetByHeaderHandle(
  companyId: string,
  headerHandle: string,
  db: DbClient = prisma
) {
  const matches = await db.mediaAsset.findMany({
    where: {
      companyId,
      headerHandle
    },
    orderBy: {
      createdAt: "asc"
    },
    take: 2
  });

  return matches.length === 1 ? matches[0] : null;
}

export function updateMediaAssetStorageDetails(
  companyId: string,
  id: string,
  input: UpdateMediaAssetStorageDetailsInput,
  db: DbClient = prisma
): Promise<MediaAsset | null> {
  const data: Prisma.MediaAssetUncheckedUpdateInput = {
    type: input.type,
    mimeType: input.mimeType,
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
    status: input.status,
    storageProvider: input.storageProvider,
    storageKey: input.storageKey,
    publicUrl: input.publicUrl,
    checksum: input.checksum,
    metadata: input.metadata
  };

  return db.mediaAsset
    .update({
      where: {
        companyId_id: {
          companyId,
          id
        }
      },
      data
    })
    .catch((error: unknown) => {
      if (isPrismaRecordNotFoundError(error)) {
        return null;
      }

      throw error;
    });
}

export function updateMediaAssetStatus(
  companyId: string,
  id: string,
  input: UpdateMediaAssetStatusInput,
  db: DbClient = prisma
): Promise<MediaAsset | null> {
  return db.mediaAsset
    .update({
      where: {
        companyId_id: {
          companyId,
          id
        }
      },
      data: {
        status: input.status,
        lastValidatedAt: input.lastValidatedAt,
        validationError: input.validationError,
        metaMediaId: input.metaMediaId,
        headerHandle: input.headerHandle,
        metaExpiresAt: input.metaExpiresAt
      }
    })
    .catch((error: unknown) => {
      if (isPrismaRecordNotFoundError(error)) {
        return null;
      }

      throw error;
    });
}
