/**
 * Two things that happen around a recipe rather than inside it (SPEC §5, §3).
 *
 * FR-534 nutrition, which is informational and stays that way.
 * FR-535 a cook mode for a child, which is the same recipe read differently.
 *
 * Both are shaped by a non-goal (§1.3): this is not a diet app and not a
 * children's game. Nutrition therefore has no target, no daily total and no
 * colour scale, and kids' mode does not gamify — it removes the steps a child
 * should not do alone and puts a picture beside the ones they can.
 */
import { readRecords, readString, readStringList, EntityTypes } from "./schema.js";
import type { FamilyState } from "./state.js";

// ── Nutrition (FR-534) ────────────────────────────────────────────────────

export interface Nutrition {
  readonly kcal: number | undefined;
  readonly proteinGrams: number | undefined;
  readonly carbGrams: number | undefined;
  readonly fatGrams: number | undefined;
}

const NUTRITION_FIELDS = {
  kcal: "kcal",
  proteinGrams: "proteinGrams",
  carbGrams: "carbGrams",
  fatGrams: "fatGrams",
} as const;

/**
 * Whatever the recipe says, per portion, and nothing computed from a database.
 *
 * The numbers come from wherever the recipe came from. The app does not look
 * ingredients up in a nutrition table, because a computed figure looks
 * authoritative in a way a scraped one does not, and this feature is explicitly
 * not allowed to be authoritative about anybody's food.
 */
export function readNutrition(state: FamilyState, recipeId: string): Nutrition {
  const recipe = state.get(EntityTypes.recipe, recipeId);

  const read = (field: string): number | undefined => {
    const value = Number(recipe?.fields[field] ?? Number.NaN);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };

  return {
    kcal: read(NUTRITION_FIELDS.kcal),
    proteinGrams: read(NUTRITION_FIELDS.proteinGrams),
    carbGrams: read(NUTRITION_FIELDS.carbGrams),
    fatGrams: read(NUTRITION_FIELDS.fatGrams),
  };
}

export function hasNutrition(nutrition: Nutrition): boolean {
  return Object.values(nutrition).some((value) => value !== undefined);
}

/** Scaled to however many people are actually eating (FR-513). */
export function nutritionForServings(
  nutrition: Nutrition,
  recipeServings: number,
  wantedServings: number,
): Nutrition {
  if (recipeServings <= 0 || wantedServings <= 0) return nutrition;

  const factor = wantedServings / recipeServings;
  const scale = (value: number | undefined): number | undefined =>
    value === undefined ? undefined : Math.round(value * factor);

  return {
    kcal: scale(nutrition.kcal),
    proteinGrams: scale(nutrition.proteinGrams),
    carbGrams: scale(nutrition.carbGrams),
    fatGrams: scale(nutrition.fatGrams),
  };
}

/**
 * Whether the family wants to see any of this at all.
 *
 * Off unless somebody switched it on, and switchable back off in one place
 * (FR-1417). A household with an eating disorder in it should be able to make
 * calories not exist in this app, and "informational only" is not that promise —
 * this switch is.
 */
export function nutritionVisible(state: FamilyState): boolean {
  return state.all(EntityTypes.family)[0]?.fields["showNutrition"] === true;
}

// ── Kids' cook mode (FR-535) ──────────────────────────────────────────────

export interface KidStep {
  readonly index: number;
  readonly text: string;
  /** A picture of this step, which is what makes the mode work at all. */
  readonly imageUrl: string | undefined;
  /**
   * True when the step involves a hob, an oven, a knife or boiling water.
   *
   * Not hidden — shown, and marked, so a child knows where the grown-up part is
   * rather than discovering it halfway through. A recipe with a gap in it is
   * harder to follow than one that says "wait for me here".
   */
  readonly needsAdult: boolean;
}

/**
 * What means "an adult does this bit".
 *
 * Two lists, and the split is not tidiness. `ADULT_STEMS` are matched as word
 * *prefixes*, so one entry covers chop / chopped / chopping and heat / heated /
 * heating without listing each. `ADULT_WORDS` are matched whole, because their
 * letters open other words that are perfectly safe — `pan` is in a pancake and a
 * pantry, and a stem would fire on both.
 *
 * Neither is matched as a raw substring, which is what this did first and what
 * made it wrong in both directions at once: `hot` inside "a shot of espresso"
 * and inside "photograph" marked innocent steps as dangerous, while the verbs a
 * recipe for a child actually uses — cut, peel, grate, microwave, drain — were
 * not on the list at all and passed as safe. The over-inclusion this feature
 * wants is more words, not looser matching.
 *
 * English because the repository is (Constitution §VII); a translated recipe
 * carries translated steps, and this list grows with the languages the app
 * ships.
 */
