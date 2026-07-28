import { describe, expect, it } from "vitest";
import {
  FamilyState,
  HlcClock,
  makeOperation,
  newId,
  setMembers,
  type Operation,
  type Value,
} from "@fam/domain";

const FAMILY = "fam-1";

interface OpOverrides {
  readonly deviceId?: string;
  readonly actorId?: string | null;
  readonly base?: Record<string, number>;
  readonly wall?: number;
  readonly counter?: number;
}

function op(
  kind: Operation["kind"],
  entityType: string,
  entityId: string,
  payload: Record<string, Value>,
  overrides: OpOverrides = {},
): Operation {
  const deviceId = overrides.deviceId ?? "device-a";
  return makeOperation({
    opId: newId(),
    familyId: FAMILY,
    deviceId,
    actorId: overrides.actorId ?? null,
    entityType,
    entityId,
    kind,
    payload,
    hlc: { wall: overrides.wall ?? 1000, counter: overrides.counter ?? 0, deviceId },
    ...(overrides.base === undefined ? {} : { base: overrides.base }),
  });
}

describe("reducer — Tier 1 (merges silently)", () => {
  it("applies a create and exposes its fields", () => {
    const state = new FamilyState();
    state.apply(op("entity.create", "shoppingItem", "item-1", { name: "Milk", checked: false }));

    expect(state.get("shoppingItem", "item-1")?.fields).toMatchObject({ name: "Milk", checked: false });
  });

  it("treats a replayed create as a no-op instead of clobbering later edits", () => {
    const state = new FamilyState();
    const create = op("entity.create", "shoppingItem", "item-1", { name: "Milk", checked: false });
    state.apply(create);
    state.apply(op("entity.setFields", "shoppingItem", "item-1", { checked: true }, { wall: 2000 }));
    const outcome = state.apply(create);

    expect(outcome.changed).toBe(false);
    expect(state.get("shoppingItem", "item-1")?.fields["checked"]).toBe(true);
  });

  it("keeps a check-off checked when two devices check the same item (FR-1219)", () => {
    const state = new FamilyState();
    state.apply(op("entity.create", "shoppingItem", "item-1", { name: "Milk", checked: false }));

    const a = op("entity.setFields", "shoppingItem", "item-1", { checked: true }, { deviceId: "phone-a", wall: 2000 });
    const b = op("entity.setFields", "shoppingItem", "item-1", { checked: true }, { deviceId: "phone-b", wall: 2001 });

    state.apply(a);
    const second = state.apply(b);

    expect(second.changed).toBe(false);
    expect(second.conflicts).toHaveLength(0);
    expect(state.get("shoppingItem", "item-1")?.fields["checked"]).toBe(true);
  });

  it("resolves competing non-critical writes by last writer, regardless of arrival order", () => {
    const early = op("entity.setFields", "shoppingItem", "item-1", { note: "small pack" }, { wall: 1000 });
    const late = op("entity.setFields", "shoppingItem", "item-1", { note: "large pack" }, { wall: 5000 });

    const forwards = new FamilyState();
    forwards.applyAll([early, late]);
    const backwards = new FamilyState();
    backwards.applyAll([late, early]);

    expect(forwards.get("shoppingItem", "item-1")?.fields["note"]).toBe("large pack");
    expect(backwards.get("shoppingItem", "item-1")?.fields["note"]).toBe("large pack");
  });

  it("merges set membership per element (who eats, which stores)", () => {
    const state = new FamilyState();
    state.apply(op("entity.create", "mealSlot", "slot-1", { mealType: "dinner" }));
    state.apply(op("set.add", "mealSlot", "slot-1", { field: "eaters", member: "person-mum" }, { deviceId: "d1", wall: 2000 }));
    state.apply(op("set.add", "mealSlot", "slot-1", { field: "eaters", member: "person-kid" }, { deviceId: "d2", wall: 2001 }));
    state.apply(op("set.remove", "mealSlot", "slot-1", { field: "eaters", member: "person-mum" }, { deviceId: "d3", wall: 3000 }));

    expect(setMembers(state.get("mealSlot", "slot-1")!, "eaters")).toEqual(["person-kid"]);
  });

  it("ignores a stale set change that arrives after a newer one", () => {
    const state = new FamilyState();
    state.apply(op("set.add", "mealSlot", "slot-1", { field: "eaters", member: "p1" }, { wall: 5000 }));
    state.apply(op("set.remove", "mealSlot", "slot-1", { field: "eaters", member: "p1" }, { wall: 1000 }));

    expect(setMembers(state.get("mealSlot", "slot-1")!, "eaters")).toEqual(["p1"]);
  });

  it("marks entities deleted without dropping them, so sync can see the tombstone", () => {
    const state = new FamilyState();
    state.apply(op("entity.create", "shoppingItem", "item-1", { name: "Milk" }));
    state.apply(op("entity.delete", "shoppingItem", "item-1", {}, { wall: 2000 }));

    expect(state.all("shoppingItem")).toHaveLength(0);
    expect(state.allIncludingDeleted("shoppingItem")).toHaveLength(1);
  });
});

