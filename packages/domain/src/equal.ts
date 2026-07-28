import type { Value } from "./ops.js";

/**
 * Structural equality for operation values.
 *
 * Needed because two devices writing the *same* value to a critical field is a
 * convergence, not a conflict — showing a resolution dialog for it would be the
 * kind of noise that makes people stop trusting the app (SPEC §12.2 acceptance 2).
 */
export function valuesEqual(a: Value | undefined, b: Value | undefined): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => valuesEqual(item, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
    return ak.every((k) => valuesEqual((a as Record<string, Value>)[k], (b as Record<string, Value>)[k]));
  }
  return false;
}
