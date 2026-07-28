import { beforeEach, describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  EntityTypes,
  FamilyState,
  backupIntegrity,
  buildBackup,
  makeOperation,
  newId,
  previewRestore,
  restoreBackup,
  type FamilyBackup,
  type Operation,
  type Value,
} from "@fam/domain";

const NOW = Date.parse("2026-07-28T08:00:00Z");
const FAMILY = "fam-1";
let wall = 1000;

function op(
  kind: Operation["kind"],
  entityType: string,
  entityId: string,
  payload: Record<string, Value>,
  familyId = FAMILY,
): Operation {
  wall += 1;
  return makeOperation({
    opId: newId(),
    familyId,
    deviceId: "device-a",
    actorId: null,
    entityType,
    entityId,
    kind,
    payload,
    hlc: { wall, counter: 0, deviceId: "device-a" },
  });
}

let state: FamilyState;

/** A family with a bit of everything: live rows, a tombstone, a set, several types. */
function seedFamily(target: FamilyState): void {
  target.apply(op("entity.create", EntityTypes.person, "p-mum", { name: "Mum" }));
  target.apply(op("entity.create", EntityTypes.person, "p-kid", { name: "Kid" }));
  target.apply(op("entity.create", EntityTypes.contact, "c-doctor", { name: "Dr Weber", role: "doctor" }));
  target.apply(
    op("entity.create", EntityTypes.event, "e-swim", {
      title: "Swimming",
      startsAt: NOW,
      endsAt: NOW + 3_600_000,
    }),
  );
  target.apply(op("set.add", EntityTypes.event, "e-swim", { field: "participants", member: "p-kid" }));
  target.apply(op("entity.create", EntityTypes.contact, "c-old", { name: "Old neighbour", role: "neighbour" }));
  target.apply(op("entity.delete", EntityTypes.contact, "c-old", {}));
}

beforeEach(() => {
  state = new FamilyState();
  seedFamily(state);
});

describe("a backup is self-describing (FR-1116)", () => {
  it("says which family it is, when it was taken and which schema wrote it", () => {
    const backup = buildBackup(state, { familyId: FAMILY, at: NOW });

    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.familyId).toBe(FAMILY);
    expect(backup.createdAt).toBe(NOW);
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
  });

  it("keeps only the entity types the family actually has", () => {
    const backup = buildBackup(state, { familyId: FAMILY, at: NOW });

    expect(Object.keys(backup.entities).sort()).toEqual([EntityTypes.contact, EntityTypes.event, EntityTypes.person]);
  });

  it("leaves another family's rows out entirely", () => {
    state.apply(op("entity.create", EntityTypes.person, "p-stranger", { name: "Stranger" }, "fam-2"));

    const backup = buildBackup(state, { familyId: FAMILY, at: NOW });

    expect(backup.entities[EntityTypes.person]?.map((entity) => entity.id)).toEqual(["p-kid", "p-mum"]);
  });
});

describe("round trip (FR-1117)", () => {
  it("restores a state that is indistinguishable from the original", () => {
    const backup = buildBackup(state, { familyId: FAMILY, at: NOW });

    const result = restoreBackup(backup);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.snapshot()).toEqual(state.snapshot());
  });

  it("survives a trip through JSON, which is how a backup actually travels", () => {
    const backup = buildBackup(state, { familyId: FAMILY, at: NOW });

    const result = restoreBackup(JSON.parse(JSON.stringify(backup)) as unknown);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.snapshot()).toEqual(state.snapshot());
  });

  it("brings the deletion back as a deletion, not as the deleted object", () => {
    const result = restoreBackup(buildBackup(state, { familyId: FAMILY, at: NOW }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.get(EntityTypes.contact, "c-old")?.deleted).toBe(true);
    expect(result.state.all(EntityTypes.contact).map((entity) => entity.id)).toEqual(["c-doctor"]);
  });

  it("keeps set membership", () => {
    const result = restoreBackup(buildBackup(state, { familyId: FAMILY, at: NOW }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.get(EntityTypes.event, "e-swim")?.sets["participants"]?.["p-kid"]?.present).toBe(true);
  });
});

describe("a backup from a newer client is refused, not guessed at", () => {
  it("rejects a schema version this build does not understand", () => {
    const backup = buildBackup(state, {
      familyId: FAMILY,
      at: NOW,
      schemaVersion: BACKUP_SCHEMA_VERSION + 1,
    });

    const result = restoreBackup(backup);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema-too-new");
    expect(result.detail).toContain("newer version");
  });

  it("accepts one written at exactly the supported version", () => {
    const backup = buildBackup(state, { familyId: FAMILY, at: NOW, schemaVersion: BACKUP_SCHEMA_VERSION });

    expect(restoreBackup(backup).ok).toBe(true);
  });
});

