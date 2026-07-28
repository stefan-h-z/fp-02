/**
 * ADVERSARIAL REVIEW — scratch file. Not part of the repository.
 * Every test here is written to FAIL if the defect is real.
 */
import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  EntityTypes,
  FamilyState,
  buildShoppingList,
  computeRhythm,
  canonicalItemKey,
  derivePlannedNeeds,
  makeOperation,
  newId,
  setMembers,
  type Operation,
  type Value,
} from "@fam/domain";
import { META_LAST_SEQ, MemoryStateStore } from "@fam/storage";
import { ReferenceServer, SyncClient } from "@fam/sync";

const FAMILY = "fam-1";

interface Ov {
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
  o: Ov = {},
): Operation {
  const deviceId = o.deviceId ?? "device-a";
  return makeOperation({
    opId: newId(),
    familyId: FAMILY,
    deviceId,
    actorId: o.actorId ?? null,
    entityType,
    entityId,
    kind,
    payload,
    hlc: { wall: o.wall ?? 1000, counter: o.counter ?? 0, deviceId },
    ...(o.base === undefined ? {} : { base: o.base }),
  });
}

// ---------------------------------------------------------------------------
// 1. REDUCER — the equal-value / equal-membership short circuit forgets to
//    advance the field's HLC watermark.
// ---------------------------------------------------------------------------

describe("D1 reducer: Tier-1 LWW is not last-writer-wins", () => {
  it("D1a a NEWER duplicate write must still raise the field watermark", () => {
    // three concurrent writes on one Tier-1 field:
    //   x@1000 = "A"   y@9000 = "A"   z@5000 = "B"
    // The newest write is y ("A"), so "A" must win in EVERY order.
    const x = op("entity.setFields", "shoppingItem", "i", { note: "A" }, { deviceId: "x", wall: 1000 });
    const y = op("entity.setFields", "shoppingItem", "i", { note: "A" }, { deviceId: "y", wall: 9000 });
    const z = op("entity.setFields", "shoppingItem", "i", { note: "B" }, { deviceId: "z", wall: 5000 });

    const s1 = new FamilyState();
    s1.applyAll([x, y, z]);
    const s2 = new FamilyState();
    s2.applyAll([x, z, y]);

    expect(s2.get("shoppingItem", "i")?.fields["note"]).toBe("A"); // sanity: holds
    expect(s1.get("shoppingItem", "i")?.fields["note"]).toBe("A"); // FAILS -> "B"
  });

  it("D1b the reducer is not order independent for Tier-1 fields", () => {
    const x = op("entity.setFields", "shoppingItem", "i", { note: "A" }, { deviceId: "x", wall: 1000 });
    const y = op("entity.setFields", "shoppingItem", "i", { note: "A" }, { deviceId: "y", wall: 9000 });
    const z = op("entity.setFields", "shoppingItem", "i", { note: "B" }, { deviceId: "z", wall: 5000 });

    const s1 = new FamilyState();
    s1.applyAll([x, y, z]);
    const s2 = new FamilyState();
    s2.applyAll([x, z, y]);

    expect(s1.snapshot()).toEqual(s2.snapshot()); // FAILS
  });
});

describe("D2 reducer: set membership LWW is not last-writer-wins", () => {
  it("D2a a newer redundant add must still raise the member watermark", () => {
    const add1 = op("set.add", "mealSlot", "s", { field: "eaters", member: "p" }, { deviceId: "x", wall: 1000 });
    const add9 = op("set.add", "mealSlot", "s", { field: "eaters", member: "p" }, { deviceId: "y", wall: 9000 });
    const rem5 = op("set.remove", "mealSlot", "s", { field: "eaters", member: "p" }, { deviceId: "z", wall: 5000 });

    const s1 = new FamilyState();
    s1.applyAll([add1, add9, rem5]);
    const s2 = new FamilyState();
    s2.applyAll([add1, rem5, add9]);

    expect(setMembers(s2.get("mealSlot", "s")!, "eaters")).toEqual(["p"]); // sanity: holds
    expect(setMembers(s1.get("mealSlot", "s")!, "eaters")).toEqual(["p"]); // FAILS -> []
  });
});

