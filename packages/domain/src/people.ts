/**
 * Who a person is, and what they are allowed to see (SPEC §4.1).
 *
 * The spec is emphatic that there is no permission system beyond the roles
 * (FR-102), and this file keeps that promise. What it adds is the two places
 * where "everyone in the family sees everything" is not true, and both are
 * about real households rather than about security:
 *
 *  - a **separated parent** is a member of this family for the child's sake and
 *    for nothing else (FR-104), so their view is scoped to what was explicitly
 *    shared for that child;
 *  - **emergency access** is the opposite case (FR-111) — a designated adult
 *    who normally sees less is deliberately allowed to see everything needed to
 *    keep the day running, for a bounded time, and it is written down.
 *
 * Pets (FR-109) are here too, because a pet is exactly a person who receives
 * care and holds no access: the same tasks, the same protocols, no device.
 * Modelling them as anything else would have duplicated both.
 */
import type { FamilyState } from "./state.js";
import { EntityTypes, readRecords, readString, readStringList } from "./schema.js";
import { setMembers, type StoredEntity } from "./entity.js";

// ── Profile (FR-101) ──────────────────────────────────────────────────────

/**
 * The colours a family picks from.
 *
 * A fixed, ordered palette rather than a colour wheel: the colour's whole job
 * is telling two people apart at a glance on a shared calendar, and a free
 * picker reliably produces two blues nobody can distinguish.
 */
export const PERSON_COLOURS: readonly string[] = [
  "berry",
  "ocean",
  "moss",
  "amber",
  "plum",
  "clay",
  "teal",
  "slate",
];

export type PersonKind = "human" | "pet";

export interface PersonProfile {
  readonly id: string;
  readonly name: string;
  readonly colour: string;
  /** An emoji or a stored document id; empty when the person has none. */
  readonly avatar: string;
  readonly kind: PersonKind;
  readonly bornOn: string;
  /** The same child in another household (FR-106). */
  readonly linkedPersonIds: readonly string[];
}

export function readProfile(state: FamilyState, personId: string): PersonProfile | undefined {
  const person = state.get(EntityTypes.person, personId);
  if (person === undefined || person.deleted) return undefined;

  return {
    id: personId,
    name: readString(person, "name"),
    colour: readString(person, "colour"),
    avatar: readString(person, "avatar"),
    kind: readString(person, "kind") === "pet" ? "pet" : "human",
    bornOn: readString(person, "bornOn"),
    linkedPersonIds: readStringList(person, "linkedPersonIds"),
  };
}

/**
 * The next colour nobody in the family is using.
 *
 * Falls back to the palette in order once every colour is taken — a tenth
 * person sharing a colour with the first is better than a tenth person with no
 * colour, and by then the family has bigger problems than telling two ambers
 * apart.
 */
export function nextFreeColour(state: FamilyState): string {
  const taken = new Set(
    state
      .all(EntityTypes.person)
      .map((person) => readString(person, "colour"))
      .filter((colour) => colour.length > 0),
  );

  return PERSON_COLOURS.find((colour) => !taken.has(colour)) ?? PERSON_COLOURS[0] ?? "berry";
}

/** Everyone who receives care but holds no access (FR-109). */
export function pets(state: FamilyState): readonly PersonProfile[] {
  return state
    .all(EntityTypes.person)
    .map((person) => readProfile(state, person.id))
    .filter((profile): profile is PersonProfile => profile !== undefined && profile.kind === "pet");
}

// ── Linked children across households (FR-106) ────────────────────────────

/**
 * Whether an object is shared with the other household.
 *
 * Opt-in per object, never per person: two separated parents agreeing to share
 * a school calendar is not the same as agreeing to share everything, and the
 * data model should not make the second easy by accident.
 */
export function isSharedAcrossHouseholds(entity: StoredEntity | undefined): boolean {
  return entity?.fields["sharedAcrossHouseholds"] === true;
}

/** The child ids this person is the same child as, in other families. */
export function linkedChildren(state: FamilyState, personId: string): readonly string[] {
  return readProfile(state, personId)?.linkedPersonIds ?? [];
}

// ── What a separated parent sees (FR-104) ─────────────────────────────────

export interface ScopeInput {
  readonly viewerRole: string;
  /** The children this viewer is a parent of. */
  readonly viewerChildIds: readonly string[];
}

/**
 * Can this viewer see this object?
 *
 * `true` for everybody except a separated parent, which is the point: this is
 * not a permission system, it is one role with a narrow window. For that role
 * an object is visible when it was explicitly shared across households *and* it
 * concerns one of their children — both, because a shared object about somebody
 * else's child is still not theirs to read.
 */
