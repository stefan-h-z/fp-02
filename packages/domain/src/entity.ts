/**
 * The materialized shape of an entity.
 *
 * Entities are stored as a field bag plus per-field metadata rather than as
 * typed columns, because the reducer must be able to merge any field of any
 * entity type without knowing the domain. Typed access happens above, in the
 * projections (see `projections/`), where zod schemas validate what was read.
 */
import type { HlcStamp } from "./hlc.js";
import type { Value } from "./ops.js";

export interface FieldMeta {
  /** Monotonic per field; the version a Tier-2 writer must have seen. */
  readonly version: number;
  readonly hlc: HlcStamp;
  /** Person the change is attributed to, when one was recorded. */
  readonly actorId: string | null;
}

export interface SetMember {
  readonly present: boolean;
  readonly hlc: HlcStamp;
}

export interface StoredEntity {
  readonly id: string;
  readonly type: string;
  readonly familyId: string;
  readonly deleted: boolean;
  readonly fields: Readonly<Record<string, Value>>;
  /** Observed-remove sets with per-element last-writer-wins. */
  readonly sets: Readonly<Record<string, Readonly<Record<string, SetMember>>>>;
  readonly meta: Readonly<Record<string, FieldMeta>>;
}

export function emptyEntity(type: string, id: string, familyId: string): StoredEntity {
  return { id, type, familyId, deleted: false, fields: {}, sets: {}, meta: {} };
}

/** Members currently in a set, sorted so every replica renders the same order. */
export function setMembers(entity: StoredEntity, field: string): readonly string[] {
  const bag = entity.sets[field];
  if (bag === undefined) return [];
  return Object.keys(bag)
    .filter((k) => bag[k]?.present === true)
    .sort();
}

export function fieldValue(entity: StoredEntity | undefined, field: string): Value | undefined {
  return entity?.fields[field];
}
