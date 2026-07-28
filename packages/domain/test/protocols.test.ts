import { beforeEach, describe, expect, it } from "vitest";
import {
  EntityTypes,
  FamilyState,
  HOUR_MS,
  instanceId,
  makeOperation,
  newId,
  pendingReminders,
  planInstances,
  readProtocol,
  summarizeProtocol,
  type Operation,
  type ProtocolDefinition,
  type Value,
} from "@fam/domain";

const DAY = 24 * HOUR_MS;
const START = Date.parse("2026-08-01T00:00:00Z");
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

function seedProtocol(overrides: Record<string, Value> = {}): ProtocolDefinition {
  state.apply(
    op("entity.create", EntityTypes.protocol, "proto-1", {
      personId: "p-kid",
      label: "Eye drops",
      kind: "acknowledgement",
      startsAt: START + 8 * HOUR_MS,
      endsAt: START + 5 * DAY,
      frequencyKind: "times-per-day",
      frequencyValue: 5,
      instruction: "One drop in the left eye",
      responsibleAdultIds: ["p-mum", "p-dad"],
      wakeCapable: false,
      missedDoseRule: "shift",
      ...overrides,
    }),
  );
  return readProtocol(state, "proto-1")!;
}

function acknowledge(protocolId: string, dueAt: number, by: string, at: number): void {
  state.apply(
    op("entity.create", EntityTypes.protocolInstance, instanceId(protocolId, dueAt), {
      state: "acknowledged",
      acknowledgedBy: by,
      acknowledgedAt: at,
    }),
  );
}

beforeEach(() => {
  state = new FamilyState();
});

describe("schedule derivation", () => {
  it("derives instances instead of storing twenty-five of them (SPEC §12.2)", () => {
    const protocol = seedProtocol();

    const instances = planInstances(protocol, state, { from: START, to: START + 5 * DAY });

    expect(instances.length).toBe(25);
    expect(state.all(EntityTypes.protocolInstance)).toHaveLength(0);
  });

  it("spreads doses over waking hours rather than around the clock", () => {
    const protocol = seedProtocol({ frequencyValue: 3 });

    const firstDay = planInstances(protocol, state, { from: START, to: START + DAY });
    const hours = firstDay.map((i) => new Date(i.dueAt).getUTCHours());

    expect(hours).toEqual([8, 14, 21]);
  });

  it("honours fixed times when the prescription names them", () => {
    const protocol = seedProtocol({ frequencyKind: "fixed-times", fixedTimes: ["480", "1200"] });

    const hours = planInstances(protocol, state, { from: START, to: START + DAY }).map((i) =>
      new Date(i.dueAt).getUTCHours(),
    );

    expect(hours).toEqual([8, 20]);
  });

  it("stops on its own at the end date, leaving nothing to clean up (FR-924)", () => {
    const protocol = seedProtocol();

    const afterwards = planInstances(protocol, state, { from: START + 6 * DAY, to: START + 30 * DAY });

    expect(afterwards).toHaveLength(0);
  });
});

describe("every-n-hours counts from the actual dose (FR-922)", () => {
  it("moves the next dose when one was given late", () => {
    const protocol = seedProtocol({
      frequencyKind: "every-n-hours",
      frequencyValue: 8,
      startsAt: START + 8 * HOUR_MS,
      endsAt: START + 2 * DAY,
    });
    const firstDue = START + 8 * HOUR_MS;
    acknowledge("proto-1", firstDue, "p-mum", firstDue + HOUR_MS);

    const instances = planInstances(readProtocol(state, "proto-1")!, state, {
      from: START,
      to: START + 2 * DAY,
    });

    expect(instances[1]?.dueAt).toBe(firstDue + HOUR_MS + 8 * HOUR_MS);
  });

  it("keeps the grid fixed when the protocol says so (FR-920)", () => {
    const protocol = seedProtocol({
      frequencyKind: "every-n-hours",
      frequencyValue: 8,
      startsAt: START + 8 * HOUR_MS,
      endsAt: START + 2 * DAY,
      missedDoseRule: "fixed",
    });
    const firstDue = START + 8 * HOUR_MS;
    acknowledge("proto-1", firstDue, "p-mum", firstDue + HOUR_MS);

    const instances = planInstances(readProtocol(state, "proto-1")!, state, { from: START, to: START + 2 * DAY });

    expect(instances[1]?.dueAt).toBe(firstDue + 8 * HOUR_MS);
    expect(protocol.missedDoseRule).toBe("fixed");
  });
});

