/**
 * Backup and restore (SPEC §14.2, FR-1116, FR-1117).
 *
 * FR-1117 asks for "a real restore, not just a raw-data export", and the
 * difference is entirely in what the file has to carry. A raw dump is a pile of
 * rows; a backup is a *self-describing* snapshot — it names the family it belongs
 * to, when it was taken, and which schema wrote it, so a build from next year can
 * still tell whether it is allowed to read it (FR-1116 makes backups automatic,
 * which means most of them will be read by a client that is not the one that
 * wrote them).
 *
 * A restore *replaces* state, it never merges. Merging a backup into a live
 * family looks helpful and is not: a snapshot carries tombstones, so merging it
 * would either resurrect every object the family deleted since the backup was
 * taken (if the tombstones were dropped) or delete objects created since it (if
 * they were honoured). The mechanism for combining two divergent histories
 * already exists and is the op log with its HLC ordering (FR-1214, FR-1215) — a
 * backup is not a peer, it is a point in time. So this module offers exactly two
 * shapes, "restore into an empty family" and "restore over an existing one", and
 * makes the second one show its damage first.
 */
import { setMembers, type StoredEntity } from "./entity.js";
import { valuesEqual } from "./equal.js";
import { SCHEMA_VERSION } from "./ops.js";
import { FamilyState } from "./state.js";

/** Marks the file as ours before anything else is trusted about it. */
export const BACKUP_FORMAT = "fam.backup";

/**
 * The newest backup layout this build can read.
 *
 * Deliberately the same number as the operation schema version: a backup is the
 * materialization of operations at that schema, so a client that cannot read an
 * operation of version N cannot honestly claim to read a snapshot of it either.
 */
export const BACKUP_SCHEMA_VERSION = SCHEMA_VERSION;

export interface FamilyBackup {
  readonly format: typeof BACKUP_FORMAT;
  readonly schemaVersion: number;
  readonly familyId: string;
  readonly createdAt: number;
  /** Keyed by entity type, tombstones included — see `buildBackup`. */
  readonly entities: Readonly<Record<string, readonly StoredEntity[]>>;
}

export interface BuildBackupOptions {
  readonly familyId: string;
  readonly at: number;
  /** Defaults to this build's version; passed in so a test can write an old one. */
  readonly schemaVersion?: number;
}

/**
 * Tombstones are part of the backup, not noise in it: an entity the family
 * deleted is a decision they made, and a restore that quietly brings back the
 * contact they removed is a worse outcome than a restore that fails.
 *
 * Rows belonging to another family are dropped rather than carried along. A
 * `FamilyState` should never hold them, but a backup crosses devices and mail
 * accounts, and the family boundary is the one line the product treats as
 * absolute (FR-1417a).
 */
export function buildBackup(state: FamilyState, options: BuildBackupOptions): FamilyBackup {
  const entities: Record<string, readonly StoredEntity[]> = {};

  for (const [type, rows] of Object.entries(state.snapshot())) {
    const own = rows.filter((entity) => entity.familyId === options.familyId);
    if (own.length > 0) entities[type] = own;
  }

  return {
    format: BACKUP_FORMAT,
    schemaVersion: options.schemaVersion ?? BACKUP_SCHEMA_VERSION,
    familyId: options.familyId,
    createdAt: options.at,
    entities,
  };
}

export type RestoreRejection =
  /** Not a backup file at all — wrong shape, wrong marker, or not an object. */
  | "not-a-backup"
  /** Written by a newer client; reading it would guess at fields we do not know. */
  | "schema-too-new"
  /** Right shape, unusable content. */
  | "malformed"
  /** Someone else's family, which is never a restore, only a leak. */
  | "family-mismatch";

export type RestoreResult =
  | {
      readonly ok: true;
      readonly backup: FamilyBackup;
      readonly state: FamilyState;
      readonly integrity: BackupIntegrity;
    }
  | {
      readonly ok: false;
      readonly reason: RestoreRejection;
      /** Plain English, for a person staring at a file that will not open. */
      readonly detail: string;
    };

/**
 * Read an untrusted backup.
 *
 * Takes `unknown` and returns a result rather than throwing, because the input is
 * a file: it arrives from a cloud drive, an email attachment or a phone that died
 * halfway through writing it, and "the app crashed while I was restoring my
 * family" is the one failure mode a backup feature must not have.
 *
 * A single malformed row fails the whole restore instead of being skipped. A
 * restore that silently drops rows produces a family that looks complete and is
 * not, and nobody would ever find out which entry went missing.
 */
