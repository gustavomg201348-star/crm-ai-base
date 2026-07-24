import { Prisma, type MetaTemplate, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type MetaTemplateRepositoryErrorCode = "META_TEMPLATE_ID_CONFLICT";

export class MetaTemplateRepositoryError extends Error {
  readonly code: MetaTemplateRepositoryErrorCode;

  constructor(code: MetaTemplateRepositoryErrorCode, message: string) {
    super(message);
    this.name = "MetaTemplateRepositoryError";
    this.code = code;
  }
}

function isPrismaRecordNotFoundError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

function isPrismaUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isDifferentTemplateIdentity(
  template: MetaTemplate,
  identity: {
    companyId: string;
    wabaId: string;
    name: string;
    language: string;
  }
) {
  return (
    template.companyId !== identity.companyId ||
    template.wabaId !== identity.wabaId ||
    template.name !== identity.name ||
    template.language !== identity.language
  );
}

export type MetaTemplateListFilters = {
  operationalStatus?: string;
  metaStatus?: string | null;
  requiresHeaderMedia?: boolean;
  isActive?: boolean;
};

export type CreateMetaTemplateInput = {
  companyId: string;
  wabaId: string;
  name: string;
  language: string;
  operationalStatus: string;
  components: string;
  metaTemplateId?: string | null;
  category?: string | null;
  metaStatus?: string | null;
  requiresHeaderMedia?: boolean;
  headerFormat?: string | null;
  rawPayload?: string | null;
  supportFlags?: string | null;
  defaultHeaderMediaAssetId?: string | null;
  lastSyncedAt?: Date | null;
  lastSeenAt?: Date | null;
  syncError?: string | null;
  isActive?: boolean;
};

export type UpdateMetaTemplateInput = Partial<
  Pick<
    CreateMetaTemplateInput,
    | "metaTemplateId"
    | "category"
    | "metaStatus"
    | "operationalStatus"
    | "requiresHeaderMedia"
    | "headerFormat"
    | "components"
    | "rawPayload"
    | "supportFlags"
    | "lastSyncedAt"
    | "lastSeenAt"
    | "syncError"
    | "isActive"
  >
>;

export type UpsertMetaTemplateFromMetaInput = {
  companyId: string;
  wabaId: string;
  name: string;
  language: string;
  operationalStatus: string;
  components: string;
  metaTemplateId: string | null;
  category: string | null;
  metaStatus: string | null;
  requiresHeaderMedia: boolean;
  headerFormat: string | null;
  rawPayload: string | null;
  supportFlags: string | null;
  lastSyncedAt: Date | null;
  lastSeenAt: Date | null;
  syncError: string | null;
  isActive: boolean;
};

export function findMetaTemplateById(companyId: string, id: string, db: DbClient = prisma) {
  return db.metaTemplate.findFirst({
    where: {
      companyId,
      id
    }
  });
}

export function findMetaTemplateByIdentity(
  companyId: string,
  wabaId: string,
  name: string,
  language: string,
  db: DbClient = prisma
) {
  return db.metaTemplate.findUnique({
    where: {
      companyId_wabaId_name_language: {
        companyId,
        wabaId,
        name,
        language
      }
    }
  });
}

export function findMetaTemplateByMetaTemplateId(
  companyId: string,
  wabaId: string,
  metaTemplateId: string,
  db: DbClient = prisma
) {
  return db.metaTemplate.findUnique({
    where: {
      companyId_wabaId_metaTemplateId: {
        companyId,
        wabaId,
        metaTemplateId
      }
    }
  });
}

export function listMetaTemplatesByWaba(
  companyId: string,
  wabaId: string,
  filters: MetaTemplateListFilters = {},
  db: DbClient = prisma
) {
  return db.metaTemplate.findMany({
    where: {
      companyId,
      wabaId,
      ...(filters.operationalStatus ? { operationalStatus: filters.operationalStatus } : {}),
      ...(filters.metaStatus !== undefined ? { metaStatus: filters.metaStatus } : {}),
      ...(filters.requiresHeaderMedia !== undefined
        ? { requiresHeaderMedia: filters.requiresHeaderMedia }
        : {}),
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {})
    },
    orderBy: [{ name: "asc" }, { language: "asc" }]
  });
}

