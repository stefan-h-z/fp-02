/**
 * The five calendar views (FR-206).
 *
 * Most of these test density rather than data: what a month cell does when four
 * things fall on one day, what an agenda does with an empty Tuesday, what a
 * timeline does with a person who has nothing on.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  EntityTypes,
  FamilyState,
  makeOperation,
  MONTH_CELL_LIMIT,
  newId,
  selectAgenda,
  selectMonth,
  selectTimeline,
  startOfWeekUtc,
  viewWindow,
  type Operation,
  type Value,
} from "../src/index.js";

const DAY_MS = 86_400_000;
const HOUR = 3_600_000;
/** A Wednesday, so the grid's leading days are unambiguous. */
const ANCHOR = Date.parse("2026-08-12T00:00:00Z");

let wall = 1000;
let state: FamilyState;

function op(
  kind: Operation["kind"],
  entityId: string,
  payload: Record<string, Value>,
): Operation {
  wall += 1;
  return makeOperation({
    opId: newId(),
    familyId: "fam-1",
    deviceId: "device-a",
    actorId: null,
    entityType: EntityTypes.event,
    entityId,
    kind,
    payload,
    hlc: { wall, counter: 0, deviceId: "device-a" },
  });
}

/**
 * Participants are an observed-remove set rather than a field, so they arrive
 * as their own operations — seeding them as a field would test a shape the sync
 * engine never produces.
 */
function seed(id: string, fields: Record<string, Value>, participants: readonly string[] = []): void {
  state.apply(op("entity.create", id, { title: "Event", ...fields }));
  for (const personId of participants) {
    state.apply(op("set.add", id, { field: "participants", member: personId }));
  }
}

beforeEach(() => {
  state = new FamilyState();
  wall = 1000;
});

describe("view windows", () => {
  it("starts the week on Monday, as the rest of the app does", () => {
    // 2026-08-12 is a Wednesday.
    expect(new Date(startOfWeekUtc(ANCHOR)).toISOString().slice(0, 10)).toBe("2026-08-10");
  });

  it("covers a month's grid rather than the month", () => {
    const window = viewWindow("month", ANCHOR);

    // August 2026 starts on a Saturday, so the grid opens on 27 July.
    expect(new Date(window.from).toISOString().slice(0, 10)).toBe("2026-07-27");
    expect(Math.round((window.to + 1 - window.from) / DAY_MS)).toBe(42);
  });

  it("gives the agenda thirty days unless told otherwise", () => {
    expect(Math.round((viewWindow("agenda", ANCHOR).to + 1 - viewWindow("agenda", ANCHOR).from) / DAY_MS)).toBe(30);
    expect(
      Math.round(
        (viewWindow("agenda", ANCHOR, { agendaDays: 7 }).to + 1 -
          viewWindow("agenda", ANCHOR, { agendaDays: 7 }).from) /
          DAY_MS,
      ),
    ).toBe(7);
  });
});

