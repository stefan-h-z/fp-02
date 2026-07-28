/**
 * iCalendar, in and out (SPEC FR-207, FR-208).
 *
 * Two-way calendar sync is a mandatory requirement, and the transport half of it
 * — OAuth, watch channels, delta tokens — belongs to the backend. What lives here
 * is the part that decides whether the family ends up with duplicates: reading
 * external events into the app's shape, writing the app's events back out, and
 * knowing which local event an incoming one *is*.
 *
 * Written against the subset real calendars actually emit (RFC 5545 VEVENT with
 * DTSTART/DTEND/RRULE/EXDATE), and deliberately forgiving: an event nobody can
 * parse must be skipped, never allowed to abort the import of the other forty.
 */
import { readNumber, readOptionalString, readString } from "./schema.js";
import type { StoredEntity } from "./entity.js";
import { DAY_MS } from "./rhythm.js";
import type { RecurrenceKind } from "./calendar.js";

export interface IcsEvent {
  /** The external identity. Stable across edits — this is what prevents
   * duplicates on the next import (FR-207 loop-safety). */
  readonly uid: string;
  readonly summary: string;
  readonly description: string;
  readonly location: string;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly allDay: boolean;
  readonly recurrence: RecurrenceKind;
  readonly weekdays: readonly number[];
  readonly recurrenceUntil: number | undefined;
  /** Instances the external calendar has excluded from the series. */
  readonly exceptions: readonly number[];
  readonly cancelled: boolean;
  /** Changes with every edit, so a re-import can tell "same event, newer". */
  readonly sequence: number;
  readonly lastModified: number | undefined;
}

export interface IcsParseResult {
  readonly events: readonly IcsEvent[];
  /** Entries that could not be read, with the reason — surfaced rather than
   * swallowed, because a calendar that silently imports 39 of 40 events is
   * worse than one that says so. */
  readonly skipped: readonly { readonly uid: string; readonly reason: string }[];
  readonly calendarName: string | undefined;
}

const WEEKDAY_CODES: Readonly<Record<string, number>> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

export function parseIcs(source: string): IcsParseResult {
  const lines = unfold(source);
  const events: IcsEvent[] = [];
  const skipped: { uid: string; reason: string }[] = [];
  let calendarName: string | undefined;

  let current: Map<string, { value: string; params: Map<string, string> }> | undefined;

  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === undefined) continue;

    if (parsed.name === "BEGIN" && parsed.value === "VEVENT") {
      current = new Map();
      continue;
    }
    if (parsed.name === "END" && parsed.value === "VEVENT") {
      if (current !== undefined) {
        const event = buildEvent(current);
        if ("reason" in event) skipped.push(event);
        else events.push(event);
      }
      current = undefined;
      continue;
    }
    if (current === undefined) {
      if (parsed.name === "X-WR-CALNAME") calendarName = parsed.value;
      continue;
    }
    // A repeated property (several EXDATEs) is joined rather than overwritten.
    const existing = current.get(parsed.name);
    current.set(parsed.name, {
      value: existing === undefined ? parsed.value : existing.value + "," + parsed.value,
      params: parsed.params,
    });
  }

  return { events, skipped, calendarName };
}

function buildEvent(
  properties: Map<string, { value: string; params: Map<string, string> }>,
): IcsEvent | { uid: string; reason: string } {
  const uid = properties.get("UID")?.value ?? "";
  const start = properties.get("DTSTART");

  if (uid.length === 0) return { uid: "(missing)", reason: "no UID" };
  if (start === undefined) return { uid, reason: "no DTSTART" };

  const startsAt = parseIcsDate(start.value);
  if (startsAt === undefined) return { uid, reason: "unreadable DTSTART: " + start.value };

  // A date-valued DTSTART is an all-day event; RFC 5545 makes DTEND exclusive
  // for those, which is why a one-day event ends the following midnight.
  const allDay = start.params.get("VALUE") === "DATE" || /^\d{8}$/.test(start.value);
  const end = properties.get("DTEND");
  const parsedEnd = end === undefined ? undefined : parseIcsDate(end.value);
  const duration = properties.get("DURATION")?.value;

  const endsAt =
    parsedEnd ??
    (duration === undefined ? startsAt + (allDay ? DAY_MS : 60 * 60 * 1000) : startsAt + parseDuration(duration));

  const rrule = parseRrule(properties.get("RRULE")?.value ?? "");
  const until = rrule.until;
  const lastModified = parseIcsDate(properties.get("LAST-MODIFIED")?.value ?? "");

  return {
    uid,
    summary: properties.get("SUMMARY")?.value ?? "",
    description: properties.get("DESCRIPTION")?.value ?? "",
    location: properties.get("LOCATION")?.value ?? "",
    startsAt,
    endsAt,
    allDay,
    recurrence: rrule.kind,
    weekdays: rrule.weekdays,
    recurrenceUntil: until,
    exceptions: (properties.get("EXDATE")?.value ?? "")
      .split(",")
      .map((value) => parseIcsDate(value.trim()))
      .filter((value): value is number => value !== undefined),
    cancelled: (properties.get("STATUS")?.value ?? "").toUpperCase() === "CANCELLED",
    sequence: Number(properties.get("SEQUENCE")?.value ?? 0) || 0,
    lastModified,
  };
}

/**
 * Only the recurrence shapes the app can represent are accepted. An RRULE it
 * cannot model (BYSETPOS, monthly-by-weekday) degrades to a single event rather
 * than being silently mis-expanded into wrong dates.
 */
