/**
 * The persistence seam.
 *
 * Every platform the app runs on has SQLite available in some form, but three
 * different APIs (expo-sqlite, wa-sqlite/OPFS on the web, better-sqlite3 in Node
 * for tests). Everything above this file talks to `StateStore` and never learns
 * which one it got.
 */
import type { FieldConflict, Operation, SequencedOperation, StoredEntity } from "@fam/domain";

/** A conflict awaiting a human decision (SPEC FR-1215 Tier 2). */
export interface ConflictRecord extends FieldConflict {
  readonly id: string;
  readonly familyId: string;
  readonly detectedAtSeq: number;
  readonly resolvedAt: string | null;
}

export interface StateStore {
  init(): Promise<void>;
  close(): Promise<void>;

  getEntity(type: string, id: string): Promise<StoredEntity | undefined>;
  putEntities(entities: readonly StoredEntity[]): Promise<void>;
  listEntities(type: string, options?: { readonly includeDeleted?: boolean }): Promise<readonly StoredEntity[]>;
  entityTypes(): Promise<readonly string[]>;

  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;

  /** Confirmed operations, kept for per-object history (FR-1218) and repair. */
  appendConfirmedOps(ops: readonly SequencedOperation[]): Promise<void>;
  opsForEntity(type: string, id: string): Promise<readonly SequencedOperation[]>;
  /** Retention pruning (SPEC OBL-07: five years for histories). */
  pruneOpsBefore(wallMs: number): Promise<number>;

  enqueueOutbox(ops: readonly Operation[]): Promise<void>;
  outbox(): Promise<readonly Operation[]>;
  dequeueOutbox(opIds: readonly string[]): Promise<void>;

  putConflicts(conflicts: readonly ConflictRecord[]): Promise<void>;
  openConflicts(): Promise<readonly ConflictRecord[]>;
  markConflictResolved(id: string, atIso: string): Promise<void>;
}

export const META_LAST_SEQ = "sync.lastSeq";
export const META_DEVICE_ID = "device.id";
export const META_FAMILY_ID = "family.id";
export const META_SCHEMA_VERSION = "schema.version";
/** The hybrid logical clock survives a restart, or the device's own newer edit
 * could lose to its own older one after a clock correction. */
export const META_CLOCK_WALL = "clock.wall";
export const META_CLOCK_COUNTER = "clock.counter";