describe("month view (FR-206)", () => {
  /** A grid that changes height jumps under the thumb as you page through it. */
  it("is always six rows of seven", () => {
    const view = selectMonth(state, { anchor: ANCHOR, now: ANCHOR });

    expect(view.weeks).toHaveLength(6);
    expect(view.weeks.every((week) => week.length === 7)).toBe(true);
  });

  it("marks which days belong to the month and which only fill the grid", () => {
    const view = selectMonth(state, { anchor: ANCHOR, now: ANCHOR });
    const first = view.weeks[0]?.[0];

    expect(new Date(first?.date ?? 0).toISOString().slice(0, 10)).toBe("2026-07-27");
    expect(first?.inMonth).toBe(false);
    expect(view.weeks[1]?.[0]?.inMonth).toBe(true);
  });

  it("marks today", () => {
    const view = selectMonth(state, { anchor: ANCHOR, now: ANCHOR + 10 * HOUR });
    const today = view.weeks.flat().filter((cell) => cell.isToday);

    expect(today).toHaveLength(1);
    expect(new Date(today[0]?.date ?? 0).toISOString().slice(0, 10)).toBe("2026-08-12");
  });

  /**
   * A month cell cannot show four events. The alternative to counting is
   * clipping silently, which is how a family misses the fourth thing.
   */
  it("counts what will not fit rather than dropping it", () => {
    for (let index = 0; index < 4; index += 1) {
      seed(`e-${index}`, {
        startsAt: ANCHOR + (9 + index) * HOUR,
        endsAt: ANCHOR + (10 + index) * HOUR,
      });
    }

    const cell = selectMonth(state, { anchor: ANCHOR, now: ANCHOR })
      .weeks.flat()
      .find((candidate) => candidate.date === ANCHOR);

    expect(cell?.occurrences).toHaveLength(MONTH_CELL_LIMIT);
    expect(cell?.overflow).toBe(2);
  });

  it("has no overflow when everything fits", () => {
    seed("e-1", { startsAt: ANCHOR + 9 * HOUR, endsAt: ANCHOR + 10 * HOUR });

    const cell = selectMonth(state, { anchor: ANCHOR, now: ANCHOR })
      .weeks.flat()
      .find((candidate) => candidate.date === ANCHOR);

    expect(cell?.occurrences).toHaveLength(1);
    expect(cell?.overflow).toBe(0);
  });

  /** FR-204: a holiday is on every day of it, not only the day it started. */
  it("puts a multi-day event on every day it touches", () => {
    seed("e-holiday", {
      startsAt: ANCHOR + 9 * HOUR,
      endsAt: ANCHOR + 2 * DAY_MS + 17 * HOUR,
    });

    const days = selectMonth(state, { anchor: ANCHOR, now: ANCHOR })
      .weeks.flat()
      .filter((cell) => cell.occurrences.some((o) => o.eventId === "e-holiday"))
      .map((cell) => new Date(cell.date).toISOString().slice(0, 10));

    expect(days).toEqual(["2026-08-12", "2026-08-13", "2026-08-14"]);
  });
});

describe("agenda view (FR-206)", () => {
  /**
   * The whole point of the view. Scrolling past eleven blank Tuesdays to find
   * the next thing is the failure an agenda exists to avoid.
   */
  it("leaves out the days with nothing on them", () => {
    seed("e-1", { startsAt: ANCHOR + 9 * HOUR, endsAt: ANCHOR + 10 * HOUR });
    seed("e-2", { startsAt: ANCHOR + 5 * DAY_MS + 9 * HOUR, endsAt: ANCHOR + 5 * DAY_MS + 10 * HOUR });

    const view = selectAgenda(state, { anchor: ANCHOR });

    expect(view.days.map((day) => new Date(day.date).toISOString().slice(0, 10))).toEqual([
      "2026-08-12",
      "2026-08-17",
    ]);
  });

  it("is empty rather than a month of blank days when nothing is booked", () => {
    expect(selectAgenda(state, { anchor: ANCHOR }).days).toEqual([]);
  });

  it("orders a day's events by when they start", () => {
    seed("e-late", { startsAt: ANCHOR + 17 * HOUR, endsAt: ANCHOR + 18 * HOUR });
    seed("e-early", { startsAt: ANCHOR + 8 * HOUR, endsAt: ANCHOR + 9 * HOUR });

    expect(
      selectAgenda(state, { anchor: ANCHOR }).days[0]?.occurrences.map((o) => o.eventId),
    ).toEqual(["e-early", "e-late"]);
  });

  it("stops at the horizon it was given", () => {
    seed("e-far", { startsAt: ANCHOR + 20 * DAY_MS, endsAt: ANCHOR + 20 * DAY_MS + HOUR });

    expect(selectAgenda(state, { anchor: ANCHOR, days: 7 }).days).toEqual([]);
    expect(selectAgenda(state, { anchor: ANCHOR, days: 30 }).days).toHaveLength(1);
  });
});

/**
 * FR-203, asserted on the projections rather than on a screen.
 *
 * The masking used to live in the views: the day and agenda lists checked
 * `private` before printing a title and the month cell did not, so a therapy
 * appointment was legible in the grid. Anything reading these projections — a
 * print, an export, a screen not written yet — got the title too.
 */
