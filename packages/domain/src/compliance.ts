/**
 * Data protection as working features (SPEC §17.2).
 *
 * The hard part of GDPR in a family app is not the export button — it is that
 * family data has several data subjects at once. A shared appointment does not
 * belong to the person who typed it, so erasing them must not take the family's
 * calendar with it (FR-1417a). The rule this module implements everywhere:
 * anonymize authorship, keep the shared object, delete what is genuinely
 * personal — and only when the last adult leaves does the family go.
 */
import { setMembers } from "./entity.js";
import type { StoredEntity } from "./entity.js";
import {
  EntityTypes,
  readOptionalString,
  readString,
} from "./schema.js";
import type { FamilyState } from "./state.js";
import type { Value } from "./ops.js";

/** Entities that describe one person and nobody else. */
const PERSONAL_ENTITY_TYPES: readonly string[] = [
  EntityTypes.person,
  EntityTypes.membership,
  EntityTypes.device,
  EntityTypes.consent,
];

/** Entities that belong to the family, whoever created them. */
const SHARED_ENTITY_TYPES: readonly string[] = [
  EntityTypes.event,
  EntityTypes.task,
  EntityTypes.recipe,
  EntityTypes.weekPlan,
  EntityTypes.mealSlot,
  EntityTypes.shoppingList,
  EntityTypes.shoppingItem,
  EntityTypes.catalogItem,
  EntityTypes.store,
  EntityTypes.responsibilityCard,
  EntityTypes.contact,
  EntityTypes.collection,
  EntityTypes.collectionItem,
];

/** Health data, which exists only while the module is switched on (FR-901). */
const HEALTH_ENTITY_TYPES: readonly string[] = [
  EntityTypes.protocol,
  EntityTypes.protocolInstance,
];

export const ANONYMOUS_ACTOR = "anonymized";

export interface ExportBundle {
  readonly subjectId: string;
  readonly generatedAt: string;
  /** Machine-readable and structured, as Art. 20 requires (FR-1412). */
  readonly entities: Readonly<Record<string, readonly ExportedEntity[]>>;
  readonly consents: readonly ConsentRecord[];
  /** Named so a person can tell what they are looking at without a lawyer. */
  readonly notes: readonly string[];
}

export interface ExportedEntity {
  readonly id: string;
  readonly type: string;
  readonly fields: Readonly<Record<string, Value>>;
  readonly sets: Readonly<Record<string, readonly string[]>>;
}

export interface ConsentRecord {
  readonly id: string;
  readonly personId: string;
  readonly subject: string;
  readonly policyVersion: string;
  readonly grantedAt: string | undefined;
  readonly revokedAt: string | undefined;
}

/**
 * Everything held about one person (Art. 15), plus the shared objects they are
 * part of, marked as shared so the reader understands why the family's calendar
 * is in their file (FR-1411).
 */
export function exportPersonalData(
  state: FamilyState,
  personId: string,
  generatedAt: string,
): ExportBundle {
  const entities: Record<string, ExportedEntity[]> = {};
  const notes: string[] = [];

  for (const type of [...PERSONAL_ENTITY_TYPES, ...HEALTH_ENTITY_TYPES]) {
    const owned = state.all(type).filter((entity) => mentionsPerson(entity, personId));
    if (owned.length > 0) entities[type] = owned.map(toExported);
  }

  const shared = SHARED_ENTITY_TYPES.flatMap((type) =>
    state.all(type).filter((entity) => mentionsPerson(entity, personId)).map(toExported),
  );
  if (shared.length > 0) {
    entities["shared"] = shared;
    notes.push(
      "Shared entries belong to the whole family and have more than one data subject; they are included because they name you.",
    );
  }

  return {
    subjectId: personId,
    generatedAt,
    entities,
    consents: readConsents(state, personId),
    notes,
  };
}

export interface ErasurePlan {
  /** Entities to delete outright — nothing else is about this person. */
  readonly deleteEntityRefs: readonly { readonly type: string; readonly id: string }[];
  /** Fields to clear on shared entities where they name the person. */
  readonly clearFields: readonly {
    readonly type: string;
    readonly id: string;
    readonly field: string;
  }[];
  /** Set memberships to drop (participants, eaters, responsible adults). */
  readonly removeSetMembers: readonly {
    readonly type: string;
    readonly id: string;
    readonly field: string;
    readonly member: string;
  }[];
  /** True when this was the last adult, so the family goes entirely (FR-1417a). */
  readonly deletesWholeFamily: boolean;
  /** Operation authorship to anonymize rather than delete. */
  readonly anonymizeAuthorship: boolean;
}

