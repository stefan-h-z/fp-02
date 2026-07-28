/**
 * A recipe collection that is somebody's, and stays theirs (SPEC §5).
 *
 * `recipeImport.ts` gets a recipe in. This is what happens to it afterwards:
 * the family changes it, keeps the change, files it, hands it to another
 * family, or brings a hundred of them over from whatever they used before.
 *
 * The through-line is that a family's recipes are not the app's. Export is a
 * plain object with no ids in it that only mean something here, and a shared
 * recipe carries its provenance — because the most valuable recipes in a
 * household came from a person, and losing that is losing the recipe.
 */
import type { FamilyState } from "./state.js";
import { EntityTypes, readRecords, readString, readStringList } from "./schema.js";
import type { ImportedRecipe } from "./recipeImport.js";

// ── Categorisation (FR-515) ───────────────────────────────────────────────

export type Season = "spring" | "summer" | "autumn" | "winter";

export const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];

export interface RecipeFacets {
  readonly tags: readonly string[];
  readonly cuisine: string;
  readonly seasons: readonly Season[];
  readonly occasion: string;
  /** 1 (weeknight) to 5 (a project). Absent means nobody has said. */
  readonly effort: number | undefined;
}

export function readFacets(state: FamilyState, recipeId: string): RecipeFacets {
  const recipe = state.get(EntityTypes.recipe, recipeId);
  const effort = Number(recipe?.fields["effort"] ?? Number.NaN);

  return {
    tags: readStringList(recipe, "tags"),
    cuisine: readString(recipe, "cuisine"),
    seasons: readStringList(recipe, "seasons").filter((value): value is Season =>
      (SEASONS as readonly string[]).includes(value),
    ),
    occasion: readString(recipe, "occasion"),
    effort: Number.isFinite(effort) && effort > 0 ? effort : undefined,
  };
}

/**
 * The season a date falls in, so "what is in season" needs no second input.
 * Meteorological seasons: a family cooks by the month, not by the solstice.
 */