describe("private events (FR-203)", () => {
  beforeEach(() => {
    seed("e-therapy", {
      title: "Therapy",
      startsAt: ANCHOR + 11 * HOUR,
      endsAt: ANCHOR + 12 * HOUR,
      private: true,
    });
  });

  it("keeps the title out of the month grid", () => {
    const cell = selectMonth(state, { anchor: ANCHOR, now: ANCHOR })
      .weeks.flat()
      .find((candidate) => candidate.date === ANCHOR);

    expect(cell?.occurrences).toHaveLength(1);
    expect(cell?.occurrences[0]?.title).toBe("");
  });

  it("keeps the title out of the agenda", () => {
    const day = selectAgenda(state, { anchor: ANCHOR }).days[0];

    expect(day?.occurrences[0]?.title).toBe("");
  });

  /** The time is still taken — busy/free is the point, not invisibility. */
  it("still shows that the time is taken", () => {
    const day = selectAgenda(state, { anchor: ANCHOR }).days[0];

    expect(day?.occurrences[0]?.startsAt).toBe(ANCHOR + 11 * HOUR);
    expect(day?.occurrences[0]?.endsAt).toBe(ANCHOR + 12 * HOUR);
  });
});

describe("per-person timeline (FR-206)", () => {
  it("gives each person a lane over the same window", () => {
    seed("e-mum", {
      startsAt: ANCHOR + 9 * HOUR,
      endsAt: ANCHOR + 10 * HOUR,
    }, ["person-mum"]);
    seed("e-kid", {
      startsAt: ANCHOR + 16 * HOUR,
      endsAt: ANCHOR + 17 * HOUR,
    }, ["person-kid"]);

    const view = selectTimeline(state, {
      anchor: ANCHOR,
      personIds: ["person-mum", "person-kid"],
    });

    expect(view.lanes.map((lane) => lane.personId)).toEqual(["person-mum", "person-kid"]);
    expect(view.lanes[0]?.entries).toHaveLength(1);
    expect(view.lanes[1]?.entries[0]?.occurrence.eventId).toBe("e-kid");
  });

  /**
   * A missing lane reads as "no data". "Nothing booked" is the opposite answer,
   * and it is the one this view exists to give.
   */
  it("keeps an empty lane for a person with nothing on", () => {
    const view = selectTimeline(state, { anchor: ANCHOR, personIds: ["person-dad"] });

    expect(view.lanes).toHaveLength(1);
    expect(view.lanes[0]?.entries).toEqual([]);
  });

  it("places an event by minutes from the start of the window", () => {
    seed("e-mum", {
      startsAt: ANCHOR + 9 * HOUR,
      endsAt: ANCHOR + 10 * HOUR + 30 * 60_000,
    }, ["person-mum"]);

    const entry = selectTimeline(state, { anchor: ANCHOR, personIds: ["person-mum"] }).lanes[0]
      ?.entries[0];

    expect(entry?.offsetMinutes).toBe(540);
    expect(entry?.durationMinutes).toBe(90);
  });

  /** FR-203: the lane must show the time is taken without saying by what. */
  it("shows a private event as a block with no title", () => {
    seed("e-therapy", {
      title: "Therapy",
      startsAt: ANCHOR + 11 * HOUR,
      endsAt: ANCHOR + 12 * HOUR,
      private: true,
    }, ["person-mum"]);

    const entry = selectTimeline(state, { anchor: ANCHOR, personIds: ["person-mum"] }).lanes[0]
      ?.entries[0];

    expect(entry?.occurrence.title).toBe("");
    expect(entry?.durationMinutes).toBe(60);
  });

  it("leaves a cancelled instance out of the lane", () => {
    seed("e-off", {
      startsAt: ANCHOR + 9 * HOUR,
      endsAt: ANCHOR + 10 * HOUR,
      cancelled: true,
    }, ["person-mum"]);

    expect(selectTimeline(state, { anchor: ANCHOR, personIds: ["person-mum"] }).lanes[0]?.entries).toEqual(
      [],
    );
  });

  it("can span a week instead of a day", () => {
    const view = selectTimeline(state, {
      anchor: ANCHOR,
      personIds: ["person-mum"],
      kind: "week",
    });

    expect(new Date(view.from).toISOString().slice(0, 10)).toBe("2026-08-10");
    expect(Math.round((view.to + 1 - view.from) / DAY_MS)).toBe(7);
  });
});
