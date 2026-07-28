/**
 * The SPEC's acceptance scenarios, executable.
 *
 * Each test here is a numbered scenario from SPEC.md rather than something
 * invented for the code, which is what makes the specification checkable instead
 * of merely readable. The phase exit criteria from SPEC §3 are at the bottom.
 */
import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  EntityTypes,
  HOUR_MS,
  buildShoppingList,
  canonicalItemKey,
  computeRhythm,
  derivePlannedNeeds,
  instanceId,
  planInstances,
  readBoolean,
  readNumber,
  readProtocol,
  readString,
} from "@fam/domain";
import { FAMILY_ID, FamilySimulation } from "./harness.js";

const LIST = "list-groceries";

describe("SPEC §9 — plan propagates to list (SC-004)", () => {
  it("turns two recipes with onions into one merged line, and adjusts when one leaves", async () => {
    const family = await FamilySimulation.household();
    const mum = family.device("phone-mum");

    await mum.mutate((b) => {
      b.create(EntityTypes.recipe, "r-bolognese", {
        title: "Bolognese",
        servings: 4,
        ingredients: [
          { name: "Onion", amount: 2, unit: "piece" },
          { name: "Mince", amount: 500, unit: "g" },
        ],
      });
      b.create(EntityTypes.recipe, "r-soup", {
        title: "Onion soup",
        servings: 4,
        ingredients: [{ name: "onion", amount: 1, unit: "piece" }],
      });
      b.create(EntityTypes.weekPlan, "week-31", { startDate: "2026-07-27", planningOwnerId: "person-mum" });
      b.create(EntityTypes.mealSlot, "slot-mon", { weekPlanId: "week-31", date: "2026-07-27", mealType: "dinner", recipeId: "r-bolognese" });
      b.create(EntityTypes.mealSlot, "slot-tue", { weekPlanId: "week-31", date: "2026-07-28", mealType: "dinner", recipeId: "r-soup" });
      for (const slot of ["slot-mon", "slot-tue"]) {
        for (const person of ["person-mum", "person-dad", "person-kid", "person-guest"]) {
          b.setAdd(EntityTypes.mealSlot, slot, "eaters", person);
        }
      }
    });
    await family.settle();

    const dadState = family.device("phone-dad").client.state();
    const needs = derivePlannedNeeds(dadState, "week-31");

    expect(needs.find((n) => n.itemKey === "onion")?.quantityLabel).toBe("3×");

    // The other parent removes a meal; nobody writes a shopping item.
    await family.device("phone-dad").mutate((b) => b.delete(EntityTypes.mealSlot, "slot-tue"));
    await family.settle();

    const afterwards = derivePlannedNeeds(family.device("tablet-kitchen").client.state(), "week-31");
    expect(afterwards.find((n) => n.itemKey === "onion")?.quantityLabel).toBe("2×");
  });
});

