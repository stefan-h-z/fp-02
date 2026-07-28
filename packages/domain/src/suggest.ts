/**
 * Meal suggestions (SPEC §9.2).
 *
 * The point of this file is decision relief, not cleverness: three options with a
 * reason each, instead of an endless catalogue (FR-618, FR-619). Everything here
 * is deterministic and explainable — the ranking can always answer "why this?",
 * which is what makes a suggestion something a tired person will accept.
 *
 * The learning part (what was actually cooked, what got good ratings) enters as
 * plain inputs, so the whole suggester still works with learning switched off
 * (SPEC FR-1417) — it just gets less pointed.
 */
import { setMembers } from "./entity.js";
import { DAY_MS } from "./rhythm.js";
import {
  EntityTypes,
  SetFields,
  canonicalItemKey,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readRecords,
  readString,
  readStringList,
} from "./schema.js";
import type { FamilyState } from "./state.js";

export interface SuggestionContext {
  readonly now: number;
  /** Minutes available for cooking, e.g. cut short by a training day (FR-610). */
  readonly maxMinutes?: number;
  /** Who is eating, so per-person dislikes count (FR-519). */
  readonly eaterIds?: readonly string[];
  /** Items that should be used up, from "needs using up" reports (FR-736). */
  readonly useUpItemKeys?: readonly string[];
  /** Recipes already planned this week — variety beats a good score (FR-611). */
  readonly plannedRecipeIds?: readonly string[];
  readonly season?: "spring" | "summer" | "autumn" | "winter";
  readonly learningEnabled?: boolean;
  readonly limit?: number;
}

export interface Suggestion {
  readonly recipeId: string;
  readonly title: string;
  readonly score: number;
  /** Shown with the suggestion; never empty. */
  readonly reasons: readonly string[];
}

const RECENTLY_COOKED_DAYS = 21;

export function suggestMeals(state: FamilyState, context: SuggestionContext): readonly Suggestion[] {
  const planned = new Set(context.plannedRecipeIds ?? []);
  const useUp = new Set((context.useUpItemKeys ?? []).map(canonicalItemKey));

  const scored = state
    .all(EntityTypes.recipe)
    .filter((recipe) => !planned.has(recipe.id))
    .map((recipe) => {
      const reasons: string[] = [];
      let score = 1;

      const minutes = readOptionalNumber(recipe, "totalMinutes");
      if (context.maxMinutes !== undefined) {
        if (minutes === undefined) {
          score -= 0.2;
        } else if (minutes <= context.maxMinutes) {
          score += 1.2;
          reasons.push("takes " + minutes + " minutes");
        } else {
          // Not excluded outright: a family that wants it anyway may still pick it.
          score -= 1.5;
        }
      }

      const matches = [...useUp].filter((key) => recipeUses(state, recipe.id, key));
      if (matches.length > 0) {
        score += 1.5 * matches.length;
        reasons.push("uses up " + matches.join(", "));
      }

      const lastCooked = readOptionalNumber(recipe, "lastCookedAt");
      if (lastCooked === undefined) {
        score += 0.4;
        reasons.push("not cooked yet");
      } else {
        const days = (context.now - lastCooked) / DAY_MS;
        if (days < RECENTLY_COOKED_DAYS) {
          score -= 2 - (2 * days) / RECENTLY_COOKED_DAYS;
        } else {
          score += 0.5;
          reasons.push("last cooked " + Math.round(days) + " days ago");
        }
      }

      if (context.season !== undefined && readStringList(recipe, "seasons").includes(context.season)) {
        score += 0.5;
        reasons.push("in season");
      }

      if (context.learningEnabled !== false) {
        const rating = averageRating(state, recipe.id, context.eaterIds);
        if (rating !== undefined) {
          score += (rating - 3) * 0.5;
          if (rating >= 4) reasons.push("everyone eating likes it");
        }
        if (context.eaterIds !== undefined && someoneRefuses(state, recipe.id, context.eaterIds)) {
          score -= 2.5;
        }
      }

      return {
        recipeId: recipe.id,
        title: readString(recipe, "title"),
        score: Math.round(score * 100) / 100,
        reasons: reasons.length > 0 ? reasons : ["fits the week"],
      };
    });

  return scored
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.title < b.title ? -1 : 1))
    .slice(0, context.limit ?? 3);
}

