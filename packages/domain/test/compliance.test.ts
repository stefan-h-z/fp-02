import { beforeEach, describe, expect, it } from "vitest";
import {
  EntityTypes,
  FamilyState,
  RETENTION_YEARS,
  exportPersonalData,
  hasConsent,
  isLastAdult,
  learningAllowed,
  makeOperation,
  newId,
  planErasure,
  retentionCutoff,
  type Operation,
  type Value,
} from "@fam/domain";

let wall = 1000;

function op(kind: Operation["kind"], entityType: string, entityId: string, payload: Record<string, Value>): Operation {
  wall += 1;
  return makeOperation({
    opId: newId(),
    familyId: "fam-1",
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

beforeEach(() => {
  state = new FamilyState();
  state.apply(op("entity.create", EntityTypes.family, "fam-1", { name: "Müller", learningEnabled: true }));
  state.apply(op("entity.create", EntityTypes.person, "p-mum", { name: "Mum" }));
  state.apply(op("entity.create", EntityTypes.person, "p-dad", { name: "Dad" }));
  state.apply(op("entity.create", EntityTypes.person, "p-kid", { name: "Kid" }));
  state.apply(op("entity.create", EntityTypes.membership, "m-mum", { personId: "p-mum", role: "adult" }));
  state.apply(op("entity.create", EntityTypes.membership, "m-dad", { personId: "p-dad", role: "adult" }));
  state.apply(op("entity.create", EntityTypes.membership, "m-kid", { personId: "p-kid", role: "child" }));
  state.apply(
    op("entity.create", EntityTypes.event, "e-swim", { title: "Swimming", bringOwnerId: "p-dad" }),
  );
  state.apply(op("set.add", EntityTypes.event, "e-swim", { field: "participants", member: "p-kid" }));
});

describe("access and portability (FR-1411, FR-1412)", () => {
  it("returns everything held about a person, structured by type", () => {
    const bundle = exportPersonalData(state, "p-dad", "2026-07-28T08:00:00Z");

    expect(bundle.subjectId).toBe("p-dad");
    expect(bundle.entities[EntityTypes.person]?.[0]?.id).toBe("p-dad");
    expect(bundle.entities[EntityTypes.membership]?.[0]?.fields["role"]).toBe("adult");
  });

  it("includes shared entries but says plainly that they have other subjects too", () => {
    const bundle = exportPersonalData(state, "p-dad", "2026-07-28T08:00:00Z");

    expect(bundle.entities["shared"]?.map((e) => e.id)).toContain("e-swim");
    expect(bundle.notes.join(" ")).toContain("more than one data subject");
  });

  it("resolves set membership into readable lists rather than internal markers", () => {
    const bundle = exportPersonalData(state, "p-kid", "2026-07-28T08:00:00Z");
    const event = bundle.entities["shared"]?.find((e) => e.id === "e-swim");

    expect(event?.sets["participants"]).toEqual(["p-kid"]);
  });

  it("carries the consent record, including one that was revoked", () => {
    state.apply(
      op("entity.create", EntityTypes.consent, "c-1", {
        personId: "p-dad",
        subject: "health",
        policyVersion: "1.0",
        grantedAt: "2026-01-01T00:00:00Z",
        revokedAt: "2026-06-01T00:00:00Z",
      }),
    );

    const bundle = exportPersonalData(state, "p-dad", "2026-07-28T08:00:00Z");

    expect(bundle.consents).toHaveLength(1);
    expect(bundle.consents[0]?.revokedAt).toBe("2026-06-01T00:00:00Z");
  });
});

describe("erasure without destroying the family (FR-1417a)", () => {
  it("deletes what is personal", () => {
    const plan = planErasure(state, "p-dad");

    expect(plan.deleteEntityRefs).toContainEqual({ type: EntityTypes.person, id: "p-dad" });
    expect(plan.deleteEntityRefs).toContainEqual({ type: EntityTypes.membership, id: "m-dad" });
  });

  it("keeps the shared appointment and only clears the person from it", () => {
    const plan = planErasure(state, "p-dad");

    expect(plan.deleteEntityRefs.some((ref) => ref.id === "e-swim")).toBe(false);
    expect(plan.clearFields).toContainEqual({ type: EntityTypes.event, id: "e-swim", field: "bringOwnerId" });
  });

  it("removes the person from participant lists", () => {
    const plan = planErasure(state, "p-kid");

    expect(plan.removeSetMembers).toContainEqual({
      type: EntityTypes.event,
      id: "e-swim",
      field: "participants",
      member: "p-kid",
    });
  });

  it("anonymizes authorship instead of deleting the history", () => {
    expect(planErasure(state, "p-dad").anonymizeAuthorship).toBe(true);
  });

  it("removes a child's data without touching anything else (FR-1417a)", () => {
    const plan = planErasure(state, "p-kid");

    expect(plan.deletesWholeFamily).toBe(false);
    expect(plan.deleteEntityRefs.map((ref) => ref.id)).toEqual(expect.arrayContaining(["p-kid", "m-kid"]));
  });

  it("takes the whole family only when the last adult leaves", () => {
    expect(planErasure(state, "p-dad").deletesWholeFamily).toBe(false);

    state.apply(op("entity.delete", EntityTypes.membership, "m-dad", {}));

    expect(isLastAdult(state, "p-mum")).toBe(true);
    expect(planErasure(state, "p-mum").deletesWholeFamily).toBe(true);
  });

  it("does not consider a child the last adult, whoever else is left", () => {
    state.apply(op("entity.delete", EntityTypes.membership, "m-dad", {}));
    state.apply(op("entity.delete", EntityTypes.membership, "m-mum", {}));

    expect(isLastAdult(state, "p-kid")).toBe(false);
  });
});

describe("health data exists only with consent (FR-901, FR-1407)", () => {
  it("reports no consent when none was ever given", () => {
    expect(hasConsent(state, { personId: "p-mum", subject: "health" })).toBe(false);
  });

  it("reports consent once granted", () => {
    state.apply(
      op("entity.create", EntityTypes.consent, "c-1", {
        personId: "p-mum",
        subject: "health",
        policyVersion: "1.0",
        grantedAt: "2026-01-01T00:00:00Z",
      }),
    );

    expect(hasConsent(state, { personId: "p-mum", subject: "health" })).toBe(true);
  });

  it("stops reporting consent after it is revoked, but keeps the record", () => {
    state.apply(
      op("entity.create", EntityTypes.consent, "c-1", {
        personId: "p-mum",
        subject: "health",
        policyVersion: "1.0",
        grantedAt: "2026-01-01T00:00:00Z",
      }),
    );
    state.apply(op("entity.setFields", EntityTypes.consent, "c-1", { revokedAt: "2026-06-01T00:00:00Z" }));

    expect(hasConsent(state, { personId: "p-mum", subject: "health" })).toBe(false);
    expect(exportPersonalData(state, "p-mum", "2026-07-28T08:00:00Z").consents).toHaveLength(1);
  });
});

describe("privacy-friendly defaults (FR-1417, AI-06)", () => {
  it("allows learning for adults while the family leaves it on", () => {
    expect(learningAllowed(state, "p-mum")).toBe(true);
  });

  it("never analyses a child profile, whatever the family setting says", () => {
    expect(learningAllowed(state, "p-kid")).toBe(false);
  });

  it("stops learning entirely once the family switches it off", () => {
    state.apply(op("entity.setFields", EntityTypes.family, "fam-1", { learningEnabled: false }));

    expect(learningAllowed(state, "p-mum")).toBe(false);
    expect(learningAllowed(state, null)).toBe(false);
  });

  it("treats household actions with no person as allowed, since nobody is profiled", () => {
    expect(learningAllowed(state, null)).toBe(true);
  });
});

describe("retention (OBL-07, SPEC decision 25)", () => {
  it("keeps five years of history, so yearly and seasonal patterns survive", () => {
    const now = Date.parse("2026-07-28T00:00:00Z");

    expect(RETENTION_YEARS).toBe(5);
    expect(new Date(retentionCutoff(now)).toISOString()).toBe("2021-07-28T00:00:00.000Z");
  });
});
