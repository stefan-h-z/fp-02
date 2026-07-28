/**
 * Suggestion and bulk editing (SPEC §13), plus objection (FR-1416).
 *
 * The suggestion tests are mostly about *not* suggesting, because that is where
 * this feature earns or loses a family's trust: a wrong guess after two
 * occurrences teaches them to ignore the right guess after five.
 */
import { describe, expect, it } from "vitest";
import {
  activeObjections,
  applyOperation,
  bulkPayload,
  describeBulkPlan,
  emptyEntity,
  EntityTypes,
  FamilyState,
  HlcClock,
  makeOperation,
  mayProcess,
  MIN_OBSERVATIONS,
  newId,
  OBJECTABLE_PROCESSINGS,
  planBulkChange,
  readObjections,
  suggestRecurrences,
  type Value,
} from "../src/index.js";

const FAMILY = "fam-1";
const NOW = Date.parse("2026-03-01T00:00:00Z");
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

function withEvents(dates: readonly string[], title = "Swimming", extra: Record<string, Value> = {}): FamilyState {
  const state = new FamilyState();
  put(state, EntityTypes.family, "fam-1", { name: "Müller" });
  dates.forEach((date, index) => {
    put(state, EntityTypes.event, `ev-${index}`, { title, startsAt: date, ...extra });
  });
  return state;
}

describe("recurrence suggestions (FR-1108)", () => {
  it("notices a weekly rhythm and says when the next one would be", () => {
    const state = withEvents([
      "2026-02-03T16:00:00Z",
      "2026-02-10T16:00:00Z",
      "2026-02-17T16:00:00Z",
    ]);

    const [suggestion] = suggestRecurrences(state, { now: NOW });

    expect(suggestion?.title).toBe("Swimming");
    expect(suggestion?.kind).toBe("weekly");
    expect(suggestion?.observations).toBe(3);
    expect(new Date(suggestion?.nextAt ?? 0).toISOString()).toBe("2026-02-24T16:00:00.000Z");
    // Tuesday.
    expect(suggestion?.weekday).toBe(2);
  });

  /**
   * Two of anything is a coincidence. A family that gets "shall I make this
   * weekly?" after the second swimming lesson learns that the app guesses badly,
   * and after that they stop reading the good suggestions too.
   */
  it("says nothing after two occurrences", () => {
    const state = withEvents(["2026-02-03T16:00:00Z", "2026-02-10T16:00:00Z"]);

    expect(suggestRecurrences(state, { now: NOW })).toEqual([]);
    expect(MIN_OBSERVATIONS).toBe(3);
  });

  it("does not call three scattered dates a rhythm", () => {
    const state = withEvents([
      "2026-02-03T16:00:00Z",
      "2026-02-10T16:00:00Z",
      "2026-02-26T16:00:00Z",
    ]);

    expect(suggestRecurrences(state, { now: NOW })).toEqual([]);
  });

  it("recognises fortnightly and monthly too", () => {
    const fortnight = withEvents([
      "2026-01-06T09:00:00Z",
      "2026-01-20T09:00:00Z",
      "2026-02-03T09:00:00Z",
    ]);
    const monthly = withEvents([
      "2025-12-05T09:00:00Z",
      "2026-01-04T09:00:00Z",
      "2026-02-03T09:00:00Z",
    ]);

    expect(suggestRecurrences(fortnight, { now: NOW })[0]?.kind).toBe("fortnightly");
    expect(suggestRecurrences(monthly, { now: NOW })[0]?.kind).toBe("monthly");
  });

  it("has nothing to suggest about an event that already repeats", () => {
    const state = withEvents(
      ["2026-02-03T16:00:00Z", "2026-02-10T16:00:00Z", "2026-02-17T16:00:00Z"],
      "Swimming",
      { recurrence: "FREQ=WEEKLY" },
    );

    expect(suggestRecurrences(state, { now: NOW })).toEqual([]);
  });

  it("looks only at what already happened, not at what is booked ahead", () => {
    const state = withEvents([
      "2026-02-17T16:00:00Z",
      "2026-03-10T16:00:00Z",
      "2026-03-17T16:00:00Z",
    ]);

    expect(suggestRecurrences(state, { now: NOW })).toEqual([]);
  });

  /** A dismissal that does not stick is the same question asked again next week. */
  it("stops asking once somebody has said no", () => {
    const state = withEvents([
      "2026-02-03T16:00:00Z",
      "2026-02-10T16:00:00Z",
      "2026-02-17T16:00:00Z",
    ]);
    put(state, EntityTypes.family, "fam-1", {
      name: "Müller",
      dismissedRecurrences: ["Swimming"],
    });

    expect(suggestRecurrences(state, { now: NOW })).toEqual([]);
  });

  it("says nothing at all when the family switched learning off", () => {
    const state = withEvents([
      "2026-02-03T16:00:00Z",
      "2026-02-10T16:00:00Z",
      "2026-02-17T16:00:00Z",
    ]);
    put(state, EntityTypes.family, "fam-1", { name: "Müller", learningEnabled: false });

    expect(suggestRecurrences(state, { now: NOW })).toEqual([]);
  });

  it("puts the rhythm it is surest about first", () => {
    const state = withEvents([
      "2026-01-06T09:00:00Z",
      "2026-01-13T09:00:00Z",
      "2026-01-20T09:00:00Z",
      "2026-01-27T09:00:00Z",
    ]);
    put(state, EntityTypes.event, "ev-x1", { title: "Choir", startsAt: "2026-02-02T18:00:00Z" });
    put(state, EntityTypes.event, "ev-x2", { title: "Choir", startsAt: "2026-02-09T18:00:00Z" });
    put(state, EntityTypes.event, "ev-x3", { title: "Choir", startsAt: "2026-02-16T18:00:00Z" });

    expect(suggestRecurrences(state, { now: NOW }).map((s) => s.title)).toEqual([
      "Swimming",
      "Choir",
    ]);
  });
});