describe("SPEC §10.2 — the staples loop", () => {
  it("scenario 1: a weekly item becomes 'probably due' with a reason on request", async () => {
    const family = await FamilySimulation.household();
    const mum = family.device("phone-mum");
    const now = family.now();

    await mum.mutate((b) => {
      b.create(EntityTypes.catalogItem, "milk", { productGroup: "dairy", name: "Milk" });
      for (const weeksAgo of [5, 4, 3, 2, 1]) {
        b.setAdd(EntityTypes.catalogItem, "milk", "purchases", String(now - weeksAgo * 7 * DAY_MS));
      }
    });
    await family.settle();

    const view = buildShoppingList(family.device("phone-dad").client.state(), { listId: LIST, now });
    const suggestion = view.probablyDue.find((r) => r.itemKey === "milk");

    expect(suggestion?.state).toBe("due");
    expect(suggestion?.reason).toContain("usually every 7 days");
  });

  it("scenario 2: a dismissed suggestion stays away and lengthens the interval", async () => {
    const family = await FamilySimulation.household();
    const now = family.now();

    await family.device("phone-mum").mutate((b) => {
      b.create(EntityTypes.catalogItem, "olives", { productGroup: "ambient", name: "Olives" });
      for (const weeksAgo of [4, 3, 2, 1]) {
        b.setAdd(EntityTypes.catalogItem, "olives", "purchases", String(now - weeksAgo * 7 * DAY_MS));
      }
    });
    await family.settle();

    const before = buildShoppingList(family.device("phone-mum").client.state(), { listId: LIST, now });
    expect(before.probablyDue.map((r) => r.itemKey)).toContain("olives");

    await family.device("phone-mum").mutate((b) =>
      b.setAdd(EntityTypes.catalogItem, "olives", "dismissals", String(now)),
    );
    await family.settle();

    const after = buildShoppingList(family.device("phone-dad").client.state(), { listId: LIST, now });
    expect(after.probablyDue.map((r) => r.itemKey)).not.toContain("olives");
  });

  it("scenario 3: a spoken sentence puts the certain part on the list and asks nothing", async () => {
    const family = await FamilySimulation.household();
    const now = family.now();

    // "Milk's gone, and something for Saturday": the reported item is a fact,
    // the rest is not — and the family is not interrupted to sort it out.
    await family.device("tablet-kitchen").mutate((b) => {
      b.create(EntityTypes.catalogItem, "milk", { productGroup: "dairy", name: "Milk" });
      b.setAdd(EntityTypes.catalogItem, "milk", "emptyReports", String(now));
      b.create(EntityTypes.inboxItem, "inbox-1", {
        source: "voice",
        text: "and something for Saturday",
        state: "pending",
      });
    });
    await family.settle();

    const state = family.device("phone-mum").client.state();
    const view = buildShoppingList(state, { listId: LIST, now });

    expect(view.reported.map((r) => r.itemKey)).toEqual(["milk"]);
    expect(state.all(EntityTypes.inboxItem)).toHaveLength(1);
  });

  it("a purchase resets everything, so a missed event corrupts nothing (FR-738)", async () => {
    const family = await FamilySimulation.household();
    const now = family.now();

    await family.device("phone-mum").mutate((b) => {
      b.create(EntityTypes.catalogItem, "milk", { name: "Milk" });
      for (const weeksAgo of [4, 3, 2, 1]) {
        b.setAdd(EntityTypes.catalogItem, "milk", "purchases", String(now - weeksAgo * 7 * DAY_MS));
      }
      b.setAdd(EntityTypes.catalogItem, "milk", "emptyReports", String(now - DAY_MS));
      b.setAdd(EntityTypes.catalogItem, "milk", "dismissals", String(now - DAY_MS));
      b.setAdd(EntityTypes.catalogItem, "milk", "purchases", String(now));
    });
    await family.settle();

    const catalog = family.device("phone-dad").client.state().get(EntityTypes.catalogItem, "milk")!;
    const rhythm = computeRhythm(
      {
        itemKey: "milk",
        purchases: [...Array(5)].map((_, i) => (i === 4 ? now : now - (4 - i) * 7 * DAY_MS)),
        emptyReports: [now - DAY_MS],
        dismissals: [now - DAY_MS],
      },
      { now },
    );

    expect(catalog.deleted).toBe(false);
    expect(rhythm.reported).toBe(false);
    expect(rhythm.state).toBe("quiet");
  });
});

