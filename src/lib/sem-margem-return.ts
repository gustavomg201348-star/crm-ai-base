import { createHash } from "node:crypto";

const SHEET_TURNOVER_TIMEZONE_OFFSET = "-03:00";
const SHEET_TURNOVER_HOUR = "09:00:00";

export function isSemMargemTagName(name: string) {
  return name.trim().toLocaleLowerCase("pt-BR") === "sem margem";
}

function saoPauloCalendarDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day)
  };
}

function targetYearMonth(now: Date) {
  const local = saoPauloCalendarDate(now);
  if (local.day < 24) return { year: local.year, month: local.month };
  return local.month === 12
    ? { year: local.year + 1, month: 1 }
    : { year: local.year, month: local.month + 1 };
}

function isoDate(year: number, month: number, day: number, time: string) {
  return new Date(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time}${SHEET_TURNOVER_TIMEZONE_OFFSET}`
  );
}

export function nextSemMargemReturnWindow(now = new Date()) {
  const target = targetYearMonth(now);
  const dueAt = isoDate(target.year, target.month, 24, SHEET_TURNOVER_HOUR);
  const dayStart = isoDate(target.year, target.month, 24, "00:00:00");
  const nextDay = new Date(dayStart);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return { dueAt, dayStart, nextDay };
}

export function semMargemAutomaticTaskId(companyId: string, contactId: string, dueAt: Date) {
  return "sem-margem-" + createHash("sha256")
    .update([companyId, contactId, dueAt.toISOString().slice(0, 10)].join("|"))
    .digest("hex")
    .slice(0, 32);
}
