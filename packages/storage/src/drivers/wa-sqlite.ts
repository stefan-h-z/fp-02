/**
 * Web driver — wa-sqlite on OPFS.
 *
 * Same arrangement as the native driver: `wa-sqlite` stays out of this package's
 * imports and an already-initialized handle is passed in, because opening it is
 * genuinely app-shaped work (WASM module, VFS registration, worker plumbing) and
 * because nothing in Node should ever load it.
 *
 * Two constraints from PLAN §3.3 that this driver cannot enforce and callers must
 * honour:
 * - **OPFS**: the database lives in the Origin Private File System, so it is
 *   reachable only from a worker context, not from the page's main thread.
 * - **Single writer**: exactly one SharedWorker owns the connection for the whole
 *   origin and every tab talks to it. OPFS access handles are exclusive — a
 *   second writer does not queue, it fails — and `transaction()` here assumes it
 *   is the only thing issuing `BEGIN` on this connection.
 *
 * PLAN §3.3 also names the fallback if the spike (WP-0.7) fails: an
 * IndexedDB-backed store behind this same interface, which is the reason the
 * handle is structural rather than a wa-sqlite type.
 */
import type { SqlDriver, SqlParam } from "../driver.js";

/**
 * The narrow surface the SharedWorker exposes over wa-sqlite. It is intentionally
 * statement-at-a-time: wa-sqlite's real API is prepare/step/column, and hiding
 * that behind three verbs keeps the store free of engine detail.
 */
export interface WaSqliteHandle {
  /** Runs one or more statements without parameters (DDL, pragmas). */
  exec(sql: string): Promise<void>;
  run(sql: string, params: readonly SqlParam[]): Promise<void>;
  all(sql: string, params: readonly SqlParam[]): Promise<unknown[]>;
  close(): Promise<void>;
}

export class WaSqliteDriver implements SqlDriver {
  private depth = 0;

  constructor(private readonly handle: WaSqliteHandle) {}

  async exec(sql: string): Promise<void> {
    await this.handle.exec(sql);
  }

  async run(sql: string, params: readonly SqlParam[] = []): Promise<void> {
    await this.handle.run(sql, params);
  }

  async all<T>(sql: string, params: readonly SqlParam[] = []): Promise<readonly T[]> {
    return (await this.handle.all(sql, params)) as T[];
  }

  /** Explicit BEGIN/COMMIT with savepoints for nesting; see the single-writer note. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const name = `sp_${String(this.depth)}`;
    await this.handle.exec(this.depth === 0 ? "BEGIN" : `SAVEPOINT ${name}`);
    this.depth += 1;
    try {
      const result = await fn();
      this.depth -= 1;
      await this.handle.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${name}`);
      return result;
    } catch (error) {
      this.depth -= 1;
      await this.handle.exec(
        this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`,
      );
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.handle.close();
  }
}
