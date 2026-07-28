/**
 * The one thing the equivalence suite cannot assert.
 *
 * `MemoryStateStore` passes every test in `store-equivalence.test.ts` and still
 * loses the family's data on reload, so equivalence alone is not evidence that
 * the web build persists. That claim needs a store that is closed and opened
 * again over the same origin's database — which is what a browser does on every
 * refresh, and what these tests do.
 */
import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  applyOperation,
  emptyEntity,
  HlcClock,
  makeOperation,
  newId,
  type Operation,
  type SequencedOperation,
  type StoredEntity,
} from "@fam/domain";
import { IndexedDbStateStore, META_LAST_SEQ, type StateStore } from "../src/index.js";

const FAMILY = "family-01";
const ACTOR = "person-mom";
const BASE_WALL = 1_700_000_000_000;

/** One factory stands in for one origin: every reopen sees the same database. */
function browser(): { readonly reload: () => Promise<StateStore> } {
  const factory = new IDBFactory();
  return {
    reload: async (): Promise<StateStore> => {
      const store = new IndexedDbStateStore({ factory, databaseName: "family" });
      await store.init();
      return store;
    },
  };
}

function op(entityId: string, payload: Record<string, string | number>, wall: number): Operation {
  return makeOperation({
    opId: newId(),
    familyId: FAMILY,
    deviceId: "device-a",
    actorId: ACTOR,
    entityType: "shoppingItem",
    entityId,
    kind: "entity.create",
    payload,
    hlc: new HlcClock({ deviceId: "device-a", now: () => wall }).next(),
  });
}

function item(id: string, name: string): StoredEntity {
  return applyOperation(
    emptyEntity("shoppingItem", id, FAMILY),
    op(id, { name, quantity: 1 }, BASE_WALL),
  ).entity;
}

describe("IndexedDbStateStore across a reload", () => {
  it("still holds the family's entities, meta and history", async () => {
    const origin = browser();
    const confirmed: SequencedOperation = { ...op("item-a", { name: "Milk" }, BASE_WALL), seq: 7 };

    const first = await origin.reload();
    await first.putEntities([item("item-a", "Milk"), item("item-b", "Bread")]);
    await first.setMeta(META_LAST_SEQ, "7");
    await first.appendConfirmedOps([confirmed]);
    await first.close();

    const second = await origin.reload();
    expect(await second.getEntity("shoppingItem", "item-a")).toStrictEqual(item("item-a", "Milk"));
    expect(await second.getMeta(META_LAST_SEQ)).toBe("7");
    expect(await second.opsForEntity("shoppingItem", "item-a")).toStrictEqual([confirmed]);
    await second.close();
  });

  /**
   * The reason unsent work must outlive the tab: a person who adds something to
   * the list on a bad connection and closes the browser has not withdrawn it.
   * Losing the outbox here would lose their edit silently.
   */
  it("keeps unsent operations queued, in order", async () => {
    const origin = browser();
    const first = await origin.reload();
    const a = op("item-a", { name: "Milk" }, BASE_WALL);
    const b = op("item-b", { name: "Bread" }, BASE_WALL + 1_000);
    const c = op("item-c", { name: "Jam" }, BASE_WALL + 2_000);
    await first.enqueueOutbox([a, b, c]);
    await first.close();

    const second = await origin.reload();
    expect((await second.outbox()).map((o) => o.opId)).toEqual([a.opId, b.opId, c.opId]);

    // A push that succeeded for the first two must not resurrect them either.
    await second.dequeueOutbox([a.opId, b.opId]);
    await second.close();

    const third = await origin.reload();
    expect((await third.outbox()).map((o) => o.opId)).toEqual([c.opId]);
    await third.close();
  });

  it("reopens an existing database without re-running the schema upgrade", async () => {
    const origin = browser();
    const first = await origin.reload();
    await first.putEntities([item("item-a", "Milk")]);
    await first.close();

    const second = await origin.reload();
    // A second init() on an already-open store is a no-op, not a re-upgrade.
    await second.init();
    expect(await second.listEntities("shoppingItem")).toHaveLength(1);
    await second.close();
  });

  it("refuses to be used before init(), rather than silently doing nothing", async () => {
    const store = new IndexedDbStateStore({ factory: new IDBFactory() });
    await expect(store.getMeta(META_LAST_SEQ)).rejects.toThrow(/before init/);
  });
});