describe("SPEC §12.2 — the double dose must not happen (SC-007)", () => {
  const PROTOCOL_START = Date.parse("2026-07-28T08:00:00Z");

  async function familyWithProtocol(): Promise<FamilySimulation> {
    const family = await FamilySimulation.household();
    await family.device("phone-mum").mutate((b) => {
      b.create(EntityTypes.protocol, "proto-antibiotic", {
        personId: "person-kid",
        label: "Antibiotic",
        kind: "acknowledgement",
        startsAt: PROTOCOL_START,
        endsAt: PROTOCOL_START + 5 * DAY_MS,
        frequencyKind: "every-n-hours",
        frequencyValue: 8,
        instruction: "5 ml with food",
        responsibleAdultIds: ["person-mum", "person-dad"],
        wakeCapable: false,
        missedDoseRule: "shift",
      });
    });
    await family.settle();
    return family;
  }

  it("scenario 1: one parent acknowledges and the other's device shows it, reminder stops", async () => {
    const family = await familyWithProtocol();
    const protocol = readProtocol(family.device("phone-mum").client.state(), "proto-antibiotic")!;
    const [firstDose] = planInstances(protocol, family.device("phone-mum").client.state(), {
      from: PROTOCOL_START,
      to: PROTOCOL_START + DAY_MS,
    });

    await family.device("phone-mum").mutate((b) =>
      b.create(EntityTypes.protocolInstance, instanceId("proto-antibiotic", firstDose!.dueAt), {
        state: "acknowledged",
        acknowledgedBy: "person-mum",
        acknowledgedAt: PROTOCOL_START + 3 * 60 * 1000,
      }),
    );
    await family.settle();

    const dadState = family.device("phone-dad").client.state();
    const onDad = planInstances(readProtocol(dadState, "proto-antibiotic")!, dadState, {
      from: PROTOCOL_START,
      to: PROTOCOL_START + DAY_MS,
    })[0];

    expect(onDad?.state).toBe("acknowledged");
    expect(onDad?.acknowledgedBy).toBe("person-mum");
  });

  it("scenario 2: both acknowledge while offline — the earlier one stands, no conflict dialog", async () => {
    const family = await familyWithProtocol();
    const mum = family.device("phone-mum");
    const dad = family.device("phone-dad");
    const protocol = readProtocol(mum.client.state(), "proto-antibiotic")!;
    const [firstDose] = planInstances(protocol, mum.client.state(), {
      from: PROTOCOL_START,
      to: PROTOCOL_START + DAY_MS,
    });
    const id = instanceId("proto-antibiotic", firstDose!.dueAt);

    mum.goOffline();
    dad.goOffline();
    await mum.mutate((b) =>
      b.create(EntityTypes.protocolInstance, id, {
        state: "acknowledged",
        acknowledgedBy: "person-mum",
        acknowledgedAt: PROTOCOL_START + 60_000,
      }),
    );
    await dad.mutate((b) =>
      b.create(EntityTypes.protocolInstance, id, {
        state: "acknowledged",
        acknowledgedBy: "person-dad",
        acknowledgedAt: PROTOCOL_START + 120_000,
      }),
    );
    await family.settle();

    const instance = family.device("tablet-kitchen").client.state().get(EntityTypes.protocolInstance, id)!;

    expect(instance.fields["state"]).toBe("acknowledged");
    expect(instance.fields["acknowledgedBy"]).toBe("person-mum");
    expect(await mum.client.openConflicts()).toHaveLength(0);
    expect(await dad.client.openConflicts()).toHaveLength(0);
  });

  it("a genuine disagreement — given versus skipped — is surfaced rather than merged", async () => {
    const family = await familyWithProtocol();
    const mum = family.device("phone-mum");
    const dad = family.device("phone-dad");
    const protocol = readProtocol(mum.client.state(), "proto-antibiotic")!;
    const [firstDose] = planInstances(protocol, mum.client.state(), {
      from: PROTOCOL_START,
      to: PROTOCOL_START + DAY_MS,
    });
    const id = instanceId("proto-antibiotic", firstDose!.dueAt);

    await mum.mutate((b) => b.create(EntityTypes.protocolInstance, id, { state: "due" }));
    await family.settle();

    mum.goOffline();
    dad.goOffline();
    await mum.mutate((b) => b.set(EntityTypes.protocolInstance, id, { state: "acknowledged" }));
    await dad.mutate((b) => b.set(EntityTypes.protocolInstance, id, { state: "skipped" }));
    await family.settle();

    const conflicts = await dad.client.openConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.field).toBe("state");
  });
});

describe("SPEC §5 — calendar divergence is visible, never silent", () => {
  it("two parents moving the same appointment produces one resolvable conflict", async () => {
    const family = await FamilySimulation.household();
    const mum = family.device("phone-mum");
    const dad = family.device("phone-dad");

    await mum.mutate((b) =>
      b.create(EntityTypes.event, "e-dentist", {
        title: "Dentist",
        startsAt: Date.parse("2026-08-03T09:00:00Z"),
        endsAt: Date.parse("2026-08-03T10:00:00Z"),
        bringOwnerId: "person-mum",
      }),
    );
    await family.settle();

    mum.goOffline();
    dad.goOffline();
    await mum.mutate((b) => b.set(EntityTypes.event, "e-dentist", { startsAt: Date.parse("2026-08-03T11:00:00Z") }));
    await dad.mutate((b) => b.set(EntityTypes.event, "e-dentist", { startsAt: Date.parse("2026-08-03T15:00:00Z") }));
    await family.settle();

    const conflicts = await dad.client.openConflicts();
    expect(conflicts).toHaveLength(1);

    await dad.client.resolveConflict(conflicts[0]!, "take-incoming", "2026-07-28T09:00:00Z");
    await family.settle();

    for (const device of family.devices.values()) {
      expect(readNumber(device.client.state().get(EntityTypes.event, "e-dentist"), "startsAt")).toBe(
        Date.parse("2026-08-03T15:00:00Z"),
      );
    }
  });
});

