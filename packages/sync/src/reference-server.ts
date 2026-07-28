/**
 * The reference server: an in-process implementation of the sync protocol.
 *
 * It exists for two reasons. First, the acceptance scenarios in SPEC §9, §10 and
 * §12.2 are about several devices and a network, so they cannot be tested against
 * a client alone. Second, the PHP backend must behave identically — this file is
 * the specification it is checked against, in code rather than in prose.
 *
 * Deliberately not production infrastructure: no persistence, no auth, no rate
 * limiting. Those live in the backend module.
 */
import {
  FamilyState,
  SCHEMA_VERSION,
  operationSchema,
  type Operation,
  type SequencedOperation,
} from "@fam/domain";
import type { ConflictRecord } from "@fam/storage";
import { toConflictRecord } from "./conflicts.js";
import {
  DEFAULT_PULL_LIMIT,
  type OperationRejection,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SnapshotRequest,
  type SnapshotResponse,
  type SyncTransport,
} from "./protocol.js";

interface FamilyLog {
  readonly state: FamilyState;
  readonly ops: SequencedOperation[];
  readonly seenOpIds: Set<string>;
  readonly conflicts: Map<string, ConflictRecord>;
  seq: number;
}

export interface ReferenceServerOptions {
  /** Families the server knows about. An unknown family is rejected, not created,
   * so a client bug cannot silently start a parallel universe. */
  readonly families?: readonly string[];
}

export class ReferenceServer implements SyncTransport {
  private readonly logs = new Map<string, FamilyLog>();

  constructor(options: ReferenceServerOptions = {}) {
    for (const familyId of options.families ?? []) this.createFamily(familyId);
  }

  createFamily(familyId: string): void {
    if (this.logs.has(familyId)) return;
    this.logs.set(familyId, {
      state: new FamilyState(),
      ops: [],
      seenOpIds: new Set(),
      conflicts: new Map(),
      seq: 0,
    });
  }

  async push(request: PushRequest): Promise<PushResponse> {
    const log = this.logs.get(request.familyId);
    if (log === undefined) {
      return {
        acceptedOpIds: [],
        conflicts: [],
        rejected: request.ops.map((op) => ({ opId: op.opId, reason: "unknown-family" as const })),
        cursor: 0,
      };
    }

    const acceptedOpIds: string[] = [];
    const rejected: OperationRejection[] = [];
    const conflicts: ConflictRecord[] = [];

    for (const raw of request.ops) {
      const rejection = validate(raw, request);
      if (rejection !== undefined) {
        rejected.push(rejection);
        continue;
      }

      // Idempotent by opId: a client that pushed successfully but lost the
      // response retries the same operations, and must not duplicate them.
      if (log.seenOpIds.has(raw.opId)) {
        acceptedOpIds.push(raw.opId);
        continue;
      }

      log.seq += 1;
      const sequenced: SequencedOperation = { ...raw, seq: log.seq };
      log.ops.push(sequenced);
      log.seenOpIds.add(raw.opId);
      acceptedOpIds.push(raw.opId);

      const outcome = log.state.apply(sequenced);
      for (const conflict of outcome.conflicts) {
        const record = toConflictRecord(conflict, request.familyId, log.seq);
        log.conflicts.set(record.id, record);
        conflicts.push(record);
      }
    }

    return { acceptedOpIds, conflicts, rejected, cursor: log.seq };
  }

  async pull(request: PullRequest): Promise<PullResponse> {
    const log = this.logs.get(request.familyId);
    if (log === undefined) return { ops: [], nextCursor: request.cursor, hasMore: false };

    const limit = request.limit ?? DEFAULT_PULL_LIMIT;
    const pending = log.ops.filter((op) => op.seq > request.cursor);
    const page = pending.slice(0, limit);
    const nextCursor = page.at(-1)?.seq ?? request.cursor;

    return { ops: page, nextCursor, hasMore: pending.length > page.length };
  }

  async snapshot(request: SnapshotRequest): Promise<SnapshotResponse> {
    const log = this.logs.get(request.familyId);
    if (log === undefined) return { entities: [], cursor: 0 };

    const entities = log.state
      .types()
      .flatMap((type) => log.state.allIncludingDeleted(type));

    return { entities, cursor: log.seq };
  }

  /** Test/inspection helpers — not part of the protocol. */
  stateOf(familyId: string): FamilyState {
    const log = this.logs.get(familyId);
    if (log === undefined) throw new Error("unknown family: " + familyId);
    return log.state;
  }

  opsOf(familyId: string): readonly SequencedOperation[] {
    return this.logs.get(familyId)?.ops ?? [];
  }

  conflictsOf(familyId: string): readonly ConflictRecord[] {
    return [...(this.logs.get(familyId)?.conflicts.values() ?? [])];
  }
}

function validate(op: Operation, request: PushRequest): OperationRejection | undefined {
  if (op.schemaVersion > SCHEMA_VERSION) {
    return { opId: op.opId, reason: "schema-too-new", detail: "server speaks v" + SCHEMA_VERSION };
  }
  if (op.familyId !== request.familyId || op.deviceId !== request.deviceId) {
    return { opId: op.opId, reason: "not-authorized" };
  }
  const parsed = operationSchema.safeParse(op);
  if (!parsed.success) {
    const detail = parsed.error.issues[0]?.message;
    return { opId: op.opId, reason: "schema-invalid", ...(detail === undefined ? {} : { detail }) };
  }
  return undefined;
}