describe("untrusted input never throws", () => {
  const rubbish: readonly unknown[] = [null, undefined, 42, "backup", [], {}, { format: "something-else" }];

  it("turns anything unrecognisable into a result", () => {
    for (const value of rubbish) {
      const result = restoreBackup(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("not-a-backup");
    }
  });

  it("refuses a backup with no version, family or date", () => {
    const base = { format: BACKUP_FORMAT, schemaVersion: 1, familyId: FAMILY, createdAt: NOW, entities: {} };

    expect(restoreBackup({ ...base, schemaVersion: 0 }).ok).toBe(false);
    expect(restoreBackup({ ...base, familyId: "" }).ok).toBe(false);
    expect(restoreBackup({ ...base, createdAt: "yesterday" }).ok).toBe(false);
    expect(restoreBackup({ ...base, entities: [] }).ok).toBe(false);
  });

  it("fails the whole restore on one damaged row rather than dropping it", () => {
    const backup = buildBackup(state, { familyId: FAMILY, at: NOW });
    const damaged = {
      ...backup,
      entities: { ...backup.entities, [EntityTypes.person]: [{ id: "p-mum", type: EntityTypes.person }] },
    };

    const result = restoreBackup(damaged);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("malformed");
  });

  it("refuses a row filed under the wrong type", () => {
    const backup = buildBackup(state, { familyId: FAMILY, at: NOW });
    const rows = backup.entities[EntityTypes.person] ?? [];
    const misfiled = { ...backup, entities: { [EntityTypes.contact]: rows } };

    const result = restoreBackup(misfiled);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("malformed");
  });

  it("refuses a backup carrying another family's rows", () => {
    const other = new FamilyState();
    other.apply(op("entity.create", EntityTypes.person, "p-stranger", { name: "Stranger" }, "fam-2"));
    const smuggled = {
      ...buildBackup(state, { familyId: FAMILY, at: NOW }),
      entities: { [EntityTypes.person]: other.allIncludingDeleted(EntityTypes.person) },
    };

    const result = restoreBackup(smuggled);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("family-mismatch");
  });
});

describe("what is in there, before anything is overwritten (FR-1117)", () => {
  it("counts live entries and tombstones per type", () => {
    const integrity = backupIntegrity(buildBackup(state, { familyId: FAMILY, at: NOW }));

    expect(integrity.counts).toEqual([
      { type: EntityTypes.contact, live: 1, deleted: 1 },
      { type: EntityTypes.event, live: 1, deleted: 0 },
      { type: EntityTypes.person, live: 2, deleted: 0 },
    ]);
    expect(integrity.live).toBe(4);
    expect(integrity.deleted).toBe(1);
  });

  it("reports an empty family as empty rather than as an error", () => {
    const integrity = backupIntegrity(buildBackup(new FamilyState(), { familyId: FAMILY, at: NOW }));

    expect(integrity.counts).toEqual([]);
    expect(integrity.live).toBe(0);
  });

  it("gives the same digest for the same content and a different one after a change", () => {
    const first = backupIntegrity(buildBackup(state, { familyId: FAMILY, at: NOW }));
    const second = backupIntegrity(buildBackup(state, { familyId: FAMILY, at: NOW + 1 }));

    expect(second.digest).toBe(first.digest);

    state.apply(op("entity.create", EntityTypes.contact, "c-school", { name: "School", role: "school" }));
    const third = backupIntegrity(buildBackup(state, { familyId: FAMILY, at: NOW }));

    expect(third.digest).not.toBe(first.digest);
  });

  it("is carried on a successful restore, so the app can show it afterwards", () => {
    const result = restoreBackup(buildBackup(state, { familyId: FAMILY, at: NOW }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.integrity.live).toBe(4);
  });
});

describe("restoring into an empty family vs over a live one", () => {
  let backup: FamilyBackup;

  beforeEach(() => {
    backup = buildBackup(state, { familyId: FAMILY, at: NOW });
  });

  it("knows a new device cannot lose anything", () => {
    const preview = previewRestore(backup, new FamilyState());

    expect(preview.mode).toBe("into-empty");
    expect(preview.disappearing).toEqual([]);
    expect(preview.reverting).toEqual([]);
  });

  it("names every entry created since the backup, because those are the losses", () => {
    state.apply(op("entity.create", EntityTypes.task, "t-new", { title: "Booked after the backup" }));

    const preview = previewRestore(backup, state);

    expect(preview.mode).toBe("over-existing");
    expect(preview.disappearing).toEqual([{ type: EntityTypes.task, id: "t-new" }]);
  });

  it("names the entries that would fall back to their older content", () => {
    state.apply(op("entity.setFields", EntityTypes.event, "e-swim", { title: "Swimming (moved)" }));

    const preview = previewRestore(backup, state);

    expect(preview.reverting).toEqual([{ type: EntityTypes.event, id: "e-swim" }]);
    expect(preview.disappearing).toEqual([]);
  });

  it("counts a changed set membership as a change a person would notice", () => {
    state.apply(op("set.add", EntityTypes.event, "e-swim", { field: "participants", member: "p-mum" }));

    expect(previewRestore(backup, state).reverting).toEqual([{ type: EntityTypes.event, id: "e-swim" }]);
  });

  it("does not call an untouched family a change", () => {
    const preview = previewRestore(backup, state);

    expect(preview.reverting).toEqual([]);
    expect(preview.disappearing).toEqual([]);
    expect(preview.currentLive).toBe(4);
    expect(preview.currentDeleted).toBe(1);
  });

  it("does not treat a deletion made after the backup as a loss", () => {
    state.apply(op("entity.delete", EntityTypes.contact, "c-doctor", {}));

    const preview = previewRestore(backup, state);

    // The doctor is in the backup and comes back; that is a revert, not a loss.
    expect(preview.disappearing).toEqual([]);
    expect(preview.reverting).toEqual([{ type: EntityTypes.contact, id: "c-doctor" }]);
  });

  it("flags a backup that belongs to a different family", () => {
    const preview = previewRestore(backup, state, "fam-2");

    expect(preview.familyMismatch).toBe(true);
  });

  it("carries the incoming summary so both sides can be shown together", () => {
    const preview = previewRestore(backup, new FamilyState());

    expect(preview.incoming.createdAt).toBe(NOW);
    expect(preview.incoming.live).toBe(4);
  });
});
