/**
 * The calendar screen's four views (FR-206).
 *
 * The domain tests already prove the projections are right. What this file owes
 * is that the screen actually shows them: that switching views changes what is
 * on the page, that a month cell renders its overflow count rather than
 * swallowing the fourth event, and that a person with nothing on still has a
 * lane. Those are the three ways this screen could be wrong while every domain
 * test stayed green.
 */
import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { EntityTypes } from "@fam/domain";
import { CalendarScreen } from "../src/screens/CalendarScreen.js";
import { mount, openFamily, NOW, type Harness } from "./harness.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** NOW is 2026-07-28T08:00Z, a Tuesday. */
async function withWeek(): Promise<Harness> {
  const harness = await openFamily();
  await harness.mutate((b) => {
    b.create(EntityTypes.person, "person-mum", { name: "Mum" });
    b.create(EntityTypes.person, "person-dad", { name: "Dad" });

    b.create(EntityTypes.event, "e-dentist", {
      title: "Dentist",
      startsAt: NOW + 2 * HOUR_MS,
      endsAt: NOW + 3 * HOUR_MS,
    });
    b.create(EntityTypes.event, "e-swim", {
      title: "Swimming",
      startsAt: NOW + 3 * DAY_MS,
      endsAt: NOW + 3 * DAY_MS + HOUR_MS,
    });
  });
  await harness.mutate((b) => {
    b.setAdd(EntityTypes.event, "e-dentist", "participants", "person-mum");
  });
  return harness;
}

describe("the calendar screen (FR-206)", () => {
  it("opens on the month and shows the day today falls on", async () => {
    const harness = await withWeek();
    mount(harness, <CalendarScreen personIds={["person-mum", "person-dad"]} />);

    expect(screen.getByTestId("calendar-month")).toBeTruthy();
    expect(screen.getByTestId("calendar-month-day-2026-07-28")).toBeTruthy();
  });

  it("switches to the agenda and lists what is coming", async () => {
    const harness = await withWeek();
    mount(harness, <CalendarScreen personIds={[]} />);

    fireEvent.press(screen.getByTestId("calendar-tab-agenda"));

    expect(screen.getByTestId("calendar-agenda")).toBeTruthy();
    expect(screen.getByText("Dentist")).toBeTruthy();
    expect(screen.getByText("Swimming")).toBeTruthy();
  });

  it("narrows to one day, which is what a day view is for", async () => {
    const harness = await withWeek();
    mount(harness, <CalendarScreen personIds={[]} />);

    fireEvent.press(screen.getByTestId("calendar-tab-day"));

    expect(screen.getByText("Dentist")).toBeTruthy();
    expect(screen.queryByText("Swimming")).toBeNull();
  });

  /**
   * The screen-level half of the overflow contract: the domain returns a count,
   * and this asserts the count reaches the page. A cell that showed two of four
   * and said nothing is how a family misses the fourth thing.
   */
  it("says how many more a day holds than the cell can show", async () => {
    const harness = await openFamily();
    await harness.mutate((b) => {
      for (let index = 0; index < 4; index += 1) {
        b.create(EntityTypes.event, `e-${index}`, {
          title: `Thing ${index}`,
          startsAt: NOW + index * HOUR_MS,
          endsAt: NOW + (index + 1) * HOUR_MS,
        });
      }
    });

    mount(harness, <CalendarScreen personIds={[]} />);

    // Matched by the count rather than the sentence: the harness runs in German
    // and this test is about the number reaching the page, not about wording.
    expect(screen.getByText(/\+2/)).toBeTruthy();
  });

  /** A missing lane reads as "no data"; "nothing booked" is the other answer. */
  it("keeps a lane for a person with nothing on", async () => {
    const harness = await withWeek();
    mount(harness, <CalendarScreen personIds={["person-mum", "person-dad"]} />);

    fireEvent.press(screen.getByTestId("calendar-tab-timeline"));

    // Dad's lane is present and says nothing is booked; Mum's carries the event
    // she is actually on. Both halves matter: an empty lane must be an empty
    // lane, not an absent one.
    expect(screen.getByTestId("calendar-lane-empty-person-dad")).toBeTruthy();
    expect(screen.getByTestId("calendar-lane-person-mum")).toBeTruthy();
    expect(screen.queryByTestId("calendar-lane-empty-person-mum")).toBeNull();
    expect(screen.getByText("Dentist")).toBeTruthy();
  });

  it("moves the window when the family pages forward", async () => {
    const harness = await withWeek();
    mount(harness, <CalendarScreen personIds={[]} initialTab="day" />);

    expect(screen.getByText("Dentist")).toBeTruthy();

    fireEvent.press(screen.getByTestId("calendar-next"));

    expect(screen.queryByText("Dentist")).toBeNull();
  });

  it("says so plainly when a day is empty", async () => {
    const harness = await openFamily();
    mount(harness, <CalendarScreen personIds={[]} initialTab="day" />);

    expect(screen.getByTestId("calendar-day-empty")).toBeTruthy();
  });
});
