/**
 * Deriving the shopping needs of a week plan (SPEC FR-714, SC-004).
 *
 * The important decision: planned needs are *not* written as shopping items.
 * They are computed from the plan and the recipes every time the list is read, so
 * "plan changed means list changed" (SPEC P-05) is true by construction — on every
 * device, including one that only received the plan change and never saw a
 * follow-up write. Removing a recipe from the plan cannot leave an orphan line,
 * because the line was never stored.
 *
 * What *is* stored is the check-off: a tiny entity keyed by the derived need, so
 * ticking "onions" survives, and a changed quantity does not un-tick it.
 */
import { derivedId } from "./ids.js";
import {
  EntityTypes,
  SetFields,
  canonicalItemKey,
  readNumber,
  readOptionalString,
  readRecords,
  readString,
} from "./schema.js";
import type { FamilyState } from "./state.js";
import { addQuantities, formatQuantity, normalizeQuantity, scaleQuantity, type NormalizedQuantity } from "./units.js";
import { setMembers } from "./entity.js";

export interface RecipeIngredient {
  readonly name: string;
  readonly amount: number | undefined;
  readonly unit: string;
  readonly note: string;
}

export interface PlannedNeed {
  /** Stable across quantity changes, so a tick is not lost when a recipe is edited. */
  readonly key: string;
  readonly itemKey: string;
  readonly displayName: string;
  readonly quantity: NormalizedQuantity | undefined;
  readonly quantityLabel: string;
  /** Which planned meals asked for it — the answer to "why is this on my list?". */
  readonly fromMealSlotIds: readonly string[];
  readonly fromRecipeTitles: readonly string[];
}

export function readRecipeIngredients(state: FamilyState, recipeId: string): readonly RecipeIngredient[] {
  const recipe = state.get(EntityTypes.recipe, recipeId);
  return readRecords(recipe, "ingredients").map((raw) => ({
    name: typeof raw["name"] === "string" ? raw["name"] : "",
    amount: typeof raw["amount"] === "number" ? raw["amount"] : undefined,
    unit: typeof raw["unit"] === "string" ? raw["unit"] : "",
    note: typeof raw["note"] === "string" ? raw["note"] : "",
  }));
}

/**
 * Scale factor for a planned meal: who actually eats, over what the recipe is
 * written for (FR-603 — a per-meal eater set rather than a household size).
 */
export function servingFactor(state: FamilyState, mealSlotId: string): number {
  const slot = state.get(EntityTypes.mealSlot, mealSlotId);
  if (slot === undefined) return 1;

  const eaters = setMembers(slot, SetFields.eaters).length;
  const recipeId = readOptionalString(slot, "recipeId");
  const servings = recipeId === undefined ? 0 : readNumber(state.get(EntityTypes.recipe, recipeId), "servings", 0);

  if (eaters === 0 || servings <= 0) return 1;
  return eaters / servings;
}

/**
 * Merge every planned meal's ingredients into one line per item — three recipes
 * wanting onions produce a single line with the summed amount.
 *
 * Amounts that cannot be added (a pinch plus 20 g) keep the larger, clearly
 * labelled: the list's job is to get the right thing into the trolley, not to be
 * a measurement authority (SPEC P-08).
 */
export function derivePlannedNeeds(state: FamilyState, weekPlanId: string): readonly PlannedNeed[] {
  const merged = new Map<string, {
    itemKey: string;
    displayName: string;
    quantity: NormalizedQuantity | undefined;
    /** Amounts in a dimension that cannot be added to the first one. */
    others: NormalizedQuantity[];
    slots: Set<string>;
    recipes: Set<string>;
  }>();

  for (const slot of state.all(EntityTypes.mealSlot)) {
    if (readOptionalString(slot, "weekPlanId") !== weekPlanId) continue;
    const recipeId = readOptionalString(slot, "recipeId");
    if (recipeId === undefined) continue;

    const factor = servingFactor(state, slot.id);
    const recipeTitle = readString(state.get(EntityTypes.recipe, recipeId), "title");

    for (const ingredient of readRecipeIngredients(state, recipeId)) {
      const itemKey = canonicalItemKey(ingredient.name);
      if (itemKey.length === 0) continue;

      const scaled =
        ingredient.amount === undefined
          ? undefined
          : scaleQuantity(normalizeQuantity({ amount: ingredient.amount, unit: ingredient.unit }), factor);

      const existing = merged.get(itemKey);
      if (existing === undefined) {
        merged.set(itemKey, {
          itemKey,
          displayName: ingredient.name.trim(),
          quantity: scaled,
          others: [],
          slots: new Set([slot.id]),
          recipes: new Set(recipeTitle.length > 0 ? [recipeTitle] : []),
        });
        continue;
      }

      existing.slots.add(slot.id);
      if (recipeTitle.length > 0) existing.recipes.add(recipeTitle);

      if (existing.quantity === undefined || scaled === undefined) {
        existing.quantity = existing.quantity ?? scaled;
      } else {
        const sum = addQuantities(existing.quantity, scaled);
        if (sum === undefined) {
          // Three onions and 50 g of onion cannot be added. Keeping only the
          // numerically larger would silently drop a requirement — and grams
          // always outnumber pieces, so it would usually drop the wrong one.
          existing.others.push(scaled);
        } else {
          existing.quantity = sum;
        }
      }
    }
  }

  return [...merged.values()]
    .map((entry) => ({
      key: plannedNeedKey(weekPlanId, entry.itemKey),
      itemKey: entry.itemKey,
      displayName: entry.displayName,
      quantity: entry.quantity,
      quantityLabel: [entry.quantity, ...entry.others]
        .filter((quantity): quantity is NormalizedQuantity => quantity !== undefined)
        .map(formatQuantity)
        .join(" + "),
      fromMealSlotIds: [...entry.slots].sort(),
      fromRecipeTitles: [...entry.recipes].sort(),
    }))
    .sort((a, b) => (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
}

export function plannedNeedKey(weekPlanId: string, itemKey: string): string {
  return derivedId("plannedNeed", weekPlanId, itemKey);
}