export function seasonOf(date: string): Season | undefined {
  const month = Number(date.slice(5, 7));
  if (!Number.isFinite(month) || month < 1 || month > 12) return undefined;
  if (month <= 2 || month === 12) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

/** Recipes matching every facet given; an omitted facet does not narrow. */
export function findRecipes(
  state: FamilyState,
  query: {
    readonly tags?: readonly string[];
    readonly cuisine?: string;
    readonly season?: Season;
    readonly maxEffort?: number;
  },
): readonly string[] {
  return state
    .all(EntityTypes.recipe)
    .filter((recipe) => {
      const facets = readFacets(state, recipe.id);

      if (query.tags !== undefined && !query.tags.every((tag) => facets.tags.includes(tag))) {
        return false;
      }
      if (query.cuisine !== undefined && facets.cuisine !== query.cuisine) return false;
      // A recipe with no season named is available all year, not never.
      if (
        query.season !== undefined &&
        facets.seasons.length > 0 &&
        !facets.seasons.includes(query.season)
      ) {
        return false;
      }
      if (query.maxEffort !== undefined && facets.effort !== undefined && facets.effort > query.maxEffort) {
        return false;
      }
      return true;
    })
    .map((recipe) => recipe.id);
}

// ── Modifications and versioning (FR-521) ─────────────────────────────────

export interface RecipeRevision {
  readonly at: number;
  readonly personId: string;
  readonly note: string;
}

/**
 * "We always use half the chilli."
 *
 * Kept as a list of what a household changed, not as a diff of the recipe: the
 * change is a sentence a person wrote, and rendering it back as a sentence is
 * what makes it useful the next time somebody cooks it.
 */
export function revisions(state: FamilyState, recipeId: string): readonly RecipeRevision[] {
  return readRecords(state.get(EntityTypes.recipe, recipeId), "revisions")
    .map((raw) => ({
      at: Number(raw["at"] ?? 0),
      personId: typeof raw["personId"] === "string" ? raw["personId"] : "",
      note: typeof raw["note"] === "string" ? raw["note"] : "",
    }))
    .filter((revision) => revision.note.length > 0)
    .sort((a, b) => b.at - a.at);
}

/** The change worth showing at the hob: the most recent one. */
export function latestRevision(
  state: FamilyState,
  recipeId: string,
): RecipeRevision | undefined {
  return revisions(state, recipeId)[0];
}

// ── Photos (FR-520) ───────────────────────────────────────────────────────

/**
 * The family's own photo of the finished dish, kept apart from the one that
 * came with the recipe.
 *
 * Separate fields rather than one overwritten image, because the press photo is
 * what a recipe looked like when somebody chose it and the family's is what it
 * looks like when they make it. Both are worth having, and only one of them is
 * theirs.
 */
export function recipeImages(
  state: FamilyState,
  recipeId: string,
): { readonly source: string; readonly own: string } {
  const recipe = state.get(EntityTypes.recipe, recipeId);

  return { source: readString(recipe, "imageUrl"), own: readString(recipe, "ownImageUrl") };
}

// ── Sharing and export (FR-525) ───────────────────────────────────────────

export interface SharedRecipe {
  readonly title: string;
  readonly servings: number | undefined;
  readonly ingredients: readonly { readonly name: string; readonly amount: number | undefined; readonly unit: string }[];
  readonly steps: readonly string[];
  readonly tags: readonly string[];
  readonly sourceUrl: string;
  /** Who in the sending family it came from, in words rather than an id. */
  readonly fromFamily: string;
  readonly note: string;
}

/**
 * A recipe in a form another family can read.
 *
 * No entity ids, no person ids, no household anything — an exported recipe that
 * carried them would leak the sender's family into the receiver's app, and
 * would be useless to anyone opening it in a text editor. The provenance that
 * *is* included is a name somebody typed, because a recipe from a grandmother
 * without her name is a different, poorer object.
 */
export function shareRecipe(
  state: FamilyState,
  input: { readonly recipeId: string; readonly fromFamily: string; readonly note?: string },
): SharedRecipe | undefined {
  const recipe = state.get(EntityTypes.recipe, input.recipeId);
  if (recipe === undefined || recipe.deleted) return undefined;

  const servings = Number(recipe.fields["servings"] ?? Number.NaN);

  return {
    title: readString(recipe, "title"),
    servings: Number.isFinite(servings) && servings > 0 ? servings : undefined,
    ingredients: readRecords(recipe, "ingredients").map((raw) => ({
      name: typeof raw["name"] === "string" ? raw["name"] : "",
      amount: Number.isFinite(Number(raw["amount"])) ? Number(raw["amount"]) : undefined,
      unit: typeof raw["unit"] === "string" ? raw["unit"] : "",
    })),
    steps: readRecords(recipe, "steps")
      .map((raw) => (typeof raw["text"] === "string" ? raw["text"] : ""))
      .filter((step) => step.length > 0),
    tags: readStringList(recipe, "tags"),
    sourceUrl: readString(recipe, "sourceUrl"),
    fromFamily: input.fromFamily,
    note: input.note ?? "",
  };
}

/** Everything the family has, as a bundle they can take elsewhere (FR-1112). */
export function exportRecipes(
  state: FamilyState,
  fromFamily: string,
): readonly SharedRecipe[] {
  return state
    .all(EntityTypes.recipe)
    .map((recipe) => shareRecipe(state, { recipeId: recipe.id, fromFamily }))
    .filter((shared): shared is SharedRecipe => shared !== undefined);
}

// ── Bulk import (FR-511) ──────────────────────────────────────────────────

export interface BulkOutcome {
  readonly imported: readonly ImportedRecipe[];
  /** Titles that arrived twice in the same batch, or already exist. */
  readonly duplicates: readonly string[];
  readonly rejected: readonly { readonly index: number; readonly reason: string }[];
}

/**
 * A migration from whatever the family used before.
 *
 * Partial success is the only sensible contract: a hundred recipes with three
 * bad ones should import ninety-seven and say which three failed. Refusing the
 * batch would leave somebody retyping a hundred recipes because of a typo in
 * one.
 */
export function importMany(
  state: FamilyState,
  entries: readonly SharedRecipe[],
): BulkOutcome {
  const existing = new Set(
    state.all(EntityTypes.recipe).map((recipe) => readString(recipe, "title").toLowerCase()),
  );

  const imported: ImportedRecipe[] = [];
  const duplicates: string[] = [];
  const rejected: { index: number; reason: string }[] = [];

  entries.forEach((entry, index) => {
    const title = entry.title.trim();
    if (title.length === 0) {
      rejected.push({ index, reason: "no title" });
      return;
    }
    if (entry.ingredients.length === 0 && entry.steps.length === 0) {
      rejected.push({ index, reason: "nothing in it" });
      return;
    }
    if (existing.has(title.toLowerCase())) {
      duplicates.push(title);
      return;
    }

    existing.add(title.toLowerCase());
    imported.push({
      title,
      servings: entry.servings,
      ingredients: entry.ingredients.map((ingredient) => ({
        name: ingredient.name,
        amount: ingredient.amount,
        unit: ingredient.unit,
        note: "",
        raw: `${ingredient.amount ?? ""} ${ingredient.unit} ${ingredient.name}`.trim(),
      })),
      steps: entry.steps,
      totalMinutes: undefined,
      imageUrl: undefined,
      sourceUrl: entry.sourceUrl.length > 0 ? entry.sourceUrl : undefined,
      author: entry.fromFamily.length > 0 ? entry.fromFamily : undefined,
    });
  });

  return { imported, duplicates, rejected };
}
