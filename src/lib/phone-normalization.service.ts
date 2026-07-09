export type PhoneNormalizationReason =
  | "EMPTY"
  | "BR_WITHOUT_DDI_10"
  | "BR_WITHOUT_DDI_11"
  | "BR_WITH_DDI_12"
  | "BR_WITH_DDI_13"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "INTERNATIONAL_UNSUPPORTED";

export type PhoneNormalizationCountry = "BR" | "UNKNOWN";

export type PhoneNormalizationConfidence = "HIGH" | "MEDIUM" | "NONE";

export type PhoneNormalizationResult = {
  raw: string;
  digits: string;
  normalizedPhone: string | null;
  valid: boolean;
  reason: PhoneNormalizationReason;
  country: PhoneNormalizationCountry;
  confidence: PhoneNormalizationConfidence;
};

export function digitsOnlyPhone(input?: string | null) {
  return String(input ?? "").replace(/\D/g, "");
}

function buildPhoneNormalizationResult({
  raw,
  digits,
  normalizedPhone,
  reason,
  country,
  confidence
}: {
  raw: string;
  digits: string;
  normalizedPhone: string | null;
  reason: PhoneNormalizationReason;
  country: PhoneNormalizationCountry;
  confidence: PhoneNormalizationConfidence;
}): PhoneNormalizationResult {
  return {
    raw,
    digits,
    normalizedPhone,
    valid: Boolean(normalizedPhone),
    reason,
    country,
    confidence
  };
}

export function normalizeBrazilianPhoneForIdentity(
  input?: string | null
): PhoneNormalizationResult {
  return classifyPhoneNormalization(input);
}

export function classifyPhoneNormalization(input?: string | null): PhoneNormalizationResult {
  const raw = String(input ?? "").trim();
  const digits = digitsOnlyPhone(raw);
  const digitLength = digits.length;

  if (!digits) {
    return buildPhoneNormalizationResult({
      raw,
      digits,
      normalizedPhone: null,
      reason: "EMPTY",
      country: "UNKNOWN",
      confidence: "NONE"
    });
  }

  if (digitLength < 10) {
    return buildPhoneNormalizationResult({
      raw,
      digits,
      normalizedPhone: null,
      reason: "TOO_SHORT",
      country: "UNKNOWN",
      confidence: "NONE"
    });
  }

  if (digitLength > 13) {
    return buildPhoneNormalizationResult({
      raw,
      digits,
      normalizedPhone: null,
      reason: "TOO_LONG",
      country: "UNKNOWN",
      confidence: "NONE"
    });
  }

  if (digitLength === 10) {
    return buildPhoneNormalizationResult({
      raw,
      digits,
      normalizedPhone: `55${digits}`,
      reason: "BR_WITHOUT_DDI_10",
      country: "BR",
      confidence: "MEDIUM"
    });
  }

  if (digitLength === 11) {
    return buildPhoneNormalizationResult({
      raw,
      digits,
      normalizedPhone: `55${digits}`,
      reason: "BR_WITHOUT_DDI_11",
      country: "BR",
      confidence: "HIGH"
    });
  }

  if (!digits.startsWith("55")) {
    return buildPhoneNormalizationResult({
      raw,
      digits,
      normalizedPhone: null,
      reason: "INTERNATIONAL_UNSUPPORTED",
      country: "UNKNOWN",
      confidence: "NONE"
    });
  }

  if (digitLength === 12) {
    return buildPhoneNormalizationResult({
      raw,
      digits,
      normalizedPhone: digits,
      reason: "BR_WITH_DDI_12",
      country: "BR",
      confidence: "MEDIUM"
    });
  }

  return buildPhoneNormalizationResult({
    raw,
    digits,
    normalizedPhone: digits,
    reason: "BR_WITH_DDI_13",
    country: "BR",
    confidence: "HIGH"
  });
}