describe("night rest (FR-921)", () => {
  it("drops night-time instances when the protocol may not wake the house", () => {
    const protocol = seedProtocol({
      frequencyKind: "fixed-times",
      fixedTimes: ["480", "180"],
      wakeCapable: false,
      startsAt: START,
    });

    const hours = planInstances(protocol, state, { from: START, to: START + DAY }).map((i) =>
      new Date(i.dueAt).getUTCHours(),
    );

    expect(hours).toEqual([8]);
  });

  it("keeps them when the protocol is explicitly allowed to wake", () => {
    const protocol = seedProtocol({
      frequencyKind: "fixed-times",
      fixedTimes: ["480", "180"],
      wakeCapable: true,
      startsAt: START,
    });

    const hours = planInstances(protocol, state, { from: START, to: START + DAY }).map((i) =>
      new Date(i.dueAt).getUTCHours(),
    );

    expect(hours).toEqual([3, 8]);
  });
});

describe("acknowledgement (SPEC SC-007)", () => {
  it("records who gave the dose and exactly when, not merely that it happened (FR-917)", () => {
    const protocol = seedProtocol();
    const due = START + 8 * HOUR_MS;
    acknowledge("proto-1", due, "p-mum", due + 3 * 60 * 1000);

    const instance = planInstances(protocol, state, { from: START, to: START + DAY })[0];

    expect(instance?.state).toBe("acknowledged");
    expect(instance?.acknowledgedBy).toBe("p-mum");
    expect(instance?.acknowledgedAt).toBe(due + 3 * 60 * 1000);
  });

  it("stops reminding once acknowledged, and keeps reminding until then (FR-918)", () => {
    const protocol = seedProtocol();
    const due = START + 8 * HOUR_MS;
    const now = due + 30 * 60 * 1000;

    const before = planInstances(protocol, state, { from: START, to: now });
    expect(pendingReminders(before, now)).toHaveLength(1);

    acknowledge("proto-1", due, "p-dad", due);
    const after = planInstances(protocol, state, { from: START, to: now });

    expect(pendingReminders(after, now)).toHaveLength(0);
  });

  it("distinguishes a deliberate skip from a silent miss (FR-919)", () => {
    const protocol = seedProtocol();
    const due = START + 8 * HOUR_MS;
    state.apply(
      op("entity.create", EntityTypes.protocolInstance, instanceId("proto-1", due), {
        state: "skipped",
        skipNote: "Child was asleep",
      }),
    );

    const instance = planInstances(protocol, state, { from: START, to: due + HOUR_MS })[0];

    expect(instance?.state).toBe("skipped");
    expect(instance?.skipNote).toBe("Child was asleep");
  });

  it("marks an untouched, long-overdue instance as missed rather than still due", () => {
    const protocol = seedProtocol();
    const due = START + 8 * HOUR_MS;

    const instance = planInstances(protocol, state, { from: START, to: due + 6 * HOUR_MS })[0];

    expect(instance?.state).toBe("missed");
  });
});

describe("documentation for the doctor (FR-924)", () => {
  it("summarizes what was given, skipped and missed", () => {
    const protocol = seedProtocol({ frequencyValue: 2, endsAt: START + 2 * DAY });
    const instances = planInstances(protocol, state, { from: START, to: START + 2 * DAY });
    acknowledge("proto-1", instances[0]!.dueAt, "p-mum", instances[0]!.dueAt);
    state.apply(
      op("entity.create", EntityTypes.protocolInstance, instanceId("proto-1", instances[1]!.dueAt), {
        state: "skipped",
        skipNote: "Vomited",
      }),
    );

    const summary = summarizeProtocol(readProtocol(state, "proto-1")!, state, START + 2 * DAY);

    expect(summary.acknowledged).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.total).toBeGreaterThan(2);
  });

  it("collects measurements as a series", () => {
    const protocol = seedProtocol({ kind: "measurement", frequencyValue: 2, endsAt: START + DAY });
    const instances = planInstances(protocol, state, { from: START, to: START + DAY });
    state.apply(
      op("entity.create", EntityTypes.protocolInstance, instanceId("proto-1", instances[0]!.dueAt), {
        state: "acknowledged",
        acknowledgedAt: instances[0]!.dueAt,
        measuredValue: 38.4,
      }),
    );

    const summary = summarizeProtocol(readProtocol(state, "proto-1")!, state, START + DAY);

    expect(summary.measurements).toEqual([{ at: instances[0]!.dueAt, value: 38.4 }]);
  });
});
