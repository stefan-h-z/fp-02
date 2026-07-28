/**
 * Who a person is, and what they may see (SPEC §4.1).
 *
 * The scoping tests carry the weight here. A separated parent seeing one object
 * too many is a real harm to a real household, so the cases are written from
 * the failure direction: what must *not* be visible, and why.
 */
import { describe, expect, it } from "vitest";
import {
  EntityTypes,
  FamilyState,
  PERSON_COLOURS,
  accessLog,
  applyOperation,
  emergencyGrants,
  emptyEntity,
  hasEmergencyAccess,
  HlcClock,
  isSharedAcrossHouseholds,
  isVisibleTo,
  linkedChildren,
  makeOperation,
  needsSecondFactor,
  newId,
  nextFreeColour,
  pets,
  readProfile,
  visibleEntities,
  type Value,
} from "../src/index.js";

const FAMILY = "fam-1";
const clock = new HlcClock({ deviceId: "device-a", now: () => 1_700_000_000_000 });

function put(state: FamilyState, type: string, id: string, fields: Record<string, Value>): void {
  state.put(
    applyOperation(
      emptyEntity(type, id, FAMILY),
      makeOperation({
        opId: newId(),
        familyId: FAMILY,
        deviceId: "device-a",
        actorId: "person-mum",
        entityType: type,
        entityId: id,
        kind: "entity.create",
        payload: fields,
        hlc: clock.next(),
      }),
    ).entity,
  );
}

describe("profiles (FR-101)", () => {
  it("reads name, colour and avatar", () => {
    const state = new FamilyState();
    put(state, EntityTypes.person, "person-mum", {
      name: "Anna",
      colour: "berry",
      avatar: "🦊",
      bornOn: "1988-03-02",
    });

    const profile = readProfile(state, "person-mum");

    expect(profile?.name).toBe("Anna");
    expect(profile?.colour).toBe("berry");
    expect(profile?.avatar).toBe("🦊");
    expect(profile?.kind).toBe("human");
  });

  /**
   * A fixed palette, not a colour wheel: the colour exists to tell two people
   * apart at a glance, and a free picker reliably produces two blues.
   */
  it("hands out a colour nobody is using", () => {
    const state = new FamilyState();
    put(state, EntityTypes.person, "person-mum", { name: "Anna", colour: PERSON_COLOURS[0] ?? "" });

    expect(nextFreeColour(state)).toBe(PERSON_COLOURS[1]);
  });

  it("keeps going once the palette is exhausted rather than leaving somebody blank", () => {
    const state = new FamilyState();
    PERSON_COLOURS.forEach((colour, index) => {
      put(state, EntityTypes.person, `person-${String(index)}`, { name: "X", colour });
    });

    expect(PERSON_COLOURS).toContain(nextFreeColour(state));
  });

  it("is undefined for somebody who was deleted", () => {
    const state = new FamilyState();

    expect(readProfile(state, "person-gone")).toBeUndefined();
  });
});

describe("pets (FR-109)", () => {
  /** A pet is exactly a person who receives care and holds no access. */
  it("are people with a kind, so tasks and protocols work unchanged", () => {
    const state = new FamilyState();
    put(state, EntityTypes.person, "person-kid", { name: "Ben" });
    put(state, EntityTypes.person, "pet-dog", { name: "Rex", kind: "pet" });

    const found = pets(state);

    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("Rex");
    expect(readProfile(state, "person-kid")?.kind).toBe("human");
  });
});

describe("linked children across households (FR-106)", () => {
  it("records the same child's id in the other family", () => {
    const state = new FamilyState();
    put(state, EntityTypes.person, "person-kid", {
      name: "Ben",
      linkedPersonIds: ["other-family-ben"],
    });

    expect(linkedChildren(state, "person-kid")).toEqual(["other-family-ben"]);
  });

  it("is opt-in per object, never per person", () => {
    const state = new FamilyState();
    put(state, EntityTypes.event, "e-school", { title: "Parents' evening", childId: "person-kid" });
    put(state, EntityTypes.event, "e-shared", {
      title: "Sports day",
      childId: "person-kid",
      sharedAcrossHouseholds: true,
    });

    expect(isSharedAcrossHouseholds(state.get(EntityTypes.event, "e-school"))).toBe(false);
    expect(isSharedAcrossHouseholds(state.get(EntityTypes.event, "e-shared"))).toBe(true);
  });
});

