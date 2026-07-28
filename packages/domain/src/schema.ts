/**
 * Entity types and typed reads.
 *
 * The reducer works on untyped field bags on purpose (it must merge anything);
 * everything above it needs types back. These helpers are that boundary: they
 * read a field and coerce it, returning a fallback rather than throwing, because
 * a single malformed field from an older client must never blank a whole screen.
 */
import { setMembers, type StoredEntity } from "./entity.js";
import type { Value } from "./ops.js";

export const EntityTypes = {
  family: "family",
  person: "person",
  membership: "membership",
  device: "device",
  guestLink: "guestLink",
  /** The long-lived identity of a thing the family buys — where store
   * assignment and purchase rhythm live, independent of any one list line. */
  catalogItem: "catalogItem",
  store: "store",
  shoppingList: "shoppingList",
  shoppingItem: "shoppingItem",
  recipe: "recipe",
  weekPlan: "weekPlan",
  mealSlot: "mealSlot",
  event: "event",
  task: "task",
  responsibilityCard: "responsibilityCard",
  protocol: "protocol",
  protocolInstance: "protocolInstance",
  document: "document",
  contact: "contact",
  collection: "collection",
  collectionItem: "collectionItem",
  inboxItem: "inboxItem",
  consent: "consent",
  comment: "comment",
} as const;

export type EntityTypeName = (typeof EntityTypes)[keyof typeof EntityTypes];

/** Set fields that carry a log of timestamps as members (see `rhythm.ts`). */
export const SetFields = {
  purchases: "purchases",
  emptyReports: "emptyReports",
  dismissals: "dismissals",
  stores: "stores",
  eaters: "eaters",
  responsibleAdults: "responsibleAdults",
} as const;

export function readString(entity: StoredEntity | undefined, field: string, fallback = ""): string {
  const value = entity?.fields[field];
  return typeof value === "string" ? value : fallback;
}

export function readOptionalString(entity: StoredEntity | undefined, field: string): string | undefined {
  const value = entity?.fields[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readNumber(entity: StoredEntity | undefined, field: string, fallback = 0): number {
  const value = entity?.fields[field];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function readOptionalNumber(entity: StoredEntity | undefined, field: string): number | undefined {
  const value = entity?.fields[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(entity: StoredEntity | undefined, field: string, fallback = false): boolean {
  const value = entity?.fields[field];
  return typeof value === "boolean" ? value : fallback;
}

export function readStringList(entity: StoredEntity | undefined, field: string): readonly string[] {
  const value = entity?.fields[field];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function readRecords(entity: StoredEntity | undefined, field: string): readonly Record<string, Value>[] {
  const value = entity?.fields[field];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, Value> => typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

/** Timestamps stored as set members, ascending. */
export function readTimestampSet(entity: StoredEntity | undefined, field: string): readonly number[] {
  if (entity === undefined) return [];
  return setMembers(entity, field)
    .map((member) => Number(member))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

/**
 * The canonical key for a purchasable thing.
 *
 * Two people typing "Milch" and "milch " must land on the same catalog item, or
 * the rhythm learning silently splits in two and never reaches confidence.
 */
export function canonicalItemKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/g, "");
}
