/**
 * One test body, every store.
 *
 * The whole architecture leans on the implementations being indistinguishable:
 * the simulation harness and the convergence property tests run against
 * `MemoryStateStore`, phones run `SqlStateStore`, and the browser runs
 * `IndexedDbStateStore`. Anything asserted here is a promise those layers make
 * to those tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  applyOperation,
  emptyEntity,
  HlcClock,
  makeOperation,
  newId,
  type HlcStamp,
  type Operation,
  type OpKind,
  type SequencedOperation,
  type StoredEntity,
  type Value,
} from "@fam/domain";
import {
  IndexedDbStateStore,
  MemoryStateStore,
  META_LAST_SEQ,
  SqlStateStore,
  type ConflictRecord,
  type StateStore,
} from "../src/index.js";
import { BetterSqlite3Driver } from "../src/drivers/better-sqlite3.js";

const FAMILY = "family-01";
const ACTOR = "person-mom";
const BASE_WALL = 1_700_000_000_000;

function clockAt(deviceId: string, wall: number): HlcClock {
  return new HlcClock({ deviceId, now: () => wall });
}

function op(
  entityId: string,
  payload: Record<string, Value>,
  hlc: HlcStamp,
  extra?: {
    readonly kind?: OpKind;
    readonly entityType?: string;
    readonly base?: Record<string, number>;
  },
): Operation {
  return makeOperation({
    opId: newId(),
    familyId: FAMILY,
    deviceId: hlc.deviceId,
    actorId: ACTOR,
    entityType: extra?.entityType ?? "task",
    entityId,
    kind: extra?.kind ?? "entity.setFields",
    payload,
    hlc,
    ...(extra?.base === undefined ? {} : { base: extra.base }),
  });
}

function sequenced(operation: Operation, seq: number): SequencedOperation {
  return { ...operation, seq };
}

/** Built through the reducer so the stored shape is one the app really produces. */
function task(id: string, title: string, options?: { readonly deleted?: boolean }): StoredEntity {
  const clock = clockAt("device-a", BASE_WALL);
  let entity = applyOperation(
    emptyEntity("task", id, FAMILY),
    op(id, { title, ownerId: ACTOR, effort: 2 }, clock.next(), { kind: "entity.create" }),
  ).entity;
  entity = applyOperation(
    entity,
    op(id, { field: "tags", member: "kitchen" }, clock.next(), { kind: "set.add" }),
  ).entity;
  if (options?.deleted === true) {
    entity = applyOperation(entity, op(id, {}, clock.next(), { kind: "entity.delete" })).entity;
  }
  return entity;
}

function event(id: string, title: string): StoredEntity {
  const clock = clockAt("device-b", BASE_WALL);
  return applyOperation(
    emptyEntity("event", id, FAMILY),
    op(id, { title, startsAt: "2026-08-01T09:00:00Z" }, clock.next(), {
      kind: "entity.create",
      entityType: "event",
    }),
  ).entity;
}

/**
 * A real Tier-2 divergence: `field` is critical on `task`, and a stale `base`
 * against a differing value is exactly what the reducer refuses to merge.
 * `dueAt` additionally yields a conflict whose current side is `undefined` — the
 * author had seen version 3 of a field this replica never received a write for —
 * which is the case a naive JSON round-trip loses.
 */
function conflict(id: string, field: "ownerId" | "dueAt", detectedAtSeq: number): ConflictRecord {
  const current = task("task-a", "Refill the water filter");
  const incoming = op(
    "task-a",
    field === "ownerId" ? { ownerId: "person-dad" } : { dueAt: "2026-08-03T18:00:00Z" },
    clockAt("device-b", BASE_WALL + 60_000).next(),
    { base: { [field]: field === "ownerId" ? 0 : 3 } },
  );
  const detected = applyOperation(current, incoming).conflicts[0];
  if (detected === undefined) throw new Error(`fixture produced no conflict on ${field}`);
  return { ...detected, id, familyId: FAMILY, detectedAtSeq, resolvedAt: null };
}

function ids(entities: readonly StoredEntity[]): readonly string[] {
  return entities.map((entity) => entity.id);
}

function seqs(ops: readonly SequencedOperation[]): readonly number[] {
  return ops.map((operation) => operation.seq);
}

function opIds(ops: readonly { readonly opId: string }[]): readonly string[] {
  return ops.map((operation) => operation.opId);
}

