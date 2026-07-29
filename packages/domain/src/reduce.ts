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
        // Same destination reached twice — both parents gave the dose. The
        // authorship that survives must be the one that happened first in real
        // time, not the one whose device reached the server first (SPEC §12.2
        // acceptance 2), so an earlier stamp displaces a later one.
        //
        // The version deliberately does NOT advance here. It counts value
        // changes, so that replaying the log — which happens after any
        // interrupted pull — lands on identical state.
        //
        // `raced` is what makes that true, and it is not decoration. Matching
        // values are not evidence of having reached the destination together:
        // on a replay every operation's value matches the final state, so an
        // operation that was *refused* as a conflict the first time round would
        // come back and claim the authorship it lost. What actually identifies
        // a co-author is the version it wrote against — one behind the write
        // that currently holds the field is a genuine race; anything else is a
        // coincidence of values.
        const raced = baseVersion + 1 === currentVersion;

        if (raced && previous !== undefined && hlcLater(previous.hlc, op.hlc)) {
          entity = {
            ...entity,
            meta: { ...entity.meta, [field]: { ...previous, hlc: op.hlc, actorId: op.actorId } },
          };
          changed = true;
        }
        continue;
      }

      entity = withField(entity, field, value, nextMeta(previous, op));
      changed = true;
      continue;
    }

    // Tier 1: last writer wins. A redundant write — the same value again — is
    // not a no-op for the bookkeeping: it must still raise the field's
    // watermark, or an older write arriving afterwards would win and the result
    // would depend on the order operations happened to arrive in.
    if (previous !== undefined && !hlcLater(op.hlc, previous.hlc)) continue;

    const redundant = previous !== undefined && valuesEqual(current, value);
    entity = redundant
      ? { ...entity, meta: { ...entity.meta, [field]: { ...previous, hlc: op.hlc } } }
      : withField(entity, field, value, nextMeta(previous, op));
    changed = changed || !redundant;
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

  // As with Tier-1 fields, a redundant change still raises the member's
  // watermark: without it, adding something twice would leave an older removal
  // able to win, and the result would depend on arrival order.
  const redundant = previous?.present === add;
  const entity: StoredEntity = {
    ...base,
    sets: { ...base.sets, [field]: { ...bag, [member]: { present: add, hlc: op.hlc } } },
  };
  return { entity, changed: !redundant, conflicts: [] };
}

/** Rebuild an entity from its operations — used by history views and repair. */
export function materialize(ops: readonly Operation[]): StoredEntity | undefined {
  let entity: StoredEntity | undefined;
  for (const op of ops) {
    entity = applyOperation(entity, op).entity;
  }
  return entity;
}