// ---------------------------------------------------------------------------
// 2. REDUCER — Tier-2
// ---------------------------------------------------------------------------

describe("D3 reducer: Tier-2 same-value merge keeps the first ARRIVAL, not the earlier HLC", () => {
  it("D3a SPEC 12.2 acc.2 / PLAN 3.2: the earlier acknowledgement must be authoritative", () => {
    const create = op("entity.create", "protocolInstance", "dose", { state: "due" });

    const mum = op(
      "entity.setFields",
      "protocolInstance",
      "dose",
      { state: "acknowledged" },
      { base: { state: 1 }, deviceId: "phone-mum", actorId: "person-mum", wall: 2000 },
    );
    const dad = op(
      "entity.setFields",
      "protocolInstance",
      "dose",
      { state: "acknowledged" },
      { base: { state: 1 }, deviceId: "phone-dad", actorId: "person-dad", wall: 2500 },
    );

    // Dad's phone happens to reach the server first (he had signal in the hall).
    const s = new FamilyState();
    s.applyAll([create, dad, mum]);

    // Mum acknowledged at wall 2000, earlier than dad at 2500.
    expect(s.get("protocolInstance", "dose")?.meta["state"]?.actorId).toBe("person-mum"); // FAILS -> person-dad
  });
});

describe("D4 reducer: whether a Tier-2 write is a silent no-op or a visible conflict depends on arrival order", () => {
  it("D4a", () => {
    const create = op("entity.create", "event", "e", { startsAt: "T0" });
    // Two devices, both saw version 1.
    const a = op("entity.setFields", "event", "e", { startsAt: "T1" }, { base: { startsAt: 1 }, deviceId: "a", wall: 2000 });
    const b = op("entity.setFields", "event", "e", { startsAt: "T1" }, { base: { startsAt: 1 }, deviceId: "b", wall: 2100 });
    const c = op("entity.setFields", "event", "e", { startsAt: "T2" }, { base: { startsAt: 2 }, deviceId: "c", wall: 2200 });

    const s1 = new FamilyState();
    const o1 = s1.applyAll([create, a, b, c]);
    const s2 = new FamilyState();
    const o2 = s2.applyAll([create, a, c, b]);

    // same three writes, different push order -> different number of conflicts
    // and a different final value.
    expect(o1.conflicts.length).toBe(o2.conflicts.length); // FAILS 0 vs 1
    expect(s1.get("event", "e")?.fields["startsAt"]).toBe(s2.get("event", "e")?.fields["startsAt"]);
  });
});

describe("D5 reducer: a malformed set op materialises a phantom entity", () => {
  it("D5a", () => {
    const s = new FamilyState();
    // `member` is not a string -> the op is dropped ... but the empty entity is stored.
    s.apply(op("set.add", "shoppingItem", "ghost", { field: "stores", member: 7 }));

    expect(s.allIncludingDeleted("shoppingItem")).toHaveLength(0); // FAILS -> 1
  });
});

// ---------------------------------------------------------------------------
// 3. SYNC CLIENT
// ---------------------------------------------------------------------------

async function makeDevice(
  server: ReferenceServer,
  deviceId: string,
  now: () => number,
  store = new MemoryStateStore(),
): Promise<{ client: SyncClient; store: MemoryStateStore }> {
  const client = new SyncClient({ familyId: FAMILY, deviceId, store, transport: server, now });
  await client.open();
  return { client, store };
}

function ticker(start = 1_700_000_000_000, step = 1000): () => number {
  let t = start;
  return () => {
    t += step;
    return t;
  };
}

