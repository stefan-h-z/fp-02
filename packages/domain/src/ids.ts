/**
 * Identifier helpers.
 *
 * Every entity and operation id is a UUID v7: time-ordered, so ids sort by
 * creation and index locality stays good in SQLite, while collisions across
 * offline devices remain impossible in practice.
 */
import { v7 as uuidv7 } from "uuid";

export type EntityId = string;
export type OpId = string;
export type DeviceId = string;
export type FamilyId = string;
export type PersonId = string;

export function newId(): string {
  return uuidv7();
}

/** Reserved id prefixes used by derived (non-op) rows so they cannot collide. */
export const DERIVED_ID_PREFIX = "~";

export function isDerivedId(id: string): boolean {
  return id.startsWith(DERIVED_ID_PREFIX);
}

/**
 * Stable key for a value that must be addressable without being an entity —
 * e.g. a planned ingredient need that exists only as a projection of the week
 * plan (SPEC FR-714) but still needs a check-off state.
 */
export function derivedId(...parts: readonly string[]): string {
  return DERIVED_ID_PREFIX + parts.map((p) => p.replace(/\|/g, "\\|")).join("|");
}