export function restoreBackup(input: unknown): RestoreResult {
  if (!isRecord(input)) return reject("not-a-backup", "The file is not a backup.");
  if (input["format"] !== BACKUP_FORMAT) return reject("not-a-backup", "The file is not a backup.");

  const schemaVersion = input["schemaVersion"];
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return reject("not-a-backup", "The backup does not say which version wrote it.");
  }
  if (schemaVersion > BACKUP_SCHEMA_VERSION) {
    return reject(
      "schema-too-new",
      "This backup was written by a newer version of the app (version " +
        schemaVersion +
        "; this app reads up to " +
        BACKUP_SCHEMA_VERSION +
        "). Update the app and try again.",
    );
  }

  const familyId = input["familyId"];
  if (typeof familyId !== "string" || familyId.length === 0) {
    return reject("not-a-backup", "The backup does not say which family it belongs to.");
  }

  const createdAt = input["createdAt"];
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
    return reject("not-a-backup", "The backup does not say when it was taken.");
  }

  const rawEntities = input["entities"];
  if (!isRecord(rawEntities)) return reject("not-a-backup", "The backup contains no entries.");

  const entities: Record<string, readonly StoredEntity[]> = {};
  for (const [type, rows] of Object.entries(rawEntities)) {
    if (!Array.isArray(rows)) return reject("malformed", 'The entries for "' + type + '" are damaged.');

    const parsed: StoredEntity[] = [];
    for (const row of rows) {
      if (!isStoredEntity(row)) return reject("malformed", 'An entry of type "' + type + '" is damaged.');
      if (row.type !== type) {
        return reject("malformed", 'An entry is filed under "' + type + '" but says it is a "' + row.type + '".');
      }
      if (row.familyId !== familyId) {
        return reject("family-mismatch", "The backup contains entries belonging to a different family.");
      }
      parsed.push(row);
    }
    entities[type] = parsed;
  }

  const backup: FamilyBackup = { format: BACKUP_FORMAT, schemaVersion, familyId, createdAt, entities };

  return {
    ok: true,
    backup,
    state: FamilyState.fromSnapshot(entities),
    integrity: backupIntegrity(backup),
  };
}

export interface EntityTypeCount {
  readonly type: string;
  readonly live: number;
  /** Tombstones: things the family deleted, which the restore will delete again. */
  readonly deleted: number;
}

export interface BackupIntegrity {
  readonly familyId: string;
  readonly createdAt: number;
  readonly schemaVersion: number;
  readonly live: number;
  readonly deleted: number;
  /** One row per entity type, type-sorted, so the summary reads the same twice. */
  readonly counts: readonly EntityTypeCount[];
  /**
   * A cheap fold over every id in canonical order. It catches a truncated,
   * reordered or half-written file, which is what actually goes wrong with
   * backups — it is not a signature, and calling it one would be a lie the
   * family could not check.
   */
  readonly digest: string;
}

/**
 * What is in this backup, in numbers a person can read.
 *
 * FR-1117 wants a restore somebody can decide about, and a decision needs
 * something comparable: "342 entries, 12 contacts, taken on Sunday" against what
 * is on the device right now. Hence counts per type rather than one total.
 */
export function backupIntegrity(backup: FamilyBackup): BackupIntegrity {
  const counts: EntityTypeCount[] = [];
  let live = 0;
  let deleted = 0;
  let digest = 0x811c9dc5;

  for (const type of Object.keys(backup.entities).sort()) {
    const rows = backup.entities[type] ?? [];
    const liveRows = rows.filter((entity) => !entity.deleted).length;
    counts.push({ type, live: liveRows, deleted: rows.length - liveRows });
    live += liveRows;
    deleted += rows.length - liveRows;

    for (const entity of [...rows].sort(byId)) {
      digest = fold(digest, type + " " + entity.id + " " + (entity.deleted ? "1" : "0"));
    }
  }

  return {
    familyId: backup.familyId,
    createdAt: backup.createdAt,
    schemaVersion: backup.schemaVersion,
    live,
    deleted,
    counts,
    digest: (digest >>> 0).toString(16).padStart(8, "0"),
  };
}

export interface EntityRef {
  readonly type: string;
  readonly id: string;
}

/** `into-empty` is the new-device case and cannot lose anything; `over-existing`
 * always can, which is why the two are named rather than inferred by the caller. */
export type RestoreMode = "into-empty" | "over-existing";

