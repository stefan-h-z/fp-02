/**
 * One search field for everything (SPEC FR-1213).
 *
 * The point is not completeness but recall under pressure: somebody half
 * remembers "that thing about the swimming badge" and needs it now. So matching
 * is forgiving — any query word may match any indexed field — while ranking is
 * strict, because a result list nobody trusts is a list nobody uses.
 *
 * Visibility is applied here rather than by the caller: a gift idea must never
 * surface in the search of the person it is for (FR-1012), and that is exactly
 * the kind of rule that gets forgotten at one of five call sites.
 */
import { setMembers } from "./entity.js";
import type { StoredEntity } from "./entity.js";
import {
  EntityTypes,
  readOptionalNumber,
  readOptionalString,
  readRecords,
  readString,
  readStringList,
} from "./schema.js";
import type { FamilyState } from "./state.js";

export type SearchKind =
  | "event"
  | "task"
  | "recipe"
  | "shoppingItem"
  | "document"
  | "contact"
  | "collectionItem"
  | "protocol"
  | "person";

export interface SearchHit {
  readonly id: string;
  readonly kind: SearchKind;
  readonly title: string;
  /** The line shown under the title: enough to tell two similar hits apart. */
  readonly subtitle: string;
  readonly score: number;
  /** Sorts recent things above ancient ones when relevance ties. */
  readonly at: number | undefined;
}

export interface SearchOptions {
  readonly kinds?: readonly SearchKind[];
  readonly limit?: number;
  /** Who is looking — gift ideas for this person are hidden (FR-1012). */
  readonly viewerPersonId?: string | null;
  readonly now?: number;
}

interface Indexed {
  readonly id: string;
  readonly kind: SearchKind;
  readonly title: string;
  readonly subtitle: string;
  readonly at: number | undefined;
  /** Everything searchable, already lowercased. */
  readonly haystack: readonly string[];
}

const DEFAULT_LIMIT = 20;

export function search(state: FamilyState, query: string, options: SearchOptions = {}): readonly SearchHit[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const kinds = options.kinds;
  const viewer = options.viewerPersonId ?? null;

  return index(state, viewer)
    .filter((entry) => kinds === undefined || kinds.includes(entry.kind))
    .map((entry) => ({ entry, score: score(entry, terms) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Newer first when relevance is equal: a family looking for "dentist"
      // almost always wants the next one, not the one from two years ago.
      return (b.entry.at ?? 0) - (a.entry.at ?? 0);
    })
    .slice(0, options.limit ?? DEFAULT_LIMIT)
    .map((scored) => ({
      id: scored.entry.id,
      kind: scored.entry.kind,
      title: scored.entry.title,
      subtitle: scored.entry.subtitle,
      score: Math.round(scored.score * 100) / 100,
      at: scored.entry.at,
    }));
}

/**
 * Every word must match something, but any field may be what it matches — a
 * query like "swimming form" should find the parent letter whose title says
 * form and whose text says swimming.
 */
function score(entry: Indexed, terms: readonly string[]): number {
  let total = 0;

  for (const term of terms) {
    let best = 0;
    for (let field = 0; field < entry.haystack.length; field += 1) {
      const value = entry.haystack[field] ?? "";
      if (!value.includes(term)) continue;

      // A title hit is worth more than a body hit, and a word boundary more
      // than a substring — "milk" should not rank "buttermilk" above "milk".
      const fieldWeight = field === 0 ? 2 : 1;
      const exact = value === term ? 1.5 : new RegExp("\\b" + escapeRegExp(term)).test(value) ? 1.2 : 0.6;
      best = Math.max(best, fieldWeight * exact);
    }
    if (best === 0) return 0;
    total += best;
  }

  return total / terms.length;
}

function index(state: FamilyState, viewer: string | null): readonly Indexed[] {
  return [
    ...state.all(EntityTypes.event).map(indexEvent),
    ...state.all(EntityTypes.task).map(indexTask),
    ...state.all(EntityTypes.recipe).map(indexRecipe),
    ...state.all(EntityTypes.shoppingItem).map(indexShoppingItem),
    ...state.all(EntityTypes.document).map(indexDocument),
    ...state.all(EntityTypes.contact).map(indexContact),
    ...state
      .all(EntityTypes.collectionItem)
      .filter((entity) => readOptionalString(entity, "forPersonId") !== viewer || viewer === null)
      .map(indexCollectionItem),
    ...state.all(EntityTypes.protocol).map(indexProtocol),
    ...state.all(EntityTypes.person).map(indexPerson),
  ];
}

function entry(
  id: string,
  kind: SearchKind,
  title: string,
  subtitle: string,
  at: number | undefined,
  extra: readonly string[],
): Indexed {
  return {
    id,
    kind,
    title,
    subtitle,
    at,
    // Index 0 is the title, which `score` weights higher.
    haystack: [title, ...extra].map((value) => value.toLowerCase()).filter((value) => value.length > 0),
  };
}

function indexEvent(e: StoredEntity): Indexed {
  return entry(
    e.id,
    "event",
    readString(e, "title"),
    readOptionalString(e, "location") ?? "",
    readOptionalNumber(e, "startsAt"),
    [readString(e, "location"), readString(e, "notes")],
  );
}

function indexTask(e: StoredEntity): Indexed {
  return entry(e.id, "task", readString(e, "title"), readString(e, "area"), readOptionalNumber(e, "dueAt"), [
    readString(e, "definitionOfDone"),
    readString(e, "area"),
    readString(e, "notes"),
  ]);
}

function indexRecipe(e: StoredEntity): Indexed {
  const ingredients = readRecords(e, "ingredients")
    .map((ingredient) => (typeof ingredient["name"] === "string" ? ingredient["name"] : ""))
    .filter((name) => name.length > 0);

  return entry(
    e.id,
    "recipe",
    readString(e, "title"),
    ingredients.slice(0, 3).join(", "),
    readOptionalNumber(e, "lastCookedAt"),
    // Searching by a single ingredient is its own requirement (FR-516).
    [...ingredients, ...readStringList(e, "tags")],
  );
}

function indexShoppingItem(e: StoredEntity): Indexed {
  return entry(e.id, "shoppingItem", readString(e, "name"), readString(e, "note"), readOptionalNumber(e, "checkedAt"), [
    readString(e, "note"),
    readString(e, "brand"),
  ]);
}

function indexDocument(e: StoredEntity): Indexed {
  return entry(
    e.id,
    "document",
    readString(e, "title"),
    readOptionalString(e, "category") ?? "",
    readOptionalNumber(e, "expiresAt"),
    [readString(e, "extractedText"), readString(e, "category"), ...readStringList(e, "tags")],
  );
}

function indexContact(e: StoredEntity): Indexed {
  return entry(e.id, "contact", readString(e, "name"), readString(e, "role"), undefined, [
    readString(e, "role"),
    readString(e, "phone"),
    readString(e, "email"),
    readString(e, "note"),
  ]);
}

function indexCollectionItem(e: StoredEntity): Indexed {
  return entry(e.id, "collectionItem", readString(e, "title"), readString(e, "note"), undefined, [
    readString(e, "note"),
    ...readStringList(e, "tags"),
  ]);
}

function indexProtocol(e: StoredEntity): Indexed {
  return entry(e.id, "protocol", readString(e, "label"), readString(e, "instruction"), readOptionalNumber(e, "startsAt"), [
    readString(e, "instruction"),
  ]);
}

function indexPerson(e: StoredEntity): Indexed {
  return entry(e.id, "person", readString(e, "name"), "", undefined, [
    ...setMembers(e, "aliases"),
  ]);
}

function tokenize(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/[\s,]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
