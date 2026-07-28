import { beforeEach, describe, expect, it } from "vitest";
import {
  CAPTURE_MARKERS,
  EntityTypes,
  FamilyState,
  applyRules,
  inboxCount,
  makeOperation,
  newId,
  openInboxItems,
  parseCapturedItems,
  readInboxItem,
  triageSuggestion,
  type CaptureRule,
  type InboxItem,
  type Operation,
  type Value,
} from "@fam/domain";

const NOW = Date.parse("2026-08-05T10:00:00Z");
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
});

function seedItem(id: string, fields: Record<string, Value> = {}): InboxItem {
  state.apply(
    op("entity.create", EntityTypes.inboxItem, id, {
      source: "voice",
      capturedAt: NOW,
      text: "Something was said",
      state: "new",
      ...fields,
    }),
  );
  return readInboxItem(state, id)!;
}

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "inbox-1",
    source: "voice",
    capturedAt: NOW,
    capturedBy: undefined,
    text: "",
    sender: undefined,
    state: "new",
    extracted: {
      title: undefined,
      startsAt: undefined,
      dueAt: undefined,
      deadlineAt: undefined,
      place: undefined,
      personIds: [],
      itemName: undefined,
    },
    suggestedTarget: undefined,
    confidence: 0,
    ...overrides,
  };
}

describe("reading captures (FR-1113)", () => {
  it("reads a stored capture with its extracted fields", () => {
    const read = seedItem("inbox-1", {
      source: "mail",
      sender: "sekretariat@schule.de",
      text: "Parent letter: swimming",
      title: "Swimming permission",
      deadlineAt: NOW + 5 * DAY,
      personIds: ["p-kid"],
      capturedBy: "p-mum",
    });

    expect(read.source).toBe("mail");
    expect(read.sender).toBe("sekretariat@schule.de");
    expect(read.extracted.deadlineAt).toBe(NOW + 5 * DAY);
    expect(read.extracted.personIds).toEqual(["p-kid"]);
    expect(read.capturedBy).toBe("p-mum");
  });

  it("falls back rather than throwing when a field is missing or unknown", () => {
    const read = seedItem("inbox-1", { source: "telepathy", state: "nonsense" });

    expect(read.source).toBe("voice");
    expect(read.state).toBe("new");
    expect(read.confidence).toBe(0);
  });

  it("returns nothing for a deleted or unknown capture", () => {
    seedItem("inbox-1");
    state.apply(op("entity.delete", EntityTypes.inboxItem, "inbox-1", {}));

    expect(readInboxItem(state, "inbox-1")).toBeUndefined();
    expect(readInboxItem(state, "inbox-nope")).toBeUndefined();
  });
});

describe("the visible counter (FR-1115)", () => {
  it("counts only what still needs a decision", () => {
    seedItem("inbox-1");
    seedItem("inbox-2");
    seedItem("inbox-3", { state: "triaged" });
    seedItem("inbox-4", { state: "dismissed" });

    expect(inboxCount(state)).toBe(2);
  });

  it("is zero on an empty inbox", () => {
    expect(inboxCount(state)).toBe(0);
  });

  it("offers the untriaged items oldest first, the order they are swiped through", () => {
    seedItem("inbox-b", { capturedAt: NOW + 60_000 });
    seedItem("inbox-a", { capturedAt: NOW });

    expect(openInboxItems(state).map((i) => i.id)).toEqual(["inbox-a", "inbox-b"]);
  });
});

