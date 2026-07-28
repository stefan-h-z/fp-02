import { describe, expect, it } from "vitest";
import {
  EntityTypes,
  FamilyState,
  buildIcs,
  fingerprintLocal,
  linkFor,
  makeOperation,
  newId,
  parseIcs,
  parseIcsDate,
  reconcile,
  type ExternalLink,
  type IcsEvent,
  type LocalEventShape,
  type Operation,
  type Value,
} from "@fam/domain";

const NOW = Date.parse("2026-07-28T08:00:00Z");
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

function ics(...vevents: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Family", ...vevents, "END:VCALENDAR"].join("\r\n");
}

describe("reading an external calendar (FR-208)", () => {
  it("reads a plain timed event", () => {
    const result = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:evt-1@example.com",
        "SUMMARY:Dentist",
        "LOCATION:Main Street 4",
        "DTSTART:20260803T090000Z",
        "DTEND:20260803T100000Z",
        "END:VEVENT",
      ),
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      uid: "evt-1@example.com",
      summary: "Dentist",
      location: "Main Street 4",
      startsAt: Date.parse("2026-08-03T09:00:00Z"),
      endsAt: Date.parse("2026-08-03T10:00:00Z"),
      allDay: false,
    });
  });

  it("recognises an all-day event from a date-valued start", () => {
    const result = parseIcs(
      ics("BEGIN:VEVENT", "UID:holiday", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20260803", "END:VEVENT"),
    );

    expect(result.events[0]?.allDay).toBe(true);
  });

  it("reads a weekly series onto its named days", () => {
    const result = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:swim",
        "SUMMARY:Swimming",
        "DTSTART:20260804T160000Z",
        "DTEND:20260804T170000Z",
        "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261231T000000Z",
        "END:VEVENT",
      ),
    );

    expect(result.events[0]?.recurrence).toBe("weekly");
    expect(result.events[0]?.weekdays).toEqual([2, 4]);
    expect(result.events[0]?.recurrenceUntil).toBe(Date.parse("2026-12-31T00:00:00Z"));
  });

  it("refuses to guess at a recurrence it cannot represent", () => {
    const result = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:fortnightly",
        "DTSTART:20260804T160000Z",
        "RRULE:FREQ=WEEKLY;INTERVAL=2",
        "END:VEVENT",
      ),
    );

    // Better a single event than a series on the wrong dates.
    expect(result.events[0]?.recurrence).toBe("none");
  });

  it("collects the excluded instances of a series", () => {
    const result = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:swim",
        "DTSTART:20260804T160000Z",
        "RRULE:FREQ=WEEKLY",
        "EXDATE:20260811T160000Z",
        "EXDATE:20260818T160000Z",
        "END:VEVENT",
      ),
    );

    expect(result.events[0]?.exceptions).toEqual([
      Date.parse("2026-08-11T16:00:00Z"),
      Date.parse("2026-08-18T16:00:00Z"),
    ]);
  });

  it("joins a folded line back together", () => {
    const source = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:long",
      "SUMMARY:A very long summary that the calendar",
      "  wrapped onto a second line",
      "DTSTART:20260803T090000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    expect(parseIcs(source).events[0]?.summary).toBe(
      "A very long summary that the calendar wrapped onto a second line",
    );
  });

  it("unescapes the text encoding rather than showing the backslashes", () => {
    const result = parseIcs(
      ics("BEGIN:VEVENT", "UID:x", "DTSTART:20260803T090000Z", "SUMMARY:Cake\\, candles\\nand presents", "END:VEVENT"),
    );

    expect(result.events[0]?.summary).toBe("Cake, candles\nand presents");
  });

  it("skips an unreadable event instead of losing the whole import", () => {
    const result = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:broken",
        "DTSTART:not-a-date",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:fine",
        "DTSTART:20260803T090000Z",
        "END:VEVENT",
      ),
    );

    expect(result.events.map((e) => e.uid)).toEqual(["fine"]);
    expect(result.skipped[0]).toMatchObject({ uid: "broken" });
  });

  it("gives a duration-only event an end", () => {
    const result = parseIcs(
      ics("BEGIN:VEVENT", "UID:x", "DTSTART:20260803T090000Z", "DURATION:PT1H30M", "END:VEVENT"),
    );

    expect(result.events[0]?.endsAt).toBe(Date.parse("2026-08-03T10:30:00Z"));
  });

  it("carries a cancellation through", () => {
    const result = parseIcs(
      ics("BEGIN:VEVENT", "UID:x", "DTSTART:20260803T090000Z", "STATUS:CANCELLED", "END:VEVENT"),
    );

    expect(result.events[0]?.cancelled).toBe(true);
  });

  it("reads the calendar's own name", () => {
    expect(parseIcs(ics()).calendarName).toBe("Family");
  });

  it("rejects a malformed date rather than inventing one", () => {
    expect(parseIcsDate("20260830")).toBe(Date.UTC(2026, 7, 30));
    expect(parseIcsDate("nonsense")).toBeUndefined();
  });
});

