import { beforeEach, describe, expect, it } from "vitest";
import {
  DAY_MS,
  EntityTypes,
  FamilyState,
  emergencyMeals,
  makeOperation,
  newId,
  planAdherence,
  rerollDay,
  suggestMeals,
  type Operation,
  type Value,
} from "@fam/domain";

const NOW = Date.parse("2026-07-28T18:00:00Z");
let wall = 1000;

function op(kind: Operation["kind"], entityType: string, entityId: string, payload: Record<string, Value>): Operation {
  wall += 1;
  return makeOperation({
    opId: newId(),
    familyId: "fam-1",
    deviceId: "device-a",
    actorId: null,
    entityType,
    entityId,
    kind,
    payload,
    hlc: { wall, counter: 0, deviceId: "device-a" },
  });
}

interface RecipeInput {
  readonly title: string;
  readonly totalMinutes?: number;
  readonly ingredients?: readonly string[];
  readonly lastCookedAt?: number;
  readonly seasons?: readonly string[];
  readonly tags?: readonly string[];
  readonly ratings?: readonly { personId: string; stars: number }[];
}

let state: FamilyState;

function seed(id: string, input: RecipeInput): void {
  state.apply(
    op("entity.create", EntityTypes.recipe, id, {
      title: input.title,
      servings: 4,
      ingredients: (input.ingredients ?? []).map((name) => ({ name, unit: "" })),
      seasons: [...(input.seasons ?? [])],
      tags: [...(input.tags ?? [])],
      ratings: (input.ratings ?? []).map((r) => ({ personId: r.personId, stars: r.stars })),
      ...(input.totalMinutes === undefined ? {} : { totalMinutes: input.totalMinutes }),
      ...(input.lastCookedAt === undefined ? {} : { lastCookedAt: input.lastCookedAt }),
    }),
  );
}

beforeEach(() => {
  state = new FamilyState();
});

describe("meal suggestions", () => {
  it("offers three options rather than a catalogue (FR-618)", () => {
    for (let i = 0; i < 8; i += 1) seed("r-" + i, { title: "Dish " + i });

    expect(suggestMeals(state, { now: NOW })).toHaveLength(3);
  });

  it("always explains itself (FR-619)", () => {
    seed("r-1", { title: "Pasta", totalMinutes: 20 });

    const [suggestion] = suggestMeals(state, { now: NOW, maxMinutes: 30 });

    expect(suggestion?.reasons.length).toBeGreaterThan(0);
    expect(suggestion?.reasons).toContain("takes 20 minutes");
  });

  it("prefers quick dishes on a tight evening (FR-610)", () => {
    seed("r-quick", { title: "Quick pasta", totalMinutes: 20 });
    seed("r-slow", { title: "Slow roast", totalMinutes: 180 });

    expect(suggestMeals(state, { now: NOW, maxMinutes: 25 })[0]?.recipeId).toBe("r-quick");
  });

  it("prefers a dish that uses up what needs using up, and says so (FR-736)", () => {
    seed("r-peppers", { title: "Stuffed peppers", ingredients: ["Pepper", "Rice"] });
    seed("r-other", { title: "Omelette", ingredients: ["Egg"] });

    const [top] = suggestMeals(state, { now: NOW, useUpItemKeys: ["Pepper"] });

    expect(top?.recipeId).toBe("r-peppers");
    expect(top?.reasons.join(" ")).toContain("uses up pepper");
  });

  it("pushes down what was cooked days ago, to force variety (FR-611)", () => {
    seed("r-recent", { title: "Recent", lastCookedAt: NOW - 2 * DAY_MS });
    seed("r-old", { title: "Old", lastCookedAt: NOW - 60 * DAY_MS });

    expect(suggestMeals(state, { now: NOW })[0]?.recipeId).toBe("r-old");
  });

  it("never proposes something already planned this week", () => {
    seed("r-a", { title: "A" });
    seed("r-b", { title: "B" });

    const suggestions = suggestMeals(state, { now: NOW, plannedRecipeIds: ["r-a"] });

    expect(suggestions.map((s) => s.recipeId)).toEqual(["r-b"]);
  });

  it("respects that a child will not eat something (FR-519)", () => {
    seed("r-fish", { title: "Fish" });
    seed("r-pizza", { title: "Pizza" });
    state.apply(op("set.add", EntityTypes.recipe, "r-fish", { field: "refusedBy", member: "p-kid" }));

    expect(suggestMeals(state, { now: NOW, eaterIds: ["p-mum", "p-kid"] })[0]?.recipeId).toBe("r-pizza");
  });

  it("counts a dislike only when that person is actually eating", () => {
    seed("r-fish", { title: "Fish", ratings: [{ personId: "p-mum", stars: 5 }] });
    seed("r-pizza", { title: "Pizza" });
    state.apply(op("set.add", EntityTypes.recipe, "r-fish", { field: "refusedBy", member: "p-kid" }));

    expect(suggestMeals(state, { now: NOW, eaterIds: ["p-mum"] })[0]?.recipeId).toBe("r-fish");
  });

  it("ignores ratings entirely when learning is switched off (FR-1417)", () => {
    seed("r-loved", { title: "Loved", ratings: [{ personId: "p-mum", stars: 5 }] });
    seed("r-plain", { title: "Plain" });

    const withLearning = suggestMeals(state, { now: NOW, eaterIds: ["p-mum"] });
    const withoutLearning = suggestMeals(state, { now: NOW, eaterIds: ["p-mum"], learningEnabled: false });

    expect(withLearning[0]?.recipeId).toBe("r-loved");
    expect(withoutLearning[0]?.score).toBe(withoutLearning[1]?.score);
  });

  it("prefers seasonal dishes when a season is given (FR-613)", () => {
    seed("r-asparagus", { title: "Asparagus", seasons: ["spring"] });
    seed("r-stew", { title: "Stew", seasons: ["winter"] });

    expect(suggestMeals(state, { now: NOW, season: "spring" })[0]?.recipeId).toBe("r-asparagus");
  });
});

describe("re-roll and emergencies", () => {
  it("replaces one day without repeating the rejected dish (FR-617)", () => {
    seed("r-a", { title: "A" });
    seed("r-b", { title: "B" });
    seed("r-c", { title: "C" });

    const again = rerollDay(state, { now: NOW, plannedRecipeIds: ["r-a"] }, ["r-b"]);

    expect(again.map((s) => s.recipeId)).toEqual(["r-c"]);
  });

  it("keeps three cupboard dishes ready for a bad day (FR-622)", () => {
    seed("r-pasta", { title: "Pasta aglio e olio", tags: ["emergency"] });
    seed("r-rice", { title: "Rice pudding", tags: ["emergency"] });
    seed("r-fresh", { title: "Fresh salad" });

    const emergency = emergencyMeals(state);

    expect(emergency.map((s) => s.recipeId)).toEqual(["r-pasta", "r-rice"]);
    expect(emergency[0]?.reasons[0]).toContain("cupboard");
  });
});

describe("plan adherence (FR-621)", () => {
  it("reports how much of the plan actually happened", () => {
    for (const [id, cooked] of [["s-1", true], ["s-2", true], ["s-3", false], ["s-4", false]] as const) {
      state.apply(
        op("entity.create", EntityTypes.mealSlot, id, {
          weekPlanId: "week-1",
          recipeId: "r-1",
          state: cooked ? "cooked" : "planned",
        }),
      );
    }

    expect(planAdherence(state, "week-1")).toBe(0.5);
  });

  it("treats an empty week as adhered to, so a new family is not nagged", () => {
    expect(planAdherence(state, "week-1")).toBe(1);
  });
});