describe("bulk editing (FR-1111)", () => {
  function tasks(): FamilyState {
    const state = new FamilyState();
    put(state, EntityTypes.task, "t-1", { title: "Bins" });
    put(state, EntityTypes.task, "t-2", { title: "Laundry", completedAt: "2026-02-01T08:00:00Z" });
    put(state, EntityTypes.shoppingItem, "i-1", { name: "Onion", origin: "plan" });
    put(state, EntityTypes.shoppingItem, "i-2", { name: "Milk" });
    return state;
  }

  it("plans a change across many at once", () => {
    const plan = planBulkChange(tasks(), {
      entityType: EntityTypes.task,
      ids: ["t-1", "t-2"],
      change: { kind: "assign", personId: "person-dad" },
    });

    expect(plan.targets).toEqual(["t-1", "t-2"]);
    expect(plan.skipped).toEqual([]);
  });

  /**
   * The point of the whole module. A bulk edit that silently skipped four of
   * twenty is worse than one that changed nothing: the person walks away
   * believing all twenty are done.
   */
  it("names everything it will not touch, and why", () => {
    const plan = planBulkChange(tasks(), {
      entityType: EntityTypes.task,
      ids: ["t-1", "t-2", "t-missing"],
      change: { kind: "complete" },
    });

    expect(plan.targets).toEqual(["t-1"]);
    expect(plan.skipped).toEqual([
      { id: "t-2", reason: "already done" },
      { id: "t-missing", reason: "not here" },
    ]);
  });

  it("refuses to bulk-delete a line the plan is asking for", () => {
    const plan = planBulkChange(tasks(), {
      entityType: EntityTypes.shoppingItem,
      ids: ["i-1", "i-2"],
      change: { kind: "delete" },
    });

    expect(plan.targets).toEqual(["i-2"]);
    expect(plan.skipped).toEqual([{ id: "i-1", reason: "comes from the plan" }]);
  });

  it("turns each change into the fields it writes", () => {
    const at = "2026-03-01T10:00:00Z";

    expect(bulkPayload({ kind: "assign", personId: "p" }, at)).toEqual({ assigneeId: "p" });
    expect(bulkPayload({ kind: "move", startsAt: at }, at)).toEqual({ startsAt: at });
    expect(bulkPayload({ kind: "retag", tags: ["x"] }, at)).toEqual({ tags: ["x"] });
    expect(bulkPayload({ kind: "complete" }, at)).toEqual({ completedAt: at });
    expect(bulkPayload({ kind: "delete" }, at)).toEqual({ deletedAt: at });
  });

  /** The count shown and the count changed come from the same object. */
  it("describes itself for the confirmation", () => {
    const plan = planBulkChange(tasks(), {
      entityType: EntityTypes.task,
      ids: ["t-1", "t-2"],
      change: { kind: "complete" },
    });

    expect(describeBulkPlan(plan)).toBe("Complete 1, skip 1");
    expect(
      describeBulkPlan({ entityType: "task", change: { kind: "delete" }, targets: ["a"], skipped: [] }),
    ).toBe("Delete 1");
  });
});

