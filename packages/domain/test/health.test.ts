/**
 * The health facts that are not schedules (SPEC §9).
 *
 * The bias throughout is stated in the module and asserted here: where a missed
 * warning and a false one are not equally bad, the code does not pretend they
 * are. An allergy match is generous on purpose.
 */
import { describe, expect, it } from "vitest";
import {
  EntityTypes,
  FamilyState,
  VACCINATION_SCHEDULE,
  WELL_CHILD_CHECKS,
  actionablePreventive,
  allergensOf,
  applyOperation,
  emptyEntity,
  HlcClock,
  makeOperation,
  matchingAllergens,
  measurementSeries,
  newId,
  preventiveSchedule,
  readAllergies,
  recipesWithout,
  warnAboutMeal,
  type Value,
} from "../src/index.js";

const FAMILY = "fam-1";
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;
const clock = new HlcClock({ deviceId: "device-a", now: () => 1_700_000_000_000 });

function put(
  state: FamilyState,
  type: string,
  id: string,
  fields: Record<string, Value>,
): FamilyState {
  const entity = applyOperation(
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
  ).entity;
  state.put(entity);
  return state;
}

function familyWithAllergies(): FamilyState {
  const state = new FamilyState();
  put(state, EntityTypes.person, "person-kid", {
    name: "Ben",
    bornOn: "2020-01-15",
    allergies: [
      { allergen: "nut", severity: "anaphylaxis", note: "EpiPen in the blue bag" },
      { allergen: "lactose", severity: "intolerance", note: "" },
    ],
  });
  put(state, EntityTypes.person, "person-mum", { name: "Anna", bornOn: "1988-03-02" });
  return state;
}

describe("allergies (FR-908)", () => {
  it("reads what a person cannot eat, with the severity a carer needs", () => {
    const allergies = readAllergies(familyWithAllergies(), "person-kid");

    expect(allergies).toHaveLength(2);
    expect(allergies[0]?.severity).toBe("anaphylaxis");
    expect(allergies[0]?.note).toContain("EpiPen");
  });

  /**
   * The generosity is the feature. "nut" has to catch "hazelnuts", because a
   * warning about a safe dish costs a conversation and a missed one costs an
   * ambulance.
   */
  it("matches an allergen inside a longer ingredient name", () => {
    const allergies = readAllergies(familyWithAllergies(), "person-kid");

    expect(matchingAllergens(allergies, ["Hazelnuts", "Flour"])).toHaveLength(1);
    expect(matchingAllergens(allergies, ["HAZELNUT paste"])).toHaveLength(1);
    expect(matchingAllergens(allergies, ["Flour", "Water"])).toEqual([]);
  });

  it("warns only about the people actually eating", () => {
    const state = familyWithAllergies();

    const warned = warnAboutMeal(state, {
      eaterIds: ["person-kid", "person-mum"],
      ingredients: ["Hazelnuts", "Sugar"],
    });
    expect(warned).toHaveLength(1);
    expect(warned[0]?.personId).toBe("person-kid");

    // The same dish, without the child at the table, is not a warning.
    expect(
      warnAboutMeal(state, { eaterIds: ["person-mum"], ingredients: ["Hazelnuts"] }),
    ).toEqual([]);
  });

  it("collects the exclusion list a family already recorded", () => {
    expect(allergensOf(familyWithAllergies(), ["person-kid", "person-mum"])).toEqual([
      "lactose",
      "nut",
    ]);
  });
});

describe("exclusion search (FR-518)", () => {
  function withRecipes(): FamilyState {
    const state = familyWithAllergies();
    put(state, EntityTypes.recipe, "r-cake", {
      title: "Nut cake",
      ingredients: [{ name: "Hazelnuts" }, { name: "Flour" }],
    });
    put(state, EntityTypes.recipe, "r-soup", {
      title: "Onion soup",
      ingredients: [{ name: "Onion" }, { name: "Stock" }],
    });
    return state;
  }

  it("returns what is safe, not what is not", () => {
    expect(recipesWithout(withRecipes(), { exclude: ["nut"] })).toEqual(["r-soup"]);
  });

  it("couples to the family's own allergies without being told them twice", () => {
    const state = withRecipes();

    const safe = recipesWithout(state, { exclude: allergensOf(state, ["person-kid"]) });

    expect(safe).toEqual(["r-soup"]);
  });

  it("excludes nothing when asked to exclude nothing", () => {
    expect(recipesWithout(withRecipes(), { exclude: [] }).sort()).toEqual(["r-cake", "r-soup"]);
  });
});

