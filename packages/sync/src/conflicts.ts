/**
 * Turning a reducer-detected divergence into a conflict record.
 *
 * The id is derived from the operation and the field rather than generated, so
 * the server and every client independently arrive at the *same* conflict id for
 * the same divergence. That is what lets a client show conflicts it detected
 * itself while replaying the log, without waiting for the server to tell it, and
 * without ever showing the same conflict twice.
 */
import type { FieldConflict } from "@fam/domain";
import type { ConflictRecord } from "@fam/storage";

export function conflictId(conflict: FieldConflict): string {
  return "conflict:" + conflict.incomingOpId + ":" + conflict.field;
}

export function toConflictRecord(
  conflict: FieldConflict,
  familyId: string,
  detectedAtSeq: number,
): ConflictRecord {
  return {
    ...conflict,
    id: conflictId(conflict),
    familyId,
    detectedAtSeq,
    resolvedAt: null,
  };
}
