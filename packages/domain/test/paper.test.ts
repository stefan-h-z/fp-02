import { beforeEach, describe, expect, it } from "vitest";
import {
  DAY_MS,
  EntityTypes,
  FamilyState,
  buildShoppingList,
  makeOperation,
  newId,
  renderEmergencySheet,
  renderShoppingSheet,
  renderWeekSheet,
  type Operation,
  type ShoppingListView,
  type Value,
} from "@fam/domain";

const NOW = Date.parse("2026-07-28T08:00:00Z");
const LIST = "list-1";
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

function seedPeople(): void {
  state.apply(op("entity.create", EntityTypes.person, "p-mum", { name: "Mum" }));
  state.apply(op("entity.create", EntityTypes.person, "p-dad", { name: "Dad" }));
  state.apply(op("entity.create", EntityTypes.person, "p-kid", { name: "Kid" }));
}

beforeEach(() => {
  state = new FamilyState();
});

describe("the emergency sheet (FR-1118)", () => {
  beforeEach(() => {
    seedPeople();
    state.apply(
      op("entity.create", EntityTypes.event, "e-swim", {
        title: "Swimming",
        startsAt: Date.parse("2026-07-28T15:00:00Z"),
        endsAt: Date.parse("2026-07-28T16:00:00Z"),
        bringOwnerId: "p-dad",
        fetchOwnerId: "p-mum",
      }),
    );
    state.apply(
      op("entity.create", EntityTypes.contact, "c-doctor", {
        name: "Dr Weber",
        role: "doctor",
        phone: "0123 456",
      }),
    );
    state.apply(op("entity.create", EntityTypes.contact, "c-plumber", { name: "Plumber", role: "trade" }));
  });

  it("prints today's appointments with the times and the arrangement", () => {
    const sheet = renderEmergencySheet(state, NOW).join("\n");

    expect(sheet).toContain("Tuesday 2026-07-28");
    expect(sheet).toContain("15:00-16:00");
    expect(sheet).toContain("Swimming (brings: Dad, fetches: Mum)");
  });

  it("prints only the emergency contacts, with a way to reach them", () => {
    const sheet = renderEmergencySheet(state, NOW).join("\n");

    expect(sheet).toContain("Dr Weber (doctor)  0123 456");
    expect(sheet).not.toContain("Plumber");
  });

  it("never puts an identifier on paper", () => {
    const sheet = renderEmergencySheet(state, NOW).join("\n");

    for (const id of ["p-mum", "p-dad", "p-kid", "e-swim", "c-doctor"]) {
      expect(sheet).not.toContain(id);
    }
  });

  it("keeps a private appointment's slot but not its subject (FR-203)", () => {
    state.apply(
      op("entity.create", EntityTypes.event, "e-private", {
        title: "Therapy",
        startsAt: Date.parse("2026-07-28T11:00:00Z"),
        endsAt: Date.parse("2026-07-28T12:00:00Z"),
        private: true,
      }),
    );

    const sheet = renderEmergencySheet(state, NOW).join("\n");

    expect(sheet).toContain("11:00-12:00  Private");
    expect(sheet).not.toContain("Therapy");
  });

  it("leaves out an appointment that was cancelled", () => {
    state.apply(op("entity.setFields", EntityTypes.event, "e-swim", { cancelled: true }));

    expect(renderEmergencySheet(state, NOW).join("\n")).not.toContain("Swimming");
  });

  it("shifts the day and the clock when the family does not live at UTC", () => {
    state.apply(
      op("entity.create", EntityTypes.event, "e-late", {
        title: "Late pickup",
        startsAt: Date.parse("2026-07-28T23:30:00Z"),
        endsAt: Date.parse("2026-07-28T23:45:00Z"),
      }),
    );

    const utc = renderEmergencySheet(state, NOW).join("\n");
    const berlin = renderEmergencySheet(state, NOW, { offsetMinutes: 120 }).join("\n");

    expect(utc).toContain("23:30-23:45  Late pickup");
    // Half past eleven at night in UTC is half past one the next morning here, so
    // it belongs on tomorrow's sheet, not on this one.
    expect(berlin).toContain("17:00-18:00  Swimming");
    expect(berlin).not.toContain("Late pickup");
  });
});