/**
 * Plan an erasure without performing it.
 *
 * Separated on purpose: erasure is irreversible and touches shared data, so the
 * app shows the person exactly what will happen before anything is written.
 */
export function planErasure(state: FamilyState, personId: string): ErasurePlan {
  const deleteEntityRefs: { type: string; id: string }[] = [];
  const clearFields: { type: string; id: string; field: string }[] = [];
  const removeSetMembers: { type: string; id: string; field: string; member: string }[] = [];

  for (const type of [...PERSONAL_ENTITY_TYPES, ...HEALTH_ENTITY_TYPES]) {
    for (const entity of state.all(type)) {
      if (mentionsPerson(entity, personId)) deleteEntityRefs.push({ type, id: entity.id });
    }
  }

  for (const type of SHARED_ENTITY_TYPES) {
    for (const entity of state.all(type)) {
      for (const [field, value] of Object.entries(entity.fields)) {
        if (value === personId) clearFields.push({ type, id: entity.id, field });
      }
      for (const [field, members] of Object.entries(entity.sets)) {
        if (members[personId]?.present === true) {
          removeSetMembers.push({ type, id: entity.id, field, member: personId });
        }
      }
    }
  }

  return {
    deleteEntityRefs,
    clearFields,
    removeSetMembers,
    deletesWholeFamily: isLastAdult(state, personId),
    anonymizeAuthorship: true,
  };
}

/** Adults left if this person goes — the family cannot exist without one. */
export function isLastAdult(state: FamilyState, personId: string): boolean {
  const adults = state
    .all(EntityTypes.membership)
    .filter((membership) => readString(membership, "role") === "adult");

  return (
    adults.some((membership) => readString(membership, "personId") === personId) &&
    adults.filter((membership) => readString(membership, "personId") !== personId).length === 0
  );
}

export interface ConsentQuery {
  readonly personId: string;
  readonly subject: string;
  readonly at?: string;
}

/**
 * Whether a consent is in force right now (FR-1410), which is what gates the
 * health module (FR-901/FR-1407). A revoked consent is kept, not deleted: the
 * record of what was agreed and when is itself the accountability evidence.
 */
export function hasConsent(state: FamilyState, query: ConsentQuery): boolean {
  return readConsents(state, query.personId)
    .filter((consent) => consent.subject === query.subject)
    .some((consent) => consent.grantedAt !== undefined && consent.revokedAt === undefined);
}

export function readConsents(state: FamilyState, personId: string): readonly ConsentRecord[] {
  return state
    .all(EntityTypes.consent)
    .filter((entity) => readString(entity, "personId") === personId)
    .map((entity) => ({
      id: entity.id,
      personId: readString(entity, "personId"),
      subject: readString(entity, "subject"),
      policyVersion: readString(entity, "policyVersion"),
      grantedAt: readOptionalString(entity, "grantedAt"),
      revokedAt: readOptionalString(entity, "revokedAt"),
    }));
}

/**
 * Whether behavioural learning may run for this person (SPEC AI-06, FR-1417).
 *
 * Three independent gates, all of which must be open: the family may switch
 * learning off entirely, children are excluded unconditionally — a child profile
 * carries no analysis of any kind, which is not a setting — and one person may
 * object on their own behalf without the family switching anything off
 * (FR-1416). The third gate is what makes the objection a right rather than a
 * checkbox: it is read here, where the processing actually happens.
 */
export function learningAllowed(state: FamilyState, personId: string | null): boolean {
  const family = state.all(EntityTypes.family)[0];
  if (family !== undefined && family.fields["learningEnabled"] === false) return false;
  if (personId === null) return true;
  if (!mayProcess(state, personId, OBJECTABLE_PROCESSINGS.behaviourLearning)) return false;

  return !state
    .all(EntityTypes.membership)
    .some(
      (membership) =>
        readString(membership, "personId") === personId && readString(membership, "role") === "child",
    );
}

/** SPEC decision 25: histories and rhythm data live five years; audio never
 * survives transcription, so it is not represented here at all. */
export const RETENTION_YEARS = 5;

