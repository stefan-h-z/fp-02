/**
 * Nutrition and kids' cook mode (SPEC §5), plus child onboarding (FR-130).
 *
 * Both cooking features are defined as much by what they refuse to do as by what
 * they do, so several tests here assert an absence: no computed figure, no
 * target, no progress bar.
 */
import { describe, expect, it } from "vitest";
import {
  applyOperation,
  CHILD_LED_FROM_AGE,
  childOnboardingProgress,
  childOnboardingSteps,
  childStarterTasks,
  emptyEntity,
  EntityTypes,
  FamilyState,
  hasNutrition,
  HlcClock,
  kidSteps,
  makeOperation,
  needsAdult,
  newId,
  nutritionForServings,
  nutritionVisible,
  onboardingMode,
  readNutrition,
  recipesForKids,
  summariseForKid,
  type Value,
} from "../src/index.js";

const FAMILY = "fam-1";
const clock = new HlcClock({ deviceId: "device-a", now: () => 1_700_000_000_000 });

function put(state: FamilyState, type: string, id: string, fields: Record<string, Value>): void {
  state.put(
    applyOperation(
      emptyEntity(type, id, FAMILY),
      makeOperation({
        opId: newId(),
        familyId: FAMILY,
        deviceId: "device-a",
        actorId: "person-mum",
        entityType: type,
        entityId: id,
        kind: "entity.create",
        payload: fields,
        hlc: clock.next(),
      }),
    ).entity,
  );
}

function kitchen(): FamilyState {
  const state = new FamilyState();
  put(state, EntityTypes.family, "fam-1", { name: "Müller" });
  put(state, EntityTypes.recipe, "r-stew", {
    title: "Winter stew",
    servings: 4,
    kcal: 520,
    proteinGrams: 31,
    carbGrams: 44,
    fatGrams: 22,
    steps: [
      { text: "Chop the onion." },
      { text: "Brown the beef in a hot pan." },
      { text: "Simmer for an hour." },
    ],
  });
  put(state, EntityTypes.recipe, "r-sandwich", {
    title: "Banana sandwich",
    servings: 1,
    steps: [
      { text: "Put the bread on a plate.", imageUrl: "file://step-1.jpg" },
      { text: "Spread the butter." },
      { text: "Lay the banana on top." },
    ],
  });
  put(state, EntityTypes.recipe, "r-muffins", {
    title: "Muffins",
    servings: 12,
    tags: ["kid-friendly"],
    steps: [
      { text: "Mix the flour and sugar." },
      { text: "Bake for twenty minutes." },
    ],
  });
  return state;
}

describe("nutrition (FR-534)", () => {
  it("reads whatever the recipe brought with it", () => {
    expect(readNutrition(kitchen(), "r-stew")).toEqual({
      kcal: 520,
      proteinGrams: 31,
      carbGrams: 44,
      fatGrams: 22,
    });
  });

  /**
   * The app does not look ingredients up in a nutrition table. A computed figure
   * looks authoritative in a way a scraped one does not, and this feature is
   * explicitly not allowed to be authoritative about anybody's food.
   */
  it("says nothing at all about a recipe that came without figures", () => {
    const nutrition = readNutrition(kitchen(), "r-sandwich");

    expect(nutrition.kcal).toBeUndefined();
    expect(hasNutrition(nutrition)).toBe(false);
  });

  it("scales with the number of people actually eating", () => {
    const scaled = nutritionForServings(readNutrition(kitchen(), "r-stew"), 4, 6);

    expect(scaled.kcal).toBe(780);
    expect(scaled.proteinGrams).toBe(47);
  });

  it("leaves the figures alone rather than dividing by zero", () => {
    const original = readNutrition(kitchen(), "r-stew");

    expect(nutritionForServings(original, 0, 4)).toEqual(original);
    expect(nutritionForServings(original, 4, 0)).toEqual(original);
  });

  /**
   * A household with an eating disorder in it should be able to make calories
   * not exist in this app. "Informational only" is not that promise; this switch
   * is, and it is off until somebody turns it on.
   */
  it("is off until a family switches it on", () => {
    const state = kitchen();
    expect(nutritionVisible(state)).toBe(false);

    put(state, EntityTypes.family, "fam-1", { name: "Müller", showNutrition: true });
    expect(nutritionVisible(state)).toBe(true);
  });
});

