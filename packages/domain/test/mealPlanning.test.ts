/**
 * The parts of planning a week that are not "put a recipe in a slot" (SPEC §6).
 *
 * The balance tests are written to pin a *restraint* rather than a feature:
 * SPEC §1.3 rules out nutrition judgement, so the assertions check that nothing
 * scores, rates or advises.
 */
import { describe, expect, it } from "vitest";
import {
  EntityTypes,
  FamilyState,
  applyOperation,
  emptyEntity,
  HlcClock,
  leftoverPlans,
  leftoverSlotIds,
  makeOperation,
  mealPatterns,
  newId,
  patternFor,
  portionsNeeded,
  shiftTemplate,
  vetoedRecipeIds,
  weekAsTemplate,
  weekBalance,
  weekDates,
  wishDays,
  type Value,
} from "../src/index.js";

const FAMILY = "fam-1";
const WEEK = "week-31";
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

function addEaters(state: FamilyState, slotId: string, people: readonly string[]): void {
  for (const personId of people) {
    const before = state.get(EntityTypes.mealSlot, slotId);
    if (before === undefined) continue;
    state.put(
      applyOperation(
        before,
        makeOperation({
          opId: newId(),
          familyId: FAMILY,
          deviceId: "device-a",
          actorId: "person-mum",
          entityType: EntityTypes.mealSlot,
          entityId: slotId,
          kind: "set.add",
          payload: { field: "eaters", member: personId },
          hlc: clock.next(),
        }),
      ).entity,
    );
  }
}

describe("leftovers (FR-605)", () => {
  function withLeftovers(): FamilyState {
    const state = new FamilyState();
    put(state, EntityTypes.mealSlot, "slot-sun", {
      weekPlanId: WEEK,
      date: "2026-07-26",
      mealType: "dinner",
      recipeId: "r-roast",
    });
    put(state, EntityTypes.mealSlot, "slot-mon", {
      weekPlanId: WEEK,
      date: "2026-07-27",
      mealType: "dinner",
      recipeId: "r-roast",
      leftoverOfSlotId: "slot-sun",
    });
    addEaters(state, "slot-sun", ["person-mum", "person-dad"]);
    addEaters(state, "slot-mon", ["person-mum", "person-dad", "person-kid"]);
    return state;
  }

  it("links the meal that is eaten to the meal that was cooked", () => {
    const plans = leftoverPlans(withLeftovers(), WEEK);

    expect(plans).toHaveLength(1);
    expect(plans[0]?.cookedInSlotId).toBe("slot-sun");
    expect(plans[0]?.eatenInSlotId).toBe("slot-mon");
  });

  /**
   * The reason this is a link and not the same recipe planned twice: a leftover
   * must not put its ingredients on the shopping list a second time.
   */
  it("names the slots the shopping list must skip", () => {
    const skip = leftoverSlotIds(withLeftovers(), WEEK);

    expect(skip.has("slot-mon")).toBe(true);
    expect(skip.has("slot-sun")).toBe(false);
  });

  it("counts the portions the cooking slot has to produce for both days", () => {
    const state = withLeftovers();

    expect(portionsNeeded(state, { weekPlanId: WEEK, slotId: "slot-sun" })).toBe(5);
    expect(portionsNeeded(state, { weekPlanId: WEEK, slotId: "slot-mon" })).toBe(3);
  });
});

describe("recurring patterns (FR-606)", () => {
  function withPatterns(): FamilyState {
    const state = new FamilyState();
    put(state, EntityTypes.family, FAMILY, {
      name: "Müller",
      mealPatterns: [
        { key: "pizza", label: "Friday pizza", weekday: 5, mealType: "dinner", recipeId: "r-pizza" },
        { key: "veggie", label: "Meat-free Monday", weekday: 1, mealType: "dinner", tag: "vegetarian" },
      ],
    });
    return state;
  }

  it("reads what this family does on which day", () => {
    const patterns = mealPatterns(withPatterns(), FAMILY);

    expect(patterns).toHaveLength(2);
    expect(patterns[0]?.weekday).toBe(5);
  });

  it("finds the pattern for a date, by weekday and meal", () => {
    const patterns = mealPatterns(withPatterns(), FAMILY);

    // 2026-07-31 is a Friday; 2026-07-27 is a Monday.
    expect(patternFor(patterns, { date: "2026-07-31", mealType: "dinner" })?.key).toBe("pizza");
    expect(patternFor(patterns, { date: "2026-07-27", mealType: "dinner" })?.key).toBe("veggie");
    expect(patternFor(patterns, { date: "2026-07-29", mealType: "dinner" })).toBeUndefined();
  });

  /** A pattern is a preference, not an entry — it never fills the week itself. */
  it("does not match a meal type the family did not name", () => {
    const patterns = mealPatterns(withPatterns(), FAMILY);

    expect(patternFor(patterns, { date: "2026-07-31", mealType: "breakfast" })).toBeUndefined();
  });

  it("ignores a pattern with a nonsense weekday", () => {
    const state = new FamilyState();
    put(state, EntityTypes.family, FAMILY, {
      name: "Müller",
      mealPatterns: [{ key: "broken", weekday: 9, mealType: "dinner" }],
    });

    expect(mealPatterns(state, FAMILY)).toEqual([]);
  });
});

