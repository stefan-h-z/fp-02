/**
 * The sync client — one per device.
 *
 * The model that makes everything else simple: the family's truth is the
 * server-ordered operation log, and this device's unsent work is an overlay on
 * top of it. Reads see the overlay, so the app feels instant offline; the overlay
 * shrinks as the server confirms the work. Because confirmed operations are only
 * ever applied in server order, two devices that have pulled to the same cursor
 * hold byte-identical state — including identical conflict decisions.
 */
import {
  FamilyState,
  HlcClock,
  type Operation,
  type SequencedOperation,
} from "@fam/domain";
import {
  META_CLOCK_COUNTER,
  META_CLOCK_WALL,
  META_LAST_SEQ,
  type ConflictRecord,
  type StateStore,
} from "@fam/storage";
import { MutationBuilder, type MutationContext } from "./mutation.js";
import { toConflictRecord } from "./conflicts.js";
import type { SyncTransport } from "./protocol.js";

export interface SyncClientOptions {
  readonly familyId: string;
  readonly deviceId: string;
  readonly store: StateStore;
  readonly transport: SyncTransport;
  /** Injected for deterministic tests. */
  readonly now?: () => number;
}

export type ConflictChoice = "keep-current" | "take-incoming";

/**
 * The entity a resolution is recorded as.
 *
 * A conflict is detected independently by every device that replays the log, so
 * the *decision* has to travel the same way — otherwise one person resolves it
 * and everyone else keeps being asked about it forever (FR-1215).
 */
export const CONFLICT_RESOLUTION_TYPE = "conflictResolution";

/**
 * Rejections that will never succeed however often they are retried. Anything
 * else — an unprovisioned family, a client newer than the server — is transient,
 * and throwing the work away would be exactly the data loss FR-1217 forbids.
 */
const PERMANENT_REJECTIONS = new Set(["schema-invalid", "not-authorized"]);

export interface SyncResult {
  readonly pushed: number;
  readonly pulled: number;
  readonly conflicts: readonly ConflictRecord[];
  readonly rejected: readonly string[];
}

type ChangeListener = () => void;

export class SyncClient {
  readonly familyId: string;
  readonly deviceId: string;

  private readonly store: StateStore;
  private readonly transport: SyncTransport;
  private readonly clock: HlcClock;
  private readonly listeners = new Set<ChangeListener>();

  /** State built strictly from confirmed operations, in server order. */
  private confirmed = new FamilyState();
  /** What the UI reads: confirmed plus this device's unsent operations. */
  private visible = new FamilyState();
  private pending = new Map<string, Operation>();
  private cursor = 0;
  private actorId: string | null = null;

