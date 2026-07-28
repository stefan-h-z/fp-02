/**
 * Calendar logic (SPEC §5).
 *
 * The calendar's job in this product is not to be a calendar — parents already
 * have one, and two-way sync (FR-207) keeps it that way. Its job is the part no
 * general calendar does: saying who brings and who fetches (FR-209), noticing
 * that one parent is now in two places at once (FR-211), and spotting the
 * childcare gap in six weeks' time before a human has to (FR-212).
 *
 * Occurrences are expanded from a rule rather than stored, so an edit to a series
 * cannot leave stale rows behind; only genuine exceptions are stored.
 */
import { setMembers } from "./entity.js";
import { derivedId } from "./ids.js";
import { DAY_MS } from "./rhythm.js";
import {
  EntityTypes,
  readBoolean,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readString,
  readStringList,
} from "./schema.js";
import type { FamilyState } from "./state.js";

/**
 * `fortnightly` is here because family life has it — A/B school weeks (FR-802),
 * alternating custody, the every-other-Saturday club — and because a suggestion
 * the app makes (FR-1108) that the calendar cannot then express is a suggestion
 * with no accept button.
 */
export type RecurrenceKind = "none" | "daily" | "weekly" | "fortnightly" | "monthly";

export interface EventDefinition {
  readonly id: string;
  readonly title: string;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly allDay: boolean;
  readonly calendarId: string;
  readonly recurrence: RecurrenceKind;
  /** Weekly recurrence: 0 = Sunday, matching `Date.getUTCDay()`. */
  readonly weekdays: readonly number[];
  readonly recurrenceUntil: number | undefined;
  /** Who brings, who fetches, who is the fallback (FR-209). */
  readonly bringOwnerId: string | undefined;
  readonly fetchOwnerId: string | undefined;
  readonly fallbackOwnerId: string | undefined;
  /** Travel time either side, which is what makes conflict detection honest (FR-210). */
  readonly travelBeforeMinutes: number;
  readonly travelAfterMinutes: number;
  readonly cancelled: boolean;
  readonly participantIds: readonly string[];
  /** Private events show as busy to everyone else (FR-203). */
  readonly private: boolean;
}

export interface Occurrence {
  readonly id: string;
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly allDay: boolean;
  readonly cancelled: boolean;
  readonly bringOwnerId: string | undefined;
  readonly fetchOwnerId: string | undefined;
  readonly fallbackOwnerId: string | undefined;
  readonly participantIds: readonly string[];
  readonly private: boolean;
  /** Start and end including travel — the interval a person is actually busy. */
  readonly blockedFrom: number;
  readonly blockedTo: number;
}

export function readEvent(state: FamilyState, eventId: string): EventDefinition | undefined {
  const entity = state.get(EntityTypes.event, eventId);
  if (entity === undefined || entity.deleted) return undefined;

  const startsAt = readNumber(entity, "startsAt");
  return {
    id: entity.id,
    title: readString(entity, "title"),
    startsAt,
    endsAt: readNumber(entity, "endsAt", startsAt),
    allDay: readBoolean(entity, "allDay"),
    calendarId: readOptionalString(entity, "calendarId") ?? "default",
    recurrence: recurrenceKindOf(readString(entity, "recurrence")),
    weekdays: readStringList(entity, "weekdays")
      .map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    recurrenceUntil: readOptionalNumber(entity, "recurrenceUntil"),
    bringOwnerId: readOptionalString(entity, "bringOwnerId"),
    fetchOwnerId: readOptionalString(entity, "fetchOwnerId"),
    fallbackOwnerId: readOptionalString(entity, "fallbackOwnerId"),
    travelBeforeMinutes: readNumber(entity, "travelBeforeMinutes"),
    travelAfterMinutes: readNumber(entity, "travelAfterMinutes"),
    cancelled: readBoolean(entity, "cancelled"),
    participantIds: setMembers(entity, "participants"),
    private: readBoolean(entity, "private"),
  };
}

const RECURRENCE_KINDS: readonly RecurrenceKind[] = [
  "daily",
  "weekly",
  "fortnightly",
  "monthly",
];

function recurrenceKindOf(value: string): RecurrenceKind {
  return (RECURRENCE_KINDS as readonly string[]).includes(value)
    ? (value as RecurrenceKind)
    : "none";
}

export function occurrenceId(eventId: string, startsAt: number): string {
  return derivedId("occurrence", eventId, String(startsAt));
}

/**
 * Expand a series into the requested window.
 *
 * Exceptions are stored as `eventException` entities keyed by the occurrence id,
 * so moving or cancelling a single instance never rewrites the series (FR-205).
 */