/**
 * Re-roll one day without disturbing the rest (FR-617): the same suggester, with
 * everything currently planned excluded so the replacement is genuinely new.
 */
export function rerollDay(
  state: FamilyState,
  context: SuggestionContext,
  rejectedRecipeIds: readonly string[],
): readonly Suggestion[] {
  return suggestMeals(state, {
    ...context,
    plannedRecipeIds: [...(context.plannedRecipeIds ?? []), ...rejectedRecipeIds],
  });
}

/**
 * The emergency list (FR-622): dishes that work from what a household normally
 * keeps in, so there is always an answer on a bad day. Marked by the family, not
 * inferred — the app does not know what is in the cupboard and does not pretend
 * to (SPEC FR-743).
 */
export function emergencyMeals(state: FamilyState, limit = 3): readonly Suggestion[] {
  return state
    .all(EntityTypes.recipe)
    .filter((recipe) => readStringList(recipe, "tags").includes("emergency"))
    .slice(0, limit)
    .map((recipe) => ({
      recipeId: recipe.id,
      title: readString(recipe, "title"),
      score: 0,
      reasons: ["always works from the cupboard"],
    }));
}

/**
 * A plan the family keeps ignoring is a wrong plan, not a discipline problem
 * (FR-621). Reports how often planned meals were actually cooked, so the
 * suggester can be told to aim lower.
 */
export function planAdherence(state: FamilyState, weekPlanId: string): number {
  const slots = state
    .all(EntityTypes.mealSlot)
    .filter((slot) => readOptionalString(slot, "weekPlanId") === weekPlanId && readOptionalString(slot, "recipeId") !== undefined);

  if (slots.length === 0) return 1;
  const cooked = slots.filter((slot) => readString(slot, "state") === "cooked").length;
  return Math.round((cooked / slots.length) * 100) / 100;
}

function recipeUses(state: FamilyState, recipeId: string, itemKey: string): boolean {
  return readRecords(state.get(EntityTypes.recipe, recipeId), "ingredients").some((ingredient) => {
    const name = ingredient["name"];
    return typeof name === "string" && canonicalItemKey(name) === itemKey;
  });
}

/** Ratings are per family member (FR-519), so "good" depends on who is eating. */
function averageRating(
  state: FamilyState,
  recipeId: string,
  eaterIds: readonly string[] | undefined,
): number | undefined {
  const ratings = readRecords(state.get(EntityTypes.recipe, recipeId), "ratings").filter((entry) => {
    const personId = entry["personId"];
    return eaterIds === undefined || (typeof personId === "string" && eaterIds.includes(personId));
  });

  const values = ratings
    .map((entry) => entry["stars"])
    .filter((stars): stars is number => typeof stars === "number");

  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** "The child will not eat this" is a hard signal, not an average. */
function someoneRefuses(state: FamilyState, recipeId: string, eaterIds: readonly string[]): boolean {
  const recipe = state.get(EntityTypes.recipe, recipeId);
  if (recipe === undefined) return false;
  return setMembers(recipe, "refusedBy").some((personId) => eaterIds.includes(personId));
}

export function eatersOf(state: FamilyState, mealSlotId: string): readonly string[] {
  const slot = state.get(EntityTypes.mealSlot, mealSlotId);
  return slot === undefined ? [] : setMembers(slot, SetFields.eaters);
}

export function recipeServings(state: FamilyState, recipeId: string): number {
  return readNumber(state.get(EntityTypes.recipe, recipeId), "servings", 0);
}