const implementations = [
  { name: "MemoryStateStore", open: (): StateStore => new MemoryStateStore() },
  {
    name: "SqlStateStore over better-sqlite3 :memory:",
    open: (): StateStore => new SqlStateStore(new BetterSqlite3Driver()),
  },
  {
    // A fresh factory per store, so one test's database cannot leak into the
    // next — a real browser gives each origin exactly one, which is the point.
    name: "IndexedDbStateStore",
    open: (): StateStore => new IndexedDbStateStore({ factory: new IDBFactory() }),
  },
];

describe.each(implementations)("$name", ({ open }) => {
  let store: StateStore;

  beforeEach(async () => {
    store = open();
    await store.init();
  });

  afterEach(async () => {
    await store.close();
  });

  it("tolerates init() twice", async () => {
    await store.init();
    await store.putEntities([task("task-a", "Water the plants")]);
    expect(await store.getEntity("task", "task-a")).toBeDefined();
  });

  it("round-trips entities and lists them by id, deleted ones excluded", async () => {
    await store.putEntities([
      task("task-c", "Book the dentist"),
      task("task-a", "Water the plants"),
      task("task-b", "Fix the shelf"),
      task("task-d", "Cancelled errand", { deleted: true }),
      event("event-a", "Swimming lesson"),
    ]);

    expect(await store.getEntity("task", "task-a")).toEqual(task("task-a", "Water the plants"));
    expect(await store.getEntity("task", "nope")).toBeUndefined();
    expect(await store.getEntity("event", "task-a")).toBeUndefined();

    expect(ids(await store.listEntities("task"))).toEqual(["task-a", "task-b", "task-c"]);
    expect(ids(await store.listEntities("task", { includeDeleted: true }))).toEqual([
      "task-a",
      "task-b",
      "task-c",
      "task-d",
    ]);
    expect(ids(await store.listEntities("task", { includeDeleted: false }))).toEqual([
      "task-a",
      "task-b",
      "task-c",
    ]);
    expect(ids(await store.listEntities("event"))).toEqual(["event-a"]);
    expect(await store.listEntities("shoppingItem")).toEqual([]);
    expect(await store.entityTypes()).toEqual(["event", "task"]);
  });

  it("preserves field, set and meta detail across a write", async () => {
    const stored = task("task-a", "Water the plants");
    await store.putEntities([stored]);
    const read = await store.getEntity("task", "task-a");
    expect(read).toStrictEqual(stored);
    expect(read?.fields["effort"]).toBe(2);
    expect(read?.sets["tags"]?.["kitchen"]).toStrictEqual({ present: true, hlc: expect.anything() });
    expect(read?.meta["title"]?.version).toBe(1);
  });

  it("overwrites an entity in place", async () => {
    await store.putEntities([task("task-a", "Water the plants")]);
    const renamed = task("task-a", "Water the plants twice");
    await store.putEntities([renamed]);
    expect(await store.getEntity("task", "task-a")).toEqual(renamed);
    expect(await store.listEntities("task")).toHaveLength(1);
  });

  it("round-trips meta values", async () => {
    expect(await store.getMeta(META_LAST_SEQ)).toBeUndefined();
    await store.setMeta(META_LAST_SEQ, "41");
    expect(await store.getMeta(META_LAST_SEQ)).toBe("41");
    await store.setMeta(META_LAST_SEQ, "42");
    expect(await store.getMeta(META_LAST_SEQ)).toBe("42");
    await store.setMeta("device.nickname", "");
    expect(await store.getMeta("device.nickname")).toBe("");
  });

  it("appends confirmed ops in seq order and ignores opIds it already has", async () => {
    const clock = clockAt("device-a", BASE_WALL);
    const first = sequenced(op("task-a", { title: "Water the plants" }, clock.next()), 1);
    const second = sequenced(op("task-a", { title: "Water all the plants" }, clock.next()), 2);
    const third = sequenced(op("task-a", { effort: 3 }, clock.next()), 3);

    await store.appendConfirmedOps([third, first]);
    await store.appendConfirmedOps([second]);
    expect(seqs(await store.opsForEntity("task", "task-a"))).toEqual([1, 2, 3]);

    const replay: SequencedOperation = { ...second, payload: { title: "Clobbered" } };
    await store.appendConfirmedOps([replay, third]);
    const ops = await store.opsForEntity("task", "task-a");
    expect(seqs(ops)).toEqual([1, 2, 3]);
    expect(ops[1]?.payload).toEqual({ title: "Water all the plants" });
  });

  it("returns only the requested entity's ops", async () => {
    const clock = clockAt("device-a", BASE_WALL);
    const mine = sequenced(op("task-a", { effort: 1 }, clock.next()), 1);
    const otherId = sequenced(op("task-b", { effort: 1 }, clock.next()), 2);
    const otherType = sequenced(op("task-a", { title: "Swimming" }, clock.next(), {
      entityType: "event",
    }), 3);
    await store.appendConfirmedOps([mine, otherId, otherType]);

    expect(opIds(await store.opsForEntity("task", "task-a"))).toEqual([mine.opId]);
    expect(opIds(await store.opsForEntity("task", "task-b"))).toEqual([otherId.opId]);
    expect(opIds(await store.opsForEntity("event", "task-a"))).toEqual([otherType.opId]);
    expect(await store.opsForEntity("task", "unknown")).toEqual([]);
  });

  it("prunes ops by wall clock and reports how many went", async () => {
    const old = sequenced(op("task-a", { effort: 1 }, clockAt("device-a", BASE_WALL).next()), 1);
    const mid = sequenced(
      op("task-a", { effort: 2 }, clockAt("device-a", BASE_WALL + 1_000).next()),
      2,
    );
    const fresh = sequenced(
      op("task-a", { effort: 3 }, clockAt("device-a", BASE_WALL + 2_000).next()),
      3,
    );
    await store.appendConfirmedOps([old, mid, fresh]);

    expect(await store.pruneOpsBefore(BASE_WALL)).toBe(0);
    expect(await store.pruneOpsBefore(BASE_WALL + 1_000)).toBe(1);
    expect(seqs(await store.opsForEntity("task", "task-a"))).toEqual([2, 3]);
    expect(await store.pruneOpsBefore(BASE_WALL + 1_000)).toBe(0);
    expect(await store.pruneOpsBefore(BASE_WALL + 10_000)).toBe(2);
    expect(await store.opsForEntity("task", "task-a")).toEqual([]);
  });

  it("keeps the outbox in enqueue order, without duplicates", async () => {
    const clock = clockAt("device-a", BASE_WALL);
    const a = op("task-a", { title: "Buy milk" }, clock.next());
    const b = op("task-b", { title: "Buy bread" }, clock.next());
    const c = op("task-c", { title: "Buy jam" }, clock.next());
    const d = op("task-d", { title: "Buy tea" }, clock.next());

    expect(await store.outbox()).toEqual([]);
    await store.enqueueOutbox([a, b]);
    await store.enqueueOutbox([b, c]);
    expect(opIds(await store.outbox())).toEqual([a.opId, b.opId, c.opId]);
    expect((await store.outbox())[0]).toEqual(a);

    await store.dequeueOutbox([a.opId]);
    await store.dequeueOutbox(["never-enqueued"]);
    await store.enqueueOutbox([d]);
    expect(opIds(await store.outbox())).toEqual([b.opId, c.opId, d.opId]);

    await store.dequeueOutbox([b.opId, c.opId, d.opId]);
    expect(await store.outbox()).toEqual([]);
  });

  it("lists open conflicts oldest first and hides resolved ones", async () => {
    const later = conflict("conflict-2", "ownerId", 7);
    const earlier = conflict("conflict-1", "dueAt", 3);

    expect(await store.openConflicts()).toEqual([]);
    await store.putConflicts([later, earlier]);
    expect(await store.openConflicts()).toStrictEqual([earlier, later]);

    await store.markConflictResolved("conflict-1", "2026-07-28T10:00:00Z");
    expect(await store.openConflicts()).toStrictEqual([later]);

    await store.markConflictResolved("never-detected", "2026-07-28T10:00:00Z");
    expect(await store.openConflicts()).toStrictEqual([later]);

    await store.markConflictResolved("conflict-2", "2026-07-28T10:05:00Z");
    expect(await store.openConflicts()).toEqual([]);
  });

  it("overwrites a conflict on re-put", async () => {
    const record = conflict("conflict-1", "ownerId", 5);
    await store.putConflicts([record]);
    const moved: ConflictRecord = { ...record, detectedAtSeq: 9 };
    await store.putConflicts([moved]);
    expect(await store.openConflicts()).toStrictEqual([moved]);
  });
});
