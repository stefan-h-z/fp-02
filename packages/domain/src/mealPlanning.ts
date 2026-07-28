/**
 * The parts of planning a week that are not "put a recipe in a slot"
 * (SPEC §6).
 *
 * `plan.ts` derives what a week needs; `suggest.ts` proposes what to cook. What
 * was missing is the shape a real week has: the same things happen every week,
 * cooking once and eating twice is a plan rather than an accident, the children
 * get a say, and somebody wants to look at the whole week and see whether it is
 * lopsided.
 *
 * The last of those is the one to be careful with. SPEC §1.3 lists nutrition
 * judgement as a non-goal, so `weekBalance` counts what was planned and says
 * nothing about whether it is good. A family that eats pasta four times has
 * been told it ate pasta four times, and that is where the app stops.
 */
import type { FamilyState } from "./state.js";
import { EntityTypes, readRecords, readString, readStringList } from "./schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "meal-prep";

export const MEAL_TYPES: readonly MealType[] = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "meal-prep",
];

export function readMealType(value: string): MealType {
  return (MEAL_TYPES as readonly string[]).includes(value) ? (value as MealType) : "dinner";
}

// ── Leftovers (FR-605) ────────────────────────────────────────────────────

export interface LeftoverPlan {
  /** The slot the food is actually cooked in. */
  readonly cookedInSlotId: string;
  readonly eatenInSlotId: string;
  readonly recipeId: string;
}

/**
 * "Cook once, eat twice", as a first-class link rather than the same recipe
 * planned twice.
 *
 * The distinction is not pedantry: a leftover slot must not add its ingredients
 * to the shopping list a second time, and it must move if the cooking slot
 * moves. Two independent entries would do neither.
 */
export function leftoverPlans(state: FamilyState, weekPlanId: string): readonly LeftoverPlan[] {
  return state
    .all(EntityTypes.mealSlot)
    .filter((slot) => readString(slot, "weekPlanId") === weekPlanId)
    .map((slot) => ({
      cookedInSlotId: readString(slot, "leftoverOfSlotId"),
      eatenInSlotId: slot.id,
      recipeId: readString(slot, "recipeId"),
    }))
    .filter((plan) => plan.cookedInSlotId.length > 0);
}

/**
 * Slots whose ingredients should NOT be bought again.
 *
 * Exported as a set of ids so `derivePlannedNeeds` can skip them without
 * knowing what a leftover is.
 */
export function leftoverSlotIds(state: FamilyState, weekPlanId: string): ReadonlySet<string> {
  return new Set(leftoverPlans(state, weekPlanId).map((plan) => plan.eatenInSlotId));
}

/** How many portions a cooking slot has to produce, including its leftovers. */
export function portionsNeeded(
  state: FamilyState,
  input: { readonly weekPlanId: string; readonly slotId: string },
): number {
  const eaters = (slotId: string): number =>
    Object.keys(state.get(EntityTypes.mealSlot, slotId)?.sets["eaters"] ?? {}).filter(
      (personId) => state.get(EntityTypes.mealSlot, slotId)?.sets["eaters"]?.[personId]?.present === true,
    ).length;

  const dependents = leftoverPlans(state, input.weekPlanId).filter(
    (plan) => plan.cookedInSlotId === input.slotId,
  );

  return eaters(input.slotId) + dependents.reduce((sum, plan) => sum + eaters(plan.eatenInSlotId), 0);
}

// ── Recurring patterns (FR-606) ───────────────────────────────────────────

export interface MealPattern {
  readonly key: string;
  readonly label: string;
  /** 0 = Sunday, matching `Date#getUTCDay`. */
  readonly weekday: number;
  readonly mealType: MealType;
  /** Either a specific recipe, or a tag the suggester should honour. */
  readonly recipeId: string;
  readonly tag: string;
}

/**
 * "Friday pizza", "meat-free Monday", "Sunday roast".
 *
 * A pattern is a preference, not an entry: it tells the suggester what this
 * family does on a Friday, and leaves the actual planning to a person. Writing
 * the entries directly would fill a week nobody asked for.
 */
export function mealPatterns(state: FamilyState, familyId: string): readonly MealPattern[] {
  const family = state.get(EntityTypes.family, familyId);

  return readRecords(family, "mealPatterns")
    .map((raw, index) => ({
      key: typeof raw["key"] === "string" ? raw["key"] : String(index),
      label: typeof raw["label"] === "string" ? raw["label"] : "",
      weekday: Number(raw["weekday"] ?? -1),
      mealType: readMealType(typeof raw["mealType"] === "string" ? raw["mealType"] : "dinner"),
      recipeId: typeof raw["recipeId"] === "string" ? raw["recipeId"] : "",
      tag: typeof raw["tag"] === "string" ? raw["tag"] : "",
    }))
    .filter((pattern) => pattern.weekday >= 0 && pattern.weekday <= 6);
}

