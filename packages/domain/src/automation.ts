/**
 * The two ways the app does work a person would otherwise do by hand (SPEC §13).
 *
 * FR-1108 notices that something keeps happening and offers to stop asking.
 * FR-1111 changes many things at once when a person already knows what they want.
 *
 * They pull in opposite directions on purpose, and the pairing is the design.
 * Suggestion is the app being presumptuous, so every suggestion is a question
 * with a dismissal that sticks. Bulk editing is the person being decisive, so it
 * asks nothing and reports exactly what it touched — including what it refused
 * to touch, because a bulk edit that silently skipped four things is worse than
 * one that changed nothing.
 */
import type { RecurrenceKind } from "./calendar.js";
import { learningAllowed } from "./compliance.js";
import type { Value } from "./ops.js";
import { EntityTypes, readString, readStringList } from "./schema.js";
import type { FamilyState } from "./state.js";

// ── Recurrence suggestions from observed behaviour (FR-1108) ─────────────

/** Milliseconds in a day, for reading gaps between occurrences. */
const DAY = 86_400_000;

/**
 * The rhythms worth noticing, which is a subset of the ones the calendar can
 * express. Daily is missing on purpose: something that happens every day is a
 * routine the family already knows about, and offering to make it recurring
 * tells them nothing they had not noticed themselves.
 */
export type SuggestableRecurrence = Extract<
  RecurrenceKind,
  "weekly" | "fortnightly" | "monthly"
>;

export interface RecurrenceSuggestion {
  readonly title: string;
  readonly kind: SuggestableRecurrence;
  /** 0 = Sunday, as `Date#getUTCDay` counts. Absent for monthly. */
  readonly weekday: number | undefined;
  /** How many past occurrences this is drawn from. */
  readonly observations: number;
  readonly lastAt: number;
  /** The next date it would fall on, so the question is concrete. */
  readonly nextAt: number;
}

/**
 * How many occurrences before the app is allowed to say anything.
 *
 * Three, not two. Two of anything is a coincidence, and a family that gets
 * "shall I make this weekly?" after the second swimming lesson learns that the
 * app guesses badly — after which they will not read the good suggestions
 * either. The cost of waiting one more week is one more week; the cost of being
 * wrong early is the whole feature.
 */
export const MIN_OBSERVATIONS = 3;

/** How far a gap may be off the ideal and still count as that rhythm. */
const TOLERANCE_DAYS: Record<SuggestableRecurrence, number> = {
  weekly: 1,
  fortnightly: 2,
  monthly: 4,
};

const IDEAL_DAYS: Record<SuggestableRecurrence, number> = {
  weekly: 7,
  fortnightly: 14,
  monthly: 30,
};

function classify(gapDays: number): SuggestableRecurrence | undefined {
  for (const kind of ["weekly", "fortnightly", "monthly"] as const) {
    if (Math.abs(gapDays - IDEAL_DAYS[kind]) <= TOLERANCE_DAYS[kind]) return kind;
  }
  return undefined;
}

/**
 * Rhythms the app has noticed in events that already happened.
 *
 * Gated on `learningAllowed`, which is the whole of the LRN switch here: a
 * family who turned learning off gets an empty array and no explanation, because
 * the explanation belongs in the setting, not in every screen that would have
 * shown a suggestion.
 *
 * A suggestion is dropped once somebody dismisses it, and the dismissal is
 * stored against the title rather than against an occurrence — otherwise the
 * same question comes back next Tuesday having learned nothing.
 */
export function suggestRecurrences(
  state: FamilyState,
  options: { readonly now: number; readonly personId?: string },
): readonly RecurrenceSuggestion[] {
  if (!learningAllowed(state, options.personId ?? null)) return [];

  const dismissed = new Set(
    state
      .all(EntityTypes.family)
      .flatMap((family) => readStringList(family, "dismissedRecurrences")),
  );

  const byTitle = new Map<string, number[]>();
  for (const event of state.all(EntityTypes.event)) {
    if (event.deleted) continue;

    const title = readString(event, "title").trim();
    const startsAt = Date.parse(readString(event, "startsAt"));
    if (title.length === 0 || !Number.isFinite(startsAt) || startsAt > options.now) continue;
    // An event that already repeats has nothing to suggest.
    if (readString(event, "recurrence").length > 0) continue;

    byTitle.set(title, [...(byTitle.get(title) ?? []), startsAt]);
  }

  const suggestions: RecurrenceSuggestion[] = [];

  for (const [title, rawTimes] of byTitle) {
    if (dismissed.has(title)) continue;

    const times = [...new Set(rawTimes)].sort((a, b) => a - b);
    if (times.length < MIN_OBSERVATIONS) continue;

    const kinds = times
      .slice(1)
      .map((time, index) => classify((time - (times[index] ?? 0)) / DAY));

    const kind = kinds[0];
    // Every gap must agree. One irregular gap means this is not a rhythm, it is
    // a thing that happened to happen three times.
    if (kind === undefined || !kinds.every((candidate) => candidate === kind)) continue;

    const lastAt = times[times.length - 1] ?? 0;
    const nextAt = lastAt + IDEAL_DAYS[kind] * DAY;

    suggestions.push({
      title,
      kind,
      weekday: kind === "monthly" ? undefined : new Date(lastAt).getUTCDay(),
      observations: times.length,
      lastAt,
      nextAt,
    });
  }

  // Most-observed first: the rhythm the app is surest about is the one worth
  // spending the family's attention on.
  return suggestions.sort((a, b) => b.observations - a.observations || (a.title < b.title ? -1 : 1));
}