describe("objection (FR-1416, Art. 21)", () => {
  function objecting(fields: Record<string, Value>): FamilyState {
    const state = new FamilyState();
    put(state, EntityTypes.consent, "obj-1", {
      personId: "person-mum",
      kind: "objection",
      raisedAt: "2026-02-01T09:00:00Z",
      ...fields,
    });
    return state;
  }

  /**
   * The reason this is an enumeration and not a boolean: "I do not want my
   * behaviour analysed, but keep the reminders" is a sentence a person is
   * entitled to say, and a single opt-out switch cannot hear it.
   */
  it("stops one processing without touching the others", () => {
    const state = objecting({ subject: OBJECTABLE_PROCESSINGS.behaviourLearning });

    expect(mayProcess(state, "person-mum", OBJECTABLE_PROCESSINGS.behaviourLearning)).toBe(false);
    expect(mayProcess(state, "person-mum", OBJECTABLE_PROCESSINGS.proactiveNotifications)).toBe(true);
  });

  it("leaves everybody else alone", () => {
    const state = objecting({ subject: OBJECTABLE_PROCESSINGS.aiProcessing });

    expect(mayProcess(state, "person-dad", OBJECTABLE_PROCESSINGS.aiProcessing)).toBe(true);
  });

  it("allows what nobody objected to", () => {
    expect(mayProcess(new FamilyState(), "person-mum", OBJECTABLE_PROCESSINGS.locationReminders)).toBe(
      true,
    );
  });

  it("lets a person take an objection back", () => {
    const state = objecting({
      subject: OBJECTABLE_PROCESSINGS.mentalLoadAnalysis,
      withdrawnAt: "2026-02-20T09:00:00Z",
    });

    expect(mayProcess(state, "person-mum", OBJECTABLE_PROCESSINGS.mentalLoadAnalysis)).toBe(true);
    // Kept, not deleted: what was objected to and when is the evidence.
    expect(readObjections(state, "person-mum")).toHaveLength(1);
  });

  it("keeps the reason optional, as the article does", () => {
    expect(readObjections(objecting({ subject: "aiProcessing" }), "person-mum")[0]?.reason).toBeUndefined();
    expect(
      readObjections(objecting({ subject: "aiProcessing", reason: "No thank you" }), "person-mum")[0]
        ?.reason,
    ).toBe("No thank you");
  });

  /** An objection whose effect a person cannot see is a checkbox, not a right. */
  it("lists what is currently switched off", () => {
    const state = objecting({ subject: OBJECTABLE_PROCESSINGS.aiProcessing });
    put(state, EntityTypes.consent, "obj-2", {
      personId: "person-mum",
      kind: "objection",
      subject: OBJECTABLE_PROCESSINGS.locationReminders,
      raisedAt: "2026-02-02T09:00:00Z",
      withdrawnAt: "2026-02-03T09:00:00Z",
    });

    expect(activeObjections(state, "person-mum")).toEqual(["aiProcessing"]);
  });

  it("ignores an objection against something that is not on the list", () => {
    expect(readObjections(objecting({ subject: "breathing" }), "person-mum")).toEqual([]);
  });
});

/**
 * The gate test. An objection that no code path reads is a checkbox, so this
 * asserts the effect rather than the record: one person objects, and the feature
 * that does the processing goes quiet for them and stays on for everybody else.
 */
describe("an objection reaches the thing it objects to", () => {
  it("silences suggestions for the person who objected, and nobody else", () => {
    const state = withEvents([
      "2026-02-03T16:00:00Z",
      "2026-02-10T16:00:00Z",
      "2026-02-17T16:00:00Z",
    ]);
    put(state, EntityTypes.consent, "obj-1", {
      personId: "person-mum",
      kind: "objection",
      subject: OBJECTABLE_PROCESSINGS.behaviourLearning,
      raisedAt: "2026-02-01T09:00:00Z",
    });

    expect(suggestRecurrences(state, { now: NOW, personId: "person-mum" })).toEqual([]);
    expect(suggestRecurrences(state, { now: NOW, personId: "person-dad" })).toHaveLength(1);
  });
});
