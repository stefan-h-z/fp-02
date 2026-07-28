/**
 * SQL store: the implementation that actually ships.
 *
 * Behaviourally identical to `MemoryStateStore` — `test/store-equivalence.test.ts`
 * runs one test body against both — so the simulation harness can keep using the
 * fast in-memory store while devices get durability (FR-1217).
 *
 * Layout principle: the operation, outbox and conflict rows keep their payload as
 * one verbatim JSON `body`, and the columns beside it exist only to index and
 * filter. Duplicating a few values is cheaper than reassembling shapes that must
 * survive schema evolution (ops carry their own `schemaVersion`, PLAN §3.4): a
 * row written by a newer client round-trips through an older one unchanged.
 * Entities are the exception the interface forces — `fields`/`sets`/`meta` are
 * stored verbatim, while identity and the delete flag are columns.
 */
import type { FieldConflict, Operation, SequencedOperation, StoredEntity } from "@fam/domain";
import type { SqlDriver, SqlParam } from "./driver.js";
import type { ConflictRecord, StateStore } from "./types.js";

interface Migration {
  readonly version: number;
  readonly statements: readonly string[];
}

/**
 * Append-only: never edit a landed migration, add the next one. `init()` applies
 * whatever the local database has not seen yet.
 */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS entities (
         type TEXT NOT NULL,
         id TEXT NOT NULL,
         family_id TEXT NOT NULL,
         deleted INTEGER NOT NULL,
         fields TEXT NOT NULL,
         sets TEXT NOT NULL,
         meta TEXT NOT NULL,
         PRIMARY KEY (type, id)
       )`,
      `CREATE TABLE IF NOT EXISTS ops (
         seq INTEGER PRIMARY KEY,
         op_id TEXT NOT NULL UNIQUE,
         entity_type TEXT NOT NULL,
         entity_id TEXT NOT NULL,
         wall INTEGER NOT NULL,
         body TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS ops_by_entity ON ops (entity_type, entity_id, seq)`,
      `CREATE INDEX IF NOT EXISTS ops_by_wall ON ops (wall)`,
      // created_seq is the queue order and must keep rising across drains, hence
      // AUTOINCREMENT rather than the implicit rowid, which SQLite reuses.
      `CREATE TABLE IF NOT EXISTS outbox (
         created_seq INTEGER PRIMARY KEY AUTOINCREMENT,
         op_id TEXT NOT NULL UNIQUE,
         body TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS meta (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS conflicts (
         id TEXT PRIMARY KEY,
         family_id TEXT NOT NULL,
         detected_at_seq INTEGER NOT NULL,
         resolved_at TEXT,
         body TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS conflicts_open ON conflicts (resolved_at, detected_at_seq)`,
    ],
  },
];

interface EntityRow {
  readonly type: string;
  readonly id: string;
  readonly family_id: string;
  readonly deleted: number;
  readonly fields: string;
  readonly sets: string;
  readonly meta: string;
}

interface BodyRow {
  readonly body: string;
}

interface ConflictRow extends BodyRow {
  readonly id: string;
  readonly family_id: string;
  readonly detected_at_seq: number;
  readonly resolved_at: string | null;
}

function toEntity(row: EntityRow): StoredEntity {
  return {
    id: row.id,
    type: row.type,
    familyId: row.family_id,
    deleted: row.deleted !== 0,
    fields: JSON.parse(row.fields) as StoredEntity["fields"],
    sets: JSON.parse(row.sets) as StoredEntity["sets"],
    meta: JSON.parse(row.meta) as StoredEntity["meta"],
  };
}

function toConflict(row: ConflictRow): ConflictRecord {
  const detection = JSON.parse(row.body) as FieldConflict;
  return {
    ...detection,
    // `JSON.stringify` drops keys whose value is `undefined`, and `FieldConflict`
    // declares both of these as present-but-possibly-undefined (there is no
    // current value when the field was never written). Naming them restores the
    // keys, so a record read back is shape-identical to the one written.
    currentValue: detection.currentValue,
    currentHlc: detection.currentHlc,
    id: row.id,
    familyId: row.family_id,
    detectedAtSeq: row.detected_at_seq,
    // The column is authoritative: `markConflictResolved` only touches it.
    resolvedAt: row.resolved_at,
  };
}

export class SqlStateStore implements StateStore {
  constructor(private readonly driver: SqlDriver) {}

  async init(): Promise<void> {
    await this.driver.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version INTEGER PRIMARY KEY,
         applied_at TEXT NOT NULL
       )`,
    );
    const rows = await this.driver.all<{ readonly version: number }>(
      "SELECT version FROM schema_migrations",
    );
    const applied = new Set(rows.map((row) => row.version));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      await this.driver.transaction(async () => {
        for (const statement of migration.statements) await this.driver.exec(statement);
        await this.driver.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [
          migration.version,
          new Date().toISOString(),
        ]);
      });
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  async getEntity(type: string, id: string): Promise<StoredEntity | undefined> {
    const rows = await this.driver.all<EntityRow>(
      "SELECT type, id, family_id, deleted, fields, sets, meta FROM entities WHERE type = ? AND id = ?",
      [type, id],
    );
    const row = rows[0];
    return row === undefined ? undefined : toEntity(row);
  }

  async putEntities(entities: readonly StoredEntity[]): Promise<void> {
    await this.driver.transaction(async () => {
      for (const entity of entities) {
        await this.driver.run(
          `INSERT INTO entities (type, id, family_id, deleted, fields, sets, meta)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (type, id) DO UPDATE SET
             family_id = excluded.family_id,
             deleted = excluded.deleted,
             fields = excluded.fields,
             sets = excluded.sets,
             meta = excluded.meta`,
          [
            entity.type,
            entity.id,
            entity.familyId,
            entity.deleted ? 1 : 0,
            JSON.stringify(entity.fields),
            JSON.stringify(entity.sets),
            JSON.stringify(entity.meta),
          ],
        );
      }
    });
  }

  async listEntities(
    type: string,
    options?: { readonly includeDeleted?: boolean },
  ): Promise<readonly StoredEntity[]> {
    const includeDeleted = options?.includeDeleted === true;
    const rows = await this.driver.all<EntityRow>(
      `SELECT type, id, family_id, deleted, fields, sets, meta FROM entities
       WHERE type = ?${includeDeleted ? "" : " AND deleted = 0"}
       ORDER BY id`,
      [type],
    );
    return rows.map(toEntity);
  }

  async entityTypes(): Promise<readonly string[]> {
    const rows = await this.driver.all<{ readonly type: string }>(
      "SELECT DISTINCT type FROM entities ORDER BY type",
    );
    return rows.map((row) => row.type);
  }

  async getMeta(key: string): Promise<string | undefined> {
    const rows = await this.driver.all<{ readonly value: string }>(
      "SELECT value FROM meta WHERE key = ?",
      [key],
    );
    return rows[0]?.value;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.driver.run(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }

  async appendConfirmedOps(ops: readonly SequencedOperation[]): Promise<void> {
    await this.driver.transaction(async () => {
      for (const op of ops) {
        // A pull can overlap what we already hold, and a push can be confirmed
        // twice; the log is keyed by opId so re-delivery is a no-op (FR-1219).
        await this.driver.run(
          `INSERT OR IGNORE INTO ops (seq, op_id, entity_type, entity_id, wall, body)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [op.seq, op.opId, op.entityType, op.entityId, op.hlc.wall, JSON.stringify(op)],
        );
      }
    });
  }

  async opsForEntity(type: string, id: string): Promise<readonly SequencedOperation[]> {
    const rows = await this.driver.all<BodyRow>(
      "SELECT body FROM ops WHERE entity_type = ? AND entity_id = ? ORDER BY seq",
      [type, id],
    );
    return rows.map((row) => JSON.parse(row.body) as SequencedOperation);
  }

  async pruneOpsBefore(wallMs: number): Promise<number> {
    // Counting inside the transaction is what makes the returned number the
    // number actually deleted; the driver seam has no rows-affected channel.
    return this.driver.transaction(async () => {
      const rows = await this.driver.all<{ readonly n: number }>(
        "SELECT COUNT(*) AS n FROM ops WHERE wall < ?",
        [wallMs],
      );
      const deleted = rows[0]?.n ?? 0;
      if (deleted > 0) await this.driver.run("DELETE FROM ops WHERE wall < ?", [wallMs]);
      return deleted;
    });
  }

  async enqueueOutbox(ops: readonly Operation[]): Promise<void> {
    await this.driver.transaction(async () => {
      for (const op of ops) {
        await this.driver.run("INSERT OR IGNORE INTO outbox (op_id, body) VALUES (?, ?)", [
          op.opId,
          JSON.stringify(op),
        ]);
      }
    });
  }

  async outbox(): Promise<readonly Operation[]> {
    const rows = await this.driver.all<BodyRow>("SELECT body FROM outbox ORDER BY created_seq");
    return rows.map((row) => JSON.parse(row.body) as Operation);
  }

  async dequeueOutbox(opIds: readonly string[]): Promise<void> {
    await this.driver.transaction(async () => {
      for (const opId of opIds) {
        await this.driver.run("DELETE FROM outbox WHERE op_id = ?", [opId]);
      }
    });
  }

  async putConflicts(conflicts: readonly ConflictRecord[]): Promise<void> {
    await this.driver.transaction(async () => {
      for (const record of conflicts) {
        const { id, familyId, detectedAtSeq, resolvedAt, ...detection } = record;
        const params: readonly SqlParam[] = [
          id,
          familyId,
          detectedAtSeq,
          resolvedAt,
          JSON.stringify(detection),
        ];
        await this.driver.run(
          `INSERT INTO conflicts (id, family_id, detected_at_seq, resolved_at, body)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             family_id = excluded.family_id,
             detected_at_seq = excluded.detected_at_seq,
             resolved_at = excluded.resolved_at,
             body = excluded.body`,
          params,
        );
      }
    });
  }

  /** Oldest divergence first, so the resolution UI is stable across reloads. */
  async openConflicts(): Promise<readonly ConflictRecord[]> {
    const rows = await this.driver.all<ConflictRow>(
      `SELECT id, family_id, detected_at_seq, resolved_at, body FROM conflicts
       WHERE resolved_at IS NULL
       ORDER BY detected_at_seq, id`,
    );
    return rows.map(toConflict);
  }

  async markConflictResolved(id: string, atIso: string): Promise<void> {
    await this.driver.run("UPDATE conflicts SET resolved_at = ? WHERE id = ?", [atIso, id]);
  }
}
