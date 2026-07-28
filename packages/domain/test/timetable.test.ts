/**
 * A/B weeks, time zones and carpool rotation (SPEC §2, §8).
 *
 * The time-zone tests use real zones and real clock-change dates rather than
 * fixed offsets, because a fixed offset per zone is exactly the bug the module
 * exists to avoid.
 */
import { describe, expect, it } from "vitest";
import {
  EntityTypes,
  FamilyState,
  applyOperation,
  crossesOffsetChange,
  driverOn,
  emptyEntity,
  HlcClock,
  lessonsOn,
  makeOperation,
  newId,
  readCarpools,
  readTimetable,
  startOfDayInZone,
  upcomingTurns,
  weekLabel,
  zoneOffsetMinutes,
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

describe("A/B weeks (FR-802)", () => {
  // 2026-08-03 is a Monday.
  const ANCHOR = "2026-08-03";

  it("labels the anchor week A and the next one B", () => {
    expect(weekLabel(ANCHOR, "2026-08-03")).toBe("a");
    expect(weekLabel(ANCHOR, "2026-08-10")).toBe("b");
    expect(weekLabel(ANCHOR, "2026-08-17")).toBe("a");
  });

  /** A timetable that flipped mid-week would be worse than none. */
  it("holds the label steady across a whole week", () => {
    for (const date of ["2026-08-03", "2026-08-05", "2026-08-07", "2026-08-09"]) {
      expect(weekLabel(ANCHOR, date)).toBe("a");
    }
  });

  it("alternates backwards as well as forwards", () => {
    expect(weekLabel(ANCHOR, "2026-07-27")).toBe("b");
    expect(weekLabel(ANCHOR, "2026-07-20")).toBe("a");
  });

  it("says nothing when it cannot read the dates", () => {
    expect(weekLabel("nonsense", "2026-08-03")).toBeUndefined();
  });

  it("resolves a child's lessons for the day, A/B applied", () => {
    const state = new FamilyState();
    put(state, EntityTypes.person, "person-kid", {
      name: "Ben",
      timetable: [
        { subject: "Maths", weekday: 1, startsAtMinute: 480, endsAtMinute: 525 },
        { subject: "Swimming", weekday: 1, startsAtMinute: 600, endsAtMinute: 660, week: "a" },
        { subject: "Art", weekday: 1, startsAtMinute: 600, endsAtMinute: 660, week: "b" },
      ],
    });
    const entries = readTimetable(state, "person-kid");

    const weekA = lessonsOn(entries, { date: "2026-08-03", anchorDate: ANCHOR });
    const weekB = lessonsOn(entries, { date: "2026-08-10", anchorDate: ANCHOR });

    expect(weekA.map((e) => e.subject)).toEqual(["Maths", "Swimming"]);
    expect(weekB.map((e) => e.subject)).toEqual(["Maths", "Art"]);
  });

  it("has nothing to say about a day with no lessons", () => {
    const state = new FamilyState();
    put(state, EntityTypes.person, "person-kid", {
      name: "Ben",
      timetable: [{ subject: "Maths", weekday: 1, startsAtMinute: 480, endsAtMinute: 525 }],
    });

    expect(
      lessonsOn(readTimetable(state, "person-kid"), { date: "2026-08-08", anchorDate: ANCHOR }),
    ).toEqual([]);
  });
});

describe("time zones (FR-220)", () => {
  it("reads the offset from the platform's own database, not a table", () => {
    // Berlin is UTC+1 in winter and UTC+2 in summer.
    expect(zoneOffsetMinutes("Europe/Berlin", Date.parse("2026-01-15T12:00:00Z"))).toBe(60);
    expect(zoneOffsetMinutes("Europe/Berlin", Date.parse("2026-07-15T12:00:00Z"))).toBe(120);
  });

  it("survives a zone it has never heard of rather than losing the appointment", () => {
    expect(zoneOffsetMinutes("Mars/Olympus", Date.parse("2026-07-15T12:00:00Z"))).toBe(0);
  });

  /**
   * The case where "two hours" and "10:00 to 12:00" stop meaning the same
   * thing: a flight west, or a meeting booked across the spring change.
   */
  it("notices an event that crosses a change of offset", () => {
    expect(
      crossesOffsetChange({
        startsAt: Date.parse("2026-07-15T08:00:00Z"),
        endsAt: Date.parse("2026-07-15T12:00:00Z"),
        startZone: "Europe/Berlin",
        endZone: "America/New_York",
      }),
    ).toBe(true);

    expect(
      crossesOffsetChange({
        startsAt: Date.parse("2026-07-15T08:00:00Z"),
        endsAt: Date.parse("2026-07-15T12:00:00Z"),
        startZone: "Europe/Berlin",
      }),
    ).toBe(false);
  });

  /**
   * The bug this prevents: an all-day event kept as UTC midnight shows up on
   * the previous evening for anybody west of Greenwich, so "the trip is on the
   * 3rd" becomes the 2nd on their phone.
   */
  it("puts the start of a local day where that day actually starts", () => {
    const berlin = startOfDayInZone("2026-08-03", "Europe/Berlin");
    const newYork = startOfDayInZone("2026-08-03", "America/New_York");

    expect(new Date(berlin).toISOString()).toBe("2026-08-02T22:00:00.000Z");
    expect(new Date(newYork).toISOString()).toBe("2026-08-03T04:00:00.000Z");
    expect(newYork).toBeGreaterThan(berlin);
  });

  it("is NaN for a date it cannot read, rather than silently now", () => {
    expect(Number.isNaN(startOfDayInZone("nonsense", "Europe/Berlin"))).toBe(true);
  });
});

describe("carpool rotation (FR-214, FR-814)", () => {
  function withPool(): FamilyState {
    const state = new FamilyState();
    put(state, EntityTypes.family, FAMILY, {
      name: "Müller",
      carpools: [
        {
          id: "pool-school",
          label: "School run",
          driverIds: ["person-mum", "person-neighbour", "person-dad"],
          anchorDate: "2026-08-03",
          weekdays: [1, 3, 5],
        },
      ],
    });
    return state;
  }

  it("reads the pool with its rota and its days", () => {
    const pools = readCarpools(withPool(), FAMILY);

    expect(pools).toHaveLength(1);
    expect(pools[0]?.driverIds).toHaveLength(3);
    expect(pools[0]?.weekdays).toEqual([1, 3, 5]);
  });

  /** By week, not by trip: a rota that changes driver mid-week is unmemorable. */
  it("keeps one driver for a whole week and rotates on Monday", () => {
    const pool = readCarpools(withPool(), FAMILY)[0]!;

    expect(driverOn(pool, "2026-08-03")).toBe("person-mum");
    expect(driverOn(pool, "2026-08-07")).toBe("person-mum");
    expect(driverOn(pool, "2026-08-10")).toBe("person-neighbour");
    expect(driverOn(pool, "2026-08-17")).toBe("person-dad");
    expect(driverOn(pool, "2026-08-24")).toBe("person-mum");
  });

  /** Naming a driver on a day the pool does not run would be worse than silence. */
  it("names nobody on a day the pool does not run", () => {
    const pool = readCarpools(withPool(), FAMILY)[0]!;

    expect(driverOn(pool, "2026-08-04")).toBeUndefined();
    expect(driverOn(pool, "2026-08-08")).toBeUndefined();
  });

  it("lists the days a person drives next, so a reminder has a date", () => {
    const pool = readCarpools(withPool(), FAMILY)[0]!;

    expect(upcomingTurns(pool, { personId: "person-mum", from: "2026-08-03", days: 7 })).toEqual([
      "2026-08-03",
      "2026-08-05",
      "2026-08-07",
    ]);
  });

  it("ignores a pool with nobody in it", () => {
    const state = new FamilyState();
    put(state, EntityTypes.family, FAMILY, {
      name: "Müller",
      carpools: [{ id: "empty", driverIds: [], anchorDate: "2026-08-03", weekdays: [1] }],
    });

    expect(readCarpools(state, FAMILY)).toEqual([]);
  });
});