export function retentionCutoff(now: number): number {
  const date = new Date(now);
  date.setUTCFullYear(date.getUTCFullYear() - RETENTION_YEARS);
  return date.getTime();
}

function mentionsPerson(entity: StoredEntity, personId: string): boolean {
  if (entity.id === personId) return true;
  if (Object.values(entity.fields).some((value) => value === personId)) return true;
  return Object.keys(entity.sets).some((field) => setMembers(entity, field).includes(personId));
}

function toExported(entity: StoredEntity): ExportedEntity {
  const sets: Record<string, readonly string[]> = {};
  for (const field of Object.keys(entity.sets)) {
    sets[field] = setMembers(entity, field);
  }
  return { id: entity.id, type: entity.type, fields: entity.fields, sets };
}

// ── Objection against individual processings (FR-1416, Art. 21) ───────────

/**
 * The processings a person may object to, one at a time.
 *
 * Art. 21 is not the consent switch and this list is not the consent list. A
 * consent asks permission before something starts; an objection stops something
 * that is otherwise lawful, and it has to be possible to stop *one* of them
 * without stopping the app. That is why this is an enumeration rather than a
 * boolean: "I do not want my behaviour analysed, but keep the reminders" is a
 * sentence a person is entitled to say, and a single opt-out switch cannot hear
 * it.
 *
 * Everything named here is something the app does on its own initiative. Work a
 * person explicitly asked for is not on the list, because objecting to it would
 * mean objecting to using the app, and Art. 21 is not a deletion request.
 */
export const OBJECTABLE_PROCESSINGS = {
  /** Rhythms, replenishment clocks, suggested recurrences (LRN, FR-1108). */
  behaviourLearning: "behaviourLearning",
  /** Sending text to the AI gateway to be structured (§16A). */
  aiProcessing: "aiProcessing",
  /** Push notifications the app decides to send, digests included. */
  proactiveNotifications: "proactiveNotifications",
  /** Being counted in the mental-load balance a partner can see (§12). */
  mentalLoadAnalysis: "mentalLoadAnalysis",
  /** Geofenced shopping reminders evaluated from the device's location (FR-719). */
  locationReminders: "locationReminders",
} as const;

export type ObjectableProcessing =
  (typeof OBJECTABLE_PROCESSINGS)[keyof typeof OBJECTABLE_PROCESSINGS];

export interface Objection {
  readonly personId: string;
  readonly processing: ObjectableProcessing;
  readonly raisedAt: string;
  /** Reasons are optional in law and stay optional here (Art. 21(1)). */
  readonly reason: string | undefined;
  readonly withdrawnAt: string | undefined;
}

export function readObjections(state: FamilyState, personId: string): readonly Objection[] {
  return state
    .all(EntityTypes.consent)
    .filter(
      (entity) =>
        readString(entity, "personId") === personId && readString(entity, "kind") === "objection",
    )
    .map((entity) => ({
      personId,
      processing: readString(entity, "subject") as ObjectableProcessing,
      raisedAt: readString(entity, "raisedAt"),
      reason: readOptionalString(entity, "reason"),
      withdrawnAt: readOptionalString(entity, "withdrawnAt"),
    }))
    .filter((objection) =>
      (Object.values(OBJECTABLE_PROCESSINGS) as readonly string[]).includes(objection.processing),
    );
}

/**
 * Whether a processing may run for this person right now.
 *
 * The default is "yes", and that is deliberate rather than lax: a processing
 * nobody objected to is one the family agreed to when they set the app up. What
 * this function guarantees is that a single objection stops a single thing —
 * immediately, without a review step, and without touching anything else the
 * person still wants.
 */
export function mayProcess(
  state: FamilyState,
  personId: string,
  processing: ObjectableProcessing,
): boolean {
  return !readObjections(state, personId).some(
    (objection) => objection.processing === processing && objection.withdrawnAt === undefined,
  );
}

/**
 * Everything currently switched off for this person, for the screen that has to
 * show them what their objections are actually doing. An objection a person
 * cannot see the effect of is a checkbox, not a right.
 */
export function activeObjections(
  state: FamilyState,
  personId: string,
): readonly ObjectableProcessing[] {
  return readObjections(state, personId)
    .filter((objection) => objection.withdrawnAt === undefined)
    .map((objection) => objection.processing);
}
