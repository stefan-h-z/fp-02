/**
 * Native driver (iOS/Android) — expo-sqlite's async API.
 *
 * The database is handed in already opened rather than opened here: `expo-sqlite`
 * is not a dependency of this package (it only resolves inside the Expo app), and
 * keeping the import out means Node tests and the server never pull a native
 * module into their bundle. The app wires it up with
 * `openDatabaseAsync("family.db")` and passes the result straight in; the
 * structural interface below is the slice of that object this driver touches.
 */
import type { SqlDriver, SqlParam } from "../driver.js";

/** Structural mirror of `expo-sqlite`'s `SQLiteDatabase` — no import, by design. */
export interface ExpoSqliteDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: readonly SqlParam[]): Promise<unknown>;
  getAllAsync(source: string, params: readonly SqlParam[]): Promise<unknown[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

export class ExpoSqliteDriver implements SqlDriver {
  private depth = 0;

  constructor(private readonly db: ExpoSqliteDatabase) {}

  async exec(sql: string): Promise<void> {
    await this.db.execAsync(sql);
  }

  async run(sql: string, params: readonly SqlParam[] = []): Promise<void> {
    await this.db.runAsync(sql, params);
  }

  async all<T>(sql: string, params: readonly SqlParam[] = []): Promise<readonly T[]> {
    return (await this.db.getAllAsync(sql, params)) as T[];
  }

  /**
   * `withTransactionAsync` cannot nest, so only the outermost call uses it and
   * inner ones become savepoints. The result is carried out through a closure
   * because the expo callback is `Promise<void>`.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.depth > 0) return this.savepoint(fn);
    let outcome: { readonly value: T } | undefined;
    this.depth = 1;
    try {
      await this.db.withTransactionAsync(async () => {
        outcome = { value: await fn() };
      });
    } finally {
      this.depth = 0;
    }
    if (outcome === undefined) throw new Error("expo-sqlite transaction body did not run");
    return outcome.value;
  }

  private async savepoint<T>(fn: () => Promise<T>): Promise<T> {
    const name = `sp_${String(this.depth)}`;
    await this.db.execAsync(`SAVEPOINT ${name}`);
    this.depth += 1;
    try {
      const result = await fn();
      this.depth -= 1;
      await this.db.execAsync(`RELEASE ${name}`);
      return result;
    } catch (error) {
      this.depth -= 1;
      await this.db.execAsync(`ROLLBACK TO ${name}`);
      await this.db.execAsync(`RELEASE ${name}`);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.db.closeAsync();
  }
}
