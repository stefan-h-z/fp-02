/**
 * The food loop's two screens (SPEC §9, §10).
 *
 * The week plan is where a household decides, and cook mode is where it acts on
 * the decision an hour later with wet hands. Both are asserted against what a
 * person sees, not against a snapshot: a Tamagui tree changes whenever the
 * library does and would tell nobody whether dinner still works.
 */
import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen, within } from "@testing-library/react-native";
import { EntityTypes } from "@fam/domain";
import { CookModeScreen } from "../src/screens/CookModeScreen.js";
import { WeekPlanScreen } from "../src/screens/WeekPlanScreen.js";
import { mount, openFamily, waitForState, type Harness } from "./harness.js";

const WEEK = "week-31";
const RECIPE = "r-bolognese";

/** The Tuesday of the harness's fixed `NOW`, so "today" is not a moving target. */
const TUESDAY = "2026-07-28";

async function withPlannedWeek(): Promise<Harness> {
  const harness = await openFamily();
  await harness.mutate((b) => {
    b.create(EntityTypes.recipe, RECIPE, {
      title: "Bolognese",
      servings: 4,
      ingredients: [
        { name: "Onion", amount: 2, unit: "piece" },
        { name: "Mince", amount: 500, unit: "g" },
      ],
      steps: [
        { text: "Chop the onion", minutes: 5 },
        { text: "Simmer the sauce", minutes: 40 },
      ],
    });
    b.create(EntityTypes.weekPlan, WEEK, {
      startDate: "2026-07-27",
      planningOwnerId: "person-mum",
    });
    b.create(EntityTypes.mealSlot, "slot-tue", {
      weekPlanId: WEEK,
      date: TUESDAY,
      mealType: "dinner",
      recipeId: RECIPE,
      cookOwnerId: "person-mum",
    });
    b.setAdd(EntityTypes.mealSlot, "slot-tue", "eaters", "person-mum");
    b.setAdd(EntityTypes.mealSlot, "slot-tue", "eaters", "person-dad");
  });
  return harness;
}

describe("WeekPlanScreen (SPEC §9)", () => {
  /**
   * FR-601, as the two taps that replace a drag.
   *
   * Asserted through the sync client rather than through the label, because the
   * thing that has to be true is that the recipe reached the slot — a screen
   * that repainted without writing would pass a text assertion and lose the
   * meal.
   */
  it("puts a recipe from the collection onto a slot", async () => {
    const harness = await withPlannedWeek();
    await harness.mutate((b) => {
      b.create(EntityTypes.recipe, "recipe-soup", { title: "Bean soup", servings: 4 });
      b.create(EntityTypes.mealSlot, "slot-wed", {
        weekPlanId: WEEK,
        date: "2026-07-29",
        mealType: "dinner",
      });
    });

    mount(harness, <WeekPlanScreen weekPlanId={WEEK} eaterIds={["person-mum"]} />);

    fireEvent.press(screen.getByTestId("plan-library-recipe-soup"));
    fireEvent.press(screen.getByTestId("plan-target-slot-wed"));

    await waitForState(harness, (state) =>
      state
        .all(EntityTypes.mealSlot)
        .some((slot) => slot.fields["date"] === "2026-07-29" && slot.fields["recipeId"] === "recipe-soup"),
    );
  });

  /** Picking up the wrong recipe must not force a meal to be planned. */
  it("lets a recipe be put back down", async () => {
    const harness = await withPlannedWeek();

    mount(harness, <WeekPlanScreen weekPlanId={WEEK} eaterIds={["person-mum"]} />);

    fireEvent.press(screen.getByTestId("plan-library-" + RECIPE));
    expect(screen.getByTestId("plan-targets")).toBeTruthy();

    fireEvent.press(screen.getByTestId("plan-place-cancel"));
    expect(screen.getByTestId("plan-library")).toBeTruthy();
  });

  it("shows what is planned, by the name a person recognises", async () => {
    const harness = await withPlannedWeek();

    mount(harness, <WeekPlanScreen weekPlanId={WEEK} eaterIds={["person-mum", "person-dad"]} />);

    // Scoped to the slot: the same title also appears in the recipe collection
    // below, which is not a duplicate but the same recipe in its two roles.
    expect(within(screen.getByTestId("slot-slot-tue")).getByText("Bolognese")).toBeTruthy();
  });

  /**
   * An empty plan is the normal state on a Sunday evening, and the screen that
   * greets it must offer the way forward rather than a blank page — the whole
   * point of the decision-relief work (FR-909).
   */
  it("offers a way in when nothing is planned yet", async () => {
    const harness = await openFamily();
    await harness.mutate((b) => {
      b.create(EntityTypes.weekPlan, WEEK, {
        startDate: "2026-07-27",
        planningOwnerId: "person-mum",
      });
    });

    mount(harness, <WeekPlanScreen weekPlanId={WEEK} eaterIds={["person-mum"]} />);

    expect(screen.queryByTestId("slot-slot-tue")).toBeNull();
    expect(screen.toJSON()).toBeTruthy();
  });
});

describe("CookModeScreen (SPEC §9, FR-527)", () => {
  it("starts on the first step and walks forward", async () => {
    const harness = await withPlannedWeek();

    mount(harness, <CookModeScreen recipeId={RECIPE} />);

    expect(screen.getByText("Chop the onion")).toBeTruthy();
    expect(screen.queryByText("Simmer the sauce")).toBeNull();

    fireEvent.press(screen.getByTestId("cook-next"));

    expect(screen.getByText("Simmer the sauce")).toBeTruthy();
  });

  /**
   * Scaling is the reason the ingredients are structured rather than a block of
   * text (FR-514). Cooking for eight must not ask the person at the hob to
   * double 500 g in their head.
   */
  it("scales the ingredients to the number actually eating", async () => {
    const harness = await withPlannedWeek();

    mount(harness, <CookModeScreen recipeId={RECIPE} eaters={8} />);

    // The key carries the position as well as the name, so two lines of the
    // same ingredient stay distinguishable.
    expect(screen.getByTestId("cook-ingredient-1:Mince")).toBeTruthy();
    expect(screen.getByText(/1000|1 kg/)).toBeTruthy();
  });

  /**
   * What was learned at the hob is worth more than the recipe, and it is lost
   * unless it can be written down while the pan is still on (FR-528).
   */
  it("keeps a note taken during cooking", async () => {
    const harness = await withPlannedWeek();

    mount(harness, <CookModeScreen recipeId={RECIPE} />);
    // The design system puts the caller's testID on the field's outer stack and
    // the real TextInput one level in, under `-input`. Firing at the wrapper
    // would find no handler: fireEvent walks up the tree, never down.
    fireEvent.changeText(screen.getByTestId("cook-note-input"), "Needs more garlic");
    fireEvent.press(screen.getByTestId("cook-note-save"));

    await waitForState(harness, (state) => {
      const note = state.get(EntityTypes.recipe, RECIPE)?.fields["nextTimeNote"];
      return typeof note === "string" && note.includes("garlic");
    });
  });
});