describe("reusing a past week (FR-607)", () => {
  function plannedWeek(): FamilyState {
    const state = new FamilyState();
    put(state, EntityTypes.mealSlot, "slot-mon", {
      weekPlanId: WEEK,
      date: "2026-07-27",
      mealType: "dinner",
      recipeId: "r-bolognese",
    });
    put(state, EntityTypes.mealSlot, "slot-wed", {
      weekPlanId: WEEK,
      date: "2026-07-29",
      mealType: "dinner",
      recipeId: "r-soup",
    });
    return state;
  }

  it("reads a week back as something that can be laid down again", () => {
    const template = weekAsTemplate(plannedWeek(), WEEK);

    expect(template.map((e) => e.date)).toEqual(["2026-07-27", "2026-07-29"]);
    expect(template[0]?.recipeId).toBe("r-bolognese");
  });

  /** Whole days, so a Monday stays a Monday — a week has a shape. */
  it("shifts onto another week without sliding the weekdays", () => {
    const shifted = shiftTemplate(weekAsTemplate(plannedWeek(), WEEK), {
      fromWeekStart: "2026-07-27",
      toWeekStart: "2026-08-03",
    });

    expect(shifted.map((e) => e.date)).toEqual(["2026-08-03", "2026-08-05"]);
    for (const entry of shifted) {
      expect(new Date(entry.date + "T00:00:00Z").getUTCDay()).toBeGreaterThanOrEqual(1);
    }
  });

  it("leaves the template alone when the dates make no sense", () => {
    const template = weekAsTemplate(plannedWeek(), WEEK);

    expect(shiftTemplate(template, { fromWeekStart: "nonsense", toWeekStart: "2026-08-03" })).toEqual(
      template,
    );
  });
});

describe("the children's say (FR-612)", () => {
  it("records whose day it is, and what they chose", () => {
    const state = new FamilyState();
    put(state, EntityTypes.weekPlan, WEEK, {
      startDate: "2026-07-27",
      wishDays: [{ personId: "person-kid", date: "2026-07-29", recipeId: "r-pancakes" }],
      vetoedRecipeIds: ["r-liver"],
    });

    expect(wishDays(state, WEEK)).toHaveLength(1);
    expect(wishDays(state, WEEK)[0]?.personId).toBe("person-kid");
    expect(vetoedRecipeIds(state, WEEK)).toEqual(["r-liver"]);
  });

  it("is empty rather than broken on a week nobody has touched", () => {
    expect(wishDays(new FamilyState(), WEEK)).toEqual([]);
    expect(vetoedRecipeIds(new FamilyState(), WEEK)).toEqual([]);
  });
});

describe("the shape of the week (FR-614)", () => {
  function week(): FamilyState {
    const state = new FamilyState();
    put(state, EntityTypes.recipe, "r-pasta", { title: "Pasta", tags: ["quick", "vegetarian"] });
    put(state, EntityTypes.recipe, "r-soup", { title: "Soup", tags: ["vegetarian"] });
    for (const [id, date, recipeId] of [
      ["slot-1", "2026-07-27", "r-pasta"],
      ["slot-2", "2026-07-28", "r-pasta"],
      ["slot-3", "2026-07-29", "r-soup"],
    ] as const) {
      put(state, EntityTypes.mealSlot, id, {
        weekPlanId: WEEK,
        date,
        mealType: "dinner",
        recipeId,
      });
    }
    return state;
  }

  it("counts what is planned and what repeats", () => {
    const balance = weekBalance(week(), WEEK);

    expect(balance.plannedMeals).toBe(3);
    expect(balance.distinctRecipes).toBe(2);
    expect(balance.repeats).toEqual([{ recipeId: "r-pasta", count: 2 }]);
  });

  it("counts by tag, most frequent first", () => {
    expect(weekBalance(week(), WEEK).byTag).toEqual([
      { tag: "vegetarian", count: 3 },
      { tag: "quick", count: 2 },
    ]);
  });

  /**
   * The restraint, pinned. SPEC §1.3 rules out nutrition judgement, so the
   * result carries counts and nothing that could be read as a verdict.
   */
  it("offers no score, target or rating of any kind", () => {
    const balance = weekBalance(week(), WEEK);

    expect(Object.keys(balance).sort()).toEqual([
      "byTag",
      "distinctRecipes",
      "plannedMeals",
      "repeats",
    ]);
  });

  it("is empty, not broken, for a week with nothing in it", () => {
    const balance = weekBalance(new FamilyState(), WEEK);

    expect(balance.plannedMeals).toBe(0);
    expect(balance.repeats).toEqual([]);
  });
});

describe("week dates", () => {
  it("gives the seven days from a start", () => {
    expect(weekDates("2026-07-27")).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });

  it("is empty for a date it cannot read", () => {
    expect(weekDates("not-a-date")).toEqual([]);
  });
});
