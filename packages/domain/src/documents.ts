/**
 * Documents, contacts and collections (SPEC §13).
 *
 * Two object types that look similar and behave nothing alike.
 *
 * A *document* has a deadline attached to it — a passport expires, a contract has
 * a notice period — so its job is to turn into a task in time (FR-1002, FR-1003).
 * The reminder has to be weeks early, because renewing a passport is not
 * something that can be done on the due date.
 *
 * A *collection* deliberately has no due date at all (FR-1011): gift ideas,
 * outing ideas, wish lists. It is the one place in the product where something
 * may sit untouched for a year and still be working as intended.
 */
import { DAY_MS } from "./rhythm.js";
import {
  EntityTypes,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readString,
  readStringList,
} from "./schema.js";
import type { FamilyState } from "./state.js";

export interface DocumentRecord {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly personId: string | undefined;
  readonly fileRef: string | undefined;
  /** Passport, ID card, certificate — the date it stops being valid. */
  readonly expiresAt: number | undefined;
  /** Contracts: when the notice must be given by, which is the date that matters. */
  readonly noticeDeadlineAt: number | undefined;
  readonly noticePeriodDays: number;
  readonly tags: readonly string[];
  /** Free text pulled from a scan, so search finds it (FR-1001). */
  readonly extractedText: string;
}

export function readDocument(state: FamilyState, documentId: string): DocumentRecord | undefined {
  const entity = state.get(EntityTypes.document, documentId);
  if (entity === undefined || entity.deleted) return undefined;

  return {
    id: entity.id,
    title: readString(entity, "title"),
    category: readOptionalString(entity, "category") ?? "other",
    personId: readOptionalString(entity, "personId"),
    fileRef: readOptionalString(entity, "fileRef"),
    expiresAt: readOptionalNumber(entity, "expiresAt"),
    noticeDeadlineAt: readOptionalNumber(entity, "noticeDeadlineAt"),
    noticePeriodDays: readNumber(entity, "noticePeriodDays"),
    tags: readStringList(entity, "tags"),
    extractedText: readString(entity, "extractedText"),
  };
}

export interface DocumentDeadline {
  readonly documentId: string;
  readonly title: string;
  readonly kind: "expiry" | "notice";
  readonly dueAt: number;
  /** When to start mentioning it — never the due date itself (FR-320, FR-321). */
  readonly firstReminderAt: number;
  readonly personId: string | undefined;
}

/**
 * How much warning each kind of deadline needs.
 *
 * These are not arbitrary: a passport renewal takes an appointment and weeks of
 * processing, and a contract's notice period is itself the deadline — miss it by
 * a day and the contract runs another year.
 */
const EXPIRY_LEAD_DAYS = 90;
const NOTICE_LEAD_DAYS = 30;

export function upcomingDocumentDeadlines(
  state: FamilyState,
  window: { readonly from: number; readonly to: number },
): readonly DocumentDeadline[] {
  const deadlines: DocumentDeadline[] = [];

  for (const entity of state.all(EntityTypes.document)) {
    const document = readDocument(state, entity.id);
    if (document === undefined) continue;

    if (document.expiresAt !== undefined) {
      deadlines.push({
        documentId: document.id,
        title: document.title,
        kind: "expiry",
        dueAt: document.expiresAt,
        firstReminderAt: document.expiresAt - EXPIRY_LEAD_DAYS * DAY_MS,
        personId: document.personId,
      });
    }

    // A contract's real deadline is the last day notice can be given, which is
    // the term end minus the notice period — not the term end.
    const noticeAt =
      document.noticeDeadlineAt ??
      (document.noticePeriodDays > 0 && document.expiresAt !== undefined
        ? document.expiresAt - document.noticePeriodDays * DAY_MS
        : undefined);

    if (noticeAt !== undefined) {
      deadlines.push({
        documentId: document.id,
        title: document.title,
        kind: "notice",
        dueAt: noticeAt,
        firstReminderAt: noticeAt - NOTICE_LEAD_DAYS * DAY_MS,
        personId: document.personId,
      });
    }
  }

  return deadlines
    .filter((deadline) => deadline.firstReminderAt <= window.to && deadline.dueAt >= window.from)
    .sort((a, b) => a.dueAt - b.dueAt);
}

/** Full-text search across documents and the knowledge entries (FR-1001, FR-1007). */
export function searchDocuments(state: FamilyState, query: string): readonly DocumentRecord[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];

  return state
    .all(EntityTypes.document)
    .flatMap((entity) => {
      const document = readDocument(state, entity.id);
      return document === undefined ? [] : [document];
    })
    .filter(
      (document) =>
        document.title.toLowerCase().includes(needle) ||
        document.category.toLowerCase().includes(needle) ||
        document.extractedText.toLowerCase().includes(needle) ||
        document.tags.some((tag) => tag.toLowerCase().includes(needle)),
    );
}

