/**
 * Opening the local database, per platform.
 *
 * The app is offline-first, so this is not a cache — it is where the family's
 * data lives. Which SQLite it is differs by platform and nothing above this file
 * needs to know: native gets `expo-sqlite`, the browser gets wa-sqlite on OPFS,
 * and anything else falls back to memory so the app still runs rather than
 * refusing to start.
 *
 * The imports are dynamic on purpose. A static `expo-sqlite` import would pull a
 * native module into the web bundle, and a static wa-sqlite import would pull a
 * WASM binary into the native one.
 */
import {
  ExpoSqliteDriver,
  MemoryStateStore,
  SqlStateStore,
  type ExpoSqliteDatabase,
  type SqlParam,
  type StateStore,
} from "@fam/storage";
import { Platform } from "react-native";

const DATABASE_NAME = "family.db";

export async function openLocalStore(): Promise<StateStore> {
  const store = (await openNative()) ?? (await openWeb()) ?? new MemoryStateStore();
  await store.init();
  return store;
}

async function openNative(): Promise<StateStore | undefined> {
  if (Platform.OS === "web") return undefined;

  try {
    // Only expo-sqlite is loaded dynamically: the driver itself is a plain class
    // that never imports the native module, so it costs nothing to bundle.
    const { openDatabaseAsync } = await import("expo-sqlite");
    const database = await openDatabaseAsync(DATABASE_NAME);
    return new SqlStateStore(new ExpoSqliteDriver(adapt(database)));
  } catch (error) {
    // Falling back to memory loses persistence but keeps the app usable, and
    // the warning is what tells us the platform driver needs attention.
    console.warn("[family] native SQLite unavailable, falling back to memory", error);
    return undefined;
  }
}

async function openWeb(): Promise<StateStore | undefined> {
  if (Platform.OS !== "web") return undefined;

  // wa-sqlite on OPFS needs a single-writer arrangement (a SharedWorker) that is
  // not wired yet — see PLAN.md §3.3 and docs/status.md. Until it is, the web
  // build runs in memory rather than pretending to persist.
  return undefined;
}

/**
 * expo-sqlite wants mutable parameter arrays; the storage seam hands out
 * readonly ones, because a driver has no business modifying what it was given.
 * Copying at this one boundary is cheaper than weakening the seam for everyone.
 */
function adapt(database: {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: never[]): Promise<unknown>;
  getAllAsync(source: string, ...params: never[]): Promise<unknown[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}): ExpoSqliteDatabase {
  const mutable = (params: readonly SqlParam[]): never[] => [...params] as never[];

  return {
    execAsync: (source) => database.execAsync(source),
    runAsync: (source, params) => database.runAsync(source, ...mutable(params)),
    getAllAsync: (source, params) => database.getAllAsync(source, ...mutable(params)),
    withTransactionAsync: (task) => database.withTransactionAsync(task),
    closeAsync: () => database.closeAsync(),
  };
}
