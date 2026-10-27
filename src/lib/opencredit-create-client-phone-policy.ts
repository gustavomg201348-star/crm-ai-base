// Browser-safe, closed createClient policy. No phone inspection or automatic fallback.
export type OpenCreditCreateClientPhonePolicy = "include" | "omit";

export function parseOpenCreditCreateClientPhonePolicy(value: unknown): OpenCreditCreateClientPhonePolicy {
  if (value !== "include" && value !== "omit") throw new Error("INVALID_PHONE_POLICY");
  return value;
}
