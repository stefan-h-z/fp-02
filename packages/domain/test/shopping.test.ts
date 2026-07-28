import { beforeEach, describe, expect, it } from "vitest";
import {
  DAY_MS,
  EVERYWHERE,
  EntityTypes,
  FamilyState,
  buildShoppingList,
  canonicalItemKey,
  derivePlannedNeeds,
  makeOperation,
  newId,
  plannedNeedKey,
  type Operation,
  type Value,
} from "@fam/domain";

const FAMILY = "fam-1";
const LIST = "list-groceries";
const NOW = Date.parse("2026-07-28T08:00:00Z");

let wall = 1000;

function op(
  kind: Operation["kind"],
  entityType: string,
  entityId: string,
  payload: Record<string, Value>,
): Operation {
  wall += 1;
  return makeOperation({
    opId: newId(),
    familyId: FAMILY,
    deviceId: "device-a",
    actorId: null,
    entityType,
    entityId,
    kind,
    payload,
    hlc: { wall, counter: 0, deviceId: "device-a" },
  });
}

function seedRecipe(
  state: FamilyState,
  id: string,
  title: string,
  servings: number,
  ingredients: readonly { name: string; amount?: number; unit?: string }[],
): void {
  state.apply(
    op("entity.create", EntityTypes.recipe, id, {
      title,
      servings,
      ingredients: ingredients.map((i) => ({
        name: i.name,
        ...(i.amount === undefined ? {} : { amount: i.amount }),
        unit: i.unit ?? "",
      })),
    }),
  );
}

function seedMealSlot(
  state: FamilyState,
  id: string,
  recipeId: string,
  eaters: readonly string[],
  weekPlanId = "week-1",
): void {
  state.apply(op("entity.create", EntityTypes.mealSlot, id, { weekPlanId, date: "2026-07-28", mealType: "dinner", recipeId }));
  for (const eater of eaters) {
    state.apply(op("set.add", EntityTypes.mealSlot, id, { field: "eaters", member: eater }));
  }
}

function addManualItem(state: FamilyState, id: string, name: string, extra: Record<string, Value> = {}): void {
  state.apply(
    op("entity.create", EntityTypes.shoppingItem, id, {
      listId: LIST,
      name,
      itemKey: canonicalItemKey(name),
      checked: false,
      ...extra,
    }),
  );
}

let state: FamilyState;

beforeEach(() => {
  state = new FamilyState();
  state.apply(op("entity.create", EntityTypes.shoppingList, LIST, { domain: "groceries", name: "Groceries" }));
});