describe("D6 client: a server rejection destroys the user's work, locally and permanently", () => {
  it("D6a unknown-family (or a not-yet-provisioned family) wipes the whole outbox", async () => {
    const server = new ReferenceServer(); // family NOT created
    const { client, store } = await makeDevice(server, "phone-a", ticker());

    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "item-1", { name: "Milk" }));
    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "item-2", { name: "Bread" }));

    await client.push(); // server says: unknown family

    // FR-1217: no data loss through connection loss / server trouble.
    expect((await store.outbox()).length).toBe(2); // FAILS -> 0
    expect(client.state().all(EntityTypes.shoppingItem)).toHaveLength(2); // FAILS -> 0
  });

  it("D6b schema-too-new (client newer than server) silently deletes the edit", async () => {
    const server = new ReferenceServer({ families: [FAMILY] });
    const { client, store } = await makeDevice(server, "phone-a", ticker());
    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "item-1", { name: "Milk" }));

    // Simulate the client running a newer schema than the deployed server.
    const [pending] = await store.outbox();
    await store.dequeueOutbox([pending!.opId]);
    await store.enqueueOutbox([{ ...pending!, schemaVersion: 99 }]);

    const result = await client.push();

    expect(result.rejected).toHaveLength(1);
    // The op is gone from the store: the family's change is unrecoverable.
    expect((await store.outbox()).length).toBe(1); // FAILS -> 0
  });
});

describe("D7 client: conflict resolution never reaches the other devices", () => {
  it("D7a a conflict resolved on one phone stays open on the other forever", async () => {
    const server = new ReferenceServer({ families: [FAMILY] });
    const now = ticker();
    const a = await makeDevice(server, "phone-a", now);
    const b = await makeDevice(server, "phone-b", now);

    await a.client.mutate((x) => x.create(EntityTypes.event, "e1", { startsAt: "09:00" }));
    await a.client.sync();
    await b.client.sync();

    await a.client.mutate((x) => x.set(EntityTypes.event, "e1", { startsAt: "10:00" }));
    await b.client.mutate((x) => x.set(EntityTypes.event, "e1", { startsAt: "14:00" }));
    await a.client.sync();
    await b.client.sync();
    await a.client.sync();

    expect(await a.client.openConflicts()).toHaveLength(1);
    const [conflict] = await b.client.openConflicts();
    await b.client.resolveConflict(conflict!, "take-incoming", "2026-07-28T08:00:00Z");

    for (let i = 0; i < 3; i += 1) {
      await b.client.sync();
      await a.client.sync();
    }

    expect(await b.client.openConflicts()).toHaveLength(0); // sanity: holds
    expect(await a.client.openConflicts()).toHaveLength(0); // FAILS -> 1
  });

  it("D7b a resolved conflict re-opens when the log is re-applied after a cursor regression", async () => {
    const server = new ReferenceServer({ families: [FAMILY] });
    const now = ticker();
    const a = await makeDevice(server, "phone-a", now);
    const b = await makeDevice(server, "phone-b", now);

    await a.client.mutate((x) => x.create(EntityTypes.event, "e1", { startsAt: "09:00" }));
    await a.client.sync();
    await b.client.sync();
    await a.client.mutate((x) => x.set(EntityTypes.event, "e1", { startsAt: "10:00" }));
    await b.client.mutate((x) => x.set(EntityTypes.event, "e1", { startsAt: "14:00" }));
    await a.client.sync();
    await b.client.sync();
    await a.client.sync();

    const [conflict] = await b.client.openConflicts();
    await b.client.resolveConflict(conflict!, "keep-current", "2026-07-28T08:00:00Z");
    await b.client.sync();
    expect(await b.client.openConflicts()).toHaveLength(0);

    // The app died between applying a pulled page and persisting the cursor.
    await b.store.setMeta(META_LAST_SEQ, "0");
    const restarted = new SyncClient({
      familyId: FAMILY,
      deviceId: "phone-b",
      store: b.store,
      transport: server,
      now,
    });
    await restarted.open();
    await restarted.pull();

    expect(await restarted.openConflicts()).toHaveLength(0); // FAILS -> 1, the dialog is back
  });
});

