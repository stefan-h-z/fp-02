/**
 * Command tests, driven through a real sync client.
 *
 * These go through the client rather than a stub because the point of a command
 * is the operations it produces — and whether those operations still do the right
 * thing when a second device did something else at the same time.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DAY_MS,
  EntityTypes,
  canonicalItemKey,
  computeRhythm,
  readBoolean,
  readString,
  readTimestampSet,
  setMembers,
} from "@fam/domain";
import { MemoryStateStore } from "@fam/storage";
import { ReferenceServer, SyncClient } from "@fam/sync";
import {
  acknowledgeDose,
  addItem,
  approveWish,
  askAboutItem,
  checkOff,
  checkOffPlanned,
  describeSyncStatus,
  dismissSuggestion,
  markCooked,
  planMeal,
  reportEmpty,
  selectShoppingList,
  setAbsence,
  skipDose,
  unplanMeal,
} from "@fam/app";

const FAMILY = "fam-1";
const LIST = "list-groceries";
const NOW = Date.parse("2026-07-28T08:00:00Z");

let server: ReferenceServer;
let client: SyncClient;
let clock: number;

beforeEach(async () => {
  clock = 1_700_000_000_000;
  server = new ReferenceServer({ families: [FAMILY] });
  client = new SyncClient({
    familyId: FAMILY,
    deviceId: "phone-mum",
    store: new MemoryStateStore(),
    transport: server,
    now: () => (clock += 1000),
  });
  await client.open();
  client.setActor("person-mum");
  await client.mutate((b) => {
    b.create(EntityTypes.family, FAMILY, { name: "Müller", learningEnabled: true });
    b.create(EntityTypes.shoppingList, LIST, { domain: "groceries", name: "Groceries" });
  });
});

const mutate = (describe: Parameters<SyncClient["mutate"]>[0]) => client.mutate(describe);

describe("adding to the list (SPEC P-04)", () => {
  it("takes a name and nothing else", async () => {
    const id = await addItem(mutate, { listId: LIST, name: "Milk" });

    const item = client.state().get(EntityTypes.shoppingItem, id);
    expect(readString(item, "name")).toBe("Milk");
    expect(readBoolean(item, "checked")).toBe(false);
  });

  it("creates the catalog entry alongside, so the item can ever be learned (FR-741)", async () => {
    await addItem(mutate, { listId: LIST, name: "  Olive oil " });

    expect(client.state().get(EntityTypes.catalogItem, canonicalItemKey("Olive oil"))).toBeDefined();
  });

  it("lands two spellings of the same thing on one catalog item", async () => {
    await addItem(mutate, { listId: LIST, name: "Milk" });
    await addItem(mutate, { listId: LIST, name: "milk " });

    expect(client.state().all(EntityTypes.catalogItem)).toHaveLength(1);
  });

  it("marks a child's entry as needing a parent (FR-725)", async () => {
    const id = await addItem(mutate, { listId: LIST, name: "Sweets", asWish: true });

    const line = selectShoppingList(client.state(), { listId: LIST, now: NOW })
      .groups.flatMap((g) => g.lines)
      .find((l) => l.id === id);
    expect(line?.awaitingApproval).toBe(true);

    await approveWish(mutate, id);

    const approved = selectShoppingList(client.state(), { listId: LIST, now: NOW })
      .groups.flatMap((g) => g.lines)
      .find((l) => l.id === id);
    expect(approved?.awaitingApproval).toBe(false);
  });
});

describe("ticking off teaches the rhythm (FR-731)", () => {
  it("records the purchase on the catalog item", async () => {
    const id = await addItem(mutate, { listId: LIST, name: "Milk" });

    await checkOff(mutate, { itemId: id, itemKey: "milk", at: NOW });

    const catalog = client.state().get(EntityTypes.catalogItem, "milk");
    expect(readBoolean(client.state().get(EntityTypes.shoppingItem, id), "checked")).toBe(true);
    expect(readTimestampSet(catalog, "purchases")).toEqual([NOW]);
  });

  it("survives the same tick arriving twice from two devices (FR-1219)", async () => {
    const id = await addItem(mutate, { listId: LIST, name: "Milk" });
    await client.sync();

    const other = new SyncClient({
      familyId: FAMILY,
      deviceId: "phone-dad",
      store: new MemoryStateStore(),
      transport: server,
      now: () => (clock += 1000),
    });
    await other.open();
    await other.bootstrap();

    await checkOff(mutate, { itemId: id, itemKey: "milk", at: NOW });
    await checkOff((d) => other.mutate(d), { itemId: id, itemKey: "milk", at: NOW });
    await client.sync();
    await other.sync();
    await client.sync();

    expect(readTimestampSet(client.state().get(EntityTypes.catalogItem, "milk"), "purchases")).toEqual([NOW]);
    expect(await client.openConflicts()).toHaveLength(0);
  });

  it("ticks a planned need without creating a second line", async () => {
    await checkOffPlanned(mutate, { weekPlanId: "week-1", itemKey: "pasta", listId: LIST, at: NOW });

    expect(client.state().all(EntityTypes.shoppingItem)).toHaveLength(0);
    expect(client.state().all(EntityTypes.plannedTick)).toHaveLength(1);
  });
});

describe("reporting and suggestions (SPEC §10.2)", () => {
  it("records an empty report with no quantity and no category (FR-734)", async () => {
    await reportEmpty(mutate, { name: "Milk", at: NOW });

    const catalog = client.state().get(EntityTypes.catalogItem, "milk");
    expect(readTimestampSet(catalog, "emptyReports")).toEqual([NOW]);
    expect(catalog?.fields["amount"]).toBeUndefined();
  });

  it("keeps a needs-using-up report out of the empty reports (FR-736)", async () => {
    await reportEmpty(mutate, { name: "Peppers", at: NOW, kind: "use-up" });

    const catalog = client.state().get(EntityTypes.catalogItem, "peppers");
    expect(readTimestampSet(catalog, "emptyReports")).toEqual([]);
    expect(readTimestampSet(catalog, "useUpReports")).toEqual([NOW]);
  });

  it("shows a reported item in the reported section", async () => {
    await reportEmpty(mutate, { name: "Bread", at: NOW });

    const view = selectShoppingList(client.state(), { listId: LIST, now: NOW });
    expect(view.reported.map((r) => r.itemKey)).toEqual(["bread"]);
  });

  it("records a dismissal so the model learns rather than merely hiding a row", async () => {
    await addItem(mutate, { listId: LIST, name: "Olives" });
    await dismissSuggestion(mutate, { itemKey: "olives", at: NOW });

    expect(readTimestampSet(client.state().get(EntityTypes.catalogItem, "olives"), "dismissals")).toEqual([NOW]);
  });

  it("suggests nothing for a child, whatever the family setting (FR-1417)", async () => {
    await mutate((b) => {
      b.create(EntityTypes.membership, "m-kid", { personId: "person-kid", role: "child" });
      b.create(EntityTypes.catalogItem, "coffee", { name: "Coffee" });
      for (const weeksAgo of [4, 3, 2, 1]) {
        b.setAdd(EntityTypes.catalogItem, "coffee", "purchases", String(NOW - weeksAgo * 7 * DAY_MS));
      }
    });

    const asAdult = selectShoppingList(client.state(), { listId: LIST, now: NOW, personId: "person-mum" });
    const asChild = selectShoppingList(client.state(), { listId: LIST, now: NOW, personId: "person-kid" });

    expect(asAdult.probablyDue).toHaveLength(1);
    expect(asChild.probablyDue).toHaveLength(0);
  });

  it("pauses the clocks while the family is away (FR-733)", async () => {
    await mutate((b) => b.create(EntityTypes.membership, "m-mum", { personId: "person-mum", role: "adult" }));
    await setAbsence(mutate, { membershipId: "m-mum", from: NOW - 8 * DAY_MS, until: NOW });

    const membership = client.state().get(EntityTypes.membership, "m-mum");
    expect(membership?.fields["absentUntil"]).toBe(NOW);

    // A holiday consumes nothing, so an item is not treated as overdue.
    const rhythm = computeRhythm(
      { itemKey: "milk", purchases: [NOW - 28 * DAY_MS, NOW - 21 * DAY_MS, NOW - 14 * DAY_MS], pausedMs: 8 * DAY_MS },
      { now: NOW },
    );
    expect(rhythm.state).not.toBe("overdue");
  });
});

describe("questions from the shop (FR-721)", () => {
  it("attaches the question to the item, not to a chat", async () => {
    const id = await addItem(mutate, { listId: LIST, name: "Special tea" });

    await askAboutItem(mutate, { itemId: id, question: "Out of stock — alternative?" });

    const line = selectShoppingList(client.state(), { listId: LIST, now: NOW })
      .groups.flatMap((g) => g.lines)
      .find((l) => l.id === id);
    expect(line?.openQuestion).toBe("Out of stock — alternative?");
  });
});

describe("planning meals", () => {
  it("records who eats and who cooks (FR-603, FR-608)", async () => {
    const id = await planMeal(mutate, {
      weekPlanId: "week-1",
      date: "2026-07-28",
      mealType: "dinner",
      recipeId: "r-pasta",
      cookOwnerId: "person-dad",
      eaterIds: ["person-mum", "person-kid"],
    });

    const slot = client.state().get(EntityTypes.mealSlot, id);
    expect(readString(slot, "cookOwnerId")).toBe("person-dad");
    expect(setMembers(slot!, "eaters")).toEqual(["person-kid", "person-mum"]);
  });

  it("accepts a plan entry that is not a recipe at all (FR-604)", async () => {
    const id = await planMeal(mutate, {
      weekPlanId: "week-1",
      date: "2026-07-28",
      mealType: "lunch",
      label: "School canteen",
      eaterIds: ["person-kid"],
    });

    expect(readString(client.state().get(EntityTypes.mealSlot, id), "label")).toBe("School canteen");
  });

  it("records what was actually cooked, which is what the suggester learns from", async () => {
    await mutate((b) => b.create(EntityTypes.recipe, "r-pasta", { title: "Pasta", servings: 4 }));
    const id = await planMeal(mutate, {
      weekPlanId: "week-1",
      date: "2026-07-28",
      mealType: "dinner",
      recipeId: "r-pasta",
      eaterIds: ["person-mum"],
    });

    await markCooked(mutate, { mealSlotId: id, recipeId: "r-pasta", at: NOW });

    expect(readString(client.state().get(EntityTypes.mealSlot, id), "state")).toBe("cooked");
    expect(client.state().get(EntityTypes.recipe, "r-pasta")?.fields["lastCookedAt"]).toBe(NOW);
  });

  it("removes a meal without leaving anything behind", async () => {
    const id = await planMeal(mutate, {
      weekPlanId: "week-1",
      date: "2026-07-28",
      mealType: "dinner",
      recipeId: "r-pasta",
      eaterIds: ["person-mum"],
    });

    await unplanMeal(mutate, id);

    expect(client.state().all(EntityTypes.mealSlot)).toHaveLength(0);
  });
});

describe("doses (SPEC §12.2)", () => {
  it("records who gave it and when", async () => {
    await acknowledgeDose(mutate, { instanceId: "pi-1", personId: "person-mum", at: NOW });

    const instance = client.state().get(EntityTypes.protocolInstance, "pi-1");
    expect(readString(instance, "state")).toBe("acknowledged");
    expect(readString(instance, "acknowledgedBy")).toBe("person-mum");
  });

  it("records a measurement alongside the acknowledgement", async () => {
    await acknowledgeDose(mutate, { instanceId: "pi-1", personId: "person-mum", at: NOW, measuredValue: 38.4 });

    expect(client.state().get(EntityTypes.protocolInstance, "pi-1")?.fields["measuredValue"]).toBe(38.4);
  });

  it("requires a reason for a skip, so it is never silent (FR-919)", async () => {
    await skipDose(mutate, { instanceId: "pi-1", personId: "person-dad", note: "Child asleep", at: NOW });

    const instance = client.state().get(EntityTypes.protocolInstance, "pi-1");
    expect(readString(instance, "state")).toBe("skipped");
    expect(readString(instance, "skipNote")).toBe("Child asleep");
  });
});

describe("sync status (FR-1216)", () => {
  it("tells the family what state they are in", () => {
    expect(describeSyncStatus({ pending: 0, online: true, openConflicts: 0 })).toBe("synced");
    expect(describeSyncStatus({ pending: 3, online: true, openConflicts: 0 })).toBe("pending");
    expect(describeSyncStatus({ pending: 3, online: false, openConflicts: 0 })).toBe("offline");
  });

  it("puts an unresolved conflict above everything else", () => {
    expect(describeSyncStatus({ pending: 0, online: false, openConflicts: 1 })).toBe("needs-attention");
  });
});
