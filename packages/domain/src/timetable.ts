/**
 * The three recurring shapes the calendar engine does not have a rule for
 * (SPEC §2, §8).
 *
 * `calendar.ts` expands daily, weekly and monthly recurrence, which covers
 * almost everything a family does. What it cannot say is "every other week",
 * "the same time in another country", or "whose turn is it to drive" — and each
 * of those is a real fixture of the school year rather than an edge case.
 *
 * Kept beside the engine rather than inside it: these are ways of *selecting*
 * from a recurrence, and folding them into `expandEvent` would complicate the
 * one function every screen depends on.
 */
import type { FamilyState } from "./state.js";
import { EntityTypes, readRecords, readStringList } from "./schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// ── A/B weeks (FR-802) ────────────────────────────────────────────────────

export type WeekLabel = "a" | "b";

/**
 * Which of the two weeks a date falls in, counted from an anchor.
 *
 * The anchor is a date the school called "week A", because there is no
 * universal parity — one school's A week is the next school's B week, and a
 * calendar that guessed would be wrong for half its users every week.
 *
 * Counted in whole weeks from the Monday of the anchor, so a timetable does not
 * flip in the middle of a week.
 */
export function weekLabel(anchorDate: string, date: string): WeekLabel | undefined {
  const anchor = mondayOf(anchorDate);
  const target = mondayOf(date);
  if (anchor === undefined || target === undefined) return undefined;

  const weeks = Math.round((target - anchor) / WEEK_MS);
  // Negative weeks alternate backwards just as they do forwards.
  return ((weeks % 2) + 2) % 2 === 0 ? "a" : "b";
}

function mondayOf(date: string): number | undefined {
  const at = Date.parse(date + "T00:00:00Z");
  if (Number.isNaN(at)) return undefined;

  // getUTCDay: 0 = Sunday. Monday is the start of a school week.
  const day = new Date(at).getUTCDay();
  const backToMonday = (day + 6) % 7;
  return at - backToMonday * DAY_MS;
}

export interface TimetableEntry {
  readonly subject: string;
  /** 0 = Sunday, matching `Date#getUTCDay`. */
  readonly weekday: number;
  readonly startsAtMinute: number;
  readonly endsAtMinute: number;
  /** `undefined` means every week; otherwise only the A or the B week. */
  readonly week: WeekLabel | undefined;
  readonly room: string;
}

/** A child's timetable, as the school hands it out. */
export function readTimetable(state: FamilyState, personId: string): readonly TimetableEntry[] {
  const person = state.get(EntityTypes.person, personId);

  return readRecords(person, "timetable")
    .map((raw) => ({
      subject: typeof raw["subject"] === "string" ? raw["subject"] : "",
      weekday: Number(raw["weekday"] ?? -1),
      startsAtMinute: Number(raw["startsAtMinute"] ?? 0),
      endsAtMinute: Number(raw["endsAtMinute"] ?? 0),
      week: weekLabelOf(raw["week"]),
      room: typeof raw["room"] === "string" ? raw["room"] : "",
    }))
    .filter((entry) => entry.subject.length > 0 && entry.weekday >= 0 && entry.weekday <= 6);
}

function weekLabelOf(value: unknown): WeekLabel | undefined {
  return value === "a" || value === "b" ? value : undefined;
}

/** What is actually on for this child on this day, A/B week resolved. */
export function lessonsOn(
  entries: readonly TimetableEntry[],
  input: { readonly date: string; readonly anchorDate: string },
): readonly TimetableEntry[] {
  const at = Date.parse(input.date + "T00:00:00Z");
  if (Number.isNaN(at)) return [];

  const weekday = new Date(at).getUTCDay();
  const label = weekLabel(input.anchorDate, input.date);

  return entries
    .filter((entry) => entry.weekday === weekday)
    .filter((entry) => entry.week === undefined || entry.week === label)
    .sort((a, b) => a.startsAtMinute - b.startsAtMinute);
}

// ── Time zones (FR-220) ───────────────────────────────────────────────────

/**
 * The offset a zone was at on a given instant, in minutes east of UTC.
 *
 * Read out of `Intl` rather than from a table, so daylight saving is whatever
 * the platform's own database says it was on that date — a fixed offset per
 * zone is the bug this function exists to avoid.
 */
export function zoneOffsetMinutes(timeZone: string, at: number): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(at));

    const read = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? "0");

    // `Date.UTC` of the wall-clock reading in that zone, minus the instant,
    // is the offset — the only way to get it without shipping a tz table.
    const asUtc = Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour") === 24 ? 0 : read("hour"),
      read("minute"),
      read("second"),
    );
    return Math.round((asUtc - at) / 60_000);
  } catch {
    // An unknown zone is not a reason to lose the appointment.
    return 0;
  }
}