describe("publishing the family's calendar (FR-208)", () => {
  it("writes an event that can be read back unchanged", () => {
    const state = new FamilyState();
    state.apply(
      op("entity.create", EntityTypes.event, "e-1", {
        title: "Dentist",
        startsAt: Date.parse("2026-08-03T09:00:00Z"),
        endsAt: Date.parse("2026-08-03T10:00:00Z"),
        location: "Main Street 4",
      }),
    );

    const feed = buildIcs(state.all(EntityTypes.event), { calendarName: "Family", now: NOW });
    const reparsed = parseIcs(feed);

    expect(reparsed.events[0]).toMatchObject({
      uid: "e-1",
      summary: "Dentist",
      startsAt: Date.parse("2026-08-03T09:00:00Z"),
      endsAt: Date.parse("2026-08-03T10:00:00Z"),
    });
  });

  it("uses the app's own id as the UID, so a round trip is recognised", () => {
    const state = new FamilyState();
    state.apply(op("entity.create", EntityTypes.event, "e-42", { title: "X", startsAt: NOW, endsAt: NOW }));

    expect(buildIcs(state.all(EntityTypes.event), { calendarName: "F", now: NOW })).toContain("UID:e-42");
  });

  it("writes a weekly series with its days", () => {
    const state = new FamilyState();
    state.apply(
      op("entity.create", EntityTypes.event, "e-swim", {
        title: "Swimming",
        startsAt: NOW,
        endsAt: NOW,
        recurrence: "weekly",
        weekdays: [2, 4],
      }),
    );

    expect(buildIcs(state.all(EntityTypes.event), { calendarName: "F", now: NOW })).toContain(
      "RRULE:FREQ=WEEKLY;BYDAY=TU,TH",
    );
  });

  it("escapes text that would otherwise break the format", () => {
    const state = new FamilyState();
    state.apply(
      op("entity.create", EntityTypes.event, "e-1", { title: "Cake, candles", startsAt: NOW, endsAt: NOW }),
    );

    const feed = buildIcs(state.all(EntityTypes.event), { calendarName: "F", now: NOW });

    expect(feed).toContain("SUMMARY:Cake\\, candles");
    expect(parseIcs(feed).events[0]?.summary).toBe("Cake, candles");
  });

  it("leaves deleted events out of the feed", () => {
    const state = new FamilyState();
    state.apply(op("entity.create", EntityTypes.event, "e-1", { title: "X", startsAt: NOW, endsAt: NOW }));
    state.apply(op("entity.delete", EntityTypes.event, "e-1", {}));

    expect(parseIcs(buildIcs(state.allIncludingDeleted(EntityTypes.event), { calendarName: "F", now: NOW })).events).toHaveLength(0);
  });
});

