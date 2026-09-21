export type ContactReferenceDb = {
  pipelineStage: {
    findFirst(args: {
      where: { id: string; companyId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  origin: {
    findFirst(args: {
      where: { id: string; companyId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

type ReferenceValue = string | null | undefined;

export type ContactReferenceValidationResult =
  | {
      ok: true;
      stageId: string | null | undefined;
      originId: string | null | undefined;
    }
  | { ok: false; field: "stageId" | "originId" };

function normalizeReference(value: ReferenceValue) {
  if (value === undefined) return undefined;
  return value || null;
}

export async function validateContactReferences({
  db,
  companyId,
  stageId,
  originId
}: {
  db: ContactReferenceDb;
  companyId: string;
  stageId?: ReferenceValue;
  originId?: ReferenceValue;
}): Promise<ContactReferenceValidationResult> {
  const normalizedStageId = normalizeReference(stageId);
  const normalizedOriginId = normalizeReference(originId);

  const [stage, origin] = await Promise.all([
    typeof normalizedStageId === "string"
      ? db.pipelineStage.findFirst({
          where: { id: normalizedStageId, companyId },
          select: { id: true }
        })
      : null,
    typeof normalizedOriginId === "string"
      ? db.origin.findFirst({
          where: { id: normalizedOriginId, companyId },
          select: { id: true }
        })
      : null
  ]);

  if (typeof normalizedStageId === "string" && !stage) {
    return { ok: false, field: "stageId" };
  }

  if (typeof normalizedOriginId === "string" && !origin) {
    return { ok: false, field: "originId" };
  }

  return {
    ok: true,
    stageId: normalizedStageId,
    originId: normalizedOriginId
  };
}
