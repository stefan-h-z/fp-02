/**
 * Convergence properties.
 *
 * Example tests show that the cases we thought of work. These generate the cases
 * we did not think of: random work on random devices, synced in a random order,
 * with devices going offline for arbitrary stretches. The promise being checked
 * is the one the whole product rests on — after everyone has synced, everyone
 * sees exactly the same thing, and it is the same thing the server has
 * (SPEC FR-1215, SC-005, SC-009).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EntityTypes, FamilyState, type SequencedOperation } from "@fam/domain";
import { MemoryStateStore } from "@fam/storage";
import { ReferenceServer, SyncClient } from "@fam/sync";

const FAMILY = "fam-1";
const ITEM_IDS = ["item-1", "item-2", "item-3"] as const;
const EVENT_IDS = ["event-1", "event-2"] as const;

type Action =
  | { readonly kind: "create-item"; readonly device: number; readonly item: number }
  | { readonly kind: "check"; readonly device: number; readonly item: number; readonly checked: boolean }
  | { readonly kind: "note"; readonly device: number; readonly item: number; readonly note: string }
  | { readonly kind: "store"; readonly device: number; readonly item: number; readonly store: string; readonly add: boolean }
  | { readonly kind: "delete-item"; readonly device: number; readonly item: number }
  | { readonly kind: "create-event"; readonly device: number; readonly event: number }
  | { readonly kind: "move-event"; readonly device: number; readonly event: number; readonly hour: number }
  | { readonly kind: "sync"; readonly device: number };

const actionArb = (deviceCount: number): fc.Arbitrary<Action> =>
  fc.oneof(
    fc.record({
      kind: fc.constant("create-item" as const),
      device: fc.integer({ min: 0, max: deviceCount - 1 }),
      item: fc.integer({ min: 0, max: ITEM_IDS.length - 1 }),
    }),
    fc.record({
      kind: fc.constant("check" as const),
      device: fc.integer({ min: 0, max: deviceCount - 1 }),
      item: fc.integer({ min: 0, max: ITEM_IDS.length - 1 }),
      checked: fc.boolean(),
    }),
    fc.record({
      kind: fc.constant("note" as const),
      device: fc.integer({ min: 0, max: deviceCount - 1 }),
      item: fc.integer({ min: 0, max: ITEM_IDS.length - 1 }),
      note: fc.constantFrom("small", "large", "any brand"),
    }),
    fc.record({
      kind: fc.constant("store" as const),
      device: fc.integer({ min: 0, max: deviceCount - 1 }),
      item: fc.integer({ min: 0, max: ITEM_IDS.length - 1 }),
      store: fc.constantFrom("aldi", "market", "pharmacy"),
      add: fc.boolean(),
    }),
    fc.record({
      kind: fc.constant("delete-item" as const),
      device: fc.integer({ min: 0, max: deviceCount - 1 }),
      item: fc.integer({ min: 0, max: ITEM_IDS.length - 1 }),
    }),
    fc.record({
      kind: fc.constant("create-event" as const),
      device: fc.integer({ min: 0, max: deviceCount - 1 }),
      event: fc.integer({ min: 0, max: EVENT_IDS.length - 1 }),
    }),
    fc.record({
      kind: fc.constant("move-event" as const),
      device: fc.integer({ min: 0, max: deviceCount - 1 }),
      event: fc.integer({ min: 0, max: EVENT_IDS.length - 1 }),
      hour: fc.integer({ min: 8, max: 20 }),
    }),
    // Syncs are frequent on purpose: partitions of every length then appear
    // naturally between them, rather than only at the end of a run.
    fc.record({ kind: fc.constant("sync" as const), device: fc.integer({ min: 0, max: deviceCount - 1 }) }),
    fc.record({ kind: fc.constant("sync" as const), device: fc.integer({ min: 0, max: deviceCount - 1 }) }),
  );

class Simulation {
  readonly server = new ReferenceServer({ families: [FAMILY] });
  readonly clients: SyncClient[] = [];
  private wall = 1_700_000_000_000;

  private tick = (): number => {
    this.wall += 137;
    return this.wall;
  };

  async start(deviceCount: number): Promise<void> {
    for (let i = 0; i < deviceCount; i += 1) {
      const client = new SyncClient({
        familyId: FAMILY,
        deviceId: "device-" + i,
        store: new MemoryStateStore(),
        transport: this.server,
        now: this.tick,
      });
      await client.open();
      client.setActor("person-" + i);
      this.clients.push(client);
    }
  }

  async run(action: Action): Promise<void> {
    const client = this.clients[action.device];
    if (client === undefined) return;

    switch (action.kind) {
      case "create-item":
        await client.mutate((b) =>
          b.create(EntityTypes.shoppingItem, ITEM_IDS[action.item]!, { name: "Item " + action.item, checked: false }),
        );
        return;
      case "check":
        await client.mutate((b) => b.set(EntityTypes.shoppingItem, ITEM_IDS[action.item]!, { checked: action.checked }));
        return;
      case "note":
        await client.mutate((b) => b.set(EntityTypes.shoppingItem, ITEM_IDS[action.item]!, { note: action.note }));
        return;
      case "store":
        await client.mutate((b) =>
          action.add
            ? b.setAdd(EntityTypes.shoppingItem, ITEM_IDS[action.item]!, "stores", action.store)
            : b.setRemove(EntityTypes.shoppingItem, ITEM_IDS[action.item]!, "stores", action.store),
        );
        return;
      case "delete-item":
        await client.mutate((b) => b.delete(EntityTypes.shoppingItem, ITEM_IDS[action.item]!));
        return;
      case "create-event":
        await client.mutate((b) =>
          b.create(EntityTypes.event, EVENT_IDS[action.event]!, { title: "Event", startsAt: "2026-08-01T09:00:00Z" }),
        );
        return;
      case "move-event":
        await client.mutate((b) =>
          b.set(EntityTypes.event, EVENT_IDS[action.event]!, {
            startsAt: "2026-08-01T" + String(action.hour).padStart(2, "0") + ":00:00Z",
          }),
        );
        return;
      case "sync":
        await client.sync();
        return;
    }
  }

  /** Everyone comes back online and talks until nothing is left to say. */
  async settle(): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      for (const client of this.clients) await client.sync();
    }
  }
}

