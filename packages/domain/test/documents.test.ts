import { beforeEach, describe, expect, it } from "vitest";
import {
  DAY_MS,
  EntityTypes,
  FamilyState,
  buildEmergencyBinder,
  filterOutingIdeas,
  makeOperation,
  newId,
  readCollectionItems,
  readDocument,
  searchDocuments,
  upcomingDocumentDeadlines,
  visibleCollectionItems,
  type Operation,
  type Value,
} from "@fam/domain";

const NOW = Date.parse("2026-07-28T08:00:00Z");
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
});

describe("documents with deadlines (FR-1002, FR-1003)", () => {
  it("warns about an expiring passport months ahead, not on the day", () => {
    const expiresAt = NOW + 200 * DAY_MS;
    state.apply(
      op("entity.create", EntityTypes.document, "doc-passport", {
        title: "Passport (Kid)",
        category: "id",
        personId: "p-kid",
        expiresAt,
      }),
    );

    const [deadline] = upcomingDocumentDeadlines(state, { from: NOW, to: NOW + 365 * DAY_MS });

    expect(deadline?.kind).toBe("expiry");
    expect(deadline?.dueAt).toBe(expiresAt);
    expect(deadline?.firstReminderAt).toBe(expiresAt - 90 * DAY_MS);
  });

  it("treats the notice date as the real deadline of a contract, not the term end", () => {
    const termEnd = NOW + 200 * DAY_MS;
    state.apply(
      op("entity.create", EntityTypes.document, "doc-insurance", {
        title: "Household insurance",
        category: "contract",
        expiresAt: termEnd,
        noticePeriodDays: 90,
      }),
    );

    const deadlines = upcomingDocumentDeadlines(state, { from: NOW, to: NOW + 365 * DAY_MS });
    const notice = deadlines.find((d) => d.kind === "notice");

    expect(notice?.dueAt).toBe(termEnd - 90 * DAY_MS);
    expect(notice?.firstReminderAt).toBe(termEnd - 90 * DAY_MS - 30 * DAY_MS);
  });

  it("prefers an explicitly recorded notice date over the derived one", () => {
    const explicitNotice = NOW + 40 * DAY_MS;
    state.apply(
      op("entity.create", EntityTypes.document, "doc-gym", {
        title: "Gym membership",
        category: "contract",
        expiresAt: NOW + 200 * DAY_MS,
        noticePeriodDays: 90,
        noticeDeadlineAt: explicitNotice,
      }),
    );

    const notice = upcomingDocumentDeadlines(state, { from: NOW, to: NOW + 365 * DAY_MS }).find(
      (d) => d.kind === "notice",
    );

    expect(notice?.dueAt).toBe(explicitNotice);
  });

  it("says nothing about a document with no dates on it", () => {
    state.apply(op("entity.create", EntityTypes.document, "doc-manual", { title: "Boiler manual", category: "knowledge" }));

    expect(upcomingDocumentDeadlines(state, { from: NOW, to: NOW + 365 * DAY_MS })).toHaveLength(0);
  });

  it("orders deadlines by when they bite", () => {
    state.apply(op("entity.create", EntityTypes.document, "doc-a", { title: "A", expiresAt: NOW + 300 * DAY_MS }));
    state.apply(op("entity.create", EntityTypes.document, "doc-b", { title: "B", expiresAt: NOW + 100 * DAY_MS }));

    const order = upcomingDocumentDeadlines(state, { from: NOW, to: NOW + 400 * DAY_MS }).map((d) => d.documentId);

    expect(order).toEqual(["doc-b", "doc-a"]);
  });
});

describe("finding a document again (FR-1001)", () => {
  beforeEach(() => {
    state.apply(
      op("entity.create", EntityTypes.document, "doc-1", {
        title: "Household insurance",
        category: "contract",
        tags: ["insurance", "home"],
        extractedText: "Policy number 4711, covers water damage",
      }),
    );
  });

  it("searches the scanned text, not only the title", () => {
    expect(searchDocuments(state, "water damage").map((d) => d.id)).toEqual(["doc-1"]);
  });

  it("searches tags and categories too", () => {
    expect(searchDocuments(state, "contract")).toHaveLength(1);
    expect(searchDocuments(state, "home")).toHaveLength(1);
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(searchDocuments(state, "   ")).toHaveLength(0);
  });

  it("reads back the stored fields", () => {
    expect(readDocument(state, "doc-1")?.title).toBe("Household insurance");
  });
});