describe("preventive care (FR-903, FR-904)", () => {
  const born = Date.parse("2020-01-15T00:00:00Z");

  it("knows the statutory windows for the well-child examinations", () => {
    expect(WELL_CHILD_CHECKS.map((c) => c.key)).toContain("U9");
    expect(WELL_CHILD_CHECKS.map((c) => c.key)).toContain("J1");
    for (const check of WELL_CHILD_CHECKS) {
      expect(check.toAgeMs).toBeGreaterThan(check.fromAgeMs);
    }
  });

  it("knows the childhood vaccination series", () => {
    expect(VACCINATION_SCHEDULE.map((c) => c.key)).toContain("mmr-1");
    for (const dose of VACCINATION_SCHEDULE) {
      expect(dose.toAgeMs).toBeGreaterThan(dose.fromAgeMs);
    }
  });

  it("places each entitlement against the child's age", () => {
    const state = familyWithAllergies();

    // Just over four years old: U8 is behind, U9 is still ahead.
    const items = preventiveSchedule(state, {
      personId: "person-kid",
      checks: WELL_CHILD_CHECKS,
      now: born + 49 * MONTH_MS,
    });

    expect(items.find((i) => i.key === "U3")?.state).toBe("missed");
    expect(items.find((i) => i.key === "U8")?.state).toBe("missed");
    expect(items.find((i) => i.key === "U9")?.state).toBe("upcoming");
  });

  /**
   * The whole point of the feature: being told *before* the window shuts, since
   * an appointment has to be booked and a reminder on the last day is not one.
   */
  it("flags a window that is about to close", () => {
    const state = familyWithAllergies();

    const items = preventiveSchedule(state, {
      personId: "person-kid",
      checks: WELL_CHILD_CHECKS,
      now: born + 63 * MONTH_MS,
      closingLeadMs: 45 * DAY_MS,
    });

    expect(items.find((i) => i.key === "U9")?.state).toBe("closing");
  });

  it("stops reporting an examination that was done", () => {
    const state = familyWithAllergies();
    put(state, EntityTypes.person, "person-done", {
      name: "Mia",
      bornOn: "2020-01-15",
      preventiveDone: [{ key: "U3" }],
    });

    const items = preventiveSchedule(state, {
      personId: "person-done",
      checks: WELL_CHILD_CHECKS,
      now: born + 49 * MONTH_MS,
    });

    expect(items.find((i) => i.key === "U3")?.state).toBe("done");
  });

  it("puts what needs acting on first, soonest deadline first", () => {
    const state = familyWithAllergies();

    const actionable = actionablePreventive(
      preventiveSchedule(state, {
        personId: "person-kid",
        checks: WELL_CHILD_CHECKS,
        now: born + 49 * MONTH_MS,
      }),
    );

    expect(actionable.every((i) => i.state !== "upcoming" && i.state !== "done")).toBe(true);
    for (let i = 1; i < actionable.length; i += 1) {
      expect(actionable[i]!.closesAt).toBeGreaterThanOrEqual(actionable[i - 1]!.closesAt);
    }
  });

  it("says nothing at all when the date of birth is unknown", () => {
    const state = new FamilyState();
    put(state, EntityTypes.person, "person-x", { name: "Unknown" });

    expect(
      preventiveSchedule(state, { personId: "person-x", checks: WELL_CHILD_CHECKS, now: born }),
    ).toEqual([]);
  });
});

describe("measurement series (FR-906)", () => {
  function withReadings(values: readonly (readonly [number, number])[]): FamilyState {
    const state = new FamilyState();
    for (const [at, value] of values) {
      put(state, EntityTypes.protocolInstance, `proto-fever@${String(at)}`, {
        state: "acknowledged",
        measuredAt: at,
        value,
      });
    }
    return state;
  }

  it("reads a course of measurements as a curve, in order", () => {
    const series = measurementSeries(withReadings([[300, 38.9], [100, 39.4], [200, 38.2]]), {
      protocolId: "proto-fever",
    });

    expect(series.points.map((p) => p.at)).toEqual([100, 200, 300]);
    expect(series.min).toBeCloseTo(38.2);
    expect(series.max).toBeCloseTo(39.4);
    expect(series.latest?.value).toBeCloseTo(38.9);
    expect(series.trend).toBe("rising");
  });

  it("reports falling and steady", () => {
    expect(measurementSeries(withReadings([[100, 39.4], [200, 38.2]]), { protocolId: "proto-fever" }).trend)
      .toBe("falling");
    expect(measurementSeries(withReadings([[100, 38.2], [200, 38.2]]), { protocolId: "proto-fever" }).trend)
      .toBe("steady");
  });

  /** One reading is a number, not a trend, and the type says so. */
  it("refuses to call a single reading a trend", () => {
    const series = measurementSeries(withReadings([[100, 39.4]]), { protocolId: "proto-fever" });

    expect(series.points).toHaveLength(1);
    expect(series.trend).toBe("unknown");
  });

  it("windows to the period asked about", () => {
    const series = measurementSeries(withReadings([[100, 39], [200, 38], [300, 37]]), {
      protocolId: "proto-fever",
      from: 150,
      to: 250,
    });

    expect(series.points.map((p) => p.at)).toEqual([200]);
  });

  it("is empty, not broken, when nothing was measured", () => {
    const series = measurementSeries(new FamilyState(), { protocolId: "proto-fever" });

    expect(series.points).toEqual([]);
    expect(series.latest).toBeUndefined();
    expect(series.trend).toBe("unknown");
  });
});