describe("protocols on the emergency sheet (FR-1118, FR-919)", () => {
  beforeEach(() => {
    seedPeople();
    state.apply(
      op("entity.create", EntityTypes.protocol, "pr-drops", {
        personId: "p-kid",
        label: "Eye drops",
        kind: "acknowledgement",
        // Started two days ago, ends in three: the printed day sits inside it.
        startsAt: NOW - 2 * DAY_MS,
        endsAt: NOW + 3 * DAY_MS,
        frequencyKind: "fixed-times",
        fixedTimes: ["480", "840"],
        instruction: "One drop in each eye",
      }),
    );
  });

  it("prints a course that spans the printed day, with its instruction once", () => {
    const sheet = renderEmergencySheet(state, NOW);
    const text = sheet.join("\n");

    expect(text).toContain("Eye drops — Kid");
    expect(text).toContain("One drop in each eye");
    expect(text.match(/One drop in each eye/g)).toHaveLength(1);
  });

  it("prints every time of the printed day, not only the ones still to come", () => {
    const text = renderEmergencySheet(state, NOW).join("\n");

    expect(text).toContain("08:00 due");
    expect(text).toContain("14:00");
  });

  it("marks what already happened, so nobody gives a second dose (FR-917)", () => {
    const instanceAt = Date.parse("2026-07-28T08:00:00Z");
    state.apply(
      op("entity.create", EntityTypes.protocolInstance, "~protocolInstance|pr-drops|" + instanceAt, {
        state: "acknowledged",
        acknowledgedBy: "p-mum",
        acknowledgedAt: instanceAt,
      }),
    );

    expect(renderEmergencySheet(state, NOW).join("\n")).toContain("08:00 done");
  });

  it("says nothing about a course that finished before today", () => {
    state.apply(op("entity.delete", EntityTypes.protocol, "pr-drops", {}));
    state.apply(
      op("entity.create", EntityTypes.protocol, "pr-antibiotics", {
        personId: "p-kid",
        label: "Antibiotics",
        startsAt: NOW - 10 * DAY_MS,
        endsAt: NOW - 5 * DAY_MS,
        frequencyKind: "fixed-times",
        fixedTimes: ["480"],
        instruction: "One spoon",
      }),
    );

    const text = renderEmergencySheet(state, NOW).join("\n");

    expect(text).toContain("Nothing active today.");
    expect(text).not.toContain("Antibiotics");
  });

  it("prints the measured value rather than a tick for a measurement (FR-923)", () => {
    const instanceAt = Date.parse("2026-07-28T08:00:00Z");
    state.apply(op("entity.setFields", EntityTypes.protocol, "pr-drops", { kind: "measurement", label: "Temperature" }));
    state.apply(
      op("entity.create", EntityTypes.protocolInstance, "~protocolInstance|pr-drops|" + instanceAt, {
        state: "acknowledged",
        measuredValue: 38.4,
      }),
    );

    expect(renderEmergencySheet(state, NOW).join("\n")).toContain("08:00 38.4");
  });
});

describe("an emergency sheet for a family with nothing in it", () => {
  it("is still a usable sheet rather than an error", () => {
    const sheet = renderEmergencySheet(state, NOW);

    expect(sheet[0]).toBe("EMERGENCY SHEET");
    expect(sheet).toContain("Tuesday 2026-07-28");
    expect(sheet.join("\n")).toContain("Nothing in the calendar today.");
    expect(sheet.join("\n")).toContain("Nothing active today.");
    expect(sheet.join("\n")).toContain("No emergency contacts recorded.");
  });

  it("returns lines, so the caller decides the page width (FR-727)", () => {
    const sheet = renderEmergencySheet(state, NOW);

    expect(Array.isArray(sheet)).toBe(true);
    expect(sheet.every((line) => typeof line === "string")).toBe(true);
    expect(sheet.some((line) => line.includes("\n"))).toBe(false);
  });
});