describe("collections have no due date (FR-1011)", () => {
  beforeEach(() => {
    state.apply(op("entity.create", EntityTypes.collection, "col-gifts", { name: "Gift ideas", kind: "gifts" }));
    state.apply(
      op("entity.create", EntityTypes.collectionItem, "gift-1", {
        collectionId: "col-gifts",
        title: "Telescope",
        forPersonId: "p-kid",
      }),
    );
    state.apply(
      op("entity.create", EntityTypes.collectionItem, "gift-2", {
        collectionId: "col-gifts",
        title: "Cookbook",
        forPersonId: "p-mum",
      }),
    );
  });

  it("keeps entries without ever making them overdue", () => {
    const items = readCollectionItems(state, "col-gifts");

    expect(items).toHaveLength(2);
    expect(items[0]).not.toHaveProperty("dueAt");
  });

  it("hides a gift from the person it is for (FR-1012)", () => {
    const asKid = visibleCollectionItems(state, "col-gifts", "p-kid");

    expect(asKid.map((i) => i.id)).toEqual(["gift-2"]);
  });

  it("shows everything on a household device with no person selected", () => {
    expect(visibleCollectionItems(state, "col-gifts", null)).toHaveLength(2);
  });
});

describe("outing ideas are searched, not tracked (FR-1014)", () => {
  beforeEach(() => {
    state.apply(op("entity.create", EntityTypes.collection, "col-outings", { name: "Outings", kind: "outings" }));
    state.apply(
      op("entity.create", EntityTypes.collectionItem, "out-museum", {
        collectionId: "col-outings",
        title: "Museum",
        weather: "rain",
        minAge: 6,
        maxMinutes: 180,
        distanceKm: 12,
      }),
    );
    state.apply(
      op("entity.create", EntityTypes.collectionItem, "out-lake", {
        collectionId: "col-outings",
        title: "Lake",
        weather: "sun",
        minAge: 0,
        maxMinutes: 300,
        distanceKm: 40,
      }),
    );
  });

  it("filters by weather", () => {
    const items = filterOutingIdeas(readCollectionItems(state, "col-outings"), { weather: "rain" });

    expect(items.map((i) => i.id)).toEqual(["out-museum"]);
  });

  it("filters by what the youngest child can join", () => {
    const items = filterOutingIdeas(readCollectionItems(state, "col-outings"), { age: 3 });

    expect(items.map((i) => i.id)).toEqual(["out-lake"]);
  });

  it("filters by the time and distance actually available", () => {
    const items = filterOutingIdeas(readCollectionItems(state, "col-outings"), { maxMinutes: 200, maxDistanceKm: 20 });

    expect(items.map((i) => i.id)).toEqual(["out-museum"]);
  });

  it("keeps an entry that simply does not say, rather than dropping it", () => {
    state.apply(
      op("entity.create", EntityTypes.collectionItem, "out-park", { collectionId: "col-outings", title: "Park" }),
    );

    const items = filterOutingIdeas(readCollectionItems(state, "col-outings"), { weather: "sun", age: 2 });

    expect(items.map((i) => i.id)).toContain("out-park");
  });
});

describe("the emergency binder (FR-1009)", () => {
  it("collects the contacts and papers a stand-in actually needs", () => {
    state.apply(op("entity.create", EntityTypes.contact, "c-doctor", { name: "Dr Weber", role: "doctor", phone: "0123" }));
    state.apply(op("entity.create", EntityTypes.contact, "c-plumber", { name: "Plumber", role: "trade" }));
    state.apply(
      op("entity.create", EntityTypes.document, "doc-insurance-card", {
        title: "Insurance card",
        category: "id",
        tags: ["emergency"],
      }),
    );
    state.apply(
      op("entity.create", EntityTypes.document, "doc-heating", {
        title: "How the heating works",
        category: "knowledge",
        extractedText: "Turn the valve behind the door",
      }),
    );

    const binder = buildEmergencyBinder(state, NOW);

    expect(binder.contacts.map((c) => c.id)).toEqual(["c-doctor"]);
    expect(binder.documents.map((d) => d.id)).toEqual(["doc-insurance-card"]);
    expect(binder.notes[0]).toContain("Turn the valve");
  });
});