/**
 * Does this event cross a change of offset — a flight, or a meeting booked
 * across the spring clock change?
 *
 * Worth surfacing because it is the case where "two hours" and "10:00 to 12:00"
 * stop meaning the same thing, and a person reading a duration needs to know.
 */
export function crossesOffsetChange(input: {
  readonly startsAt: number;
  readonly endsAt: number;
  readonly startZone: string;
  readonly endZone?: string;
}): boolean {
  const endZone = input.endZone ?? input.startZone;

  return (
    zoneOffsetMinutes(input.startZone, input.startsAt) !==
    zoneOffsetMinutes(endZone, input.endsAt)
  );
}

/**
 * The start of a local day, as an instant.
 *
 * An all-day event stored as UTC midnight lands on the previous evening for
 * anybody west of Greenwich, which is how "the school trip is on the 3rd"
 * becomes the 2nd on a phone.
 */
export function startOfDayInZone(date: string, timeZone: string): number {
  const naive = Date.parse(date + "T00:00:00Z");
  if (Number.isNaN(naive)) return Number.NaN;

  // Two passes: the offset at the naive instant may differ from the offset at
  // the real local midnight, on exactly the nights the clocks change.
  const first = naive - zoneOffsetMinutes(timeZone, naive) * 60_000;
  return naive - zoneOffsetMinutes(timeZone, first) * 60_000;
}

// ── Carpool rotation (FR-214, FR-814) ─────────────────────────────────────

export interface Carpool {
  readonly id: string;
  readonly label: string;
  /** Whose turn it is, in order. */
  readonly driverIds: readonly string[];
  /** The week the first driver in the list takes. */
  readonly anchorDate: string;
  readonly weekdays: readonly number[];
}

export function readCarpools(state: FamilyState, familyId: string): readonly Carpool[] {
  const family = state.get(EntityTypes.family, familyId);

  return readRecords(family, "carpools")
    .map((raw, index) => ({
      id: typeof raw["id"] === "string" ? raw["id"] : String(index),
      label: typeof raw["label"] === "string" ? raw["label"] : "",
      driverIds: Array.isArray(raw["driverIds"])
        ? raw["driverIds"].filter((id): id is string => typeof id === "string")
        : [],
      anchorDate: typeof raw["anchorDate"] === "string" ? raw["anchorDate"] : "",
      weekdays: Array.isArray(raw["weekdays"])
        ? raw["weekdays"].map((day) => Number(day)).filter((day) => day >= 0 && day <= 6)
        : [],
    }))
    .filter((pool) => pool.driverIds.length > 0 && pool.anchorDate.length > 0);
}

/**
 * Whose turn it is on a given date.
 *
 * By week rather than by trip: a rota that changes driver mid-week is a rota
 * nobody can remember, and the whole value of a carpool is not having to check.
 * Returns `undefined` on a day the pool does not run, rather than naming a
 * driver who is not expected.
 */
export function driverOn(pool: Carpool, date: string): string | undefined {
  const at = Date.parse(date + "T00:00:00Z");
  if (Number.isNaN(at)) return undefined;
  if (!pool.weekdays.includes(new Date(at).getUTCDay())) return undefined;

  const anchor = mondayOf(pool.anchorDate);
  const target = mondayOf(date);
  if (anchor === undefined || target === undefined) return undefined;

  const weeks = Math.round((target - anchor) / WEEK_MS);
  const index = ((weeks % pool.driverIds.length) + pool.driverIds.length) % pool.driverIds.length;
  return pool.driverIds[index];
}

/** The next few dates this person drives, so a reminder has something to point at. */
export function upcomingTurns(
  pool: Carpool,
  input: { readonly personId: string; readonly from: string; readonly days: number },
): readonly string[] {
  const start = Date.parse(input.from + "T00:00:00Z");
  if (Number.isNaN(start)) return [];

  return Array.from({ length: Math.max(0, input.days) }, (_, offset) =>
    new Date(start + offset * DAY_MS).toISOString().slice(0, 10),
  ).filter((date) => driverOn(pool, date) === input.personId);
}

/** Everyone in the pool, for the reminder that goes out to the group. */
export function poolMembers(state: FamilyState, familyId: string, poolId: string): readonly string[] {
  const pool = readCarpools(state, familyId).find((candidate) => candidate.id === poolId);
  return pool?.driverIds ?? readStringList(state.get(EntityTypes.family, familyId), "carpoolDrivers");
}

/** Human-readable, for a screen that lists pools without expanding them. */
export function describeCarpool(pool: Carpool): string {
  return pool.label.length > 0 ? pool.label : pool.id;
}
