/**
 * Node driver — tests and the simulation harness.
 *
 * better-sqlite3 is fully synchronous, so every method here resolves
 * immediately; the promises exist only to satisfy the seam that the two real
 * platform drivers need. That also makes it the reference for transaction
 * semantics: with no I/O suspension points, a transaction body cannot interleave
 * with another one by accident.
 */
import Database from "better-sqlite3";
import type { SqlDriver, SqlParam } from "../driver.js";

export interface BetterSqlite3DriverOptions {
  /** File path, or `:memory:` (the default) for a throwaway database. */
  readonly filename?: string;
}

export class BetterSqlite3Driver implements SqlDriver {
  private readonly db: Database.Database;
  private depth = 0;

  constructor(options: BetterSqlite3DriverOptions = {}) {
    const filename = options.filename ?? ":memory:";
    this.db = new Database(filename);
    if (filename !== ":memory:") {
      // Concurrent readers while the app writes; irrelevant for :memory:.
      this.db.pragma("journal_mode = WAL");
    }
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async run(sql: string, params: readonly SqlParam[] = []): Promise<void> {
    this.db.prepare(sql).run(...params);
  }

  async all<T>(sql: string, params: readonly SqlParam[] = []): Promise<readonly T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /**
   * Hand-rolled rather than `db.transaction()`, which rejects async callbacks.
   * Nested calls become savepoints so a store method that already runs inside a
   * transaction still commits or rolls back as one unit.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const name = `sp_${String(this.depth)}`;
    this.db.exec(this.depth === 0 ? "BEGIN" : `SAVEPOINT ${name}`);
    this.depth += 1;
    try {
      const result = await fn();
      this.depth -= 1;
      this.db.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${name}`);
      return result;
    } catch (error) {
      this.depth -= 1;
      this.db.exec(this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export function openBetterSqlite3Driver(filename?: string): BetterSqlite3Driver {
  return new BetterSqlite3Driver(filename === undefined ? {} : { filename });
}