const ADULT_STEMS: readonly string[] = [
  "bake",
  "blend",
  "boil",
  "burner",
  "chop",
  "cut",
  "dice",
  "drain",
  "fry",
  "grate",
  "grill",
  "heat",
  "hob",
  "hot",
  "kettle",
  "knife",
  "knive",
  "microwav",
  "oven",
  "peel",
  "roast",
  "scald",
  "scissor",
  "sharp",
  "simmer",
  "skillet",
  "slice",
  "steam",
  "stove",
  "toaster",
];

/** Matched whole, because their letters begin harmless words. */
const ADULT_WORDS: readonly string[] = ["pan", "pans", "saucepan", "saucepans", "flame", "flames", "processor", "mixer"];

/**
 * Errs towards asking a grown-up. A false positive costs a child one moment of
 * asking; a false negative costs considerably more, so where the two trade off
 * this leans one way on purpose.
 */
export function needsAdult(text: string): boolean {
  const words = text.toLowerCase().split(/[^a-z]+/).filter((word) => word.length > 0);

  return words.some(
    (word) =>
      ADULT_WORDS.includes(word) || ADULT_STEMS.some((stem) => word.startsWith(stem)),
  );
}

/**
 * Roughly how hard a recipe is for a child, from the shape of the recipe rather
 * than from an editor's rating: how many steps, and how many of them a child
 * cannot do. A recipe of four steps with none of them at the hob is a recipe a
 * seven-year-old can own.
 */
export interface KidRecipeSummary {
  readonly recipeId: string;
  readonly title: string;
  readonly stepCount: number;
  readonly adultStepCount: number;
  readonly hasPictures: boolean;
}

export function kidSteps(state: FamilyState, recipeId: string): readonly KidStep[] {
  return readRecords(state.get(EntityTypes.recipe, recipeId), "steps").map((raw, index) => {
    const text = typeof raw["text"] === "string" ? raw["text"] : "";
    const imageUrl = typeof raw["imageUrl"] === "string" && raw["imageUrl"].length > 0
      ? raw["imageUrl"]
      : undefined;

    return { index, text, imageUrl, needsAdult: needsAdult(text) };
  });
}

export function summariseForKid(state: FamilyState, recipeId: string): KidRecipeSummary | undefined {
  const recipe = state.get(EntityTypes.recipe, recipeId);
  if (recipe === undefined || recipe.deleted) return undefined;

  const steps = kidSteps(state, recipeId);

  return {
    recipeId,
    title: readString(recipe, "title"),
    stepCount: steps.length,
    adultStepCount: steps.filter((step) => step.needsAdult).length,
    hasPictures: steps.some((step) => step.imageUrl !== undefined),
  };
}

/**
 * Recipes to offer a child, easiest first.
 *
 * "Suitable" is three things and none of them is a rating somebody typed: few
 * steps, few of them needing an adult, and — where the family has bothered —
 * pictures. Explicitly marking a recipe as kid-friendly overrides all of it,
 * because a parent knows their child and this function does not.
 */
export function recipesForKids(
  state: FamilyState,
  options: { readonly maxSteps?: number } = {},
): readonly KidRecipeSummary[] {
  const maxSteps = options.maxSteps ?? 8;

  return state
    .all(EntityTypes.recipe)
    .filter((recipe) => !recipe.deleted)
    .map((recipe) => ({
      summary: summariseForKid(state, recipe.id),
      marked: readStringList(recipe, "tags").includes("kid-friendly"),
    }))
    .filter(
      (candidate): candidate is { summary: KidRecipeSummary; marked: boolean } =>
        candidate.summary !== undefined && candidate.summary.stepCount > 0,
    )
    .filter(
      (candidate) =>
        candidate.marked ||
        (candidate.summary.stepCount <= maxSteps && candidate.summary.adultStepCount === 0),
    )
    .map((candidate) => candidate.summary)
    .sort((a, b) => a.stepCount - b.stepCount || (a.title < b.title ? -1 : 1));
}