function parseRrule(rule: string): {
  kind: RecurrenceKind;
  weekdays: readonly number[];
  until: number | undefined;
} {
  if (rule.length === 0) return { kind: "none", weekdays: [], until: undefined };

  const parts = new Map(
    rule.split(";").map((part) => {
      const [key, value] = part.split("=");
      return [(key ?? "").toUpperCase(), value ?? ""];
    }),
  );

  const frequency = (parts.get("FREQ") ?? "").toUpperCase();
  const interval = Number(parts.get("INTERVAL") ?? "1");
  const until = parseIcsDate(parts.get("UNTIL") ?? "");

  // An interval other than 1 (every second week) is not representable yet, and
  // guessing would put appointments on wrong days.
  if (interval !== 1) return { kind: "none", weekdays: [], until };

  const weekdays = (parts.get("BYDAY") ?? "")
    .split(",")
    .map((code) => WEEKDAY_CODES[code.trim().toUpperCase().slice(-2)])
    .filter((day): day is number => day !== undefined);

  switch (frequency) {
    case "DAILY":
      return { kind: "daily", weekdays: [], until };
    case "WEEKLY":
      return { kind: "weekly", weekdays, until };
    case "MONTHLY":
      return parts.has("BYDAY")
        ? { kind: "none", weekdays: [], until }
        : { kind: "monthly", weekdays: [], until };
    default:
      return { kind: "none", weekdays: [], until };
  }
}

export function parseIcsDate(value: string): number | undefined {
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
  if (dateOnly !== null) {
    return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(trimmed);
  if (dateTime === null) return undefined;

  // A floating time (no Z) is read as UTC. The alternative — guessing the
  // family's zone — produces appointments an hour out twice a year.
  return Date.UTC(
    Number(dateTime[1]),
    Number(dateTime[2]) - 1,
    Number(dateTime[3]),
    Number(dateTime[4]),
    Number(dateTime[5]),
    Number(dateTime[6]),
  );
}

function parseDuration(value: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (match === null) return 60 * 60 * 1000;
  return (
    Number(match[1] ?? 0) * DAY_MS +
    Number(match[2] ?? 0) * 3_600_000 +
    Number(match[3] ?? 0) * 60_000 +
    Number(match[4] ?? 0) * 1000
  );
}

/** RFC 5545 folds long lines; a continuation starts with a space or tab. */
function unfold(source: string): readonly string[] {
  const out: string[] = [];
  for (const raw of source.split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] = (out.at(-1) ?? "") + raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

function parseLine(
  line: string,
): { name: string; value: string; params: Map<string, string> } | undefined {
  const separator = line.indexOf(":");
  if (separator < 0) return undefined;

  const head = line.slice(0, separator);
  const value = unescapeText(line.slice(separator + 1));
  const [name, ...paramParts] = head.split(";");

  const params = new Map<string, string>();
  for (const part of paramParts) {
    const [key, paramValue] = part.split("=");
    if (key !== undefined && paramValue !== undefined) params.set(key.toUpperCase(), paramValue);
  }

  return { name: (name ?? "").toUpperCase(), value, params };
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export interface IcsExportOptions {
  readonly calendarName: string;
  readonly now: number;
  /** Identifies this app as the producer, which is what lets the *other*
   * calendar recognise its own round-tripped events. */
  readonly productId?: string;
}

/**
 * Publish the family's events as a read-only feed (FR-208).
 *
 * The UID is the app's own event id, so an event that travels out and comes back
 * is recognised as itself rather than imported as a copy.
 */
export function buildIcs(
  events: readonly StoredEntity[],
  options: IcsExportOptions,
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:" + (options.productId ?? "-//Family App//EN"),
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:" + escapeText(options.calendarName),
  ];

  for (const event of events) {
    if (event.deleted) continue;
    const startsAt = readNumber(event, "startsAt");
    if (startsAt === 0) continue;

    lines.push("BEGIN:VEVENT");
    lines.push("UID:" + event.id);
    lines.push("DTSTAMP:" + formatIcsDate(options.now));
    lines.push("DTSTART:" + formatIcsDate(startsAt));
    lines.push("DTEND:" + formatIcsDate(readNumber(event, "endsAt", startsAt + 3_600_000)));
    lines.push("SUMMARY:" + escapeText(readString(event, "title")));

    const location = readOptionalString(event, "location");
    if (location !== undefined) lines.push("LOCATION:" + escapeText(location));

    const rrule = buildRrule(event);
    if (rrule !== undefined) lines.push("RRULE:" + rrule);

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 wants CRLF, and some clients genuinely reject LF-only feeds.
  return lines.join("\r\n") + "\r\n";
}

function buildRrule(event: StoredEntity): string | undefined {
  const recurrence = readString(event, "recurrence");
  if (recurrence === "daily") return "FREQ=DAILY";
  if (recurrence === "monthly") return "FREQ=MONTHLY";
  if (recurrence !== "weekly") return undefined;

  const days = Object.entries(WEEKDAY_CODES)
    .filter(([, index]) => weekdaysOf(event).includes(index))
    .map(([code]) => code);

  return days.length === 0 ? "FREQ=WEEKLY" : "FREQ=WEEKLY;BYDAY=" + days.join(",");
}

function weekdaysOf(event: StoredEntity): readonly number[] {
  const value = event.fields["weekdays"];
  if (!Array.isArray(value)) return [];
  return value.map((day) => Number(day)).filter((day) => Number.isInteger(day));
}

export function formatIcsDate(at: number): string {
  return new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