export interface RestorePreview {
  readonly mode: RestoreMode;
  readonly incoming: BackupIntegrity;
  readonly currentLive: number;
  readonly currentDeleted: number;
  /** Live now, absent from the backup: these are gone after the restore. */
  readonly disappearing: readonly EntityRef[];
  /** Present in both with different content: these fall back to the older version. */
  readonly reverting: readonly EntityRef[];
  /** The backup belongs to a different family than the state it would replace. */
  readonly familyMismatch: boolean;
}

/**
 * What a restore would cost, computed before anything is written.
 *
 * The same separation as `planErasure` in `compliance.ts`, for the same reason:
 * the operation is irreversible from the user's point of view, so the app shows
 * the losses first and lets a person say no. Every entry created since the backup
 * was taken is in `disappearing` — that is the number people are actually
 * deciding about, and no aggregate count would show it to them.
 */
export function previewRestore(
  backup: FamilyBackup,
  current: FamilyState,
  currentFamilyId?: string,
): RestorePreview {
  const snapshot = current.snapshot();
  const incoming = new Map<string, StoredEntity>();
  for (const [type, rows] of Object.entries(backup.entities)) {
    for (const entity of rows) incoming.set(type + " " + entity.id, entity);
  }

  const disappearing: EntityRef[] = [];
  const reverting: EntityRef[] = [];
  let currentLive = 0;
  let currentDeleted = 0;
  let familyMismatch = false;

  for (const [type, rows] of Object.entries(snapshot)) {
    for (const entity of rows) {
      if (entity.deleted) currentDeleted += 1;
      else currentLive += 1;
      if (entity.familyId !== backup.familyId) familyMismatch = true;

      const older = incoming.get(type + " " + entity.id);
      if (older === undefined) {
        // A tombstone that the backup never saw is not a loss — the object is
        // already gone, and the restore simply forgets that it ever existed.
        if (!entity.deleted) disappearing.push({ type, id: entity.id });
      } else if (!sameContent(older, entity)) {
        reverting.push({ type, id: entity.id });
      }
    }
  }

  if (currentFamilyId !== undefined && currentFamilyId !== backup.familyId) familyMismatch = true;

  return {
    mode: currentLive + currentDeleted === 0 ? "into-empty" : "over-existing",
    incoming: backupIntegrity(backup),
    currentLive,
    currentDeleted,
    disappearing: disappearing.sort(byRef),
    reverting: reverting.sort(byRef),
    familyMismatch,
  };
}

/**
 * Content as a person understands it: whether the thing exists, what it says, and
 * who is on it. Field versions and HLC stamps are merge bookkeeping — two
 * replicas can hold the same appointment with different metadata, and telling
 * somebody their dentist appointment "will change" because of that would be
 * noise (FR-1215 keeps that distinction everywhere else too).
 */
function sameContent(a: StoredEntity, b: StoredEntity): boolean {
  if (a.deleted !== b.deleted) return false;
  if (!valuesEqual(a.fields, b.fields)) return false;

  const setFields = new Set([...Object.keys(a.sets), ...Object.keys(b.sets)]);
  for (const field of setFields) {
    const left = setMembers(a, field);
    const right = setMembers(b, field);
    if (left.length !== right.length || left.some((member, i) => member !== right[i])) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural only. Field *values* are not validated against a domain schema on
 * purpose: the reducer stores untyped field bags so it can merge anything
 * (`entity.ts`), and every reader above it already copes with a malformed field
 * by falling back (`schema.ts`). Re-validating here would reject backups the
 * running app handles happily.
 */
function isStoredEntity(value: unknown): value is StoredEntity {
  if (!isRecord(value)) return false;
  if (typeof value["id"] !== "string" || value["id"].length === 0) return false;
  if (typeof value["type"] !== "string" || value["type"].length === 0) return false;
  if (typeof value["familyId"] !== "string" || value["familyId"].length === 0) return false;
  if (typeof value["deleted"] !== "boolean") return false;
  if (!isRecord(value["fields"])) return false;
  if (!isRecord(value["meta"])) return false;

  const sets = value["sets"];
  if (!isRecord(sets)) return false;
  for (const members of Object.values(sets)) {
    if (!isRecord(members)) return false;
    for (const member of Object.values(members)) {
      if (!isRecord(member) || typeof member["present"] !== "boolean") return false;
    }
  }
  return true;
}

function reject(reason: RestoreRejection, detail: string): RestoreResult {
  return { ok: false, reason, detail };
}

/** FNV-1a over UTF-16 code units — small, dependency-free and stable across
 * engines, which is all the digest promises to be. */
function fold(seed: number, text: string): number {
  let hash = seed;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash;
}

function byId(a: StoredEntity, b: StoredEntity): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byRef(a: EntityRef, b: EntityRef): number {
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