describe("two-way reconciliation (FR-207)", () => {
  const local = (overrides: Partial<LocalEventShape> = {}): LocalEventShape => ({
    id: "e-1",
    title: "Dentist",
    startsAt: Date.parse("2026-08-03T09:00:00Z"),
    endsAt: Date.parse("2026-08-03T10:00:00Z"),
    allDay: false,
    cancelled: false,
    updatedAt: NOW,
    ...overrides,
  });

  const remote = (overrides: Partial<IcsEvent> = {}): IcsEvent => ({
    uid: "ext-1",
    summary: "Dentist",
    description: "",
    location: "",
    startsAt: Date.parse("2026-08-03T09:00:00Z"),
    endsAt: Date.parse("2026-08-03T10:00:00Z"),
    allDay: false,
    recurrence: "none",
    weekdays: [],
    recurrenceUntil: undefined,
    exceptions: [],
    cancelled: false,
    sequence: 0,
    lastModified: undefined,
    ...overrides,
  });

  function linked(localEvent: LocalEventShape): ExternalLink {
    return linkFor(localEvent, "acc-1", "ext-1", NOW);
  }

  it("imports an event the family has never seen", () => {
    const plan = reconcile({
      accountId: "acc-1",
      direction: "two-way",
      local: [],
      remote: [remote()],
      links: [],
      now: NOW,
    });

    expect(plan.importCreate.map((e) => e.uid)).toEqual(["ext-1"]);
  });

  it("exports a family event the external calendar does not have", () => {
    const plan = reconcile({
      accountId: "acc-1",
      direction: "two-way",
      local: [local()],
      remote: [],
      links: [],
      now: NOW,
    });

    expect(plan.exportCreate.map((e) => e.id)).toEqual(["e-1"]);
  });

  it("exports nothing at all on a read-only mapping", () => {
    const plan = reconcile({
      accountId: "acc-1",
      direction: "read-only",
      local: [local()],
      remote: [],
      links: [],
      now: NOW,
    });

    expect(plan.exportCreate).toHaveLength(0);
  });

  it("does nothing when neither side moved", () => {
    const event = local();
    const plan = reconcile({
      accountId: "acc-1",
      direction: "two-way",
      local: [event],
      remote: [remote()],
      links: [linked(event)],
      now: NOW,
    });

    expect(plan.importUpdate).toHaveLength(0);
    expect(plan.exportUpdate).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("recognises its own change coming back and does not write it out again", () => {
    const event = local();
    const link = linked(event);
    // The provider echoes the app's write back as a notification.
    const plan = reconcile({
      accountId: "acc-1",
      direction: "two-way",
      local: [event],
      remote: [remote({ summary: event.title })],
      links: [link],
      now: NOW,
    });

    expect(plan.exportUpdate).toHaveLength(0);
    expect(plan.importUpdate).toHaveLength(0);
  });

  it("imports a genuine external move without creating a duplicate (SC-010)", () => {
    const event = local();
    const moved = remote({ startsAt: Date.parse("2026-08-03T14:00:00Z") });

    const plan = reconcile({
      accountId: "acc-1",
      direction: "two-way",
      local: [event],
      remote: [moved],
      links: [linked(event)],
      now: NOW,
    });

    expect(plan.importCreate).toHaveLength(0);
    expect(plan.importUpdate).toEqual([{ localEventId: "e-1", event: moved }]);
  });

  it("exports a family move", () => {
    const moved = local({ startsAt: Date.parse("2026-08-03T14:00:00Z") });
    const link = { ...linked(local()), fingerprint: fingerprintLocal(local()) };

    const plan = reconcile({
      accountId: "acc-1",
      direction: "two-way",
      local: [moved],
      remote: [remote()],
      links: [link],
      now: NOW,
    });

    expect(plan.exportUpdate).toEqual([{ externalUid: "ext-1", event: moved }]);
  });

  it("asks a person when both sides moved the same appointment", () => {
    const movedLocally = local({ startsAt: Date.parse("2026-08-03T14:00:00Z") });
    const movedRemotely = remote({ startsAt: Date.parse("2026-08-03T11:00:00Z") });
    const link = { ...linked(local()), fingerprint: fingerprintLocal(local()) };

    const plan = reconcile({
      accountId: "acc-1",
      direction: "two-way",
      local: [movedLocally],
      remote: [movedRemotely],
      links: [link],
      now: NOW,
    });

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.importUpdate).toHaveLength(0);
    expect(plan.exportUpdate).toHaveLength(0);
  });

  it("treats both sides moving to the same time as agreement, not a conflict", () => {
    const sameTime = Date.parse("2026-08-03T14:00:00Z");
    const link = { ...linked(local()), fingerprint: fingerprintLocal(local()) };

    const plan = reconcile({
      accountId: "acc-1",
      direction: "two-way",
      local: [local({ startsAt: sameTime, endsAt: sameTime + 3_600_000 })],
      remote: [remote({ startsAt: sameTime, endsAt: sameTime + 3_600_000 })],
      links: [link],
      now: NOW,
    });

    expect(plan.conflicts).toHaveLength(0);
    expect(plan.echoesIgnored).toBe(1);
  });

  it("removes the local copy when the external calendar drops the event", () => {
    const event = local();
    const plan = reconcile({
      accountId: "acc-1",
      direction: "two-way",
      local: [event],
      remote: [],
      links: [linked(event)],
      now: NOW,
    });

    expect(plan.importDelete).toEqual(["e-1"]);
  });

  it("ignores fields the external calendar never sees, so they cannot look like changes", () => {
    // The family assigned who fetches; that is invisible to Google and must not
    // trigger an export.
    const event = local({ updatedAt: NOW + 10_000 });
    const plan = reconcile({
      accountId: "acc-1",
      direction: "two-way",
      local: [event],
      remote: [remote()],
      links: [linked(event)],
      now: NOW,
    });

    expect(plan.exportUpdate).toHaveLength(0);
  });
});
