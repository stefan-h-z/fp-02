/**
 * In-memory materialization of a family's state.
 *
 * Used directly by tests, the simulation harness and the reference server, and
 * used by the app as the read model in front of SQLite (the SQLite adapter keeps
 * the same shape, so a projection cannot tell the two apart).
 */
import type { StoredEntity } from "./entity.js";
import type { FieldConflict } from "./reduce.js";
import { applyOperation } from "./reduce.js";
import type { Operation, SequencedOperation } from "./ops.js";

export interface ApplyOutcome {
  readonly changed: boolean;
  readonly conflicts: readonly FieldConflict[];
}

export class FamilyState {
  private readonly byType = new Map<string, Map<string, StoredEntity>>();

  get(type: string, id: string): StoredEntity | undefined {
    return this.byType.get(type)?.get(id);
  }

  /** Live entities of a type, id-sorted for deterministic rendering. */
  all(type: string): readonly StoredEntity[] {
    const bag = this.byType.get(type);
    if (bag === undefined) return [];
    return [...bag.values()].filter((e) => !e.deleted).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Including tombstones — sync and history need to see deletions. */
  allIncludingDeleted(type: string): readonly StoredEntity[] {
    const bag = this.byType.get(type);
    if (bag === undefined) return [];
    return [...bag.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  types(): readonly string[] {
    return [...this.byType.keys()].sort();
  }

  put(entity: StoredEntity): void {
    let bag = this.byType.get(entity.type);
    if (bag === undefined) {
      bag = new Map();
      this.byType.set(entity.type, bag);
    }
    bag.set(entity.id, entity);
  }

  apply(op: Operation): ApplyOutcome {
    const existing = this.get(op.entityType, op.entityId);
    const result = applyOperation(existing, op);

    // An operation that changes nothing and names an entity nobody has ever
    // created must not bring one into existence — otherwise a malformed message
    // from an older client leaves an empty row behind on every device.
    if (result.changed || existing !== undefined) {
      this.put(result.entity);
    }
    return { changed: result.changed, conflicts: result.conflicts };
  }

  applyAll(ops: readonly (Operation | SequencedOperation)[]): ApplyOutcome {
    let changed = false;
    const conflicts: FieldConflict[] = [];
    for (const op of ops) {
      const outcome = this.apply(op);
      changed = changed || outcome.changed;
      conflicts.push(...outcome.conflicts);
    }
    return { changed, conflicts };
  }

  /** Structural snapshot used for equality assertions and bootstrap transfer. */
  snapshot(): Record<string, readonly StoredEntity[]> {
    const out: Record<string, readonly StoredEntity[]> = {};
    for (const type of this.types()) {
      out[type] = this.allIncludingDeleted(type);
    }
    return out;
  }

  static fromSnapshot(snapshot: Record<string, readonly StoredEntity[]>): FamilyState {
    const state = new FamilyState();
    for (const entities of Object.values(snapshot)) {
      for (const entity of entities) state.put(entity);
    }
    return state;
  }

  clone(): FamilyState {
    return FamilyState.fromSnapshot(this.snapshot());
  }
}