describe("D8 client: bootstrap() never folds the family's clock in", () => {
  it("D8a a bootstrapped device with a slower clock has its writes silently discarded", async () => {
    const server = new ReferenceServer({ families: [FAMILY] });
    // phone-a's clock is correct (2026).
    const a = await makeDevice(server, "phone-a", ticker(1_700_000_000_000));
    await a.client.mutate((x) => x.create(EntityTypes.shoppingItem, "item-1", { name: "Milk", checked: false }));
    await a.client.sync();

    // The new kitchen tablet boots with a clock that is behind (never set / RTC flat).
    const fresh = await makeDevice(server, "tablet", ticker(1_600_000_000_000));
    await fresh.client.bootstrap();
    await fresh.client.mutate((x) => x.set(EntityTypes.shoppingItem, "item-1", { checked: true }));
    await fresh.client.sync();
    await a.client.sync();
    await fresh.client.sync();

    // No rejection, no conflict — the tick simply never happened.
    expect(a.client.state().get(EntityTypes.shoppingItem, "item-1")?.fields["checked"]).toBe(true); // FAILS
  });
});

describe("D9 client: the outbox and the sync-status indicator drift apart", () => {
  it("D9a a push whose response was lost leaves the op in the outbox forever", async () => {
    const server = new ReferenceServer({ families: [FAMILY] });
    const now = ticker();
    const { client, store } = await makeDevice(server, "phone-a", now);
    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "item-1", { name: "Milk" }));

    // push reaches the server; the response never comes back.
    await server.push({ familyId: FAMILY, deviceId: "phone-a", ops: await store.outbox() });
    await client.pull();

    expect(client.hasUnsyncedWork()).toBe(false); // sanity: in-memory view is clean

    const restarted = new SyncClient({ familyId: FAMILY, deviceId: "phone-a", store, transport: server, now });
    await restarted.open();

    // FR-1216: what is shown as unsent must be what is actually unsent.
    expect(restarted.unsyncedCount()).toBe(0); // FAILS -> 1
  });
});

// ---------------------------------------------------------------------------
// 4. STAPLES ENGINE
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-07-28T08:00:00Z");
const ago = (d: number): number => NOW - d * DAY_MS;

describe("D10 rhythm: the learned interval can round to zero", () => {
  it("D10a produces a non-finite overdueRatio", () => {
    // Three check-offs inside one hour (tick / untick / tick while shopping).
    const r = computeRhythm(
      { itemKey: "milk", purchases: [NOW - 3 * 3_600_000, NOW - 2 * 3_600_000, NOW - 3_600_000] },
      { now: NOW },
    );

    expect(Number.isFinite(r.overdueRatio)).toBe(true); // FAILS -> Infinity
    expect(r.intervalDays).toBeGreaterThan(0); // FAILS -> 0
  });

  it("D10b produces NaN when now === the last purchase", () => {
    const t = NOW - 3_600_000;
    const r = computeRhythm(
      { itemKey: "milk", purchases: [t - 2 * 3_600_000, t - 3_600_000, t] },
      { now: t },
    );

    expect(Number.isNaN(r.overdueRatio)).toBe(false); // FAILS -> NaN
  });

  it("D10c NEGATIVE CONTROL: identical purchase timestamps do not divide by zero", () => {
    const r = computeRhythm({ itemKey: "x", purchases: [ago(5), ago(5), ago(5), ago(5)] }, { now: NOW });
    expect(r.state).toBe("unknown");
    expect(Number.isFinite(r.overdueRatio)).toBe(true);
  });
});

