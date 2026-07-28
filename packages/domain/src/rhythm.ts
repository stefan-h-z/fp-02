/**
 * The staples engine (SPEC §10.2).
 *
 * The product's central bet: nobody maintains a pantry, so the app must not ask
 * them to. There is no stock — only the dates an item was bought, from which a
 * rhythm is learned, plus the occasional "it's empty" report that both corrects
 * the prediction and calibrates it (FR-737).
 *
 * Three properties matter more than accuracy:
 *  - Silence when unsure. Below `minPurchases` the item says nothing (FR-732).
 *  - Self-healing. Every purchase resets state; a dismissal lengthens the
 *    interval, a late report shortens it; nothing needs repair (FR-738).
 *  - Quietness under rejection. An item dismissed repeatedly gets quieter rather
 *    than more insistent (FR-742).
 */
export const DAY_MS = 24 * 60 * 60 * 1000;

export type RhythmState = "unknown" | "quiet" | "due-soon" | "due" | "overdue";

/** Everything the engine is allowed to know about an item. */
export interface ItemSignals {
  readonly itemKey: string;
  /** Check-off timestamps, ascending (FR-731: the only data source). */
  readonly purchases: readonly number[];
  /** "Is empty" / "running low" reports since the last purchase (FR-734). */
  readonly emptyReports?: readonly number[];
  /** Dismissed suggestions since the last purchase (FR-738, FR-742). */
  readonly dismissals?: readonly number[];
  /** Milliseconds the family was away, which consumes nothing (FR-733). */
  readonly pausedMs?: number;
}

export interface RhythmOptions {
  /** Below this, no claim is made at all. Two intervals is the minimum from
   * which a median means anything. */
  readonly minPurchases?: number;
  readonly now: number;
  /** How early "due soon" starts, as a fraction of the interval. */
  readonly dueSoonFraction?: number;
}

export interface Rhythm {
  readonly itemKey: string;
  readonly state: RhythmState;
  /** Learned median interval in days, undefined while unknown. */
  readonly intervalDays: number | undefined;
  /** 0..1 — how consistent the observed intervals are. */
  readonly confidence: number;
  readonly predictedDueAt: number | undefined;
  /** How far past due, in units of the interval; 0 when not due. */
  readonly overdueRatio: number;
  /** True when a human said so — reported beats predicted (FR-734). */
  readonly reported: boolean;
  /** Plain-language justification, shown on request (FR-740). */
  readonly reason: string;
}

const DEFAULT_MIN_PURCHASES = 3;
const DEFAULT_DUE_SOON_FRACTION = 0.8;

/** Each dismissal stretches the estimate; the effect is capped so the item
 * cannot be pushed out indefinitely by a few impatient swipes. */
const DISMISSAL_STRETCH = 0.15;
const MAX_DISMISSAL_STRETCH = 0.6;

export function computeRhythm(signals: ItemSignals, options: RhythmOptions): Rhythm {
  const minPurchases = options.minPurchases ?? DEFAULT_MIN_PURCHASES;
  const dueSoonFraction = options.dueSoonFraction ?? DEFAULT_DUE_SOON_FRACTION;
  const purchases = [...signals.purchases].sort((a, b) => a - b);
  const lastPurchase = purchases.at(-1);
  const reported = (signals.emptyReports ?? []).some((at) => lastPurchase === undefined || at > lastPurchase);

  const intervals = intervalDaysBetween(purchases);

  if (intervals.length < minPurchases - 1) {
    // Nothing is claimed while nothing is known; a reported item still shows up,
    // it just has no prediction behind it.
    return {
      itemKey: signals.itemKey,
      state: reported ? "due" : "unknown",
      intervalDays: undefined,
      confidence: 0,
      predictedDueAt: undefined,
      overdueRatio: 0,
      reported,
      reason: reported ? "Reported as empty" : "Not enough purchases yet to know a rhythm",
    };
  }

  const median = medianOf(intervals);
  const confidence = intervalConfidence(intervals);
  const dismissals = countAfter(signals.dismissals ?? [], lastPurchase);
  const stretch = 1 + Math.min(dismissals * DISMISSAL_STRETCH, MAX_DISMISSAL_STRETCH);
  const effectiveIntervalMs = median * DAY_MS * stretch + (signals.pausedMs ?? 0);
  const predictedDueAt = lastPurchase === undefined ? undefined : lastPurchase + effectiveIntervalMs;

  const elapsedRatio =
    predictedDueAt === undefined || lastPurchase === undefined
      ? 0
      : (options.now - lastPurchase) / effectiveIntervalMs;

  const state = reported
    ? "due"
    : elapsedRatio >= 1.5
      ? "overdue"
      : elapsedRatio >= 1
        ? "due"
        : elapsedRatio >= dueSoonFraction
          ? "due-soon"
          : "quiet";

  return {
    itemKey: signals.itemKey,
    state,
    intervalDays: median,
    confidence,
    predictedDueAt,
    overdueRatio: Math.max(0, elapsedRatio - 1),
    reported,
    reason: reasonFor({ reported, lastPurchase, median, now: options.now, dismissals }),
  };
}