describe("plan to list (SPEC SC-004)", () => {
  it("merges the same ingredient from several recipes into one line (FR-714)", () => {
    seedRecipe(state, "r-bolognese", "Bolognese", 4, [
      { name: "Onion", amount: 2, unit: "piece" },
      { name: "Mince", amount: 500, unit: "g" },
    ]);
    seedRecipe(state, "r-soup", "Soup", 4, [{ name: "onion", amount: 1, unit: "piece" }]);
    seedMealSlot(state, "slot-mon", "r-bolognese", ["p-mum", "p-dad", "p-kid", "p-teen"]);
    seedMealSlot(state, "slot-tue", "r-soup", ["p-mum", "p-dad", "p-kid", "p-teen"]);

    const needs = derivePlannedNeeds(state, "week-1");
    const onion = needs.find((n) => n.itemKey === "onion");

    expect(needs.map((n) => n.itemKey)).toEqual(["mince", "onion"]);
    expect(onion?.quantityLabel).toBe("3×");
    expect(onion?.fromRecipeTitles).toEqual(["Bolognese", "Soup"]);
  });

  it("scales by who actually eats, not by household size (FR-603)", () => {
    seedRecipe(state, "r-pasta", "Pasta", 4, [{ name: "Pasta", amount: 400, unit: "g" }]);
    seedMealSlot(state, "slot-mon", "r-pasta", ["p-mum", "p-kid"]);

    expect(derivePlannedNeeds(state, "week-1")[0]?.quantityLabel).toBe("200 g");
  });

  it("drops the line again when the recipe leaves the plan (SPEC P-05)", () => {
    seedRecipe(state, "r-pasta", "Pasta", 2, [{ name: "Pasta", amount: 200, unit: "g" }]);
    seedMealSlot(state, "slot-mon", "r-pasta", ["p-mum", "p-dad"]);
    expect(derivePlannedNeeds(state, "week-1")).toHaveLength(1);

    state.apply(op("entity.delete", EntityTypes.mealSlot, "slot-mon", {}));

    expect(derivePlannedNeeds(state, "week-1")).toHaveLength(0);
  });

  it("adjusts a merged quantity when one contributing recipe is unplanned", () => {
    seedRecipe(state, "r-a", "A", 2, [{ name: "Onion", amount: 2, unit: "piece" }]);
    seedRecipe(state, "r-b", "B", 2, [{ name: "Onion", amount: 3, unit: "piece" }]);
    seedMealSlot(state, "slot-a", "r-a", ["p-mum", "p-dad"]);
    seedMealSlot(state, "slot-b", "r-b", ["p-mum", "p-dad"]);
    expect(derivePlannedNeeds(state, "week-1")[0]?.quantityLabel).toBe("5×");

    state.apply(op("entity.delete", EntityTypes.mealSlot, "slot-b", {}));

    expect(derivePlannedNeeds(state, "week-1")[0]?.quantityLabel).toBe("2×");
  });

  it("normalizes units so litres and millilitres add up (FR-513)", () => {
    seedRecipe(state, "r-a", "A", 1, [{ name: "Milk", amount: 0.5, unit: "l" }]);
    seedRecipe(state, "r-b", "B", 1, [{ name: "milk", amount: 200, unit: "ml" }]);
    seedMealSlot(state, "slot-a", "r-a", ["p-mum"]);
    seedMealSlot(state, "slot-b", "r-b", ["p-mum"]);

    expect(derivePlannedNeeds(state, "week-1")[0]?.quantityLabel).toBe("700 ml");
  });

  it("keeps a planned need out of the list once the family added it by hand", () => {
    seedRecipe(state, "r-pasta", "Pasta", 2, [{ name: "Pasta", amount: 200, unit: "g" }]);
    seedMealSlot(state, "slot-mon", "r-pasta", ["p-mum", "p-dad"]);
    addManualItem(state, "item-pasta", "Pasta");

    const view = buildShoppingList(state, {
      listId: LIST,
      now: NOW,
      plannedNeeds: derivePlannedNeeds(state, "week-1"),
    });
    const lines = view.groups.flatMap((g) => g.lines);

    expect(lines.filter((l) => l.itemKey === "pasta")).toHaveLength(1);
    expect(lines[0]?.origin).toBe("manual");
  });

  it("keeps a planned need ticked off across a quantity change", () => {
    seedRecipe(state, "r-pasta", "Pasta", 2, [{ name: "Pasta", amount: 200, unit: "g" }]);
    seedMealSlot(state, "slot-mon", "r-pasta", ["p-mum", "p-dad"]);
    const key = plannedNeedKey("week-1", "pasta");
    state.apply(op("entity.create", EntityTypes.shoppingItem, key, { listId: LIST, checked: true }));

    state.apply(op("entity.setFields", EntityTypes.recipe, "r-pasta", {
      title: "Pasta",
      servings: 2,
      ingredients: [{ name: "Pasta", amount: 500, unit: "g" }],
    }));

    const view = buildShoppingList(state, {
      listId: LIST,
      now: NOW,
      plannedNeeds: derivePlannedNeeds(state, "week-1"),
    });
    const line = view.groups.flatMap((g) => g.lines).find((l) => l.itemKey === "pasta");

    expect(line?.quantityLabel).toBe("500 g");
    expect(line?.checked).toBe(true);
  });
});