export interface CollectionItemRecord {
  readonly id: string;
  readonly collectionId: string;
  readonly title: string;
  readonly note: string;
  readonly url: string | undefined;
  /** Gift ideas are per person, and must not be visible to that person. */
  readonly forPersonId: string | undefined;
  readonly tags: readonly string[];
  /** Outing ideas filter on these (FR-1014). */
  readonly weather: string | undefined;
  readonly minAge: number | undefined;
  readonly maxMinutes: number | undefined;
  readonly distanceKm: number | undefined;
}

export function readCollectionItems(state: FamilyState, collectionId: string): readonly CollectionItemRecord[] {
  return state
    .all(EntityTypes.collectionItem)
    .filter((entity) => readOptionalString(entity, "collectionId") === collectionId)
    .map((entity) => ({
      id: entity.id,
      collectionId,
      title: readString(entity, "title"),
      note: readString(entity, "note"),
      url: readOptionalString(entity, "url"),
      forPersonId: readOptionalString(entity, "forPersonId"),
      tags: readStringList(entity, "tags"),
      weather: readOptionalString(entity, "weather"),
      minAge: readOptionalNumber(entity, "minAge"),
      maxMinutes: readOptionalNumber(entity, "maxMinutes"),
      distanceKm: readOptionalNumber(entity, "distanceKm"),
    }));
}

/**
 * Gift ideas must never be visible to the person they are for (FR-1012).
 *
 * This is a visibility rule rather than an access-control one: the family shares
 * a household, and the point is that a child scrolling the tablet does not spoil
 * their own birthday.
 */
export function visibleCollectionItems(
  state: FamilyState,
  collectionId: string,
  viewerPersonId: string | null,
): readonly CollectionItemRecord[] {
  return readCollectionItems(state, collectionId).filter(
    (item) => viewerPersonId === null || item.forPersonId !== viewerPersonId,
  );
}

export interface OutingFilter {
  readonly weather?: string;
  readonly age?: number;
  readonly maxMinutes?: number;
  readonly maxDistanceKm?: number;
}

/** Filtering an idea list is the whole interaction — it is searched, not tracked. */
export function filterOutingIdeas(
  items: readonly CollectionItemRecord[],
  filter: OutingFilter,
): readonly CollectionItemRecord[] {
  return items.filter((item) => {
    if (filter.weather !== undefined && item.weather !== undefined && item.weather !== filter.weather) return false;
    if (filter.age !== undefined && item.minAge !== undefined && filter.age < item.minAge) return false;
    if (filter.maxMinutes !== undefined && item.maxMinutes !== undefined && item.maxMinutes > filter.maxMinutes) {
      return false;
    }
    if (
      filter.maxDistanceKm !== undefined &&
      item.distanceKm !== undefined &&
      item.distanceKm > filter.maxDistanceKm
    ) {
      return false;
    }
    return true;
  });
}

export interface ContactRecord {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly phone: string | undefined;
  readonly email: string | undefined;
  readonly note: string;
  /** A friend's parent, so the child's contact and the adult's stay linked (FR-1010). */
  readonly relatedPersonId: string | undefined;
}

export function readContacts(state: FamilyState): readonly ContactRecord[] {
  return state.all(EntityTypes.contact).map((entity) => ({
    id: entity.id,
    name: readString(entity, "name"),
    role: readOptionalString(entity, "role") ?? "other",
    phone: readOptionalString(entity, "phone"),
    email: readOptionalString(entity, "email"),
    note: readString(entity, "note"),
    relatedPersonId: readOptionalString(entity, "relatedPersonId"),
  }));
}

/**
 * The emergency binder (FR-1009, FR-1118).
 *
 * Deliberately small and printable: the things somebody standing in for the
 * family needs when nothing digital is available.
 */
export interface EmergencyBinder {
  readonly generatedAt: number;
  readonly contacts: readonly ContactRecord[];
  readonly documents: readonly DocumentRecord[];
  readonly notes: readonly string[];
}

export function buildEmergencyBinder(state: FamilyState, now: number): EmergencyBinder {
  const emergencyRoles = new Set(["doctor", "emergency", "school", "daycare", "neighbour"]);

  return {
    generatedAt: now,
    contacts: readContacts(state).filter((contact) => emergencyRoles.has(contact.role)),
    documents: state
      .all(EntityTypes.document)
      .flatMap((entity) => {
        const document = readDocument(state, entity.id);
        return document !== undefined && document.tags.includes("emergency") ? [document] : [];
      }),
    notes: state
      .all(EntityTypes.document)
      .filter((entity) => readOptionalString(entity, "category") === "knowledge")
      .map((entity) => readString(entity, "title") + ": " + readString(entity, "extractedText")),
  };
}