export function expandEvent(
  event: EventDefinition,
  state: FamilyState,
  window: { readonly from: number; readonly to: number },
): readonly Occurrence[] {
  const duration = Math.max(0, event.endsAt - event.startsAt);
  // "Repeats until 4 August" includes the 4th: a date is a day, not an instant.
  const until =
    event.recurrenceUntil === undefined
      ? window.to
      : Math.min(startOfDay(event.recurrenceUntil) + DAY_MS - 1, window.to);
  const out: Occurrence[] = [];

  for (const startsAt of startTimes(event, window.from, until)) {
    const exception = state.get("eventException", occurrenceId(event.id, startsAt));
    const movedTo = readOptionalNumber(exception, "startsAt") ?? startsAt;
    const cancelled = event.cancelled || readBoolean(exception, "cancelled");
    if (movedTo + duration < window.from || movedTo > window.to) continue;

    out.push({
      id: occurrenceId(event.id, startsAt),
      eventId: event.id,
      title: readOptionalString(exception, "title") ?? event.title,
      startsAt: movedTo,
      endsAt: movedTo + duration,
      allDay: event.allDay,
      cancelled,
      bringOwnerId: event.bringOwnerId,
      fetchOwnerId: event.fetchOwnerId,
      fallbackOwnerId: event.fallbackOwnerId,
      participantIds: event.participantIds,
      private: event.private,
      blockedFrom: movedTo - event.travelBeforeMinutes * 60_000,
      blockedTo: movedTo + duration + event.travelAfterMinutes * 60_000,
    });
  }

  return out.sort((a, b) => a.startsAt - b.startsAt);
}

function startTimes(event: EventDefinition, from: number, until: number): readonly number[] {
  if (event.recurrence === "none") return [event.startsAt];

  const out: number[] = [];
  const limit = 1000;

  if (event.recurrence === "weekly" && event.weekdays.length > 0) {
    // A weekday list is the common case ("swimming on Tuesdays and Thursdays"),
    // and is not expressible by simply adding seven days.
    const first = startOfDay(event.startsAt);
    const timeOfDay = event.startsAt - first;
    for (let day = first; day <= until && out.length < limit; day += DAY_MS) {
      if (!event.weekdays.includes(new Date(day).getUTCDay())) continue;
      const at = day + timeOfDay;
      if (at >= event.startsAt && at >= from - DAY_MS) out.push(at);
    }
    return out;
  }

  if (event.recurrence === "monthly") {
    for (let month = 0; month < limit; month += 1) {
      const at = addMonths(event.startsAt, month);
      if (at > until) break;
      if (at >= from - DAY_MS) out.push(at);
    }
    return out;
  }

  // Everything left steps by a fixed number of days from the original date.
  // "weekly" reaches here when nobody named a weekday, and it must still mean
  // seven days — falling through to a daily step would quietly turn one swimming
  // lesson a week into seven.
  const step = event.recurrence === "fortnightly" ? 14 : event.recurrence === "weekly" ? 7 : 1;

  let at = event.startsAt;
  while (at <= until && out.length < limit) {
    if (at >= from - DAY_MS) out.push(at);
    at += step * DAY_MS;
  }
  return out;
}

/**
 * Always counted from the original date, never from the previous occurrence:
 * a series on the 31st that gets clamped to 28 February must return to the 31st
 * in March, which stepping month-by-month from the clamped value cannot do.
 */
function addMonths(anchor: number, months: number): number {
  const source = new Date(anchor);
  const target = new Date(anchor);
  target.setUTCDate(1);
  target.setUTCMonth(source.getUTCMonth() + months);

  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(source.getUTCDate(), daysInTargetMonth));

  return target.getTime();
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

export function occurrencesInWindow(
  state: FamilyState,
  window: { readonly from: number; readonly to: number },
): readonly Occurrence[] {
  return state
    .all(EntityTypes.event)
    .flatMap((entity) => {
      const event = readEvent(state, entity.id);
      return event === undefined ? [] : expandEvent(event, state, window);
    })
    .sort((a, b) => a.startsAt - b.startsAt);
}

export interface ScheduleConflict {
  readonly personId: string;
  readonly first: Occurrence;
  readonly second: Occurrence;
  /** Milliseconds of genuine overlap, travel included. */
  readonly overlapMs: number;
}

/**
 * Two events, one parent (FR-211).
 *
 * Responsibility counts, not attendance: the conflict that matters is the one
 * where the same adult is supposed to be driving to two places. Travel buffers are
 * part of the interval, because the clash usually happens in the journey rather
 * than in the appointment.
 */