/**
 * Calibration (FR-737): an empty report is also a measurement. If the family
 * runs out earlier than predicted the interval shortens, if later it lengthens —
 * and the correction is damped, so one unusual week does not reset what the app
 * had learned.
 */
export function calibrateInterval(
  currentIntervalDays: number,
  observedIntervalDays: number,
  weight = 0.3,
): number {
  const bounded = Math.max(0.05, Math.min(1, weight));
  return round1(currentIntervalDays * (1 - bounded) + observedIntervalDays * bounded);
}

export interface SuggestionRanking {
  readonly reported: readonly Rhythm[];
  readonly probablyDue: readonly Rhythm[];
  /** Beyond the visible cut — reachable behind an expander (FR-742). */
  readonly more: readonly Rhythm[];
}

/**
 * Order and cut the suggestion list. The item set is never limited — only what is
 * shown is (FR-741, FR-742).
 */
export function rankSuggestions(rhythms: readonly Rhythm[], visibleLimit = 5): SuggestionRanking {
  const reported = rhythms.filter((r) => r.reported).sort(byItemKey);

  // Only what is actually due belongs in the list. "Due soon" is a state the UI
  // may hint at, but showing it here would resurrect an item the moment after
  // somebody dismissed it, which is exactly what FR-742 rules out.
  const candidates = rhythms
    .filter((r) => !r.reported && (r.state === "due" || r.state === "overdue"))
    .sort((a, b) => {
      const score = suggestionScore(b) - suggestionScore(a);
      return score !== 0 ? score : byItemKey(a, b);
    });

  return {
    reported,
    probablyDue: candidates.slice(0, visibleLimit),
    more: candidates.slice(visibleLimit),
  };
}

/** Confidence first, then how overdue: a reliable weekly item outranks a vague
 * one that happens to be later. */
function suggestionScore(rhythm: Rhythm): number {
  const stateWeight = rhythm.state === "overdue" ? 2 : rhythm.state === "due" ? 1 : 0;
  return stateWeight * 2 + rhythm.confidence + Math.min(rhythm.overdueRatio, 2);
}

function byItemKey(a: Rhythm, b: Rhythm): number {
  return a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0;
}

function intervalDaysBetween(purchases: readonly number[]): readonly number[] {
  const out: number[] = [];
  for (let i = 1; i < purchases.length; i += 1) {
    const previous = purchases[i - 1];
    const current = purchases[i];
    if (previous === undefined || current === undefined) continue;
    const days = (current - previous) / DAY_MS;
    if (days > 0) out.push(days);
  }
  return out;
}

/** Median, not mean: one bulk purchase must not distort the rhythm (FR-731). */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return round1(sorted[middle] ?? 0);
  return round1(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

/**
 * How regular the intervals are, as 1 − normalized spread around the median.
 * Consumables (washing powder, loo roll) score highest, which is exactly why they
 * end up at the top of the list by themselves (FR-741).
 */
function intervalConfidence(intervals: readonly number[]): number {
  if (intervals.length < 2) return 0.2;
  const median = medianOf(intervals);
  if (median <= 0) return 0;
  const deviations = intervals.map((i) => Math.abs(i - median) / median);
  const meanDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  const sampleBonus = Math.min(intervals.length / 8, 1);
  return round2(Math.max(0, Math.min(1, (1 - meanDeviation) * (0.6 + 0.4 * sampleBonus))));
}

function countAfter(timestamps: readonly number[], after: number | undefined): number {
  if (after === undefined) return timestamps.length;
  return timestamps.filter((at) => at > after).length;
}

function reasonFor(input: {
  readonly reported: boolean;
  readonly lastPurchase: number | undefined;
  readonly median: number;
  readonly now: number;
  readonly dismissals: number;
}): string {
  if (input.reported) return "Reported as empty";
  if (input.lastPurchase === undefined) return "No purchases recorded yet";

  const daysAgo = Math.round((input.now - input.lastPurchase) / DAY_MS);
  const base = "Last bought " + daysAgo + " days ago, usually every " + round1(input.median) + " days";
  return input.dismissals > 0 ? base + " (allowing for " + input.dismissals + " dismissed reminders)" : base;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
