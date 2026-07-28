/**
 * The shopping list view (SPEC §10.1).
 *
 * One list per domain, never per store: the store is an attribute of the item and
 * may hold several values (FR-701, FR-702). The same list is therefore read two
 * ways — grouped by store while planning, by aisle while standing in the shop
 * (FR-704) — and both are projections over identical state, so ticking something
 * off is global regardless of how it is currently grouped (FR-707).
 *
 * Sections mirror what the family can trust: what somebody *said* is empty, then
 * what the app *thinks* is due (FR-739).
 */
import { setMembers, type StoredEntity } from "./entity.js";
import { plannedNeedKey, type PlannedNeed } from "./plan.js";
import { computeRhythm, rankSuggestions, type Rhythm, type RhythmOptions } from "./rhythm.js";
import {
  EntityTypes,
  SetFields,
  canonicalItemKey,
  readBoolean,
  readOptionalNumber,
  readOptionalString,
  readString,
  readTimestampSet,
} from "./schema.js";
import type { FamilyState } from "./state.js";
import { formatQuantity, normalizeQuantity } from "./units.js";

export type Grouping = "store" | "productGroup";

/** Everywhere-available is the default, so assignment stays the exception (FR-703). */
export const EVERYWHERE = "everywhere";
export const UNGROUPED = "other";

export interface ListLine {
  readonly id: string;
  readonly itemKey: string;
  readonly name: string;
  readonly quantityLabel: string;
  readonly note: string;
  readonly checked: boolean;
  readonly productGroup: string;
  readonly stores: readonly string[];
  /** Where the line came from — planned needs cannot be deleted, only unplanned. */
  readonly origin: "manual" | "plan";
  readonly plannedFrom: readonly string[];
  /** A child's wish still waiting for a parent (FR-725). */
  readonly awaitingApproval: boolean;
  readonly openQuestion: string | undefined;
}

export interface ListGroup {
  readonly key: string;
  readonly label: string;
  readonly lines: readonly ListLine[];
}

export interface ShoppingListView {
  readonly listId: string;
  readonly reported: readonly Rhythm[];
  readonly probablyDue: readonly Rhythm[];
  readonly moreDue: readonly Rhythm[];
  readonly groups: readonly ListGroup[];
  readonly openCount: number;
  readonly checkedCount: number;
}

export interface BuildListOptions extends RhythmOptions {
  readonly listId: string;
  readonly grouping?: Grouping;
  /** "I'm at X right now": that store's items plus everything unassigned (FR-705). */
  readonly atStore?: string;
  readonly weekPlanId?: string;
  readonly plannedNeeds?: readonly PlannedNeed[];
  readonly suggestionLimit?: number;
  /** Suggestions are the learning feature; a family may switch it off (FR-1417). */
  readonly learningEnabled?: boolean;
  /** Total time the family was away, which pauses every clock (FR-733). */
  readonly pausedMs?: number;
}

export function buildShoppingList(state: FamilyState, options: BuildListOptions): ShoppingListView {
  const lines = [
    ...manualLines(state, options),
    ...plannedLines(state, options),
  ].sort((a, b) => (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));

  const store = options.atStore;
  const visible = store === undefined ? lines : lines.filter((line) => atStore(line, store));
  const ranking = options.learningEnabled === false
    ? { reported: [], probablyDue: [], more: [] }
    : rankSuggestions(catalogRhythms(state, options, lines), options.suggestionLimit ?? 5);

  return {
    listId: options.listId,
    reported: ranking.reported,
    probablyDue: ranking.probablyDue,
    moreDue: ranking.more,
    groups: group(visible, options.grouping ?? "productGroup", state),
    openCount: visible.filter((line) => !line.checked).length,
    checkedCount: visible.filter((line) => line.checked).length,
  };
}

function manualLines(state: FamilyState, options: BuildListOptions): readonly ListLine[] {
  return state
    .all(EntityTypes.shoppingItem)
    .filter((item) => readOptionalString(item, "listId") === options.listId)
    .map((item) => {
      const name = readString(item, "name");
      const itemKey = readOptionalString(item, "itemKey") ?? canonicalItemKey(name);
      const catalog = state.get(EntityTypes.catalogItem, itemKey);
      const amount = readOptionalNumber(item, "amount");

      return {
        id: item.id,
        itemKey,
        name,
        quantityLabel:
          amount === undefined
            ? ""
            : formatQuantity(normalizeQuantity({ amount, unit: readString(item, "unit") })),
        note: readString(item, "note"),
        checked: readBoolean(item, "checked"),
        productGroup: readOptionalString(item, "productGroup") ?? productGroupOf(catalog),
        stores: storesOf(catalog),
        origin: "manual" as const,
        plannedFrom: [],
        awaitingApproval: readBoolean(item, "wish") && !readBoolean(item, "approved"),
        openQuestion: readOptionalString(item, "question"),
      };
    });
}

