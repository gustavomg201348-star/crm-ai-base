export class JsonStorageError extends Error {
  readonly fieldName: string;

  constructor(message: string, fieldName: string) {
    super(message);
    this.name = "JsonStorageError";
    this.fieldName = fieldName;
  }
}

export function serializeJsonField(value: unknown, fieldName: string) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "erro desconhecido";
    throw new JsonStorageError(`Falha ao serializar JSON do campo ${fieldName}: ${reason}`, fieldName);
  }
}

export function parseJsonField<T>(value: string | null | undefined, fieldName: string) {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "erro desconhecido";
    throw new JsonStorageError(`JSON persistido invalido no campo ${fieldName}: ${reason}`, fieldName);
  }
}