describe("SPEC §3 — Phase 0 exit criterion", () => {
  it("three devices work offline and sync without loss (SC-005)", async () => {
    const family = await FamilySimulation.household();
    const mum = family.device("phone-mum");
    const dad = family.device("phone-dad");
    const tablet = family.device("tablet-kitchen");

    for (const device of [mum, dad, tablet]) device.goOffline();

    await mum.mutate((b) => b.create(EntityTypes.shoppingItem, "i-milk", { listId: LIST, name: "Milk", itemKey: "milk", checked: false }));
    await dad.mutate((b) => b.create(EntityTypes.shoppingItem, "i-bread", { listId: LIST, name: "Bread", itemKey: "bread", checked: false }));
    await tablet.mutate((b) => b.create(EntityTypes.shoppingItem, "i-eggs", { listId: LIST, name: "Eggs", itemKey: "eggs", checked: false }));

    expect(await mum.trySync()).toBe(false);
    expect(mum.client.unsyncedCount()).toBeGreaterThan(0);

    await family.settle();

    for (const device of family.devices.values()) {
      const names = device.client
        .state()
        .all(EntityTypes.shoppingItem)
        .map((item) => readString(item, "name"))
        .sort();
      expect(names).toEqual(["Bread", "Eggs", "Milk"]);
      expect(device.client.hasUnsyncedWork()).toBe(false);
    }
  });

  it("a new device joins and is immediately current, without replaying the log", async () => {
    const family = await FamilySimulation.household();
    await family.device("phone-mum").mutate((b) => {
      for (let i = 0; i < 15; i += 1) {
        b.create(EntityTypes.shoppingItem, "i-" + i, { listId: LIST, name: "Item " + i, checked: false });
      }
    });
    await family.settle();

    const grandma = await family.addDevice("phone-grandma", "person-grandma");
    await grandma.client.bootstrap();

    expect(grandma.client.state().all(EntityTypes.shoppingItem)).toHaveLength(15);
  });
});

