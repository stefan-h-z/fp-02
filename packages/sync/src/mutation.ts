/**
 * Building operations.
 *
 * Callers describe intent ("set this event's start time"); the builder attaches
 * the bookkeeping that makes merging work: a fresh clock stamp, and for Tier-2
 * fields the field versions the author had actually seen. Getting those base
 * versions from the *visible* state (confirmed plus this device's unsent work) is
 * what makes "I edited what I was looking at" the thing the server checks.
 */
import {
  criticalFields,
  makeOperation,
  newId,
  type FamilyState,
  type HlcClock,
  type Operation,
  type Value,
} from "@fam/domain";

export interface MutationContext {
  readonly familyId: string;
  readonly deviceId: string;
  /** Person the change is attributed to; null on a shared device acting as the
   * household, where SPEC FR-116 says identity is not asked for. */
  readonly actorId: string | null;
  readonly state: FamilyState;
  readonly clock: HlcClock;
}

export class MutationBuilder {
  private readonly ops: Operation[] = [];

  constructor(private readonly context: MutationContext) {}

  create(entityType: string, entityId: string, fields: Record<string, Value>): this {
    this.ops.push(this.op(entityType, entityId, "entity.create", fields));
    return this;
  }

  /** Create with a generated id, returning it so callers can reference the entity. */
  createNew(entityType: string, fields: Record<string, Value>): string {
    const id = newId();
    this.create(entityType, id, fields);
    return id;
  }

  set(entityType: string, entityId: string, fields: Record<string, Value>): this {
    const base = this.baseVersions(entityType, entityId, Object.keys(fields));
    this.ops.push(this.op(entityType, entityId, "entity.setFields", fields, base));
    return this;
  }

  delete(entityType: string, entityId: string): this {
    this.ops.push(this.op(entityType, entityId, "entity.delete", {}));
    return this;
  }

  setAdd(entityType: string, entityId: string, field: string, member: string): this {
    this.ops.push(this.op(entityType, entityId, "set.add", { field, member }));
    return this;
  }

  setRemove(entityType: string, entityId: string, field: string, member: string): this {
    this.ops.push(this.op(entityType, entityId, "set.remove", { field, member }));
    return this;
  }

  /**
   * Write a Tier-2 field while claiming the current version — the shape a
   * conflict resolution takes, and the only way to overwrite deliberately.
   */
  force(entityType: string, entityId: string, field: string, value: Value): this {
    const entity = this.context.state.get(entityType, entityId);
    const version = entity?.meta[field]?.version ?? 0;
    this.ops.push(
      this.op(entityType, entityId, "entity.setFields", { [field]: value }, { [field]: version }),
    );
    return this;
  }

  build(): readonly Operation[] {
    return [...this.ops];
  }

  private baseVersions(
    entityType: string,
    entityId: string,
    fields: readonly string[],
  ): Record<string, number> | undefined {
    const critical = criticalFields(entityType);
    if (critical.length === 0) return undefined;

    const entity = this.context.state.get(entityType, entityId);
    const base: Record<string, number> = {};
    for (const field of fields) {
      if (!critical.includes(field)) continue;
      base[field] = entity?.meta[field]?.version ?? 0;
    }
    return Object.keys(base).length === 0 ? undefined : base;
  }

  private op(
    entityType: string,
    entityId: string,
    kind: Operation["kind"],
    payload: Record<string, Value>,
    base?: Record<string, number>,
  ): Operation {
    return makeOperation({
      opId: newId(),
      familyId: this.context.familyId,
      deviceId: this.context.deviceId,
      actorId: this.context.actorId,
      entityType,
      entityId,
      kind,
      payload,
      hlc: this.context.clock.next(),
      ...(base === undefined ? {} : { base }),
    });
  }
}
