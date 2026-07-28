/**
 * The reducer: the single place where an operation changes state.
 *
 * The same code runs on every client and (mirrored in PHP) on the server, and it
 * is applied strictly in the family's server-assigned order, which is what makes
 * two devices provably agree — including on which divergences become visible
 * conflicts (SPEC FR-1215).
 *
 * Pure by construction: no clock, no storage, no I/O.
 */
import { emptyEntity, type FieldMeta, type StoredEntity } from "./entity.js";
import { valuesEqual } from "./equal.js";
import { isCriticalField } from "./fields.js";
import { hlcLater, type HlcStamp } from "./hlc.js";
import type { Operation, Value } from "./ops.js";

export interface FieldConflict {
  readonly entityType: string;
  readonly entityId: string;
  readonly field: string;
  /** What the family currently has, and who put it there. */
  readonly currentValue: Value | undefined;
  readonly currentActorId: string | null;
  readonly currentHlc: HlcStamp | undefined;
  readonly currentVersion: number;
  /** What the rejected operation wanted. */
  readonly incomingValue: Value;
  readonly incomingActorId: string | null;
  readonly incomingHlc: HlcStamp;
  readonly incomingOpId: string;
  readonly baseVersion: number;
}

export interface ReduceResult {
  readonly entity: StoredEntity;
  /** False when the operation changed nothing (replay, stale write, or conflict). */
  readonly changed: boolean;
  readonly conflicts: readonly FieldConflict[];
}

const DELETED_FIELD = "__deleted";

function withField(
  entity: StoredEntity,
  field: string,
  value: Value,
  meta: FieldMeta,
): StoredEntity {
  return {
    ...entity,
    fields: { ...entity.fields, [field]: value },
    meta: { ...entity.meta, [field]: meta },
  };
}

function nextMeta(previous: FieldMeta | undefined, op: Operation): FieldMeta {
  return {
    version: (previous?.version ?? 0) + 1,
    hlc: op.hlc,
    actorId: op.actorId,
  };
}

/**
 * Apply one operation to one entity.
 *
 * `existing` is undefined for the first operation that mentions the entity —
 * including when a `setFields` arrives before the `create` that made it, which
 * happens routinely once two devices have been offline.
 */
export function applyOperation(existing: StoredEntity | undefined, op: Operation): ReduceResult {
  const base = existing ?? emptyEntity(op.entityType, op.entityId, op.familyId);

  switch (op.kind) {
    case "entity.create":
    case "entity.setFields":
      return applyFields(base, op, op.kind === "entity.create");
    case "entity.delete":
      return applyDelete(base, op);
    case "set.add":
    case "set.remove":
      return applySetChange(base, op, op.kind === "set.add");
  }
}

function applyFields(base: StoredEntity, op: Operation, isCreate: boolean): ReduceResult {
  let entity = base;
  let changed = false;
  const conflicts: FieldConflict[] = [];

  for (const [field, value] of Object.entries(op.payload)) {
    const previous = entity.meta[field];
    const current = entity.fields[field];

    // A create is idempotent: replaying it, or receiving it after a later edit,
    // must never clobber what the family has since changed.
    if (isCreate && previous !== undefined) continue;

    if (isCriticalField(op.entityType, field) && !isCreate) {
      const baseVersion = op.base?.[field] ?? 0;
      const currentVersion = previous?.version ?? 0;

      if (baseVersion !== currentVersion && !valuesEqual(current, value)) {
        conflicts.push({
          entityType: op.entityType,
          entityId: op.entityId,
          field,
          currentValue: current,
          currentActorId: previous?.actorId ?? null,
          ...(previous === undefined ? { currentHlc: undefined } : { currentHlc: previous.hlc }),
          currentVersion,
          incomingValue: value,
          incomingActorId: op.actorId,
          incomingHlc: op.hlc,
          incomingOpId: op.opId,
          baseVersion,
        });
        continue;
      }

      if (valuesEqual(current, value)) {
        // Same destination reached twice. Keep the earlier authorship so "who
        // acknowledged the dose" stays the person who actually did it first.
        continue;
      }

      entity = withField(entity, field, value, nextMeta(previous, op));
      changed = true;
      continue;
    }

    // Tier 1: last writer wins, and equal values are a no-op, which is what
    // makes checking an item off twice harmless (FR-1219).
    if (previous !== undefined && !hlcLater(op.hlc, previous.hlc)) continue;
    if (previous !== undefined && valuesEqual(current, value)) continue;

    entity = withField(entity, field, value, nextMeta(previous, op));
    changed = true;
  }

  return { entity, changed, conflicts };
}

function applyDelete(base: StoredEntity, op: Operation): ReduceResult {
  const previous = base.meta[DELETED_FIELD];
  if (previous !== undefined && !hlcLater(op.hlc, previous.hlc)) {
    return { entity: base, changed: false, conflicts: [] };
  }
  const entity: StoredEntity = {
    ...base,
    deleted: true,
    meta: { ...base.meta, [DELETED_FIELD]: nextMeta(previous, op) },
  };
  return { entity, changed: base.deleted !== true, conflicts: [] };
}

function applySetChange(base: StoredEntity, op: Operation, add: boolean): ReduceResult {
  const field = typeof op.payload["field"] === "string" ? op.payload["field"] : undefined;
  const member = op.payload["member"];
  if (field === undefined || typeof member !== "string") {
    // Malformed operations are dropped rather than thrown: a client on an older
    // schema must never be able to wedge another client's sync loop.
    return { entity: base, changed: false, conflicts: [] };
  }

  const bag = base.sets[field] ?? {};
  const previous = bag[member];
  if (previous !== undefined && !hlcLater(op.hlc, previous.hlc)) {
    return { entity: base, changed: false, conflicts: [] };
  }
  if (previous?.present === add) {
    return { entity: base, changed: false, conflicts: [] };
  }

  const entity: StoredEntity = {
    ...base,
    sets: { ...base.sets, [field]: { ...bag, [member]: { present: add, hlc: op.hlc } } },
  };
  return { entity, changed: true, conflicts: [] };
}

/** Rebuild an entity from its operations — used by history views and repair. */
export function materialize(ops: readonly Operation[]): StoredEntity | undefined {
  let entity: StoredEntity | undefined;
  for (const op of ops) {
    entity = applyOperation(entity, op).entity;
  }
  return entity;
}