describe("what a separated parent sees (FR-104)", () => {
  function household(): FamilyState {
    const state = new FamilyState();
    put(state, EntityTypes.event, "e-private", { title: "Date night", personId: "person-mum" });
    put(state, EntityTypes.event, "e-child-private", { title: "Dentist", childId: "person-kid" });
    put(state, EntityTypes.event, "e-child-shared", {
      title: "Sports day",
      childId: "person-kid",
      sharedAcrossHouseholds: true,
    });
    put(state, EntityTypes.event, "e-other-shared", {
      title: "Other child's concert",
      childId: "person-other",
      sharedAcrossHouseholds: true,
    });
    return state;
  }

  const scope = { viewerRole: "separated-parent", viewerChildIds: ["person-kid"] };

  it("shows an object shared for their own child", () => {
    expect(isVisibleTo(household().get(EntityTypes.event, "e-child-shared"), scope)).toBe(true);
  });

  it("hides the household's own life", () => {
    expect(isVisibleTo(household().get(EntityTypes.event, "e-private"), scope)).toBe(false);
  });

  it("hides an unshared object even about their own child", () => {
    expect(isVisibleTo(household().get(EntityTypes.event, "e-child-private"), scope)).toBe(false);
  });

  /**
   * Shared *and* about their child — both. A shared object about somebody
   * else's child is still not theirs to read, and this is the case a naive
   * "is it shared?" check gets wrong.
   */
  it("hides a shared object about a different child", () => {
    expect(isVisibleTo(household().get(EntityTypes.event, "e-other-shared"), scope)).toBe(false);
  });

  it("changes nothing for every other role", () => {
    const state = household();
    const adult = { viewerRole: "adult", viewerChildIds: [] };

    expect(isVisibleTo(state.get(EntityTypes.event, "e-private"), adult)).toBe(true);
    expect(isVisibleTo(state.get(EntityTypes.event, "e-child-private"), adult)).toBe(true);
  });

  it("filters a whole list, so a caller cannot forget one", () => {
    const state = household();
    const all = state.all(EntityTypes.event);

    expect(visibleEntities(all, scope).map((e) => e.id)).toEqual(["e-child-shared"]);
    expect(visibleEntities(all, { viewerRole: "adult", viewerChildIds: [] })).toHaveLength(4);
  });

  it("hides an object that is about nobody", () => {
    const state = new FamilyState();
    put(state, EntityTypes.event, "e-vague", { title: "Something", sharedAcrossHouseholds: true });

    expect(isVisibleTo(state.get(EntityTypes.event, "e-vague"), scope)).toBe(false);
  });
});

describe("emergency access (FR-111)", () => {
  const NOW = 1_700_000_000_000;

  function withGrant(from: number, until: number): FamilyState {
    const state = new FamilyState();
    put(state, EntityTypes.family, FAMILY, {
      name: "Müller",
      emergencyGrants: [
        { personId: "person-gran", grantedBy: "person-mum", from, until, reason: "Hospital" },
      ],
    });
    return state;
  }

  it("is designated in advance, with who granted it and why", () => {
    const grants = emergencyGrants(withGrant(NOW - 1000, NOW + 1000), FAMILY);

    expect(grants).toHaveLength(1);
    expect(grants[0]?.grantedBy).toBe("person-mum");
    expect(grants[0]?.reason).toBe("Hospital");
  });

  it("is in force only inside its window", () => {
    const state = withGrant(NOW, NOW + 60_000);

    expect(hasEmergencyAccess(state, { familyId: FAMILY, personId: "person-gran", now: NOW })).toBe(true);
    expect(
      hasEmergencyAccess(state, { familyId: FAMILY, personId: "person-gran", now: NOW + 61_000 }),
    ).toBe(false);
    expect(
      hasEmergencyAccess(state, { familyId: FAMILY, personId: "person-gran", now: NOW - 1 }),
    ).toBe(false);
  });

  it("is not transferable to somebody who was not designated", () => {
    const state = withGrant(NOW - 1000, NOW + 1000);

    expect(hasEmergencyAccess(state, { familyId: FAMILY, personId: "person-dad", now: NOW })).toBe(
      false,
    );
  });
});

describe("the access log (SEC-05, FR-1419)", () => {
  const NOW = 1_700_000_000_000;

  function withLog(): FamilyState {
    const state = new FamilyState();
    put(state, EntityTypes.family, FAMILY, {
      name: "Müller",
      accessLog: [
        { at: NOW - 3000, personId: "person-mum", kind: "health", subject: "person-kid" },
        { at: NOW - 1000, personId: "person-gran", kind: "emergency", subject: "family" },
        { at: NOW - 2000, personId: "person-dad", kind: "document", subject: "doc-1" },
      ],
    });
    return state;
  }

  it("reads newest first, because that is the question being asked", () => {
    expect(accessLog(withLog(), { familyId: FAMILY }).map((e) => e.personId)).toEqual([
      "person-gran",
      "person-dad",
      "person-mum",
    ]);
  });

  it("windows to a period", () => {
    expect(accessLog(withLog(), { familyId: FAMILY, since: NOW - 1500 })).toHaveLength(1);
  });

  /**
   * Only where being read is itself worth knowing. Logging every glance at the
   * shopping list would bury these entries and would itself become a record of
   * what the family does all day.
   */
  it("guards exactly the sensitive areas with a second factor (SEC-02)", () => {
    expect(needsSecondFactor("health")).toBe(true);
    expect(needsSecondFactor("document")).toBe(true);
    expect(needsSecondFactor("emergency")).toBe(true);
    expect(needsSecondFactor("export")).toBe(false);
  });
});