describe("reducer — Tier 2 (never overwrites silently)", () => {
  it("applies a critical field change when the author saw the current version", () => {
    const state = new FamilyState();
    state.apply(op("entity.create", "event", "event-1", { title: "Dentist", startsAt: "2026-08-01T09:00:00Z" }));

    const outcome = state.apply(
      op("entity.setFields", "event", "event-1", { startsAt: "2026-08-01T10:00:00Z" }, { base: { startsAt: 1 }, wall: 2000 }),
    );

    expect(outcome.conflicts).toHaveLength(0);
    expect(state.get("event", "event-1")?.fields["startsAt"]).toBe("2026-08-01T10:00:00Z");
  });

  it("raises a conflict instead of overwriting a moved appointment", () => {
    const state = new FamilyState();
    state.apply(op("entity.create", "event", "event-1", { startsAt: "2026-08-01T09:00:00Z" }));
    state.apply(
      op("entity.setFields", "event", "event-1", { startsAt: "2026-08-01T10:00:00Z" }, { base: { startsAt: 1 }, deviceId: "phone-a", wall: 2000 }),
    );

    const outcome = state.apply(
      op("entity.setFields", "event", "event-1", { startsAt: "2026-08-01T14:00:00Z" }, { base: { startsAt: 1 }, deviceId: "phone-b", wall: 3000 }),
    );

    expect(outcome.conflicts).toHaveLength(1);
    expect(outcome.conflicts[0]).toMatchObject({
      field: "startsAt",
      currentValue: "2026-08-01T10:00:00Z",
      incomingValue: "2026-08-01T14:00:00Z",
      baseVersion: 1,
      currentVersion: 2,
    });
    // The later write loses on purpose: nothing is applied until a human decides.
    expect(state.get("event", "event-1")?.fields["startsAt"]).toBe("2026-08-01T10:00:00Z");
  });

  it("treats both parents acknowledging the same dose as convergence, keeping the first (SPEC §12.2)", () => {
    const state = new FamilyState();
    state.apply(op("entity.create", "protocolInstance", "dose-1", { state: "due" }));

    const mum = op(
      "entity.setFields",
      "protocolInstance",
      "dose-1",
      { state: "acknowledged" },
      { base: { state: 1 }, deviceId: "phone-mum", actorId: "person-mum", wall: 2000 },
    );
    const dad = op(
      "entity.setFields",
      "protocolInstance",
      "dose-1",
      { state: "acknowledged" },
      { base: { state: 1 }, deviceId: "phone-dad", actorId: "person-dad", wall: 2500 },
    );

    state.apply(mum);
    const second = state.apply(dad);

    expect(second.conflicts).toHaveLength(0);
    expect(state.get("protocolInstance", "dose-1")?.fields["state"]).toBe("acknowledged");
    expect(state.get("protocolInstance", "dose-1")?.meta["state"]?.actorId).toBe("person-mum");
  });

  it("raises a conflict when the two parents disagree about the dose (given vs skipped)", () => {
    const state = new FamilyState();
    state.apply(op("entity.create", "protocolInstance", "dose-1", { state: "due" }));
    state.apply(
      op("entity.setFields", "protocolInstance", "dose-1", { state: "acknowledged" }, { base: { state: 1 }, deviceId: "a", wall: 2000 }),
    );

    const outcome = state.apply(
      op("entity.setFields", "protocolInstance", "dose-1", { state: "skipped" }, { base: { state: 1 }, deviceId: "b", wall: 2001 }),
    );

    expect(outcome.conflicts).toHaveLength(1);
    expect(state.get("protocolInstance", "dose-1")?.fields["state"]).toBe("acknowledged");
  });

  it("lets a resolution overwrite by claiming the current version", () => {
    const state = new FamilyState();
    state.apply(op("entity.create", "task", "task-1", { title: "Bins", ownerId: "person-mum" }));
    state.apply(op("entity.setFields", "task", "task-1", { ownerId: "person-dad" }, { base: { ownerId: 1 }, wall: 2000 }));

    const current = state.get("task", "task-1")?.meta["ownerId"]?.version ?? 0;
    const outcome = state.apply(
      op("entity.setFields", "task", "task-1", { ownerId: "person-teen" }, { base: { ownerId: current }, wall: 3000 }),
    );

    expect(outcome.conflicts).toHaveLength(0);
    expect(state.get("task", "task-1")?.fields["ownerId"]).toBe("person-teen");
  });

  it("does not treat non-registered fields of a critical entity as critical", () => {
    const state = new FamilyState();
    state.apply(op("entity.create", "event", "event-1", { title: "Dentist" }));
    const outcome = state.apply(op("entity.setFields", "event", "event-1", { title: "Orthodontist" }, { wall: 2000 }));

    expect(outcome.conflicts).toHaveLength(0);
    expect(state.get("event", "event-1")?.fields["title"]).toBe("Orthodontist");
  });
});

describe("clock", () => {
  it("never emits the same stamp twice, even with a frozen wall clock", () => {
    const clock = new HlcClock({ deviceId: "d", now: () => 1000 });
    const stamps = [clock.next(), clock.next(), clock.next()];

    expect(new Set(stamps.map((s) => s.wall + ":" + s.counter)).size).toBe(3);
  });

  it("sorts local work after anything it has already seen", () => {
    const clock = new HlcClock({ deviceId: "d", now: () => 1000 });
    clock.observe({ wall: 9000, counter: 4 });

    expect(clock.next().wall).toBeGreaterThanOrEqual(9000);
  });

  it("does not go backwards when the device clock does", () => {
    let now = 5000;
    const clock = new HlcClock({ deviceId: "d", now: () => now });
    const first = clock.next();
    now = 1000;
    const second = clock.next();

    expect(second.wall).toBe(first.wall);
    expect(second.counter).toBe(first.counter + 1);
  });
});