/**
 * Planned needs appear as lines without being stored; only their tick is
 * (see `plan.ts`). A planned item the family also added by hand collapses into
 * the manual line, so nobody buys onions twice.
 */
function plannedLines(state: FamilyState, options: BuildListOptions): readonly ListLine[] {
  const needs = options.plannedNeeds ?? [];
  if (needs.length === 0) return [];

  const manualKeys = new Set(
    state
      .all(EntityTypes.shoppingItem)
      .filter((item) => readOptionalString(item, "listId") === options.listId)
      .map((item) => readOptionalString(item, "itemKey") ?? canonicalItemKey(readString(item, "name"))),
  );

  return needs
    .filter((need) => !manualKeys.has(need.itemKey))
    .map((need) => {
      const catalog = state.get(EntityTypes.catalogItem, need.itemKey);
      const tick = state.get(EntityTypes.plannedTick, need.key);

      return {
        id: need.key,
        itemKey: need.itemKey,
        name: need.displayName,
        quantityLabel: need.quantityLabel,
        note: "",
        checked: readBoolean(tick, "checked"),
        productGroup: productGroupOf(catalog),
        stores: storesOf(catalog),
        origin: "plan" as const,
        plannedFrom: need.fromRecipeTitles,
        awaitingApproval: false,
        openQuestion: readOptionalString(tick, "question"),
      };
    });
}

/**
 * Rhythms for every catalog item — no candidate list, no pre-selection (FR-741).
 * Items already on the list are skipped: suggesting what is right there would be
 * noise.
 */
function catalogRhythms(
  state: FamilyState,
  options: BuildListOptions,
  lines: readonly ListLine[],
): readonly Rhythm[] {
  const onList = new Set(lines.filter((line) => !line.checked).map((line) => line.itemKey));

  return state
    .all(EntityTypes.catalogItem)
    .filter((catalog) => !onList.has(catalog.id))
    .map((catalog) =>
      computeRhythm(
        {
          itemKey: catalog.id,
          purchases: readTimestampSet(catalog, SetFields.purchases),
          emptyReports: readTimestampSet(catalog, SetFields.emptyReports),
          dismissals: readTimestampSet(catalog, SetFields.dismissals),
          ...(options.pausedMs === undefined ? {} : { pausedMs: options.pausedMs }),
        },
        options,
      ),
    )
    .filter((rhythm) => rhythm.state !== "unknown" || rhythm.reported);
}

function group(lines: readonly ListLine[], grouping: Grouping, state: FamilyState): readonly ListGroup[] {
  const buckets = new Map<string, ListLine[]>();

  for (const line of lines) {
    const keys =
      grouping === "productGroup"
        ? [line.productGroup.length > 0 ? line.productGroup : UNGROUPED]
        : line.stores.length > 0
          ? line.stores
          : [EVERYWHERE];

    for (const key of keys) {
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [line]);
      else bucket.push(line);
    }
  }

  return [...buckets.entries()]
    .map(([key, groupLines]) => ({
      key,
      label: grouping === "store" ? storeLabel(state, key) : key,
      lines: groupLines,
    }))
    .sort((a, b) => {
      // "Everywhere" last: it is the fallback, not a destination.
      if (a.key === EVERYWHERE) return 1;
      if (b.key === EVERYWHERE) return -1;
      return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
    });
}

function atStore(line: ListLine, store: string): boolean {
  return line.stores.length === 0 || line.stores.includes(store);
}

function storesOf(catalog: StoredEntity | undefined): readonly string[] {
  return catalog === undefined ? [] : setMembers(catalog, SetFields.stores);
}

function productGroupOf(catalog: StoredEntity | undefined): string {
  return readOptionalString(catalog, "productGroup") ?? UNGROUPED;
}

function storeLabel(state: FamilyState, storeId: string): string {
  if (storeId === EVERYWHERE) return "Available everywhere";
  return readOptionalString(state.get(EntityTypes.store, storeId), "name") ?? storeId;
}

export { plannedNeedKey };