describe("list model (SPEC §10.1)", () => {
  beforeEach(() => {
    state.apply(op("entity.create", EntityTypes.store, "store-aldi", { name: "Aldi" }));
    state.apply(op("entity.create", EntityTypes.store, "store-pharmacy", { name: "Pharmacy" }));
    state.apply(op("entity.create", EntityTypes.catalogItem, "milk", { productGroup: "dairy" }));
    state.apply(op("entity.create", EntityTypes.catalogItem, "special tea", { productGroup: "drinks" }));
    state.apply(op("set.add", EntityTypes.catalogItem, "special tea", { field: "stores", member: "store-pharmacy" }));
    addManualItem(state, "item-milk", "Milk");
    addManualItem(state, "item-tea", "Special tea");
  });

  it("groups by product group while planning and by store in the shop (FR-704)", () => {
    const byGroup = buildShoppingList(state, { listId: LIST, now: NOW, grouping: "productGroup" });
    const byStore = buildShoppingList(state, { listId: LIST, now: NOW, grouping: "store" });

    expect(byGroup.groups.map((g) => g.key)).toEqual(["dairy", "drinks"]);
    expect(byStore.groups.map((g) => g.label)).toEqual(["Pharmacy", "Available everywhere"]);
  });

  it("puts unassigned items in 'available everywhere' rather than forcing a store (FR-703)", () => {
    const byStore = buildShoppingList(state, { listId: LIST, now: NOW, grouping: "store" });
    const everywhere = byStore.groups.find((g) => g.key === EVERYWHERE);

    expect(everywhere?.lines.map((l) => l.itemKey)).toEqual(["milk"]);
  });

  it("shows a store's items plus everything unassigned when filtering by 'I am at X' (FR-705)", () => {
    const view = buildShoppingList(state, { listId: LIST, now: NOW, atStore: "store-aldi" });

    expect(view.groups.flatMap((g) => g.lines).map((l) => l.itemKey)).toEqual(["milk"]);
  });

  it("counts a checked item as checked no matter how the list is grouped (FR-707)", () => {
    state.apply(op("entity.setFields", EntityTypes.shoppingItem, "item-tea", { checked: true }));

    const byGroup = buildShoppingList(state, { listId: LIST, now: NOW, grouping: "productGroup" });
    const byStore = buildShoppingList(state, { listId: LIST, now: NOW, grouping: "store" });

    expect(byGroup.checkedCount).toBe(1);
    expect(byStore.checkedCount).toBe(1);
  });

  it("marks a child's wish as awaiting a parent (FR-725)", () => {
    addManualItem(state, "item-sweets", "Sweets", { wish: true, approved: false });

    const line = buildShoppingList(state, { listId: LIST, now: NOW })
      .groups.flatMap((g) => g.lines)
      .find((l) => l.itemKey === "sweets");

    expect(line?.awaitingApproval).toBe(true);
  });

  it("carries an in-store question on the line it belongs to (FR-721)", () => {
    state.apply(op("entity.setFields", EntityTypes.shoppingItem, "item-tea", { question: "Out of stock — alternative?" }));

    const line = buildShoppingList(state, { listId: LIST, now: NOW })
      .groups.flatMap((g) => g.lines)
      .find((l) => l.itemKey === "special tea");

    expect(line?.openQuestion).toBe("Out of stock — alternative?");
  });
});

describe("list sections (SPEC §10.2 presentation)", () => {
  beforeEach(() => {
    state.apply(op("entity.create", EntityTypes.catalogItem, "coffee", { productGroup: "drinks" }));
    for (const days of [21, 14, 7, 0]) {
      state.apply(op("set.add", EntityTypes.catalogItem, "coffee", {
        field: "purchases",
        member: String(NOW - (days + 7) * DAY_MS),
      }));
    }
    state.apply(op("entity.create", EntityTypes.catalogItem, "bread", { productGroup: "bakery" }));
    state.apply(op("set.add", EntityTypes.catalogItem, "bread", { field: "emptyReports", member: String(NOW) }));
  });

  it("separates reported facts from predictions (FR-739)", () => {
    const view = buildShoppingList(state, { listId: LIST, now: NOW });

    expect(view.reported.map((r) => r.itemKey)).toEqual(["bread"]);
    expect(view.probablyDue.map((r) => r.itemKey)).toEqual(["coffee"]);
  });

  it("does not suggest what is already on the list", () => {
    addManualItem(state, "item-coffee", "Coffee");

    const view = buildShoppingList(state, { listId: LIST, now: NOW });

    expect(view.probablyDue).toHaveLength(0);
  });

  it("suggests nothing at all when the family switched learning off (FR-1417)", () => {
    const view = buildShoppingList(state, { listId: LIST, now: NOW, learningEnabled: false });

    expect(view.reported).toHaveLength(0);
    expect(view.probablyDue).toHaveLength(0);
  });
});