describe("D11 rhythm: pausedMs dilutes the interval instead of pausing the clock", () => {
  const weekly = (sinceDays: number, extra = {}) =>
    computeRhythm(
      {
        itemKey: "milk",
        purchases: [ago(sinceDays + 21), ago(sinceDays + 14), ago(sinceDays + 7), ago(sinceDays)],
        ...extra,
      },
      { now: NOW },
    );

  it("D11a a 4-week holiday makes a 12-day-late item look merely 'due'", () => {
    // Bought 40 days ago, 28 of which the family was away: 12 days of real
    // consumption on a 7-day rhythm => nearly twice the interval => overdue.
    const r = weekly(40, { pausedMs: 28 * DAY_MS });

    expect(r.state).toBe("overdue"); // FAILS -> "due"
    expect(r.overdueRatio).toBeCloseTo(12 / 7 - 1, 1); // FAILS -> 0.14 instead of 0.71
  });

  it("D11b the pause is also charged to items bought after the holiday came back", () => {
    // Bought yesterday. The holiday was months ago but pausedMs is a single
    // global number handed to every item.
    const r = weekly(8, { pausedMs: 28 * DAY_MS });

    expect(r.state).toBe("due"); // FAILS -> "quiet": interval inflated 7d -> 35d
  });
});

describe("D12 rhythm: the median protects the interval but not the confidence", () => {
  it("D12a a single bulk-purchase gap zeroes the confidence of a perfectly weekly item", () => {
    const r = computeRhythm(
      { itemKey: "coffee", purchases: [ago(88), ago(81), ago(74), ago(67), ago(7)] },
      { now: NOW },
    );

    expect(r.intervalDays).toBe(7); // holds — FR-731 is honoured here
    expect(r.confidence).toBeGreaterThan(0); // FAILS -> 0
  });
});

describe("D13 rhythm: NEGATIVE CONTROLS", () => {
  it("D13a dismissals cannot silence an item permanently", () => {
    const many = Array.from({ length: 20 }, (_, i) => ago(i + 1));
    const r = computeRhythm(
      { itemKey: "olives", purchases: [ago(28), ago(21), ago(14), ago(30)], dismissals: many },
      { now: NOW },
    );
    expect(["due", "overdue"]).toContain(r.state);
  });
});

// ---------------------------------------------------------------------------
// 5. PROJECTIONS
// ---------------------------------------------------------------------------

let wall = 1000;
function pop(kind: Operation["kind"], t: string, id: string, payload: Record<string, Value>): Operation {
  wall += 1;
  return makeOperation({
    opId: newId(),
    familyId: FAMILY,
    deviceId: "d",
    actorId: null,
    entityType: t,
    entityId: id,
    kind,
    payload,
    hlc: { wall, counter: 0, deviceId: "d" },
  });
}

function seedPlan(state: FamilyState, recipes: readonly { id: string; title: string; servings: number; ings: readonly Record<string, Value>[] }[]): void {
  for (const r of recipes) {
    state.apply(pop("entity.create", EntityTypes.recipe, r.id, { title: r.title, servings: r.servings, ingredients: r.ings }));
    state.apply(
      pop("entity.create", EntityTypes.mealSlot, "slot-" + r.id, {
        weekPlanId: "week-1",
        date: "2026-07-28",
        mealType: "dinner",
        recipeId: r.id,
      }),
    );
    for (const e of ["p1", "p2"]) {
      state.apply(pop("set.add", EntityTypes.mealSlot, "slot-" + r.id, { field: "eaters", member: e }));
    }
  }
}

describe("D14 plan: merging incompatible dimensions hides one of them", () => {
  it("D14a '3 onions' plus '50 g onion' becomes '50 g'", () => {
    const state = new FamilyState();
    seedPlan(state, [
      { id: "r-a", title: "A", servings: 2, ings: [{ name: "Onion", amount: 3, unit: "piece" }] },
      { id: "r-b", title: "B", servings: 2, ings: [{ name: "Onion", amount: 50, unit: "g" }] },
    ]);

    const need = derivePlannedNeeds(state, "week-1").find((n) => n.itemKey === "onion");

    // Whatever the label says, it must not understate the count of whole onions.
    expect(need?.quantityLabel).not.toBe("50 g"); // FAILS
  });

  it("D14b NEGATIVE CONTROL: a whitespace-only ingredient name is dropped", () => {
    const state = new FamilyState();
    seedPlan(state, [{ id: "r-a", title: "A", servings: 2, ings: [{ name: "   ", amount: 1, unit: "piece" }] }]);
    expect(derivePlannedNeeds(state, "week-1")).toHaveLength(0);
  });

  it("D14c NEGATIVE CONTROL: a recipe with zero servings does not divide by zero", () => {
    const state = new FamilyState();
    seedPlan(state, [{ id: "r-a", title: "A", servings: 0, ings: [{ name: "Rice", amount: 200, unit: "g" }] }]);
    const need = derivePlannedNeeds(state, "week-1")[0];
    expect(need?.quantity?.canonicalAmount).toBe(200);
  });
});