// ── Bulk editing (FR-1111) ────────────────────────────────────────────────

export type BulkChange =
  | { readonly kind: "assign"; readonly personId: string }
  | { readonly kind: "move"; readonly startsAt: number }
  | { readonly kind: "retag"; readonly tags: readonly string[] }
  | { readonly kind: "complete" }
  | { readonly kind: "delete" };

export interface BulkPlan {
  readonly entityType: string;
  readonly change: BulkChange;
  /** Ids the change applies to. */
  readonly targets: readonly string[];
  /**
   * Ids the caller asked for that this will not touch, and why.
   *
   * Returned rather than swallowed: a bulk edit that silently skipped four of
   * twenty is worse than one that changed nothing, because the person walks away
   * believing all twenty are done.
   */
  readonly skipped: readonly { readonly id: string; readonly reason: string }[];
}

/**
 * What a bulk edit would do, before it does it.
 *
 * Separated from applying it so the screen can say "this will change 14 tasks
 * and skip 2" and mean it. The same call then produces the operations, so the
 * preview and the effect cannot drift apart.
 */
export function planBulkChange(
  state: FamilyState,
  input: {
    readonly entityType: string;
    readonly ids: readonly string[];
    readonly change: BulkChange;
  },
): BulkPlan {
  const targets: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const id of input.ids) {
    const entity = state.get(input.entityType, id);

    if (entity === undefined) {
      skipped.push({ id, reason: "not here" });
      continue;
    }
    if (entity.deleted) {
      skipped.push({ id, reason: "already deleted" });
      continue;
    }
    if (input.change.kind === "complete" && entity.fields["completedAt"] !== undefined) {
      skipped.push({ id, reason: "already done" });
      continue;
    }
    // A planned line exists because a recipe is on the plan; deleting it here
    // would leave the plan asking for an ingredient that is not on any list.
    if (input.change.kind === "delete" && readString(entity, "origin") === "plan") {
      skipped.push({ id, reason: "comes from the plan" });
      continue;
    }

    targets.push(id);
  }

  return { entityType: input.entityType, change: input.change, targets, skipped };
}

/**
 * What a plan writes, per target — one description, applied to many.
 *
 * A discriminated write rather than a bag of fields, because deleting is not a
 * field change: the reducer deletes on its own operation kind and every reader
 * in the library asks `entity.deleted`. This returned `{ deletedAt }` at first,
 * which the reducer stores as an ordinary field and nothing anywhere reads — a
 * bulk delete of twenty tasks reported twenty and removed none.
 *
 * The field names and types are the ones the readers actually consume, which is
 * the other half of the same lesson. `ownerId`, not `assigneeId`, because that
 * is what `readTask` looks for; epoch milliseconds, not ISO strings, because
 * `readNumber` is what reads them and an ISO string parses to NaN and vanishes.
 * Every one of those was inert, and each failed by doing nothing at all.
 */
export type BulkWrite =
  | { readonly kind: "setFields"; readonly payload: Readonly<Record<string, Value>> }
  | { readonly kind: "delete" };

export function bulkWrite(change: BulkChange, at: number): BulkWrite {
  switch (change.kind) {
    case "assign":
      return { kind: "setFields", payload: { ownerId: change.personId } };
    case "move":
      return { kind: "setFields", payload: { startsAt: change.startsAt } };
    case "retag":
      return { kind: "setFields", payload: { tags: [...change.tags] } };
    case "complete":
      return { kind: "setFields", payload: { completedAt: at } };
    case "delete":
      return { kind: "delete" };
  }
}

/**
 * A sentence for the confirmation, in the family's own terms.
 *
 * Written here rather than in the screen because the count that gets shown and
 * the count that gets changed must come from the same place.
 */
export function describeBulkPlan(plan: BulkPlan): string {
  const verb: Record<BulkChange["kind"], string> = {
    assign: "Reassign",
    move: "Move",
    retag: "Retag",
    complete: "Complete",
    delete: "Delete",
  };

  const head = `${verb[plan.change.kind]} ${plan.targets.length}`;
  return plan.skipped.length === 0 ? head : `${head}, skip ${plan.skipped.length}`;
}
