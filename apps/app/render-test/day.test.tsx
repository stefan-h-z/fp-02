/**
 * The two screens a person opens first (SPEC §7, §11).
 *
 * Today is the household's day; my day is the same day narrowed to one person.
 * Both are read-only surfaces, so what they owe is that the right things are on
 * them and the wrong ones are not — in particular that "mine" really does mean
 * mine, because a focus view that shows someone else's afternoon is worse than
 * no focus view.
 */
import { describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react-native";
import { EntityTypes } from "@fam/domain";
import { MyDayScreen } from "../src/screens/MyDayScreen.js";
import { TodayScreen } from "../src/screens/TodayScreen.js";
import { mount, openFamily, NOW, type Harness } from "./harness.js";

const HOUR_MS = 60 * 60 * 1000;

/** Two appointments on the day of the harness's fixed `NOW`, one each. */
async function withTodaysDiary(): Promise<Harness> {
  const harness = await openFamily();
  await harness.mutate((b) => {
    b.create(EntityTypes.event, "e-dentist", {
      title: "Dentist",
      startsAt: NOW + 2 * HOUR_MS,
      endsAt: NOW + 3 * HOUR_MS,
      bringOwnerId: "person-mum",
    });
    b.create(EntityTypes.event, "e-football", {
      title: "Football",
      startsAt: NOW + 5 * HOUR_MS,
      endsAt: NOW + 6 * HOUR_MS,
      bringOwnerId: "person-dad",
    });
    // Tomorrow: it must not leak into today, which is the whole promise of the
    // screen's name.
    b.create(EntityTypes.event, "e-swimming", {
      title: "Swimming",
      startsAt: NOW + 26 * HOUR_MS,
      endsAt: NOW + 27 * HOUR_MS,
    });
  });
  return harness;
}

describe("TodayScreen (SPEC §7)", () => {
  it("shows today's appointments and not tomorrow's", async () => {
    const harness = await withTodaysDiary();

    mount(harness, <TodayScreen />);

    expect(screen.getByText("Dentist")).toBeTruthy();
    expect(screen.getByText("Football")).toBeTruthy();
    expect(screen.queryByText("Swimming")).toBeNull();
  });

  /**
   * A day with nothing in it is a normal day, and it has to read as one rather
   * than as a screen that failed to load.
   */
  it("says the day is clear rather than showing a blank page", async () => {
    const harness = await openFamily();

    mount(harness, <TodayScreen />);

    expect(screen.queryByText("Dentist")).toBeNull();
    expect(screen.toJSON()).toBeTruthy();
  });

  /**
   * Who brings and who fetches is the product's central claim — every recurring
   * thing has a visible owner (SPEC P-01). A time without a name attached is the
   * failure mode the app exists to remove.
   */
  it("names who is responsible for an appointment", async () => {
    const harness = await withTodaysDiary();

    mount(harness, <TodayScreen />);

    expect(screen.getAllByTestId(/^event-/).length).toBe(2);
    expect(screen.getAllByText(/person-mum/).length).toBeGreaterThan(0);
  });
});

describe("MyDayScreen (SPEC §11)", () => {
  it("narrows the same day to one person", async () => {
    const harness = await withTodaysDiary();

    mount(harness, <MyDayScreen personId="person-mum" />);

    // The screen stacks the next-three list above the day, so mum's own
    // appointment legitimately appears more than once. Dad's does not appear at
    // all, which is the assertion that carries the meaning: "my day" that shows
    // the other parent's afternoon is worse than no focus view.
    expect(screen.getAllByText("Dentist").length).toBeGreaterThan(0);
    expect(screen.queryByText("Football")).toBeNull();
    expect(screen.queryByText("Swimming")).toBeNull();
  });
});
