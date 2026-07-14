import { Prisma } from "@prisma/client";

export function isPrismaKnownRequestError(
  error: unknown,
  code?: string
): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  return code ? error.code === code : true;
}

export function getPrismaErrorTarget(error: unknown): string[] {
  if (!isPrismaKnownRequestError(error)) {
    return [];
  }

  const target = error.meta?.target;

  if (Array.isArray(target)) {
    return target
      .filter((item): item is string => typeof item === "string")
      .filter(Boolean);
  }

  return typeof target === "string" && target ? [target] : [];
}

export function isPrismaUniqueViolation(
  error: unknown
) {
  return isPrismaKnownRequestError(error, "P2002");
}

export function isPrismaUniqueViolationForTarget(
  error: unknown,
  expectedTarget: string | string[]
) {
  if (!isPrismaUniqueViolation(error)) {
    return false;
  }

  const actualTargets = getPrismaErrorTarget(error);
  const expectedTargets = Array.isArray(expectedTarget)
    ? expectedTarget
    : [expectedTarget];

  return expectedTargets.every((expected) =>
    actualTargets.some((actual) => actual === expected || actual.includes(expected))
  );
}
