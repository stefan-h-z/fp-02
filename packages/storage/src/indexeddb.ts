/**
 * Web store — IndexedDB.
 *
 * This is the fallback PLAN §3.3 names for WP-0.7, and it is what the browser
 * actually runs. The wa-sqlite route needs the database to live in OPFS, whose
 * access handles are exclusive: a second tab does not queue behind the first, it
 * fails, so that route only works with a SharedWorker owning the one connection
 * for the whole origin. IndexedDB has no such problem — its transactions are
 * already atomic across tabs — so the fallback removes a moving part rather than
 * adding one, and the app persists on the web today instead of after a worker.
 *
 * The cost is that this implements `StateStore` directly rather than reusing
 * `SqlStateStore`. That is the reason the equivalence suite runs this store's
 * body too: the promise the architecture leans on is that no caller can tell the
 * implementations apart.
 *
 * Values go in as live objects, not JSON. IndexedDB clones structurally, which
 * preserves a property explicitly set to `undefined` — and a conflict whose
 * current side is `undefined` (the author had seen a version of a field this
 * replica never received) is exactly the case a JSON round-trip silently drops.
 */
import type { Operation, SequencedOperation, StoredEntity } from "@fam/domain";
import type { ConflictRecord, StateStore } from "./types.js";

const ENTITIES = "entities";
const META = "meta";
const OPS = "ops";
const OUTBOX = "outbox";
const CONFLICTS = "conflicts";

/** Bumping this runs `onupgradeneeded`; see `upgrade` for what that may do. */
const SCHEMA_VERSION = 1;

interface MetaRow {
  readonly key: string;
  readonly value: string;
}

/** `order` is the key generator's, so it is absent on the way in. */
interface OutboxRow {
  readonly order?: number;
  readonly opId: string;
  readonly op: Operation;
}

export interface IndexedDbStateStoreOptions {
  /** Injectable so tests get an isolated factory rather than the page's. */
  readonly factory?: IDBFactory;
  readonly databaseName?: string;
}

export class IndexedDbStateStore implements StateStore {
  private readonly factory: IDBFactory;
  private readonly databaseName: string;
  private database: IDBDatabase | undefined;

  constructor(options: IndexedDbStateStoreOptions = {}) {
    const factory = options.factory ?? globalThis.indexedDB;
    if (factory === undefined) {
      throw new Error("IndexedDbStateStore needs an IDBFactory; this runtime has none");
    }
    this.factory = factory;
    this.databaseName = options.databaseName ?? "family";
  }

  async init(): Promise<void> {
    if (this.database !== undefined) return;
    const open = this.factory.open(this.databaseName, SCHEMA_VERSION);
    open.onupgradeneeded = () => {
      upgrade(open.result);
    };
    this.database = await request(open);
  }

  async close(): Promise<void> {
    this.database?.close();
    this.database = undefined;
  }

  async getEntity(type: string, id: string): Promise<StoredEntity | undefined> {
    const tx = this.read(ENTITIES);
    return await request<StoredEntity | undefined>(tx.objectStore(ENTITIES).get([type, id]));
  }

  async putEntities(entities: readonly StoredEntity[]): Promise<void> {
    const tx = this.write(ENTITIES);
    const store = tx.objectStore(ENTITIES);
    for (const entity of entities) store.put(entity);
    await committed(tx);
  }

  async listEntities(
    type: string,
    options?: { readonly includeDeleted?: boolean },
  ): Promise<readonly StoredEntity[]> {
    const tx = this.read(ENTITIES);
    const found = await request<StoredEntity[]>(
      tx.objectStore(ENTITIES).index("type").getAll(type),
    );
    const includeDeleted = options?.includeDeleted === true;
    return found.filter((entity) => includeDeleted || !entity.deleted).sort(byId);
  }

  async entityTypes(): Promise<readonly string[]> {
    const tx = this.read(ENTITIES);
    const index = tx.objectStore(ENTITIES).index("type");
    const types: string[] = [];
    // `nextunique` walks one entry per distinct type, so this costs the number of
    // types rather than the number of entities.
    await eachKey(index.openKeyCursor(null, "nextunique"), (cursor) => {
      types.push(String(cursor.key));
      return true;
    });
    return types;
  }

  async getMeta(key: string): Promise<string | undefined> {
    const tx = this.read(META);
    const row = await request<MetaRow | undefined>(tx.objectStore(META).get(key));
    return row?.value;
  }

  async setMeta(key: string, value: string): Promise<void> {
    const tx = this.write(META);
    tx.objectStore(META).put({ key, value } satisfies MetaRow);
    await committed(tx);
  }

  async appendConfirmedOps(ops: readonly SequencedOperation[]): Promise<void> {
    const tx = this.write(OPS);
    const store = tx.objectStore(OPS);
    for (const op of ops) {
      // `add` rather than `put`: an opId already held is the authoritative copy,
      // and a replayed pull must not overwrite it with a later rewriting.
      const existing = await request<SequencedOperation | undefined>(store.get(op.opId));
      if (existing === undefined) store.add(op);
    }
    await committed(tx);
  }