describe("the printable week (FR-1208)", () => {
  beforeEach(() => {
    seedPeople();
    state.apply(op("entity.create", EntityTypes.recipe, "r-pasta", { title: "Pasta bake", servings: 4 }));
    state.apply(
      op("entity.create", EntityTypes.mealSlot, "slot-wed", {
        weekPlanId: "week-1",
        date: "2026-07-29",
        mealType: "dinner",
        recipeId: "r-pasta",
        cookOwnerId: "p-mum",
      }),
    );
    state.apply(
      op("entity.create", EntityTypes.mealSlot, "slot-wed-lunch", {
        weekPlanId: "week-1",
        date: "2026-07-29",
        mealType: "lunch",
      }),
    );
    state.apply(
      op("entity.create", EntityTypes.event, "e-training", {
        title: "Football training",
        startsAt: Date.parse("2026-07-28T17:00:00Z"),
        endsAt: Date.parse("2026-07-28T18:30:00Z"),
        bringOwnerId: "p-dad",
      }),
    );
  });

  it("gives every day of the range a heading, in order", () => {
    const sheet = renderWeekSheet(state, { from: NOW, to: NOW + 2 * DAY_MS });

    const headings = sheet.filter((line) => line.startsWith("Tuesday") || line.startsWith("Wednesday") || line.startsWith("Thursday"));
    expect(headings).toEqual(["Tuesday 2026-07-28", "Wednesday 2026-07-29", "Thursday 2026-07-30"]);
  });

  it("says what is being eaten and who is cooking (FR-609)", () => {
    const sheet = renderWeekSheet(state, { from: NOW, to: NOW + 2 * DAY_MS }).join("\n");

    expect(sheet).toContain("Dinner: Pasta bake — cooked by Mum");
  });

  it("prints an unplanned slot as unplanned instead of hiding the gap", () => {
    const sheet = renderWeekSheet(state, { from: NOW, to: NOW + 2 * DAY_MS }).join("\n");

    expect(sheet).toContain("Lunch: not planned yet");
  });

  it("puts the meals of a day in the order of the day", () => {
    const sheet = renderWeekSheet(state, { from: NOW, to: NOW + 2 * DAY_MS });
    const lunch = sheet.findIndex((line) => line.includes("Lunch:"));
    const dinner = sheet.findIndex((line) => line.includes("Dinner:"));

    expect(lunch).toBeGreaterThan(-1);
    expect(lunch).toBeLessThan(dinner);
  });

  it("puts the day's appointments under the same day", () => {
    const sheet = renderWeekSheet(state, { from: NOW, to: NOW + 2 * DAY_MS });
    const tuesday = sheet.indexOf("Tuesday 2026-07-28");
    const wednesday = sheet.indexOf("Wednesday 2026-07-29");
    const training = sheet.findIndex((line) => line.includes("Football training"));

    expect(training).toBeGreaterThan(tuesday);
    expect(training).toBeLessThan(wednesday);
  });

  it("marks a day with nothing on it rather than leaving it blank", () => {
    const sheet = renderWeekSheet(state, { from: NOW, to: NOW + 2 * DAY_MS });
    const thursday = sheet.indexOf("Thursday 2026-07-30");

    expect(sheet[thursday + 1]).toBe("  —");
  });

  it("can be narrowed to one week plan", () => {
    state.apply(
      op("entity.create", EntityTypes.mealSlot, "slot-other-plan", {
        weekPlanId: "week-2",
        date: "2026-07-29",
        mealType: "breakfast",
      }),
    );

    const sheet = renderWeekSheet(state, { from: NOW, to: NOW + 2 * DAY_MS, weekPlanId: "week-1" }).join("\n");

    expect(sheet).not.toContain("Breakfast:");
  });

  it("names nobody by identifier", () => {
    const sheet = renderWeekSheet(state, { from: NOW, to: NOW + 2 * DAY_MS }).join("\n");

    for (const id of ["p-mum", "p-dad", "r-pasta", "slot-wed", "week-1"]) {
      expect(sheet).not.toContain(id);
    }
  });
});

describe("the shopping list on paper (FR-727)", () => {
  beforeEach(() => {
    state.apply(op("entity.create", EntityTypes.shoppingList, LIST, { name: "Food" }));
    state.apply(
      op("entity.create", EntityTypes.shoppingItem, "i-milk", {
        listId: LIST,
        name: "Milk",
        productGroup: "dairy",
        amount: 2,
        unit: "l",
      }),
    );
    state.apply(
      op("entity.create", EntityTypes.shoppingItem, "i-bread", {
        listId: LIST,
        name: "Bread",
        productGroup: "bakery",
        checked: true,
      }),
    );
    state.apply(
      op("entity.create", EntityTypes.shoppingItem, "i-sweets", {
        listId: LIST,
        name: "Sweets",
        productGroup: "dry-goods",
        wish: true,
        note: "for the party",
      }),
    );
  });

  function view(): ShoppingListView {
    return buildShoppingList(state, { listId: LIST, now: NOW });
  }

  it("groups the lines the way the screen grouped them", () => {
    const sheet = renderShoppingSheet(view());

    expect(sheet).toContain("bakery");
    expect(sheet).toContain("dairy");
    expect(sheet).toContain("dry-goods");
  });

  it("shows what is still to buy and what is already in the trolley", () => {
    const sheet = renderShoppingSheet(view()).join("\n");

    expect(sheet).toContain("[ ] Milk 2 l");
    expect(sheet).toContain("[x] Bread");
  });

  it("carries the note and the fact that a wish is still waiting for a parent", () => {
    const sheet = renderShoppingSheet(view()).join("\n");

    expect(sheet).toContain("Sweets (for the party) - waiting for a parent");
  });

  it("ends with the counts, which is what somebody in the shop looks at", () => {
    const sheet = renderShoppingSheet(view());

    expect(sheet[sheet.length - 1]).toBe("2 open, 1 already ticked");
  });

  it("prints no suggestions, because paper cannot accept one", () => {
    state.apply(op("entity.create", EntityTypes.catalogItem, "coffee", { productGroup: "drinks" }));
    for (const at of [NOW - 21 * DAY_MS, NOW - 14 * DAY_MS, NOW - 7 * DAY_MS]) {
      state.apply(op("set.add", EntityTypes.catalogItem, "coffee", { field: "purchases", member: String(at) }));
    }

    const built = view();
    const sheet = renderShoppingSheet(built).join("\n");

    expect(built.probablyDue.length + built.moreDue.length).toBeGreaterThan(0);
    expect(sheet).not.toContain("coffee");
  });

  it("says so plainly when there is nothing to buy", () => {
    const empty: ShoppingListView = {
      listId: LIST,
      reported: [],
      probablyDue: [],
      moreDue: [],
      groups: [],
      openCount: 0,
      checkedCount: 0,
    };

    expect(renderShoppingSheet(empty)).toContain("Nothing on the list.");
  });
});