describe("one-swipe triage (FR-1114)", () => {
  it("makes a dated capture an event with its fields ready", () => {
    const suggestion = triageSuggestion(
      item({
        text: "Parent evening on Thursday",
        extracted: {
          ...item().extracted,
          title: "Parent evening",
          startsAt: NOW + 3 * DAY,
          place: "Room 12",
        },
      }),
    );

    expect(suggestion.target).toBe("event");
    expect(suggestion.fields).toMatchObject({ title: "Parent evening", startsAt: NOW + 3 * DAY, place: "Room 12" });
    expect(suggestion.missing).toEqual([]);
    expect(suggestion.certain).toBe(true);
  });

  it("turns a return-by date into a task with a due date, not a type of its own (FR-801)", () => {
    const suggestion = triageSuggestion(
      item({
        source: "mail",
        extracted: { ...item().extracted, title: "Swimming permission", deadlineAt: NOW + 5 * DAY },
      }),
    );

    expect(suggestion.target).toBe("task");
    expect(suggestion.fields["dueAt"]).toBe(NOW + 5 * DAY);
    expect(suggestion.fields["isDeadline"]).toBe(1);
  });

  it("makes a named item a shopping item", () => {
    const suggestion = triageSuggestion(item({ extracted: { ...item().extracted, itemName: "Milk" } }));

    expect(suggestion.target).toBe("shoppingItem");
    expect(suggestion.fields).toMatchObject({ itemName: "Milk" });
  });

  it("makes an undated scan a document", () => {
    const suggestion = triageSuggestion(item({ source: "photo", text: "Insurance policy 2026" }));

    expect(suggestion.target).toBe("document");
    expect(suggestion.fields["title"]).toBe("Insurance policy 2026");
  });

  it("recognizes a repeated treatment", () => {
    const suggestion = triageSuggestion(item({ text: "Eye drops five times a day for five days" }));

    expect(suggestion.target).toBe("protocol");
  });

  it("recognizes something to keep rather than something to do", () => {
    const suggestion = triageSuggestion(item({ text: "Gift idea for grandma: gardening gloves" }));

    expect(suggestion.target).toBe("collectionItem");
  });

  it("keeps the extractor's own conclusion instead of second-guessing it (AI-01)", () => {
    const suggestion = triageSuggestion(
      item({ source: "photo", text: "Team photo order", suggestedTarget: "collectionItem", confidence: 0.72 }),
    );

    expect(suggestion.target).toBe("collectionItem");
    expect(suggestion.confidence).toBe(0.72);
  });

  it("still suggests something for input it cannot place, but does not pretend (AI-05, P-08)", () => {
    const suggestion = triageSuggestion(item({ text: "The thing with the thing" }));

    expect(suggestion.target).toBe("task");
    expect(suggestion.confidence).toBeLessThan(0.5);
    expect(suggestion.certain).toBe(false);
    expect(suggestion.reason.length).toBeGreaterThan(0);
  });

  it("refuses to pre-commit while a required field is missing, however sure the extractor was", () => {
    const suggestion = triageSuggestion(item({ text: "", suggestedTarget: "event", confidence: 0.99 }));

    expect(suggestion.missing).toEqual(["title", "startsAt"]);
    expect(suggestion.certain).toBe(false);
  });

  it("always names where the entry came from, so triage is undoable", () => {
    const suggestion = triageSuggestion(item({ id: "inbox-7", text: "Buy a present" }));

    expect(suggestion.fields["sourceInboxItemId"]).toBe("inbox-7");
  });
});

describe("voice capture, English (FR-735)", () => {
  it("splits one spoken sentence into several reports", () => {
    const parsed = parseCapturedItems("milk's gone, pasta almost, the peppers need using");

    expect(parsed.items).toEqual([
      { itemName: "milk", kind: "empty", phrase: "milk's gone" },
      { itemName: "pasta", kind: "low", phrase: "pasta almost" },
      { itemName: "peppers", kind: "use-up", phrase: "the peppers need using" },
    ]);
    expect(parsed.unclear).toEqual([]);
  });

  it("strips articles and pronouns without any grammar", () => {
    const parsed = parseCapturedItems("we're out of the coffee");

    expect(parsed.items[0]).toMatchObject({ itemName: "coffee", kind: "empty" });
  });

  it("reads 'almost gone' as running low, never as empty", () => {
    const parsed = parseCapturedItems("butter almost gone");

    expect(parsed.items[0]?.kind).toBe("low");
  });

  it("recognizes a use-up report, which is a meal-plan signal and not a stock one (FR-736)", () => {
    const parsed = parseCapturedItems("the spinach is going off");

    expect(parsed.items[0]).toMatchObject({ itemName: "spinach", kind: "use-up" });
  });
});

describe("voice capture, German (§2.4)", () => {
  it("splits a German sentence into the same three kinds", () => {
    const parsed = parseCapturedItems("die Milch ist alle, die Nudeln sind fast alle, die Paprika muss weg");

    expect(parsed.items).toEqual([
      { itemName: "Milch", kind: "empty", phrase: "die Milch ist alle" },
      { itemName: "Nudeln", kind: "low", phrase: "die Nudeln sind fast alle" },
      { itemName: "Paprika", kind: "use-up", phrase: "die Paprika muss weg" },
    ]);
  });

  it("hears further German phrasings", () => {
    const parsed = parseCapturedItems("Kaffee haben wir nicht mehr; das Mehl wird knapp; der Joghurt wird schlecht");

    expect(parsed.items.map((i) => `${i.itemName}:${i.kind}`)).toEqual([
      "Kaffee:empty",
      "Mehl:low",
      "Joghurt:use-up",
    ]);
  });

  it("keeps the German marker vocabulary in the documented constant", () => {
    expect(CAPTURE_MARKERS.empty).toContain("ist alle");
    expect(CAPTURE_MARKERS.low).toContain("fast alle");
    expect(CAPTURE_MARKERS["use-up"]).toContain("muss weg");
  });
});

