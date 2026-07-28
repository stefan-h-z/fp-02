/**
 * The Tier-1 / Tier-2 field registry (SPEC FR-1215).
 *
 * Tier 1 is everything that may merge silently: check-offs, additions, notes,
 * set membership. Tier 2 is the short list of fields where a silent overwrite
 * would be a real-world failure — a moved appointment nobody noticed, a
 * medication acknowledged twice, a task whose owner quietly changed. Those never
 * overwrite: a genuine divergence becomes a visible Conflict.
 *
 * The list is intentionally short. Every entry costs a resolution dialog, and a
 * dialog the family cannot make sense of is worse than a merge.
 */
export type EntityType = string;

const CRITICAL_FIELDS: Readonly<Record<EntityType, readonly string[]>> = {
  event: ["startsAt", "endsAt", "allDay", "recurrence", "cancelled"],
  protocolInstance: ["state", "acknowledgedBy", "acknowledgedAt", "measuredValue", "skipNote"],
  task: ["ownerId", "dueAt", "completedAt", "state", "delegationResponse", "delegateId"],
  document: ["fileRef", "title", "expiresAt"],
  membership: ["role"],
  weekPlan: ["planningOwnerId"],
  mealSlot: ["cookOwnerId"],
  responsibilityCard: ["ownerId"],
  protocol: ["startsAt", "endsAt", "frequency", "instruction", "missedDoseRule"],
};

export function isCriticalField(entityType: EntityType, field: string): boolean {
  return CRITICAL_FIELDS[entityType]?.includes(field) ?? false;
}

export function criticalFields(entityType: EntityType): readonly string[] {
  return CRITICAL_FIELDS[entityType] ?? [];
}

/** All entity types that have at least one Tier-2 field. */
export function entityTypesWithCriticalFields(): readonly EntityType[] {
  return Object.keys(CRITICAL_FIELDS);
}