describe("kids' cook mode (FR-535)", () => {
  /**
   * Marked, not hidden. A recipe with a gap in it is harder for a child to
   * follow than one that says "wait for me here".
   */
  it("marks the steps a grown-up has to do rather than removing them", () => {
    const steps = kidSteps(kitchen(), "r-stew");

    expect(steps).toHaveLength(3);
    expect(steps.map((step) => step.needsAdult)).toEqual([true, true, true]);
    expect(steps[1]?.text).toContain("Brown the beef");
  });

  it("leaves a step a child can do unmarked", () => {
    expect(kidSteps(kitchen(), "r-sandwich").map((step) => step.needsAdult)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("keeps the picture that makes the mode work", () => {
    expect(kidSteps(kitchen(), "r-sandwich")[0]?.imageUrl).toBe("file://step-1.jpg");
    expect(kidSteps(kitchen(), "r-sandwich")[1]?.imageUrl).toBeUndefined();
  });

  it("errs towards asking a grown-up", () => {
    expect(needsAdult("Slice the tomato")).toBe(true);
    expect(needsAdult("Put it in the oven")).toBe(true);
    expect(needsAdult("Stir it with a spoon")).toBe(false);
  });

  it("summarises how much of a recipe is a child's", () => {
    expect(summariseForKid(kitchen(), "r-sandwich")).toEqual({
      recipeId: "r-sandwich",
      title: "Banana sandwich",
      stepCount: 3,
      adultStepCount: 0,
      hasPictures: true,
    });
  });

  it("has nothing to summarise about a recipe that is not there", () => {
    expect(summariseForKid(kitchen(), "nope")).toBeUndefined();
  });

  it("offers only the recipes a child could actually do", () => {
    expect(recipesForKids(kitchen()).map((recipe) => recipe.title)).toEqual([
      "Muffins",
      "Banana sandwich",
    ]);
  });

  /** A parent knows their child; this function does not. */
  it("takes a parent's word over its own reading of the steps", () => {
    // Muffins are baked, so the matcher would exclude them on its own.
    const muffins = recipesForKids(kitchen()).find((recipe) => recipe.title === "Muffins");

    expect(muffins?.adultStepCount).toBe(1);
  });

  it("offers easiest first", () => {
    const titles = recipesForKids(kitchen()).map((recipe) => recipe.title);

    expect(titles[0]).toBe("Muffins");
  });
});

describe("child onboarding (FR-130)", () => {
  /**
   * The distinction the requirement draws: a preschool child does not answer
   * questions about themselves, and showing a four-year-old a form pretends
   * otherwise.
   */
  it("asks the parent about a preschooler and the child about themselves", () => {
    expect(onboardingMode(4)).toBe("parentLed");
    expect(onboardingMode(CHILD_LED_FROM_AGE)).toBe("childLed");

    expect(childOnboardingSteps(4)[0]?.prompt).toBe("What is the child called?");
    expect(childOnboardingSteps(8)[0]?.prompt).toBe("What should we call you?");
  });

  it("asks a preschooler's parent about care, and a school child about their own morning", () => {
    expect(childOnboardingSteps(4).map((step) => step.key)).toEqual([
      "name",
      "colour",
      "avatar",
      "care",
    ]);
    expect(childOnboardingSteps(8).map((step) => step.key)).toContain("routine");
  });

  /** FR-1206: a child who cannot read yet needs the symbol to carry the step. */
  it("gives every step a symbol", () => {
    for (const step of [...childOnboardingSteps(4), ...childOnboardingSteps(8)]) {
      expect(step.icon.length).toBeGreaterThan(0);
    }
  });

  /**
   * FR-129 forbids "profile 60 % complete", because a progress bar turns a
   * family into a task list that is permanently unfinished. `usable` is the only
   * judgement offered.
   */
  it("reports usable rather than a percentage", () => {
    const progress = childOnboardingProgress(8, ["name", "colour"]);

    expect(progress.usable).toBe(true);
    expect(progress.answered).toEqual(["name", "colour"]);
    expect(progress.remaining.every((step) => step.optional)).toBe(true);
    expect(Object.keys(progress)).toEqual(["answered", "remaining", "usable"]);
  });

  it("is not usable until the required steps are in", () => {
    expect(childOnboardingProgress(8, ["name"]).usable).toBe(false);
    expect(childOnboardingProgress(8, []).usable).toBe(false);
  });

  /** Three a six-year-old can do beats twelve a parent has to prune (FR-126). */
  it("suggests a few starter jobs rather than the whole list", () => {
    const tasks = childStarterTasks(7);

    expect(tasks).toHaveLength(3);
    expect(tasks.every((task) => task.minAge <= 7)).toBe(true);
  });

  it("suggests nothing to a toddler rather than the nearest guess", () => {
    expect(childStarterTasks(1)).toEqual([]);
  });
});