export function isVisibleTo(entity: StoredEntity | undefined, scope: ScopeInput): boolean {
  if (entity === undefined) return false;
  if (scope.viewerRole !== "separated-parent") return true;
  if (!isSharedAcrossHouseholds(entity)) return false;

  const about = subjectsOf(entity);
  return about.length === 0 ? false : about.some((id) => scope.viewerChildIds.includes(id));
}

/** Whom an object is about, across the several field names entities use. */
/**
 * Every way an entity can name the people it is about.
 *
 * The set fields are not optional extras. An event stores who is coming in an
 * observed-remove set called `participants`, which is the shape the sync engine
 * actually produces — reading only the scalar fields and the plain lists meant a
 * separated parent could not see their own child's shared swimming lesson,
 * because nothing the entity said about that child was in a place this looked.
 */
const SUBJECT_FIELDS: readonly string[] = ["personId", "childId", "ownerId", "assigneeId"];
const SUBJECT_LISTS: readonly string[] = ["personIds", "childIds"];
const SUBJECT_SETS: readonly string[] = ["participants", "eaters", "responsibleAdults"];

function subjectsOf(entity: StoredEntity): readonly string[] {
  return [
    ...SUBJECT_FIELDS.map((field) => readString(entity, field)).filter((value) => value.length > 0),
    ...SUBJECT_LISTS.flatMap((field) => readStringList(entity, field)),
    ...SUBJECT_SETS.flatMap((field) => setMembers(entity, field)),
  ];
}

/** Applies the scope to a list, so callers cannot forget one entity. */
export function visibleEntities(
  entities: readonly StoredEntity[],
  scope: ScopeInput,
): readonly StoredEntity[] {
  return entities.filter((entity) => isVisibleTo(entity, scope));
}

// ── Emergency access (FR-111) and the access log (SEC-05, FR-1419) ────────

export interface EmergencyGrant {
  readonly personId: string;
  readonly grantedBy: string;
  readonly from: number;
  readonly until: number;
  readonly reason: string;
}

/**
 * The standing designation: who may take emergency access if they need it.
 *
 * Designated in advance and in calm, because the moment it is needed is the
 * moment nobody can be asked. Taking it is a separate act, and a logged one.
 */
export function emergencyGrants(state: FamilyState, familyId: string): readonly EmergencyGrant[] {
  const family = state.get(EntityTypes.family, familyId);

  return readRecords(family, "emergencyGrants")
    .map((raw) => ({
      personId: typeof raw["personId"] === "string" ? raw["personId"] : "",
      grantedBy: typeof raw["grantedBy"] === "string" ? raw["grantedBy"] : "",
      from: Number(raw["from"] ?? 0),
      until: Number(raw["until"] ?? 0),
      reason: typeof raw["reason"] === "string" ? raw["reason"] : "",
    }))
    .filter((grant) => grant.personId.length > 0);
}

/** Is emergency access in force for this person right now? */
export function hasEmergencyAccess(
  state: FamilyState,
  input: { readonly familyId: string; readonly personId: string; readonly now: number },
): boolean {
  return emergencyGrants(state, input.familyId).some(
    (grant) =>
      grant.personId === input.personId && input.now >= grant.from && input.now <= grant.until,
  );
}

export type AccessKind = "emergency" | "health" | "document" | "export";

export interface AccessRecord {
  readonly at: number;
  readonly personId: string;
  readonly kind: AccessKind;
  readonly subject: string;
}

/**
 * The access log (SEC-05, FR-1419).
 *
 * Only the areas where being read is itself worth knowing about: health data,
 * documents, an export, and any use of emergency access. Logging every read of
 * the shopping list would bury exactly the entries this exists for, and would
 * itself become a record of what the family does all day.
 */
export function accessLog(
  state: FamilyState,
  input: { readonly familyId: string; readonly since?: number },
): readonly AccessRecord[] {
  const family = state.get(EntityTypes.family, input.familyId);

  return readRecords(family, "accessLog")
    .map((raw) => ({
      at: Number(raw["at"] ?? 0),
      personId: typeof raw["personId"] === "string" ? raw["personId"] : "",
      kind: accessKindOf(raw["kind"]),
      subject: typeof raw["subject"] === "string" ? raw["subject"] : "",
    }))
    .filter((entry) => entry.personId.length > 0)
    .filter((entry) => input.since === undefined || entry.at >= input.since)
    .sort((a, b) => b.at - a.at);
}

function accessKindOf(value: unknown): AccessKind {
  return value === "health" || value === "document" || value === "export" || value === "emergency"
    ? value
    : "document";
}

/**
 * Does reading this need a second factor (SEC-02)?
 *
 * Exactly the sensitive areas, and nothing else. A second factor on the whole
 * app would be the password this product spent its whole design avoiding
 * (SPEC §4.2) — it belongs on the handful of screens where the harm from a
 * borrowed unlocked phone is real.
 */
export function needsSecondFactor(kind: AccessKind): boolean {
  return kind === "health" || kind === "document" || kind === "emergency";
}