describe("convergence", () => {
  it("leaves every device holding exactly the server's state, whatever the interleaving", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb(3), { minLength: 1, maxLength: 40 }), async (actions) => {
        const simulation = new Simulation();
        await simulation.start(3);
        for (const action of actions) await simulation.run(action);
        await simulation.settle();

        const expected = simulation.server.stateOf(FAMILY).snapshot();
        for (const client of simulation.clients) {
          expect(client.state().snapshot()).toEqual(expected);
        }
      }),
      { numRuns: 60 },
    );
  });

  it("never loses a device's work: everything accepted ends up in the log exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb(2), { minLength: 1, maxLength: 30 }), async (actions) => {
        const simulation = new Simulation();
        await simulation.start(2);
        for (const action of actions) await simulation.run(action);
        await simulation.settle();

        const ops = simulation.server.opsOf(FAMILY);
        const opIds = new Set(ops.map((op) => op.opId));
        const seqs = ops.map((op) => op.seq);

        expect(opIds.size).toBe(ops.length);
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
        expect(new Set(seqs).size).toBe(seqs.length);

        for (const client of simulation.clients) {
          expect(client.hasUnsyncedWork()).toBe(false);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("is a pure function of the ordered log: replaying it reproduces the state exactly", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb(3), { minLength: 1, maxLength: 40 }), async (actions) => {
        const simulation = new Simulation();
        await simulation.start(3);
        for (const action of actions) await simulation.run(action);
        await simulation.settle();

        const log: readonly SequencedOperation[] = simulation.server.opsOf(FAMILY);
        const replay = new FamilyState();
        replay.applyAll(log);

        expect(replay.snapshot()).toEqual(simulation.server.stateOf(FAMILY).snapshot());
      }),
      { numRuns: 40 },
    );
  });

  it("is idempotent under replay: applying the log twice changes nothing", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb(2), { minLength: 1, maxLength: 30 }), async (actions) => {
        const simulation = new Simulation();
        await simulation.start(2);
        for (const action of actions) await simulation.run(action);
        await simulation.settle();

        const log = simulation.server.opsOf(FAMILY);
        const once = new FamilyState();
        once.applyAll(log);
        const twice = new FamilyState();
        twice.applyAll(log);
        twice.applyAll(log);

        expect(twice.snapshot()).toEqual(once.snapshot());
      }),
      { numRuns: 40 },
    );
  });

  it("keeps a device that stayed offline the whole time consistent once it returns", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb(2), { minLength: 5, maxLength: 30 }), async (actions) => {
        const simulation = new Simulation();
        await simulation.start(3);
        // Device 2 never appears in the generated actions: it is the phone in the
        // basement, or the tablet nobody touched for a week.
        for (const action of actions) await simulation.run(action);
        await simulation.settle();

        expect(simulation.clients[2]!.state().snapshot()).toEqual(simulation.server.stateOf(FAMILY).snapshot());
      }),
      { numRuns: 30 },
    );
  });
});