export function detectConflicts(occurrences: readonly Occurrence[]): readonly ScheduleConflict[] {
  const byPerson = new Map<string, Occurrence[]>();

  for (const occurrence of occurrences) {
    if (occurrence.cancelled) continue;
    for (const personId of responsibleFor(occurrence)) {
      const bucket = byPerson.get(personId);
      if (bucket === undefined) byPerson.set(personId, [occurrence]);
      else bucket.push(occurrence);
    }
  }

  const conflicts: ScheduleConflict[] = [];
  for (const [personId, list] of byPerson) {
    const sorted = [...list].sort((a, b) => a.blockedFrom - b.blockedFrom);
    for (let i = 1; i < sorted.length; i += 1) {
      const first = sorted[i - 1];
      const second = sorted[i];
      if (first === undefined || second === undefined) continue;
      const overlapMs = Math.min(first.blockedTo, second.blockedTo) - second.blockedFrom;
      if (overlapMs > 0) conflicts.push({ personId, first, second, overlapMs });
    }
  }

  return conflicts.sort((a, b) => a.second.startsAt - b.second.startsAt);
}

function responsibleFor(occurrence: Occurrence): readonly string[] {
  return [occurrence.bringOwnerId, occurrence.fetchOwnerId].filter(
    (id): id is string => id !== undefined,
  );
}

export interface CareGap {
  readonly date: number;
  readonly childId: string;
  readonly reason: string;
}

/**
 * Childcare gaps (FR-212).
 *
 * A closure day only matters if nobody has taken it off, so the check is
 * "care needed and no adult available", not "school is shut". Surfaced weeks
 * ahead, because that is the difference between a decision and an emergency —
 * this is the system doing the noticing (SPEC P-09).
 */
export function detectCareGaps(
  state: FamilyState,
  window: { readonly from: number; readonly to: number },
): readonly CareGap[] {
  const gaps: CareGap[] = [];
  const closures = state
    .all("careClosure")
    .map((entity) => ({
      date: startOfDay(readNumber(entity, "date")),
      label: readString(entity, "label"),
      childIds: readStringList(entity, "childIds"),
    }))
    .filter((closure) => closure.date >= startOfDay(window.from) && closure.date <= window.to);

  const coverage = state.all("careCoverage").map((entity) => ({
    date: startOfDay(readNumber(entity, "date")),
    childIds: readStringList(entity, "childIds"),
  }));

  for (const closure of closures) {
    for (const childId of closure.childIds) {
      const covered = coverage.some(
        (entry) => entry.date === closure.date && entry.childIds.includes(childId),
      );
      if (!covered) {
        gaps.push({ date: closure.date, childId, reason: closure.label });
      }
    }
  }

  return gaps.sort((a, b) => a.date - b.date);
}

export interface FreeSlot {
  readonly from: number;
  readonly to: number;
}

/**
 * Find a window that works for everyone (FR-215).
 *
 * Only busy intervals are considered — the app has no opinion about when a
 * family "should" be free, and inventing one would be exactly the kind of
 * judgement the SPEC rules out.
 */
export function findFreeSlots(
  occurrences: readonly Occurrence[],
  participantIds: readonly string[],
  window: { readonly from: number; readonly to: number },
  durationMs: number,
): readonly FreeSlot[] {
  const busy = occurrences
    .filter(
      (occurrence) =>
        !occurrence.cancelled &&
        participantIds.some(
          (id) => occurrence.participantIds.includes(id) || responsibleFor(occurrence).includes(id),
        ),
    )
    .map((occurrence) => ({ from: occurrence.blockedFrom, to: occurrence.blockedTo }))
    .sort((a, b) => a.from - b.from);

  const slots: FreeSlot[] = [];
  let cursor = window.from;

  for (const interval of busy) {
    if (interval.from - cursor >= durationMs) {
      slots.push({ from: cursor, to: interval.from });
    }
    cursor = Math.max(cursor, interval.to);
  }
  if (window.to - cursor >= durationMs) slots.push({ from: cursor, to: window.to });

  return slots;
}

/**
 * Lead-time preparation attached to an event (FR-213): pack the sports bag, sign
 * the form, buy the present. Derived so that moving the event moves the
 * preparation with it, which is the whole point of hanging it off the event.
 */
export interface LeadTask {
  readonly id: string;
  readonly occurrenceId: string;
  readonly title: string;
  readonly dueAt: number;
}

export function leadTasksFor(
  occurrence: Occurrence,
  preparations: readonly { readonly title: string; readonly leadDays: number }[],
): readonly LeadTask[] {
  return preparations.map((preparation) => ({
    id: derivedId("leadTask", occurrence.id, preparation.title),
    occurrenceId: occurrence.id,
    title: preparation.title,
    dueAt: occurrence.startsAt - preparation.leadDays * DAY_MS,
  }));
}
