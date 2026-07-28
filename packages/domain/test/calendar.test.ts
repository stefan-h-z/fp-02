import { beforeEach, describe, expect, it } from "vitest";
import {
  DAY_MS,
  EntityTypes,
  FamilyState,
  detectCareGaps,
  detectConflicts,
  expandEvent,
  findFreeSlots,
  leadTasksFor,
  makeOperation,
  newId,
  occurrenceId,
  occurrencesInWindow,
  readEvent,
  type Operation,
  type Value,
} from "@fam/domain";

const HOUR = 60 * 60 * 1000;
/** A Saturday, so weekday expansion is unambiguous in the tests. */
const BASE = Date.parse("2026-08-01T00:00:00Z");
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

let state: FamilyState;

function seedEvent(id: string, fields: Record<string, Value>): void {
  state.apply(op("entity.create", EntityTypes.event, id, { title: "Event", ...fields }));
}

beforeEach(() => {
  state = new FamilyState();
});

describe("recurrence expansion (FR-205)", () => {
  it("expands a weekly series onto the named weekdays", () => {
    seedEvent("e-swim", {
      startsAt: BASE + 16 * HOUR,
      endsAt: BASE + 17 * HOUR,
      recurrence: "weekly",
      weekdays: ["2", "4"],
    });

    const days = expandEvent(readEvent(state, "e-swim")!, state, { from: BASE, to: BASE + 14 * DAY_MS }).map((o) =>
      new Date(o.startsAt).getUTCDay(),
    );

    expect(days).toEqual([2, 4, 2, 4]);
  });

  /**
   * A weekly event whose weekday list nobody filled in used to fall through to
   * the daily step, quietly turning one swimming lesson a week into seven.
   */
  it("means seven days when a weekly series names no weekday", () => {
    seedEvent("e-club", {
      startsAt: BASE + 16 * HOUR,
      endsAt: BASE + 17 * HOUR,
      recurrence: "weekly",
    });

    const dates = expandEvent(readEvent(state, "e-club")!, state, {
      from: BASE,
      to: BASE + 22 * DAY_MS,
    }).map((o) => new Date(o.startsAt).toISOString().slice(0, 10));

    expect(dates).toEqual(["2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22"]);
  });

  /** A/B school weeks, alternating custody, the every-other-Saturday club. */
  it("expands a fortnightly series every fourteen days", () => {
    seedEvent("e-scouts", {
      startsAt: BASE + 16 * HOUR,
      endsAt: BASE + 17 * HOUR,
      recurrence: "fortnightly",
    });

    const dates = expandEvent(readEvent(state, "e-scouts")!, state, {
      from: BASE,
      to: BASE + 43 * DAY_MS,
    }).map((o) => new Date(o.startsAt).toISOString().slice(0, 10));

    expect(dates).toEqual(["2026-08-01", "2026-08-15", "2026-08-29", "2026-09-12"]);
  });

  it("keeps a monthly series at the end of short months instead of drifting", () => {
    seedEvent("e-rent", {
      startsAt: Date.parse("2026-01-31T09:00:00Z"),
      endsAt: Date.parse("2026-01-31T10:00:00Z"),
      recurrence: "monthly",
    });

    const dates = expandEvent(readEvent(state, "e-rent")!, state, {
      from: Date.parse("2026-01-01T00:00:00Z"),
      to: Date.parse("2026-04-01T00:00:00Z"),
    }).map((o) => new Date(o.startsAt).toISOString().slice(0, 10));

    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("stops at the series end date", () => {
    seedEvent("e-course", {
      startsAt: BASE + 10 * HOUR,
      endsAt: BASE + 11 * HOUR,
      recurrence: "daily",
      recurrenceUntil: BASE + 3 * DAY_MS,
    });

    expect(expandEvent(readEvent(state, "e-course")!, state, { from: BASE, to: BASE + 30 * DAY_MS })).toHaveLength(4);
  });

  it("moves a single instance without rewriting the series", () => {
    seedEvent("e-swim", { startsAt: BASE + 16 * HOUR, endsAt: BASE + 17 * HOUR, recurrence: "daily" });
    const second = BASE + DAY_MS + 16 * HOUR;
    state.apply(
      op("entity.create", "eventException", occurrenceId("e-swim", second), { startsAt: second + 2 * HOUR }),
    );

    const occurrences = expandEvent(readEvent(state, "e-swim")!, state, { from: BASE, to: BASE + 3 * DAY_MS });

    expect(occurrences[1]?.startsAt).toBe(second + 2 * HOUR);
    expect(occurrences[2]?.startsAt).toBe(BASE + 2 * DAY_MS + 16 * HOUR);
  });

  it("cancels a single instance without removing the rest", () => {
    seedEvent("e-swim", { startsAt: BASE + 16 * HOUR, endsAt: BASE + 17 * HOUR, recurrence: "daily" });
    state.apply(
      op("entity.create", "eventException", occurrenceId("e-swim", BASE + 16 * HOUR), { cancelled: true }),
    );

    const occurrences = expandEvent(readEvent(state, "e-swim")!, state, { from: BASE, to: BASE + 2 * DAY_MS });

    expect(occurrences[0]?.cancelled).toBe(true);
    expect(occurrences[1]?.cancelled).toBe(false);
  });
});

describe("conflict detection (FR-211)", () => {
  it("flags one parent expected in two places", () => {
    seedEvent("e-football", { startsAt: BASE + 16 * HOUR, endsAt: BASE + 17 * HOUR, bringOwnerId: "p-dad" });
    seedEvent("e-ballet", { startsAt: BASE + 16 * HOUR + 30 * 60_000, endsAt: BASE + 18 * HOUR, bringOwnerId: "p-dad" });

    const conflicts = detectConflicts(occurrencesInWindow(state, { from: BASE, to: BASE + DAY_MS }));

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.personId).toBe("p-dad");
  });

  it("does not flag two events that different parents cover", () => {
    seedEvent("e-football", { startsAt: BASE + 16 * HOUR, endsAt: BASE + 17 * HOUR, bringOwnerId: "p-dad" });
    seedEvent("e-ballet", { startsAt: BASE + 16 * HOUR, endsAt: BASE + 17 * HOUR, bringOwnerId: "p-mum" });

    expect(detectConflicts(occurrencesInWindow(state, { from: BASE, to: BASE + DAY_MS }))).toHaveLength(0);
  });

  it("counts travel time, catching the clash that happens in the car (FR-210)", () => {
    seedEvent("e-football", {
      startsAt: BASE + 15 * HOUR,
      endsAt: BASE + 16 * HOUR,
      bringOwnerId: "p-dad",
      travelAfterMinutes: 45,
    });
    seedEvent("e-ballet", {
      startsAt: BASE + 16 * HOUR + 15 * 60_000,
      endsAt: BASE + 17 * HOUR,
      fetchOwnerId: "p-dad",
      travelBeforeMinutes: 30,
    });

    expect(detectConflicts(occurrencesInWindow(state, { from: BASE, to: BASE + DAY_MS }))).toHaveLength(1);
  });

  it("ignores a cancelled instance", () => {
    seedEvent("e-a", { startsAt: BASE + 16 * HOUR, endsAt: BASE + 17 * HOUR, bringOwnerId: "p-dad" });
    seedEvent("e-b", { startsAt: BASE + 16 * HOUR, endsAt: BASE + 17 * HOUR, bringOwnerId: "p-dad", cancelled: true });

    expect(detectConflicts(occurrencesInWindow(state, { from: BASE, to: BASE + DAY_MS }))).toHaveLength(0);
  });
});

describe("care gaps (FR-212)", () => {
  beforeEach(() => {
    state.apply(
      op("entity.create", "careClosure", "closure-1", {
        date: BASE + 30 * DAY_MS,
        label: "Daycare closure day",
        childIds: ["p-kid"],
      }),
    );
  });

  it("surfaces an uncovered closure day weeks ahead", () => {
    const gaps = detectCareGaps(state, { from: BASE, to: BASE + 60 * DAY_MS });

    expect(gaps).toEqual([{ date: BASE + 30 * DAY_MS, childId: "p-kid", reason: "Daycare closure day" }]);
  });

  it("says nothing once somebody has taken the day", () => {
    state.apply(
      op("entity.create", "careCoverage", "cover-1", { date: BASE + 30 * DAY_MS, childIds: ["p-kid"] }),
    );

    expect(detectCareGaps(state, { from: BASE, to: BASE + 60 * DAY_MS })).toHaveLength(0);
  });

  it("reports per child, so one covered child does not hide the other", () => {
    state.apply(
      op("entity.setFields", "careClosure", "closure-1", { childIds: ["p-kid", "p-teen"] }),
    );
    state.apply(op("entity.create", "careCoverage", "cover-1", { date: BASE + 30 * DAY_MS, childIds: ["p-kid"] }));

    expect(detectCareGaps(state, { from: BASE, to: BASE + 60 * DAY_MS }).map((g) => g.childId)).toEqual(["p-teen"]);
  });
});

describe("free slots (FR-215)", () => {
  it("finds a window long enough for everyone involved", () => {
    seedEvent("e-work", { startsAt: BASE + 9 * HOUR, endsAt: BASE + 12 * HOUR, bringOwnerId: "p-mum" });
    seedEvent("e-club", { startsAt: BASE + 15 * HOUR, endsAt: BASE + 16 * HOUR, bringOwnerId: "p-mum" });

    const slots = findFreeSlots(
      occurrencesInWindow(state, { from: BASE, to: BASE + DAY_MS }),
      ["p-mum"],
      { from: BASE + 8 * HOUR, to: BASE + 20 * HOUR },
      2 * HOUR,
    );

    expect(slots).toEqual([
      { from: BASE + 12 * HOUR, to: BASE + 15 * HOUR },
      { from: BASE + 16 * HOUR, to: BASE + 20 * HOUR },
    ]);
  });

  it("returns nothing when the day is genuinely full", () => {
    seedEvent("e-all-day", { startsAt: BASE + 8 * HOUR, endsAt: BASE + 20 * HOUR, bringOwnerId: "p-mum" });

    const slots = findFreeSlots(
      occurrencesInWindow(state, { from: BASE, to: BASE + DAY_MS }),
      ["p-mum"],
      { from: BASE + 8 * HOUR, to: BASE + 20 * HOUR },
      HOUR,
    );

    expect(slots).toHaveLength(0);
  });

  it("ignores events that do not involve the people being asked about", () => {
    seedEvent("e-dad", { startsAt: BASE + 9 * HOUR, endsAt: BASE + 18 * HOUR, bringOwnerId: "p-dad" });

    const slots = findFreeSlots(
      occurrencesInWindow(state, { from: BASE, to: BASE + DAY_MS }),
      ["p-mum"],
      { from: BASE + 8 * HOUR, to: BASE + 20 * HOUR },
      HOUR,
    );

    expect(slots).toEqual([{ from: BASE + 8 * HOUR, to: BASE + 20 * HOUR }]);
  });
});

describe("lead-time preparation (FR-213)", () => {
  it("moves with the event it hangs off", () => {
    seedEvent("e-party", { startsAt: BASE + 10 * DAY_MS, endsAt: BASE + 10 * DAY_MS + 2 * HOUR });
    const [occurrence] = occurrencesInWindow(state, { from: BASE, to: BASE + 30 * DAY_MS });

    const tasks = leadTasksFor(occurrence!, [{ title: "Buy a present", leadDays: 3 }]);

    expect(tasks[0]?.dueAt).toBe(BASE + 7 * DAY_MS);
  });
});
