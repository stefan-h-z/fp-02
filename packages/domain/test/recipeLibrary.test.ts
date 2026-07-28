/**
 * What happens to a recipe after it arrives (SPEC §5).
 *
 * The export tests are written from the leak direction: an exported recipe must
 * carry nothing that only means something inside this family's app, because it
 * is going somewhere else by definition.
 */
import { describe, expect, it } from "vitest";
import {
  EntityTypes,
  FamilyState,
  applyOperation,
  emptyEntity,
  exportRecipes,
  findRecipes,
  HlcClock,
  importMany,
  latestRevision,
  makeOperation,
  newId,
  readFacets,
  recipeImages,
  revisions,
  seasonOf,
  shareRecipe,
  type SharedRecipe,
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

function library(): FamilyState {
  const state = new FamilyState();
  put(state, EntityTypes.recipe, "r-stew", {
    title: "Winter stew",
    servings: 4,
    cuisine: "german",
    seasons: ["autumn", "winter"],
    occasion: "sunday",
    effort: 4,
    tags: ["hearty"],
    ingredients: [{ name: "Beef", amount: 500, unit: "g" }],
    steps: [{ text: "Brown the beef." }],
    imageUrl: "https://example.test/stew.jpg",
    ownImageUrl: "file://ours.jpg",
    sourceUrl: "https://example.test/stew",
    revisions: [
      { at: 100, personId: "person-mum", note: "Half the chilli" },
      { at: 200, personId: "person-dad", note: "More paprika" },
    ],
  });
  put(state, EntityTypes.recipe, "r-salad", {
    title: "Summer salad",
    servings: 2,
    cuisine: "italian",
    seasons: ["summer"],
    effort: 1,
    tags: ["quick", "hearty"],
    ingredients: [{ name: "Tomato", amount: 3, unit: "piece" }],
    steps: [{ text: "Chop." }],
  });
  put(state, EntityTypes.recipe, "r-pasta", {
    title: "Any-time pasta",
    servings: 4,
    ingredients: [{ name: "Pasta", amount: 500, unit: "g" }],
    steps: [{ text: "Boil." }],
  });
  return state;
}

describe("categorisation (FR-515)", () => {
  it("reads cuisine, season, occasion and effort", () => {
    const facets = readFacets(library(), "r-stew");

    expect(facets.cuisine).toBe("german");
    expect(facets.seasons).toEqual(["autumn", "winter"]);
    expect(facets.occasion).toBe("sunday");
    expect(facets.effort).toBe(4);
  });

  it("treats an unset effort as unsaid rather than as zero", () => {
    expect(readFacets(library(), "r-pasta").effort).toBeUndefined();
  });

  it("knows the season of a date, by month", () => {
    expect(seasonOf("2026-01-15")).toBe("winter");
    expect(seasonOf("2026-04-15")).toBe("spring");
    expect(seasonOf("2026-07-15")).toBe("summer");
    expect(seasonOf("2026-10-15")).toBe("autumn");
    expect(seasonOf("nonsense")).toBeUndefined();
  });

  it("narrows on every facet given, and on none that is omitted", () => {
    const state = library();

    expect(findRecipes(state, { cuisine: "italian" })).toEqual(["r-salad"]);
    expect([...findRecipes(state, { tags: ["hearty"] })].sort()).toEqual(["r-salad", "r-stew"]);
    // Order is not part of the contract, so the assertion does not claim one.
    expect([...findRecipes(state, { maxEffort: 2 })].sort()).toEqual(["r-pasta", "r-salad"]);
    expect(findRecipes(state, {})).toHaveLength(3);
  });

  /** A recipe with no season named is available all year, not never. */
  it("does not hide a recipe just because nobody gave it a season", () => {
    expect([...findRecipes(library(), { season: "winter" })].sort()).toEqual(["r-pasta", "r-stew"]);
  });
});

describe("modifications (FR-521)", () => {
  it("keeps what a household changed, newest first", () => {
    const all = revisions(library(), "r-stew");

    expect(all.map((r) => r.note)).toEqual(["More paprika", "Half the chilli"]);
    expect(latestRevision(library(), "r-stew")?.personId).toBe("person-dad");
  });

  it("has nothing to say about a recipe nobody changed", () => {
    expect(revisions(library(), "r-pasta")).toEqual([]);
    expect(latestRevision(library(), "r-pasta")).toBeUndefined();
  });
});

describe("photos (FR-520)", () => {
  /**
   * Two fields, not one overwritten image: the press photo is what a recipe
   * looked like when somebody chose it, and the family's is what it looks like
   * when they make it.
   */
  it("keeps the family's own photo beside the one that came with it", () => {
    const images = recipeImages(library(), "r-stew");

    expect(images.source).toBe("https://example.test/stew.jpg");
    expect(images.own).toBe("file://ours.jpg");
  });
});

describe("sharing (FR-525)", () => {
  it("carries the recipe and the provenance somebody typed", () => {
    const shared = shareRecipe(library(), {
      recipeId: "r-stew",
      fromFamily: "Oma Müller",
      note: "Her Sunday one",
    });

    expect(shared?.title).toBe("Winter stew");
    expect(shared?.ingredients[0]?.name).toBe("Beef");
    expect(shared?.steps).toEqual(["Brown the beef."]);
    expect(shared?.fromFamily).toBe("Oma Müller");
    expect(shared?.note).toBe("Her Sunday one");
  });

  /**
   * The leak test. An exported recipe goes to another family by definition, so
   * it must carry nothing that only means something inside this one.
   */
  it("carries no ids out of the family", () => {
    const serialised = JSON.stringify(shareRecipe(library(), { recipeId: "r-stew", fromFamily: "Oma" }));

    expect(serialised).not.toContain("r-stew");
    expect(serialised).not.toContain("person-mum");
    expect(serialised).not.toContain(FAMILY);
  });

  it("exports the whole library in the same shape", () => {
    const bundle = exportRecipes(library(), "Familie Müller");

    expect(bundle).toHaveLength(3);
    expect(bundle.every((recipe) => recipe.fromFamily === "Familie Müller")).toBe(true);
  });

  it("is undefined for a recipe that is not there", () => {
    expect(shareRecipe(library(), { recipeId: "nope", fromFamily: "X" })).toBeUndefined();
  });
});

describe("bulk import (FR-511)", () => {
  const good: SharedRecipe = {
    title: "Bean soup",
    servings: 4,
    ingredients: [{ name: "Beans", amount: 400, unit: "g" }],
    steps: ["Simmer."],
    tags: [],
    sourceUrl: "",
    fromFamily: "Old app",
    note: "",
  };

  /**
   * Partial success is the only sensible contract: a hundred recipes with three
   * bad ones should import ninety-seven. Refusing the batch would leave
   * somebody retyping a hundred recipes because of one typo.
   */
  it("imports what it can and names what it could not", () => {
    const outcome = importMany(library(), [
      good,
      { ...good, title: "  " },
      { ...good, title: "Empty one", ingredients: [], steps: [] },
    ]);

    expect(outcome.imported.map((r) => r.title)).toEqual(["Bean soup"]);
    expect(outcome.rejected).toEqual([
      { index: 1, reason: "no title" },
      { index: 2, reason: "nothing in it" },
    ]);
  });

  it("does not import a recipe the family already has", () => {
    const outcome = importMany(library(), [{ ...good, title: "Winter stew" }]);

    expect(outcome.imported).toEqual([]);
    expect(outcome.duplicates).toEqual(["Winter stew"]);
  });

  it("catches a duplicate inside the same batch", () => {
    const outcome = importMany(library(), [good, { ...good }]);

    expect(outcome.imported).toHaveLength(1);
    expect(outcome.duplicates).toEqual(["Bean soup"]);
  });

  it("keeps where each recipe came from", () => {
    expect(importMany(library(), [good]).imported[0]?.author).toBe("Old app");
  });
});
