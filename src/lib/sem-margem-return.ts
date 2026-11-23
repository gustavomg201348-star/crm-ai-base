import { createHash } from "node:crypto";

const SHEET_TURNOVER_TIMEZONE_OFFSET = "-03:00";
const SHEET_TURNOVER_HOUR = "08:00:00";

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

function nextYearMonth(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function isoDate(year: number, month: number, day: number, time: string) {
  return new Date(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time}${SHEET_TURNOVER_TIMEZONE_OFFSET}`
  );
}

function dayWindow(year: number, month: number, day: number) {
  const dueAt = isoDate(year, month, day, SHEET_TURNOVER_HOUR);
  const dayStart = isoDate(year, month, day, "00:00:00");
  const nextDay = new Date(dayStart);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return { dueAt, dayStart, nextDay };
}

/**
 * New Sem margem entries always return on day 23 of the following calendar month.
 */
export function nextSemMargemReturnWindow(now = new Date()) {
  const local = saoPauloCalendarDate(now);
  const target = nextYearMonth(local.year, local.month);
  return dayWindow(target.year, target.month, 23);
}

/**
 * One-time/backfill window for Sem margem entries that already existed before today.
 */
export function todaySemMargemReturnWindow(now = new Date()) {
  const local = saoPauloCalendarDate(now);
  return dayWindow(local.year, local.month, local.day);
}

export function semMargemAutomaticTaskId(companyId: string, contactId: string, dueAt: Date) {
  return "sem-margem-" + createHash("sha256")
    .update([companyId, contactId, dueAt.toISOString().slice(0, 10)].join("|"))
    .digest("hex")
    .slice(0, 32);
}