  async opsForEntity(type: string, id: string): Promise<readonly SequencedOperation[]> {
    const tx = this.read(OPS);
    const found = await request<SequencedOperation[]>(
      tx.objectStore(OPS).index("entity").getAll([type, id]),
    );
    return found.sort((a, b) => a.seq - b.seq);
  }

  async pruneOpsBefore(wallMs: number): Promise<number> {
    const tx = this.write(OPS);
    const store = tx.objectStore(OPS);
    const stale: IDBValidKey[] = [];
    // A bounded cursor rather than `IDBKeyRange.upperBound`: the range
    // constructor is a page global, and this store is handed its factory
    // precisely so it never reaches for one. The index is ordered by wall
    // clock, so stopping at the first live operation still visits only the
    // stale ones.
    await eachKey(store.index("wall").openKeyCursor(), (cursor) => {
      if (Number(cursor.key) >= wallMs) return false;
      stale.push(cursor.primaryKey);
      return true;
    });
    for (const key of stale) store.delete(key);
    await committed(tx);
    return stale.length;
  }

  async enqueueOutbox(ops: readonly Operation[]): Promise<void> {
    const tx = this.write(OUTBOX);
    const store = tx.objectStore(OUTBOX);
    for (const op of ops) {
      const known = await request<IDBValidKey | undefined>(store.index("opId").getKey(op.opId));
      if (known === undefined) store.add({ opId: op.opId, op } satisfies OutboxRow);
    }
    await committed(tx);
  }

  async outbox(): Promise<readonly Operation[]> {
    const tx = this.read(OUTBOX);
    // Rows come back in key order, and the key is the enqueue counter, so this is
    // the order the operations were produced in — which is the order the server
    // must receive them in.
    const rows = await request<OutboxRow[]>(tx.objectStore(OUTBOX).getAll());
    return rows.map((row) => row.op);
  }

  async dequeueOutbox(opIds: readonly string[]): Promise<void> {
    const tx = this.write(OUTBOX);
    const store = tx.objectStore(OUTBOX);
    for (const opId of opIds) {
      const key = await request<IDBValidKey | undefined>(store.index("opId").getKey(opId));
      if (key !== undefined) store.delete(key);
    }
    await committed(tx);
  }

  async putConflicts(conflicts: readonly ConflictRecord[]): Promise<void> {
    const tx = this.write(CONFLICTS);
    const store = tx.objectStore(CONFLICTS);
    for (const conflict of conflicts) store.put(conflict);
    await committed(tx);
  }

  async openConflicts(): Promise<readonly ConflictRecord[]> {
    const tx = this.read(CONFLICTS);
    const all = await request<ConflictRecord[]>(tx.objectStore(CONFLICTS).getAll());
    return all
      .filter((conflict) => conflict.resolvedAt === null)
      .sort((a, b) => a.detectedAtSeq - b.detectedAtSeq);
  }

  async markConflictResolved(id: string, atIso: string): Promise<void> {
    const tx = this.write(CONFLICTS);
    const store = tx.objectStore(CONFLICTS);
    const existing = await request<ConflictRecord | undefined>(store.get(id));
    if (existing !== undefined) store.put({ ...existing, resolvedAt: atIso });
    await committed(tx);
  }

  private read(name: string): IDBTransaction {
    return this.open().transaction(name, "readonly");
  }

  private write(name: string): IDBTransaction {
    return this.open().transaction(name, "readwrite");
  }

  private open(): IDBDatabase {
    if (this.database === undefined) {
      throw new Error("IndexedDbStateStore used before init()");
    }
    return this.database;
  }
}

function upgrade(database: IDBDatabase): void {
  // Entities are keyed by the pair, so two types may share an id without one
  // shadowing the other — `getEntity("event", "task-a")` must miss.
  const entities = database.createObjectStore(ENTITIES, { keyPath: ["type", "id"] });
  entities.createIndex("type", "type");

  database.createObjectStore(META, { keyPath: "key" });

  const ops = database.createObjectStore(OPS, { keyPath: "opId" });
  ops.createIndex("entity", ["entityType", "entityId"]);
  ops.createIndex("wall", "hlc.wall");

  // The generated key doubles as the enqueue order; nothing else needs to track it.
  const outbox = database.createObjectStore(OUTBOX, { keyPath: "order", autoIncrement: true });
  outbox.createIndex("opId", "opId", { unique: true });

  database.createObjectStore(CONFLICTS, { keyPath: "id" });
}

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Awaiting the transaction rather than the last request: a request succeeding
 * only means the change is staged, and a caller that has awaited a write is
 * entitled to assume it survives a reload.
 */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** `visit` returning false stops the walk, leaving the rest of the index unread. */
function eachKey(
  req: IDBRequest<IDBCursor | null>,
  visit: (cursor: IDBCursor) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor === null || !visit(cursor)) {
        resolve();
        return;
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB cursor failed"));
  });
}
