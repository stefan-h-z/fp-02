import { beforeEach, describe, expect, it } from "vitest";
import {
  EntityTypes,
  FamilyState,
  makeOperation,
  newId,
  search,
  type Operation,
  type Value,
} from "@fam/domain";

const NOW = Date.parse("2026-07-28T08:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
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
  state.apply(
    op("entity.create", EntityTypes.event, "e-swim", {
      title: "Swimming lesson",
      location: "Town pool",
      startsAt: NOW + DAY,
    }),
  );
  state.apply(
    op("entity.create", EntityTypes.task, "t-form", {
      title: "Sign the form",
      definitionOfDone: "Signed and back in the swimming bag",
      dueAt: NOW + 2 * DAY,
    }),
  );
  state.apply(
    op("entity.create", EntityTypes.recipe, "r-soup", {
      title: "Pumpkin soup",
      ingredients: [{ name: "Pumpkin" }, { name: "Cream" }, { name: "Onion" }],
      tags: ["autumn"],
    }),
  );
  state.apply(op("entity.create", EntityTypes.contact, "c-doctor", { name: "Dr Weber", role: "doctor", phone: "0123" }));
  state.apply(
    op("entity.create", EntityTypes.document, "d-insurance", {
      title: "Household insurance",
      category: "contract",
      extractedText: "Covers water damage",
    }),
  );
});

describe("one field for everything (FR-1213)", () => {
  it("finds an appointment", () => {
    expect(search(state, "swimming").map((h) => h.id)).toContain("e-swim");
  });

  it("reaches across areas in a single query", () => {
    const kinds = new Set(search(state, "swimming").map((h) => h.kind));

    expect(kinds.has("event")).toBe(true);
    expect(kinds.has("task")).toBe(true);
  });

  it("finds a recipe by a single ingredient (FR-516)", () => {
    expect(search(state, "pumpkin").map((h) => h.id)).toContain("r-soup");
  });

  it("searches the text pulled out of a scan, not only the title", () => {
    expect(search(state, "water damage").map((h) => h.id)).toEqual(["d-insurance"]);
  });

  it("finds a contact by what they are, not just their name", () => {
    expect(search(state, "doctor").map((h) => h.id)).toContain("c-doctor");
  });

  it("requires every word to match something", () => {
    expect(search(state, "swimming pumpkin")).toHaveLength(0);
  });

  it("ignores case and stray punctuation", () => {
    expect(search(state, "  SWIMMING, ").map((h) => h.id)).toContain("e-swim");
  });

  it("returns nothing for an empty or one-letter query rather than everything", () => {
    expect(search(state, "")).toHaveLength(0);
    expect(search(state, "a")).toHaveLength(0);
  });
});

describe("ranking", () => {
  it("puts a title match above a body match", () => {
    const hits = search(state, "swimming");

    expect(hits[0]?.id).toBe("e-swim");
  });

  it("prefers a whole word over a fragment of a longer one", () => {
    state.apply(op("entity.create", EntityTypes.shoppingItem, "i-milk", { name: "Milk" }));
    state.apply(op("entity.create", EntityTypes.shoppingItem, "i-butter", { name: "Buttermilk" }));

    const hits = search(state, "milk", { kinds: ["shoppingItem"] });

    expect(hits[0]?.id).toBe("i-milk");
  });

  it("prefers the sooner of two equally relevant appointments", () => {
    state.apply(
      op("entity.create", EntityTypes.event, "e-old", { title: "Swimming lesson", startsAt: NOW - 400 * DAY }),
    );

    expect(search(state, "swimming lesson", { kinds: ["event"] })[0]?.id).toBe("e-swim");
  });

  it("can be narrowed to one kind", () => {
    const hits = search(state, "swimming", { kinds: ["task"] });

    expect(hits.map((h) => h.kind)).toEqual(["task"]);
  });

  it("caps how much comes back", () => {
    for (let i = 0; i < 30; i += 1) {
      state.apply(op("entity.create", EntityTypes.shoppingItem, "i-" + i, { name: "Apple " + i }));
    }

    expect(search(state, "apple", { limit: 5 })).toHaveLength(5);
  });
});

describe("what a searcher may not see", () => {
  beforeEach(() => {
    state.apply(
      op("entity.create", EntityTypes.collectionItem, "gift-1", {
        collectionId: "col-gifts",
        title: "Telescope",
        forPersonId: "p-kid",
      }),
    );
  });

  it("hides a gift from the person it is for (FR-1012)", () => {
    expect(search(state, "telescope", { viewerPersonId: "p-kid" })).toHaveLength(0);
  });

  it("still shows it to everyone else", () => {
    expect(search(state, "telescope", { viewerPersonId: "p-mum" }).map((h) => h.id)).toEqual(["gift-1"]);
  });

  it("shows everything on a household device with nobody selected", () => {
    expect(search(state, "telescope", { viewerPersonId: null })).toHaveLength(1);
  });

  it("leaves deleted things out", () => {
    state.apply(op("entity.delete", EntityTypes.event, "e-swim", {}));

    expect(search(state, "swimming").map((h) => h.id)).not.toContain("e-swim");
  });
});
