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
    for (const entity of snapshot.entities) state.put(entity);
    this.confirmed = state;
    this.cursor = snapshot.cursor;

    await this.store.putEntities(snapshot.entities);
    await this.store.setMeta(META_LAST_SEQ, String(this.cursor));
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
    for (const op of ops) {
      this.pending.set(op.opId, op);
      this.visible.apply(op);
    }
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

    const rejected = response.rejected.map((r) => r.opId);
    if (rejected.length > 0) {
      await this.store.dequeueOutbox(rejected);
      for (const opId of rejected) this.pending.delete(opId);
      this.rebuildVisible();
      this.emit();
    }

    if (response.conflicts.length > 0) {
      await this.store.putConflicts(response.conflicts);
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
    return this.store.openConflicts();
  }

  /**
   * Resolve a conflict by choosing a side. Taking the incoming value writes it
   * with the current version claimed, so the write lands; keeping the current
   * value writes nothing and only closes the conflict.
   */
  async resolveConflict(conflict: ConflictRecord, choice: ConflictChoice, atIso: string): Promise<void> {
    if (choice === "take-incoming") {
      await this.mutate((builder) => {
        builder.force(conflict.entityType, conflict.entityId, conflict.field, conflict.incomingValue);
      });
    }
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
        conflicts.push(toConflictRecord(conflict, this.familyId, op.seq));
      }
      // Our own work has arrived; the overlay entry for it is now redundant.
      this.pending.delete(op.opId);
    }

    await this.store.appendConfirmedOps(touched);
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
