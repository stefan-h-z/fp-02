/**
 * The sync protocol.
 *
 * This file is the contract between the app and the backend module
 * (`app-modules/family` in backend-php-01). The PHP side implements the same
 * three calls over the same JSON shapes; the reference server in this package
 * (`reference-server.ts`) implements them in TypeScript so the protocol has an
 * executable definition that tests can drive without a backend.
 *
 * Three calls, in the order a device uses them:
 *   snapshot  — bootstrap a new device without replaying years of history
 *   push      — hand over what happened while offline
 *   pull      — receive everything the family did meanwhile, in family order
 *
 * Realtime (Reverb) only ever says "there is something new"; the pull is the
 * source of truth. A wake-up that gets lost therefore costs latency, never data.
 */
import type { Operation, SequencedOperation, StoredEntity } from "@fam/domain";
import type { ConflictRecord } from "@fam/storage";

export interface PushRequest {
  readonly familyId: string;
  readonly deviceId: string;
  readonly ops: readonly Operation[];
}

/** Why the server refused an operation outright (never a merge decision). */
export type RejectionReason =
  | "schema-invalid"
  | "schema-too-new"
  | "not-authorized"
  | "unknown-family";

export interface OperationRejection {
  readonly opId: string;
  readonly reason: RejectionReason;
  readonly detail?: string;
}

export interface PushResponse {
  /** Operations that got a place in the family's order — including ones whose
   * Tier-2 field was refused, because the attempt itself is part of history. */
  readonly acceptedOpIds: readonly string[];
  /** Divergences that need a human decision (SPEC FR-1215). */
  readonly conflicts: readonly ConflictRecord[];
  readonly rejected: readonly OperationRejection[];
  /** Cursor the client should pull from to see its own writes materialized. */
  readonly cursor: number;
}

export interface PullRequest {
  readonly familyId: string;
  readonly deviceId: string;
  readonly cursor: number;
  readonly limit?: number;
}

export interface PullResponse {
  readonly ops: readonly SequencedOperation[];
  readonly nextCursor: number;
  /** True when more operations are waiting — the client pulls again at once. */
  readonly hasMore: boolean;
}

export interface SnapshotRequest {
  readonly familyId: string;
  readonly deviceId: string;
}

export interface SnapshotResponse {
  readonly entities: readonly StoredEntity[];
  readonly cursor: number;
}

/**
 * What a client needs from a server. The HTTP client and the in-process
 * reference server both satisfy it, which is what lets the same tests run
 * against either.
 */
export interface SyncTransport {
  push(request: PushRequest): Promise<PushResponse>;
  pull(request: PullRequest): Promise<PullResponse>;
  snapshot(request: SnapshotRequest): Promise<SnapshotResponse>;
}

export const DEFAULT_PULL_LIMIT = 500;