/** The pattern that applies to a given date and meal, if the family has one. */
export function patternFor(
  patterns: readonly MealPattern[],
  input: { readonly date: string; readonly mealType: MealType },
): MealPattern | undefined {
  const day = new Date(input.date + "T00:00:00Z").getUTCDay();
  if (Number.isNaN(day)) return undefined;

  return patterns.find(
    (pattern) => pattern.weekday === day && pattern.mealType === input.mealType,
  );
}

// ── Reusing a past week (FR-607) ──────────────────────────────────────────

export interface PlannedEntry {
  readonly date: string;
  readonly mealType: MealType;
  readonly recipeId: string;
  readonly title: string;
}

/** A past week, in a shape that can be laid down on a different set of dates. */
export function weekAsTemplate(state: FamilyState, weekPlanId: string): readonly PlannedEntry[] {
  return state
    .all(EntityTypes.mealSlot)
    .filter((slot) => readString(slot, "weekPlanId") === weekPlanId)
    .map((slot) => ({
      date: readString(slot, "date"),
      mealType: readMealType(readString(slot, "mealType")),
      recipeId: readString(slot, "recipeId"),
      title: readString(slot, "title"),
    }))
    .filter((entry) => entry.date.length > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Shifts a template onto another week.
 *
 * Whole days, so a Monday stays a Monday — a family's week has a shape, and a
 * template that arrived off by a day would be worse than typing it again.
 */
export function shiftTemplate(
  entries: readonly PlannedEntry[],
  input: { readonly fromWeekStart: string; readonly toWeekStart: string },
): readonly PlannedEntry[] {
  const from = Date.parse(input.fromWeekStart + "T00:00:00Z");
  const to = Date.parse(input.toWeekStart + "T00:00:00Z");
  if (Number.isNaN(from) || Number.isNaN(to)) return entries;

  const offset = to - from;

  return entries.map((entry) => {
    const at = Date.parse(entry.date + "T00:00:00Z");
    return Number.isNaN(at)
      ? entry
      : { ...entry, date: new Date(at + offset).toISOString().slice(0, 10) };
  });
}

// ── The children's say (FR-612) ───────────────────────────────────────────

export interface WishDay {
  readonly personId: string;
  readonly date: string;
  readonly recipeId: string;
}

/**
 * A child's turn to choose, and the one veto each person gets.
 *
 * Kept as data on the week rather than as a poll, because the point is not a
 * vote — it is that a child knows which day is theirs. A veto is a single
 * named refusal, not a score: "not that again" said once, by somebody, about
 * one dish.
 */
export function wishDays(state: FamilyState, weekPlanId: string): readonly WishDay[] {
  const plan = state.get(EntityTypes.weekPlan, weekPlanId);

  return readRecords(plan, "wishDays")
    .map((raw) => ({
      personId: typeof raw["personId"] === "string" ? raw["personId"] : "",
      date: typeof raw["date"] === "string" ? raw["date"] : "",
      recipeId: typeof raw["recipeId"] === "string" ? raw["recipeId"] : "",
    }))
    .filter((wish) => wish.personId.length > 0 && wish.date.length > 0);
}

/** Recipes somebody has refused for this week; the suggester must skip them. */
export function vetoedRecipeIds(state: FamilyState, weekPlanId: string): readonly string[] {
  return readStringList(state.get(EntityTypes.weekPlan, weekPlanId), "vetoedRecipeIds");
}

// ── The shape of the week (FR-614) ────────────────────────────────────────

export interface BalanceRow {
  readonly tag: string;
  readonly count: number;
}

export interface WeekBalance {
  readonly plannedMeals: number;
  readonly distinctRecipes: number;
  readonly repeats: readonly { readonly recipeId: string; readonly count: number }[];
  readonly byTag: readonly BalanceRow[];
}

/**
 * What the week actually contains — counted, never judged.
 *
 * SPEC §1.3 rules out nutrition judgement, so there is no score, no target and
 * no colour. A family that ate pasta four times is told it ate pasta four
 * times; what to do about that is theirs.
 */
export function weekBalance(state: FamilyState, weekPlanId: string): WeekBalance {
  const slots = state
    .all(EntityTypes.mealSlot)
    .filter((slot) => readString(slot, "weekPlanId") === weekPlanId);

  const recipeCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  for (const slot of slots) {
    const recipeId = readString(slot, "recipeId");
    if (recipeId.length > 0) {
      recipeCounts.set(recipeId, (recipeCounts.get(recipeId) ?? 0) + 1);
      for (const tag of readStringList(state.get(EntityTypes.recipe, recipeId), "tags")) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
  }

  return {
    plannedMeals: slots.length,
    distinctRecipes: recipeCounts.size,
    repeats: [...recipeCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([recipeId, count]) => ({ recipeId, count }))
      .sort((a, b) => b.count - a.count),
    byTag: [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1)),
  };
}

/** The dates of a week, so a caller does not reimplement the calendar. */
export function weekDates(startDate: string): readonly string[] {
  const start = Date.parse(startDate + "T00:00:00Z");
  if (Number.isNaN(start)) return [];

  return Array.from({ length: 7 }, (_, index) =>
    new Date(start + index * DAY_MS).toISOString().slice(0, 10),
  );
}