export function createMetaTemplate(input: CreateMetaTemplateInput, db: DbClient = prisma) {
  const data: Prisma.MetaTemplateUncheckedCreateInput = {
    companyId: input.companyId,
    wabaId: input.wabaId,
    name: input.name,
    language: input.language,
    operationalStatus: input.operationalStatus,
    components: input.components,
    metaTemplateId: input.metaTemplateId ?? null,
    category: input.category ?? null,
    metaStatus: input.metaStatus ?? null,
    requiresHeaderMedia: input.requiresHeaderMedia ?? false,
    headerFormat: input.headerFormat ?? null,
    rawPayload: input.rawPayload ?? null,
    supportFlags: input.supportFlags ?? null,
    defaultHeaderMediaAssetId: input.defaultHeaderMediaAssetId ?? null,
    lastSyncedAt: input.lastSyncedAt ?? null,
    lastSeenAt: input.lastSeenAt ?? null,
    syncError: input.syncError ?? null,
    isActive: input.isActive ?? true
  };

  return db.metaTemplate.create({ data });
}

export function updateMetaTemplate(
  companyId: string,
  id: string,
  input: UpdateMetaTemplateInput,
  db: DbClient = prisma
): Promise<MetaTemplate | null> {
  const data: Prisma.MetaTemplateUncheckedUpdateInput = {
    metaTemplateId: input.metaTemplateId,
    category: input.category,
    metaStatus: input.metaStatus,
    operationalStatus: input.operationalStatus,
    requiresHeaderMedia: input.requiresHeaderMedia,
    headerFormat: input.headerFormat,
    components: input.components,
    rawPayload: input.rawPayload,
    supportFlags: input.supportFlags,
    lastSyncedAt: input.lastSyncedAt,
    lastSeenAt: input.lastSeenAt,
    syncError: input.syncError,
    isActive: input.isActive
  };

  return db.metaTemplate
    .update({
      where: {
        id,
        companyId
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

export async function upsertMetaTemplateFromMeta(
  input: UpsertMetaTemplateFromMetaInput,
  db: DbClient = prisma
) {
  if (input.metaTemplateId) {
    const existingByMetaId = await findMetaTemplateByMetaTemplateId(
      input.companyId,
      input.wabaId,
      input.metaTemplateId,
      db
    );

    if (existingByMetaId && isDifferentTemplateIdentity(existingByMetaId, input)) {
      throw new MetaTemplateRepositoryError(
        "META_TEMPLATE_ID_CONFLICT",
        "Identificador Meta do template conflita com outro template da mesma WABA."
      );
    }
  }

  const metaData = {
    metaTemplateId: input.metaTemplateId,
    category: input.category,
    metaStatus: input.metaStatus,
    requiresHeaderMedia: input.requiresHeaderMedia,
    headerFormat: input.headerFormat,
    components: input.components,
    rawPayload: input.rawPayload,
    supportFlags: input.supportFlags,
    lastSyncedAt: input.lastSyncedAt,
    lastSeenAt: input.lastSeenAt,
    syncError: input.syncError,
    isActive: input.isActive,
    operationalStatus: input.operationalStatus
  } satisfies Prisma.MetaTemplateUncheckedUpdateInput;

  try {
    return await db.metaTemplate.upsert({
      where: {
        companyId_wabaId_name_language: {
          companyId: input.companyId,
          wabaId: input.wabaId,
          name: input.name,
          language: input.language
        }
      },
      update: metaData,
      create: {
        companyId: input.companyId,
        wabaId: input.wabaId,
        name: input.name,
        language: input.language,
        ...metaData
      }
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new MetaTemplateRepositoryError(
        "META_TEMPLATE_ID_CONFLICT",
        "Identificador Meta do template conflita com outro template da mesma WABA."
      );
    }

    throw error;
  }
}

export function markMetaTemplateNotReturned(
  companyId: string,
  id: string,
  db: DbClient = prisma
) {
  return db.metaTemplate.update({
    where: {
      id,
      companyId
    },
    data: {
      isActive: false,
      operationalStatus: "NOT_RETURNED"
    }
  });
}

export function setMetaTemplateOperationalStatus(
  companyId: string,
  id: string,
  operationalStatus: string,
  db: DbClient = prisma
) {
  return db.metaTemplate.update({
    where: {
      id,
      companyId
    },
    data: {
      operationalStatus
    }
  });
}

export function setMetaTemplateDefaultHeaderMediaAndStatus(
  companyId: string,
  templateId: string,
  mediaAssetId: string,
  operationalStatus: string,
  db: DbClient = prisma
) {
  return db.metaTemplate.update({
    where: {
      id: templateId,
      companyId
    },
    data: {
      defaultHeaderMediaAssetId: mediaAssetId,
      operationalStatus
    }
  });
}