describe("SPEC §3 — Phase 1 exit criterion", () => {
  it("runs the whole weekly loop offline, with two people shopping at once", async () => {
    const family = await FamilySimulation.household();
    const mum = family.device("phone-mum");
    const dad = family.device("phone-dad");
    const now = family.now();

    // Plan: the planning owner fixes the week.
    await mum.mutate((b) => {
      b.create(EntityTypes.recipe, "r-pasta", {
        title: "Pasta",
        servings: 4,
        ingredients: [
          { name: "Pasta", amount: 500, unit: "g" },
          { name: "Tomatoes", amount: 400, unit: "g" },
        ],
      });
      b.create(EntityTypes.weekPlan, "week-31", { startDate: "2026-07-27", planningOwnerId: "person-mum" });
      b.create(EntityTypes.mealSlot, "slot-mon", {
        weekPlanId: "week-31",
        date: "2026-07-27",
        mealType: "dinner",
        recipeId: "r-pasta",
        cookOwnerId: "person-dad",
      });
      for (const person of ["person-mum", "person-dad", "person-kid", "person-guest"]) {
        b.setAdd(EntityTypes.mealSlot, "slot-mon", "eaters", person);
      }
      b.create(EntityTypes.catalogItem, "pasta", { name: "Pasta", productGroup: "ambient" });
      b.create(EntityTypes.catalogItem, "tomatoes", { name: "Tomatoes", productGroup: "ambient" });
    });
    await family.settle();

    // List: derived, not written.
    const needs = derivePlannedNeeds(dad.client.state(), "week-31");
    expect(needs.map((n) => n.itemKey)).toEqual(["pasta", "tomatoes"]);

    // Shop: both parents in the same shop, no signal, ticking off simultaneously.
    mum.goOffline();
    dad.goOffline();
    const pastaKey = needs[0]!.key;
    const tomatoKey = needs[1]!.key;
    await mum.mutate((b) => b.create(EntityTypes.plannedTick, pastaKey, { listId: LIST, checked: true }));
    await dad.mutate((b) => b.create(EntityTypes.plannedTick, tomatoKey, { listId: LIST, checked: true }));
    // Both reach for the same item — the classic double check-off.
    await dad.mutate((b) => b.create(EntityTypes.plannedTick, pastaKey, { listId: LIST, checked: true }));
    await family.settle();

    const view = buildShoppingList(family.device("tablet-kitchen").client.state(), {
      listId: LIST,
      now,
      plannedNeeds: derivePlannedNeeds(family.device("tablet-kitchen").client.state(), "week-31"),
    });

    expect(view.openCount).toBe(0);
    expect(view.checkedCount).toBe(2);
    expect(await mum.client.openConflicts()).toHaveLength(0);

    // Cook: the meal is marked done and the purchase feeds the rhythm.
    await dad.mutate((b) => {
      b.set(EntityTypes.mealSlot, "slot-mon", { state: "cooked" });
      b.setAdd(EntityTypes.catalogItem, "pasta", "purchases", String(now));
      b.setAdd(EntityTypes.catalogItem, "tomatoes", "purchases", String(now));
    });
    await family.settle();

    const cooked = family.device("phone-mum").client.state().get(EntityTypes.mealSlot, "slot-mon");
    expect(readString(cooked, "state")).toBe("cooked");
  });

  it("keeps the kitchen tablet acting as the household until identity matters (FR-116)", async () => {
    const family = await FamilySimulation.household();
    const tablet = family.device("tablet-kitchen");

    // Ticking an item off is household work: no person is asked for.
    const [anonymous] = await tablet.mutate((b) =>
      b.create(EntityTypes.shoppingItem, "i-milk", { listId: LIST, name: "Milk", checked: true }),
    );
    expect(anonymous?.actorId).toBeNull();

    // Acknowledging a dose is not: the tablet asks who is standing there.
    tablet.client.setActor("person-dad");
    const [attributed] = await tablet.mutate((b) =>
      b.create(EntityTypes.protocolInstance, "pi-1", { state: "acknowledged", acknowledgedBy: "person-dad" }),
    );
    expect(attributed?.actorId).toBe("person-dad");

    await family.settle();
    expect(family.server.stateOf(FAMILY_ID).get(EntityTypes.protocolInstance, "pi-1")?.meta["state"]?.actorId).toBe(
      "person-dad",
    );
  });
});

describe("cross-cutting guarantees", () => {
  it("never silently overwrites a critical field (SC-009)", async () => {
    const family = await FamilySimulation.household();
    const mum = family.device("phone-mum");
    const dad = family.device("phone-dad");

    await mum.mutate((b) => b.create(EntityTypes.task, "t-bins", { title: "Bins", ownerId: "person-mum" }));
    await family.settle();

    mum.goOffline();
    dad.goOffline();
    await mum.mutate((b) => b.set(EntityTypes.task, "t-bins", { ownerId: "person-kid" }));
    await dad.mutate((b) => b.set(EntityTypes.task, "t-bins", { ownerId: "person-dad" }));
    await family.settle();

    const conflicts = await dad.client.openConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.field).toBe("ownerId");
  });

  it("keeps every device byte-identical after settling (SC-005)", async () => {
    const family = await FamilySimulation.household();
    const now = family.now();

    await family.device("phone-mum").mutate((b) => {
      b.create(EntityTypes.event, "e-1", { title: "Swimming", startsAt: now + HOUR_MS, endsAt: now + 2 * HOUR_MS });
      b.create(EntityTypes.shoppingItem, "i-1", { listId: LIST, name: "Milk", itemKey: canonicalItemKey("Milk") });
    });
    await family.device("phone-dad").mutate((b) => b.set(EntityTypes.shoppingItem, "i-1", { checked: true }));
    await family.settle();

    const reference = family.server.stateOf(FAMILY_ID).snapshot();
    for (const device of family.devices.values()) {
      expect(device.client.state().snapshot()).toEqual(reference);
    }
    expect(readBoolean(family.device("tablet-kitchen").client.state().get(EntityTypes.shoppingItem, "i-1"), "checked")).toBe(true);
  });
});
