export * from "./types.js";
export * from "./driver.js";
export * from "./memory.js";
export * from "./sql-store.js";
// Both platform drivers are import-free (they take an already-opened handle), so
// re-exporting them costs nothing on either platform.
export * from "./drivers/expo-sqlite.js";
export * from "./drivers/wa-sqlite.js";
// The Node driver is deliberately absent: it imports better-sqlite3, a native
// module that must never end up in the app or web bundle. Tests and the
// simulation harness reach it directly at `./drivers/better-sqlite3.js`.
