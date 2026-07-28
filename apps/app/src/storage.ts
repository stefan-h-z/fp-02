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
  IndexedDbStateStore,
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

  // IndexedDB rather than wa-sqlite on OPFS, which is the fallback PLAN §3.3
  // names: OPFS access handles are exclusive, so that route needs a SharedWorker
  // owning one connection for the whole origin before a second tab is safe.
  // IndexedDB transactions are already atomic across tabs, so this arrangement
  // has one fewer moving part and persists today.
  if (globalThis.indexedDB === undefined) {
    // Private-mode browsers and old WebViews. Memory keeps the app usable.
    console.warn("[family] IndexedDB unavailable, falling back to memory");
    return undefined;
  }

  try {
    const store = new IndexedDbStateStore({ databaseName: DATABASE_NAME });
    // Opened here rather than left to the caller so a browser that refuses the
    // database — a storage quota denied, a blocked upgrade — falls back to
    // memory instead of failing the app's boot. `init()` is idempotent.
    await store.init();
    return store;
  } catch (error) {
    console.warn("[family] IndexedDB could not be opened, falling back to memory", error);
    return undefined;
  }
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
