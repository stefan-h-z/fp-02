/**
 * The SQL seam.
 *
 * `SqlStateStore` writes plain SQLite SQL; this interface is the only thing it
 * knows about the engine underneath. It is deliberately four verbs wide because
 * the narrowest of the three real engines (expo-sqlite) offers little more, and
 * anything richer — prepared-statement handles, cursors, sync reads — would not
 * survive the port to wa-sqlite behind a SharedWorker (PLAN §3.3).
 *
 * Everything is async even where the engine is synchronous: the store must be
 * written once, against the slowest contract.
 */

/**
 * The only bound value types the store uses. Entities, operations and conflicts
 * travel as JSON `TEXT`, so blobs and bigints never reach the driver.
 */
export type SqlParam = string | number | null;

export interface SqlDriver {
  /** Statements without parameters (DDL, pragmas). May contain several. */
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlParam[]): Promise<void>;
  all<T>(sql: string, params?: readonly SqlParam[]): Promise<readonly T[]>;
  /**
   * Runs `fn` atomically. Implementations must nest (a store method that opens a
   * transaction may be called from another one), and must roll back if `fn`
   * throws or rejects.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