  constructor(options: SyncClientOptions) {
    this.familyId = options.familyId;
    this.deviceId = options.deviceId;
    this.store = options.store;
    this.transport = options.transport;
    this.clock = new HlcClock({
      deviceId: options.deviceId,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  /** Hydrate from disk. Safe to call on every app start. */
  async open(): Promise<void> {
    await this.store.init();
    this.cursor = Number(await this.store.getMeta(META_LAST_SEQ) ?? 0);
    this.clock.restore({
      wall: Number(await this.store.getMeta(META_CLOCK_WALL) ?? 0),
      counter: Number(await this.store.getMeta(META_CLOCK_COUNTER) ?? 0),
    });

    const types = await this.store.entityTypes();
    const state = new FamilyState();
    for (const type of types) {
      for (const entity of await this.store.listEntities(type, { includeDeleted: true })) {
        state.put(entity);
      }
    }
    this.confirmed = state;

    this.pending = new Map((await this.store.outbox()).map((op) => [op.opId, op]));
    this.rebuildVisible();
  }

  /**
   * Bootstrap a device that has no local state: take the materialized snapshot
   * instead of replaying the whole log, which is the difference between a
   * new phone being usable in seconds and in minutes.
   */
  async bootstrap(): Promise<void> {
    const snapshot = await this.transport.snapshot({
      familyId: this.familyId,
      deviceId: this.deviceId,
    });
    const state = new FamilyState();
    for (const entity of snapshot.entities) {
      state.put(entity);
      // Without this the device would stamp its first writes from its own wall
      // clock, and a phone a minute behind would have every edit silently lost
      // to the values it was trying to change.
      for (const meta of Object.values(entity.meta)) this.clock.observe(meta.hlc);
      for (const members of Object.values(entity.sets)) {
        for (const member of Object.values(members)) this.clock.observe(member.hlc);
      }
    }
    this.confirmed = state;
    this.cursor = snapshot.cursor;

    await this.store.putEntities(snapshot.entities);
    await this.store.setMeta(META_LAST_SEQ, String(this.cursor));
    await this.persistClock();
    this.rebuildVisible();
    this.emit();
  }

  /** Who subsequent local changes are attributed to (SPEC FR-116). */
  setActor(actorId: string | null): void {
    this.actorId = actorId;
  }

  /** The state the UI renders. */
  state(): FamilyState {
    return this.visible;
  }

  hasUnsyncedWork(): boolean {
    return this.pending.size > 0;
  }

  unsyncedCount(): number {
    return this.pending.size;
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Record a change. Applies immediately to the visible state and survives an
   * app restart before it is ever sent (SPEC FR-1217).
   */
  async mutate(describe: (builder: MutationBuilder) => void): Promise<readonly Operation[]> {
    const builder = new MutationBuilder(this.mutationContext());
    describe(builder);
    const ops = builder.build();
    if (ops.length === 0) return ops;

    await this.store.enqueueOutbox(ops);
    await this.persistClock();

    // Onto a copy, and then swapped in — not applied in place. Subscribers
    // compare snapshots by identity (`useSyncExternalStore` does exactly that),
    // so mutating the object a screen is already holding notifies it of a
    // change it cannot see: the state is right, the tick never appears, and
    // offline there is nothing else to tell the person it counted. The clone
    // costs what `rebuildVisible` already costs on every pull.
    const next = this.visible.clone();
    for (const op of ops) {
      this.pending.set(op.opId, op);
      next.apply(op);
    }
    this.visible = next;

    this.emit();
    return ops;
  }

  /** Push, then pull until drained. The normal foreground cycle. */
  async sync(): Promise<SyncResult> {
    const pushResult = await this.push();
    const pullResult = await this.pull();
    return {
      pushed: pushResult.pushed,
      pulled: pullResult.pulled,
      conflicts: [...pushResult.conflicts, ...pullResult.conflicts],
      rejected: pushResult.rejected,
    };
  }

  async push(): Promise<{ pushed: number; conflicts: readonly ConflictRecord[]; rejected: readonly string[] }> {
    const ops = await this.store.outbox();
    if (ops.length === 0) return { pushed: 0, conflicts: [], rejected: [] };

    const response = await this.transport.push({
      familyId: this.familyId,
      deviceId: this.deviceId,
      ops,
    });

    // Accepted operations stay in the overlay until they come back through pull,
    // so the screen never flickers back to the pre-edit value in between.
    await this.store.dequeueOutbox(response.acceptedOpIds);

    const permanent = response.rejected
      .filter((rejection) => PERMANENT_REJECTIONS.has(rejection.reason))
      .map((rejection) => rejection.opId);

    if (permanent.length > 0) {
      await this.store.dequeueOutbox(permanent);
      for (const opId of permanent) this.pending.delete(opId);
      this.rebuildVisible();
      this.emit();
    }
    const rejected = response.rejected.map((r) => r.opId);

    const unresolved = response.conflicts.filter((conflict) => !this.isResolved(conflict.id));
    if (unresolved.length > 0) {
      await this.store.putConflicts(unresolved);
    }

    return { pushed: response.acceptedOpIds.length, conflicts: response.conflicts, rejected };
  }

  async pull(): Promise<{ pulled: number; conflicts: readonly ConflictRecord[] }> {
    let pulled = 0;
    const conflicts: ConflictRecord[] = [];

    for (;;) {
      const response = await this.transport.pull({
        familyId: this.familyId,
        deviceId: this.deviceId,
        cursor: this.cursor,
      });
      if (response.ops.length === 0) break;

      conflicts.push(...(await this.applyConfirmed(response.ops)));
      pulled += response.ops.length;
      this.cursor = response.nextCursor;
      await this.store.setMeta(META_LAST_SEQ, String(this.cursor));

      if (!response.hasMore) break;
    }

    if (pulled > 0) {
      this.rebuildVisible();
      this.emit();
    }
    return { pulled, conflicts };
  }

  /** Conflicts still waiting for a decision. */
  async openConflicts(): Promise<readonly ConflictRecord[]> {
    const stored = await this.store.openConflicts();
    return stored.filter((conflict) => !this.isResolved(conflict.id));
  }

  /** Was this conflict decided — by anyone, on any device? */
  private isResolved(conflictId: string): boolean {
    return this.visible.get(CONFLICT_RESOLUTION_TYPE, conflictId) !== undefined;
  }

  private async persistClock(): Promise<void> {
    const state = this.clock.snapshot();
    await this.store.setMeta(META_CLOCK_WALL, String(state.wall));
    await this.store.setMeta(META_CLOCK_COUNTER, String(state.counter));
  }

  /**
   * Resolve a conflict by choosing a side. Taking the incoming value writes it
   * with the current version claimed, so the write lands; keeping the current
   * value writes nothing and only closes the conflict.
   */
  async resolveConflict(conflict: ConflictRecord, choice: ConflictChoice, atIso: string): Promise<void> {
    await this.mutate((builder) => {
      if (choice === "take-incoming") {
        builder.force(conflict.entityType, conflict.entityId, conflict.field, conflict.incomingValue);
      }
      // Recorded as an operation rather than a local flag: the other devices
      // detected this conflict themselves and would otherwise keep asking.
      builder.create(CONFLICT_RESOLUTION_TYPE, conflict.id, {
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        field: conflict.field,
        choice,
        resolvedAt: atIso,
      });
    });
    await this.store.markConflictResolved(conflict.id, atIso);
    this.emit();
  }

  /** Per-object history (SPEC FR-1218), newest last. */
  async history(entityType: string, entityId: string): Promise<readonly SequencedOperation[]> {
    return this.store.opsForEntity(entityType, entityId);
  }

  private async applyConfirmed(ops: readonly SequencedOperation[]): Promise<readonly ConflictRecord[]> {
    const conflicts: ConflictRecord[] = [];
    const touched: SequencedOperation[] = [];

    for (const op of ops) {
      this.clock.observe(op.hlc);
      const outcome = this.confirmed.apply(op);
      touched.push(op);
      for (const conflict of outcome.conflicts) {
        const record = toConflictRecord(conflict, this.familyId, op.seq);
        // A conflict the family already decided must not come back because the
        // log was replayed after a cursor regression.
        if (!this.isResolved(record.id)) conflicts.push(record);
      }
      // Our own work has arrived; the overlay entry for it is now redundant.
      this.pending.delete(op.opId);
    }

    await this.store.appendConfirmedOps(touched);
    await this.store.dequeueOutbox(touched.map((op) => op.opId));
    await this.persistTouchedEntities(touched);
    if (conflicts.length > 0) await this.store.putConflicts(conflicts);

    return conflicts;
  }

  private async persistTouchedEntities(ops: readonly SequencedOperation[]): Promise<void> {
    const seen = new Set<string>();
    const entities = [];
    for (const op of ops) {
      const key = op.entityType + " " + op.entityId;
      if (seen.has(key)) continue;
      seen.add(key);
      const entity = this.confirmed.get(op.entityType, op.entityId);
      if (entity !== undefined) entities.push(entity);
    }
    if (entities.length > 0) await this.store.putEntities(entities);
  }

  private rebuildVisible(): void {
    const state = this.confirmed.clone();
    for (const op of this.pending.values()) state.apply(op);
    this.visible = state;
  }

  private mutationContext(): MutationContext {
    return {
      familyId: this.familyId,
      deviceId: this.deviceId,
      actorId: this.actorId,
      state: this.visible,
      clock: this.clock,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