describe("D15 shopping: a manual line silently swallows the planned quantity", () => {
  it("D15a", () => {
    const state = new FamilyState();
    state.apply(pop("entity.create", EntityTypes.shoppingList, "L", { domain: "groceries" }));
    seedPlan(state, [
      { id: "r-a", title: "A", servings: 2, ings: [{ name: "Milk", amount: 500, unit: "ml" }] },
      { id: "r-b", title: "B", servings: 2, ings: [{ name: "Milk", amount: 700, unit: "ml" }] },
    ]);
    // Somebody had already jotted "milk" on the list before the week was planned.
    state.apply(
      pop("entity.create", EntityTypes.shoppingItem, "i-milk", {
        listId: "L",
        name: "Milk",
        itemKey: canonicalItemKey("Milk"),
        checked: false,
      }),
    );

    const view = buildShoppingList(state, {
      listId: "L",
      now: NOW,
      plannedNeeds: derivePlannedNeeds(state, "week-1"),
    });
    const line = view.groups.flatMap((g) => g.lines).find((l) => l.itemKey === "milk");

    expect(line?.quantityLabel).toBe("1.2 l"); // FAILS -> "" (the 1.2 l is gone)
    expect(line?.plannedFrom.length).toBeGreaterThan(0); // FAILS -> 0, "why is this here?" unanswerable
  });
});

describe("D16 shopping: a just-ticked item is suggested again straight away", () => {
  it("D16a", () => {
    const state = new FamilyState();
    state.apply(pop("entity.create", EntityTypes.shoppingList, "L", { domain: "groceries" }));
    state.apply(pop("entity.create", EntityTypes.catalogItem, "coffee", { productGroup: "drinks" }));
    for (const d of [28, 21, 14, 7]) {
      state.apply(pop("set.add", EntityTypes.catalogItem, "coffee", { field: "purchases", member: String(ago(d)) }));
    }
    state.apply(
      pop("entity.create", EntityTypes.shoppingItem, "i-coffee", {
        listId: "L",
        name: "Coffee",
        itemKey: "coffee",
        checked: true,
      }),
    );

    const view = buildShoppingList(state, { listId: "L", now: NOW });

    expect(view.probablyDue.map((r) => r.itemKey)).not.toContain("coffee"); // FAILS
  });
});

describe("D17 shopping: NEGATIVE CONTROL — a multi-store item is not counted twice", () => {
  it("D17a", () => {
    const state = new FamilyState();
    state.apply(pop("entity.create", EntityTypes.shoppingList, "L", { domain: "groceries" }));
    state.apply(pop("entity.create", EntityTypes.catalogItem, "tea", { productGroup: "drinks" }));
    state.apply(pop("set.add", EntityTypes.catalogItem, "tea", { field: "stores", member: "s1" }));
    state.apply(pop("set.add", EntityTypes.catalogItem, "tea", { field: "stores", member: "s2" }));
    state.apply(
      pop("entity.create", EntityTypes.shoppingItem, "i-tea", { listId: "L", name: "Tea", itemKey: "tea", checked: false }),
    );

    const view = buildShoppingList(state, { listId: "L", now: NOW, grouping: "store" });

    expect(view.openCount).toBe(1);
    expect(view.groups.flatMap((g) => g.lines)).toHaveLength(2); // appears twice on screen, by design
  });
});
