/**
 * The five ways to read the same calendar (SPEC FR-206).
 *
 * Day, week, month, agenda, and a per-person timeline. All five are projections
 * over `occurrencesInWindow` and none of them stores anything, which is what
 * lets a family switch between them without the app having to reconcile five
 * copies of the same week.
 *
 * The differences that matter are about density rather than data. A month cell
 * cannot show four events, so it shows two and a count. An agenda has no empty
 * days in it, because scrolling past eleven blank Tuesdays to find the next
 * thing is the failure mode agenda views exist to avoid. A timeline is per
 * person and keeps the gaps, because a gap is the thing you are looking for when
 * you ask "when is she free".
 */
import { occurrencesInWindow, type Occurrence } from "./calendar.js";
import type { FamilyState } from "./state.js";

const DAY_MS = 86_400_000;

export type CalendarViewKind = "day" | "week" | "month" | "agenda" | "timeline";

/** UTC midnight of the day an instant falls in. */
export function startOfDayUtc(at: number): number {
  const date = new Date(at);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Monday, because the family week is Monday-to-Sunday everywhere else in this
 * app (the week plan, the timetable's A/B alternation) and a calendar that
 * disagreed with them would be its own bug report.
 */
export function startOfWeekUtc(at: number): number {
  const day = startOfDayUtc(at);
  const weekday = new Date(day).getUTCDay();
  return day - ((weekday + 6) % 7) * DAY_MS;
}

export function startOfMonthUtc(at: number): number {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

/** The half-open window a view covers, so callers need not do the arithmetic. */
export function viewWindow(
  kind: CalendarViewKind,
  anchor: number,
  options: { readonly agendaDays?: number } = {},
): { readonly from: number; readonly to: number } {
  switch (kind) {
    case "day":
      return { from: startOfDayUtc(anchor), to: startOfDayUtc(anchor) + DAY_MS - 1 };
    case "week":
    case "timeline":
      return { from: startOfWeekUtc(anchor), to: startOfWeekUtc(anchor) + 7 * DAY_MS - 1 };
    case "month": {
      // A month grid shows the days either side that fill the first and last
      // rows, so the window is the grid rather than the month.
      const first = startOfMonthUtc(anchor);
      const gridStart = startOfWeekUtc(first);
      return { from: gridStart, to: gridStart + 6 * 7 * DAY_MS - 1 };
    }
    case "agenda":
      return {
        from: startOfDayUtc(anchor),
        to: startOfDayUtc(anchor) + (options.agendaDays ?? 30) * DAY_MS - 1,
      };
  }
}

// ── Month ─────────────────────────────────────────────────────────────────

export interface MonthCell {
  readonly date: number;
  /** False for the leading and trailing days that only fill the grid. */
  readonly inMonth: boolean;
  readonly isToday: boolean;
  /** As many as the cell can honestly show. */
  readonly occurrences: readonly Occurrence[];
  /** How many more there are, so the cell can say "+3" rather than lie. */
  readonly overflow: number;
}

export interface MonthView {
  readonly kind: "month";
  readonly monthStart: number;
  /** Six rows of seven, always — a grid that changes height jumps as you page. */
  readonly weeks: readonly (readonly MonthCell[])[];
}

/** How many events fit in a cell before it starts counting instead of listing. */
export const MONTH_CELL_LIMIT = 2;

export function selectMonth(
  state: FamilyState,
  options: { readonly anchor: number; readonly now: number; readonly cellLimit?: number },
): MonthView {
  const monthStart = startOfMonthUtc(options.anchor);
  const window = viewWindow("month", options.anchor);
  const limit = options.cellLimit ?? MONTH_CELL_LIMIT;
  const month = new Date(monthStart).getUTCMonth();
  const today = startOfDayUtc(options.now);

  const byDay = groupByDay(occurrencesInWindow(state, window));

  const weeks: MonthCell[][] = [];
  for (let row = 0; row < 6; row += 1) {
    const cells: MonthCell[] = [];
    for (let column = 0; column < 7; column += 1) {
      const date = window.from + (row * 7 + column) * DAY_MS;
      const all = byDay.get(date) ?? [];

      cells.push({
        date,
        inMonth: new Date(date).getUTCMonth() === month,
        isToday: date === today,
        occurrences: all.slice(0, limit),
        overflow: Math.max(0, all.length - limit),
      });
    }
    weeks.push(cells);
  }

  return { kind: "month", monthStart, weeks };
}

// ── Agenda ────────────────────────────────────────────────────────────────

export interface AgendaDay {
  readonly date: number;
  readonly occurrences: readonly Occurrence[];
}

export interface AgendaView {
  readonly kind: "agenda";
  readonly from: number;
  readonly to: number;
  /** Only days with something on them. */
  readonly days: readonly AgendaDay[];
}

/**
 * The next N days, with the empty ones left out.
 *
 * Leaving them out is the whole point. A month view answers "what does August
 * look like"; an agenda answers "what is next", and scrolling past eleven blank
 * Tuesdays to find it is the failure this view exists to avoid.
 */
export function selectAgenda(
  state: FamilyState,
  options: { readonly anchor: number; readonly days?: number },
): AgendaView {
  const window = viewWindow(
    "agenda",
    options.anchor,
    options.days === undefined ? {} : { agendaDays: options.days },
  );
  const byDay = groupByDay(occurrencesInWindow(state, window));

  const days = [...byDay.entries()]
    .filter(([, occurrences]) => occurrences.length > 0)
    .sort(([a], [b]) => a - b)
    .map(([date, occurrences]) => ({ date, occurrences }));

  return { kind: "agenda", from: window.from, to: window.to, days };
}

// ── Per-person timeline ───────────────────────────────────────────────────

export interface TimelineEntry {
  readonly occurrence: Occurrence;
  /** Minutes from the start of the window, for laying the row out. */
  readonly offsetMinutes: number;
  readonly durationMinutes: number;
}

export interface TimelineLane {
  readonly personId: string;
  readonly entries: readonly TimelineEntry[];
}

export interface TimelineView {
  readonly kind: "timeline";
  readonly from: number;
  readonly to: number;
  readonly lanes: readonly TimelineLane[];
}

/**
 * One lane per person, side by side over the same window.
 *
 * This is the view that answers "when is everybody free at once", so the empty
 * space is the content and the gaps are kept rather than collapsed. A person
 * with nothing on gets an empty lane rather than disappearing — a missing lane
 * reads as "no data", and "nothing booked" is the opposite answer.
 *
 * A private event (FR-203) appears as a block with no title, which is the whole
 * of busy/free: the lane must show that the time is taken without saying by
 * what.
 */
export function selectTimeline(
  state: FamilyState,
  options: {
    readonly anchor: number;
    readonly personIds: readonly string[];
    readonly kind?: "day" | "week";
  },
): TimelineView {
  const window = viewWindow(options.kind ?? "day", options.anchor);
  const occurrences = occurrencesInWindow(state, window).filter(
    (occurrence) => !occurrence.cancelled,
  );

  const lanes = options.personIds.map((personId) => ({
    personId,
    entries: occurrences
      .filter((occurrence) => occurrence.participantIds.includes(personId))
      .map((occurrence) => ({
        occurrence: occurrence.private
          ? { ...occurrence, title: "" }
          : occurrence,
        offsetMinutes: Math.max(0, Math.round((occurrence.startsAt - window.from) / 60_000)),
        durationMinutes: Math.max(
          1,
          Math.round((occurrence.endsAt - occurrence.startsAt) / 60_000),
        ),
      })),
  }));

  return { kind: "timeline", from: window.from, to: window.to, lanes };
}

// ── Shared ────────────────────────────────────────────────────────────────

/**
 * Occurrences filed under every day they touch, so a multi-day event (FR-204)
 * appears on Wednesday as well as on the Monday it started.
 */
function groupByDay(occurrences: readonly Occurrence[]): Map<number, Occurrence[]> {
  const byDay = new Map<number, Occurrence[]>();

  for (const occurrence of occurrences) {
    const last = startOfDayUtc(occurrence.endsAt);
    for (let day = startOfDayUtc(occurrence.startsAt); day <= last; day += DAY_MS) {
      byDay.set(day, [...(byDay.get(day) ?? []), occurrence]);
    }
  }

  for (const [, list] of byDay) list.sort((a, b) => a.startsAt - b.startsAt);
  return byDay;
}