describe("what the parser will not guess (AI-05, FR-1113)", () => {
  it("sends an unclassifiable fragment to the inbox instead of dropping it", () => {
    const parsed = parseCapturedItems("milk's gone, and something for Saturday");

    expect(parsed.items.map((i) => i.itemName)).toEqual(["milk"]);
    expect(parsed.unclear).toEqual(["something for Saturday"]);
  });

  it("treats a marker with no item as unclear rather than inventing a name", () => {
    const parsed = parseCapturedItems("it is empty");

    expect(parsed.items).toEqual([]);
    expect(parsed.unclear).toEqual(["it is empty"]);
  });

  it("classifies nothing in a sentence without markers", () => {
    const parsed = parseCapturedItems("remind me about the thing on Saturday");

    expect(parsed.items).toEqual([]);
    expect(parsed.unclear).toHaveLength(1);
  });

  it("returns nothing at all for empty input", () => {
    expect(parseCapturedItems("   ")).toEqual({ items: [], unclear: [] });
  });
});

describe("rule-based automation (FR-1107)", () => {
  const parentLetterRule: CaptureRule = {
    id: "parent-letter",
    when: { source: "mail", senderContains: "schule.de" },
    then: { target: "task", requireDeadline: true, fields: { category: "school" } },
  };

  it("makes parent-letter mails a task with a deadline", () => {
    const match = applyRules(
      item({
        source: "mail",
        sender: "Sekretariat@Schule.de",
        text: "Swimming permission",
        extracted: { ...item().extracted, title: "Swimming permission", deadlineAt: NOW + 5 * DAY },
      }),
      [parentLetterRule],
    );

    expect(match?.ruleId).toBe("parent-letter");
    expect(match?.suggestion.target).toBe("task");
    expect(match?.suggestion.fields).toMatchObject({ dueAt: NOW + 5 * DAY, category: "school" });
    expect(match?.suggestion.certain).toBe(true);
  });

  it("asks for the deadline instead of quietly dropping the requirement", () => {
    const match = applyRules(
      item({
        source: "mail",
        sender: "sekretariat@schule.de",
        extracted: { ...item().extracted, title: "Something from school" },
      }),
      [parentLetterRule],
    );

    expect(match?.suggestion.missing).toEqual(["dueAt"]);
    expect(match?.suggestion.certain).toBe(false);
  });

  it("is a family's decision, not a guess — a hit is fully confident", () => {
    const match = applyRules(
      item({ source: "mail", sender: "sekretariat@schule.de", extracted: { ...item().extracted, title: "X", deadlineAt: NOW } }),
      [parentLetterRule],
    );

    expect(match?.suggestion.confidence).toBe(1);
  });

  it("takes the first matching rule, so the list order is the family's priority", () => {
    const first: CaptureRule = { id: "first", when: { source: "mail" }, then: { target: "document" } };

    const match = applyRules(item({ source: "mail", sender: "sekretariat@schule.de" }), [first, parentLetterRule]);

    expect(match?.ruleId).toBe("first");
  });

  it("matches on text and on the presence of a deadline", () => {
    const rule: CaptureRule = {
      id: "waste",
      when: { textContains: ["bulky waste", "Sperrmüll"], hasDeadline: false },
      then: { target: "event" },
    };

    expect(applyRules(item({ text: "Sperrmüll next week" }), [rule])?.ruleId).toBe("waste");
    expect(
      applyRules(item({ text: "Sperrmüll", extracted: { ...item().extracted, deadlineAt: NOW } }), [rule]),
    ).toBeUndefined();
  });

  it("returns nothing when no rule applies, leaving the plain suggestion in charge", () => {
    expect(applyRules(item({ source: "voice", text: "hello" }), [parentLetterRule])).toBeUndefined();
    expect(applyRules(item(), [])).toBeUndefined();
  });
});
