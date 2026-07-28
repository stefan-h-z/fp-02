import { beforeEach, describe, expect, it } from "vitest";
import {
  CHILD_TASK_SUGGESTIONS,
  DAY_MS,
  EntityTypes,
  FamilyState,
  PACKING_LISTS,
  SHOPPING_TEMPLATES,
  STANDARD_PRODUCT_GROUPS,
  TASK_LIBRARY,
  TASK_PACKS,
  allTemplates,
  buildShoppingList,
  childTasksForAge,
  findTemplate,
  instantiateTemplate,
  makeOperation,
  newId,
  readResponsibilityCard,
  readTask,
  type FamilyTemplate,
  type Operation,
  type TemplatePayload,
} from "@fam/domain";

const NOW = Date.parse("2026-07-28T08:00:00Z");
const OWNER = "p-mum";
let wall = 1000;

let state: FamilyState;

beforeEach(() => {
  state = new FamilyState();
});

/** Turn payloads into state the way the command layer would, so the tests assert
 * that a template produces something the projections can actually read. */
function apply(payloads: readonly TemplatePayload[]): void {
  for (const payload of payloads) {
    wall += 1;
    const op: Operation = makeOperation({
      opId: newId(),
      familyId: "fam-1",
      deviceId: "device-a",
      actorId: OWNER,
      entityType: payload.entityType,
      entityId: payload.localId,
      kind: "entity.create",
      payload: payload.fields,
      hlc: { wall, counter: 0, deviceId: "device-a" },
    });
    state.apply(op);
  }
}

function template(kind: FamilyTemplate["kind"], key: string): FamilyTemplate {
  const found = findTemplate(kind, key);
  if (found === undefined) throw new Error("missing template " + kind + "/" + key);
  return found;
}

describe("the seed content is honest and small (FR-126)", () => {
  it("offers the aisles of an ordinary shop, not a taxonomy", () => {
    expect(STANDARD_PRODUCT_GROUPS.length).toBeLessThanOrEqual(12);
    expect(STANDARD_PRODUCT_GROUPS.map((group) => group.key)).toContain("produce");
    expect(STANDARD_PRODUCT_GROUPS.map((group) => group.key)).toContain("other");
  });

  it("keeps every category to a size a person can read in one sitting", () => {
    expect(TASK_LIBRARY.length).toBeLessThanOrEqual(15);
    expect(CHILD_TASK_SUGGESTIONS.length).toBeLessThanOrEqual(20);
    expect(TASK_PACKS.length).toBe(4);
    expect(PACKING_LISTS.length).toBeLessThanOrEqual(6);
    expect(SHOPPING_TEMPLATES.length).toBe(4);
    for (const pack of TASK_PACKS) expect(pack.items.length).toBeLessThanOrEqual(10);
    for (const list of SHOPPING_TEMPLATES) expect(list.items.length).toBeLessThanOrEqual(15);
  });

  it("covers the four packs FR-315 names and no invented fifth", () => {
    expect(TASK_PACKS.map((pack) => pack.key).sort()).toEqual([
      "moving",
      "school-enrollment",
      "sick-week",
      "trip-preparation",
    ]);
  });

  it("covers the four shopping templates FR-717 names", () => {
    expect(SHOPPING_TEMPLATES.map((list) => list.key).sort()).toEqual([
      "barbecue",
      "holiday-shop",
      "sickness-stock",
      "weekly-shop",
    ]);
  });

  it("names no medicine in the sickness stock — the app is not a medical device", () => {
    const stock = SHOPPING_TEMPLATES.find((list) => list.key === "sickness-stock");
    const names = (stock?.items ?? []).map((item) => item.name.toLowerCase()).join(" ");

    for (const drug of ["paracetamol", "ibuprofen", "aspirin", "antibiotic"]) {
      expect(names).not.toContain(drug);
    }
  });
});

describe("keys are the contract with @fam/i18n", () => {
  it("gives every entry a stable key that is unique within its kind", () => {
    const seen = new Set<string>();
    for (const entry of allTemplates()) {
      const composite = entry.kind + "/" + entry.key;
      expect(entry.key.length).toBeGreaterThan(0);
      expect(seen.has(composite)).toBe(false);
      seen.add(composite);
    }
  });

  it("keeps item keys unique inside a template", () => {
    for (const pack of TASK_PACKS) {
      expect(new Set(pack.items.map((item) => item.key)).size).toBe(pack.items.length);
    }
    for (const list of [...PACKING_LISTS, ...SHOPPING_TEMPLATES]) {
      expect(new Set(list.items.map((item) => item.key)).size).toBe(list.items.length);
    }
  });

  it("holds English source strings only", () => {
    const strings = [
      ...STANDARD_PRODUCT_GROUPS.map((group) => group.label),
      ...TASK_LIBRARY.map((entry) => entry.title),
      ...CHILD_TASK_SUGGESTIONS.map((entry) => entry.title),
      ...TASK_PACKS.flatMap((pack) => [pack.title, ...pack.items.map((item) => item.title)]),
      ...PACKING_LISTS.flatMap((list) => [list.title, ...list.items.map((item) => item.title)]),
      ...SHOPPING_TEMPLATES.flatMap((list) => [list.title, ...list.items.map((item) => item.name)]),
    ];

    for (const value of strings) {
      expect(value.length).toBeGreaterThan(0);
      // Plain ASCII: umlauts here would mean a German string slipped in.
      expect(value).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  it("finds a template by kind and key, not by key alone", () => {
    expect(findTemplate("task-pack", "moving")?.title).toBe("Moving house");
    expect(findTemplate("packing-list", "moving")).toBeUndefined();
  });
});

describe("standard tasks by child age (FR-317)", () => {
  it("suggests putting toys away to a four-year-old and nothing about laundry", () => {
    const titles = childTasksForAge(4).map((entry) => entry.title);

    expect(titles).toContain("Put the toys away");
    expect(titles).not.toContain("Do your own laundry");
  });

  it("moves on as the child grows", () => {
    expect(childTasksForAge(10).map((entry) => entry.key)).toContain("take-bins-out");
    expect(childTasksForAge(10).map((entry) => entry.key)).not.toContain("tidy-toys");
  });

  it("keeps the open-ended jobs for a teenager", () => {
    const keys = childTasksForAge(15).map((entry) => entry.key);

    expect(keys).toContain("own-laundry");
    expect(keys).toContain("feed-pet");
  });

  it("suggests nothing at all for an age no band covers", () => {
    expect(childTasksForAge(1)).toEqual([]);
  });

  it("offers no stars on the jobs that only start at thirteen (FR-323)", () => {
    expect(childTasksForAge(5).every((entry) => entry.rewardStars > 0)).toBe(true);

    const teenOnly = CHILD_TASK_SUGGESTIONS.filter((entry) => entry.minAge >= 13);
    expect(teenOnly.length).toBeGreaterThan(0);
    expect(teenOnly.every((entry) => entry.rewardStars === 0)).toBe(true);
  });
});

describe("instantiating a task pack (FR-315)", () => {
  it("hangs every task off the anchor date rather than off today", () => {
    const movingDay = Date.parse("2026-10-01T00:00:00Z");

    const payloads = instantiateTemplate(template("task-pack", "moving"), {
      now: NOW,
      ownerId: OWNER,
      anchorAt: movingDay,
    });

    apply(payloads);
    const notice = readTask(state, payloads[0]?.localId ?? "");

    expect(notice?.title).toBe("Give notice on the current home");
    expect(notice?.scheduling).toEqual({ kind: "due", dueAt: movingDay - 90 * DAY_MS });
  });

  it("puts the tasks that follow the move after it", () => {
    const movingDay = Date.parse("2026-10-01T00:00:00Z");

    const payloads = instantiateTemplate(template("task-pack", "moving"), {
      now: NOW,
      ownerId: OWNER,
      anchorAt: movingDay,
    });
    apply(payloads);

    const register = readTask(state, payloads[payloads.length - 1]?.localId ?? "");
    expect(register?.title).toBe("Register the new address with the authorities");
    expect(register?.scheduling).toEqual({ kind: "due", dueAt: movingDay + 7 * DAY_MS });
    expect(register?.deadline).toBe(true);
  });

  it("falls back to now when the family has no date yet — the sick week is today", () => {
    const payloads = instantiateTemplate(template("task-pack", "sick-week"), { now: NOW, ownerId: OWNER });
    apply(payloads);

    const report = readTask(state, payloads[0]?.localId ?? "");
    expect(report?.scheduling).toEqual({ kind: "due", dueAt: NOW });
  });

  it("gives every task an owner, because an ownerless task is not allowed (FR-301)", () => {
    const payloads = instantiateTemplate(template("task-pack", "trip-preparation"), { now: NOW, ownerId: OWNER });
    apply(payloads);

    for (const payload of payloads) {
      expect(readTask(state, payload.localId)?.ownerId).toBe(OWNER);
    }
  });

  it("carries the definition of done where done is ambiguous (FR-303)", () => {
    const payloads = instantiateTemplate(template("task-pack", "moving"), { now: NOW, ownerId: OWNER });
    apply(payloads);

    const meters = payloads.find((payload) => payload.localId.endsWith("meter-readings"));
    expect(readTask(state, meters?.localId ?? "")?.definitionOfDone).toContain("Photo of every meter");
  });

  it("produces the same payloads twice, so two offline devices agree", () => {
    const first = instantiateTemplate(template("task-pack", "sick-week"), { now: NOW, ownerId: OWNER });
    const second = instantiateTemplate(template("task-pack", "sick-week"), { now: NOW, ownerId: OWNER });

    expect(second).toEqual(first);
  });
});

describe("instantiating a packing list (FR-324)", () => {
  it("produces one task with the items as a checklist, not a task each", () => {
    const payloads = instantiateTemplate(template("packing-list", "swimming-bag"), { now: NOW, ownerId: OWNER });
    apply(payloads);

    expect(payloads).toHaveLength(1);
    const task = readTask(state, payloads[0]?.localId ?? "");
    expect(task?.title).toBe("Swimming bag");
    expect(task?.subtasks.map((subtask) => subtask.title)).toEqual([
      "Swimsuit",
      "Towel",
      "Goggles",
      "Shower gel and hairbrush",
      "Snack and drink",
    ]);
    expect(task?.subtasks.every((subtask) => !subtask.done)).toBe(true);
  });

  it("has no date until the family gives it one (FR-304)", () => {
    const payloads = instantiateTemplate(template("packing-list", "beach-holiday"), { now: NOW, ownerId: OWNER });
    apply(payloads);

    expect(readTask(state, payloads[0]?.localId ?? "")?.scheduling).toEqual({ kind: "someday" });
  });

  it("takes a date when there is one", () => {
    const departure = NOW + 30 * DAY_MS;
    const payloads = instantiateTemplate(template("packing-list", "beach-holiday"), {
      now: NOW,
      ownerId: OWNER,
      anchorAt: departure,
    });
    apply(payloads);

    expect(readTask(state, payloads[0]?.localId ?? "")?.scheduling).toEqual({ kind: "due", dueAt: departure });
  });

  it("gives the subtasks stable ids, so ticking one survives a re-read", () => {
    const first = instantiateTemplate(template("packing-list", "swimming-bag"), { now: NOW, ownerId: OWNER });
    const second = instantiateTemplate(template("packing-list", "swimming-bag"), { now: NOW + 5000, ownerId: OWNER });

    expect(second[0]?.fields["subtasks"]).toEqual(first[0]?.fields["subtasks"]);
  });
});

describe("instantiating the task library (FR-316)", () => {
  it("produces responsibility cards, because the deck carries the head-work (FR-402)", () => {
    const entry = template("task-library", "school-messages");
    const payloads = instantiateTemplate(entry, { now: NOW, ownerId: OWNER });
    apply(payloads);

    expect(payloads[0]?.entityType).toBe(EntityTypes.responsibilityCard);
    const card = readResponsibilityCard(state, payloads[0]?.localId ?? "");
    expect(card?.title).toBe("Read and answer messages from school and daycare");
    expect(card?.includesNoticing).toBe(true);
    expect(card?.includesPlanning).toBe(true);
    expect(card?.ownerId).toBe(OWNER);
  });

  it("keeps the recurrence the projection reads back", () => {
    const payloads = instantiateTemplate(template("task-library", "vehicle-service"), { now: NOW, ownerId: OWNER });
    apply(payloads);

    expect(readResponsibilityCard(state, payloads[0]?.localId ?? "")?.recurrence).toEqual({
      mode: "schedule",
      every: 1,
      unit: "year",
    });
  });

  it("distinguishes the jobs that are mostly remembering from the ones that are mostly doing", () => {
    const bins = TASK_LIBRARY.find((entry) => entry.key === "bins");
    const kitchen = TASK_LIBRARY.find((entry) => entry.key === "kitchen-evening");

    expect(bins?.includesNoticing).toBe(true);
    expect(kitchen?.includesNoticing).toBe(false);
  });

  it("seeds the whole deck without collisions", () => {
    const payloads = TASK_LIBRARY.flatMap((entry) => instantiateTemplate(entry, { now: NOW, ownerId: OWNER }));
    apply(payloads);

    expect(new Set(payloads.map((payload) => payload.localId)).size).toBe(TASK_LIBRARY.length);
    expect(state.all(EntityTypes.responsibilityCard)).toHaveLength(TASK_LIBRARY.length);
  });
});

describe("instantiating a child task (FR-317, FR-312)", () => {
  it("makes a task owned by the child with its symbolic stars", () => {
    const payloads = instantiateTemplate(template("child-task", "empty-dishwasher"), {
      now: NOW,
      ownerId: "p-kid",
    });
    apply(payloads);

    const task = readTask(state, payloads[0]?.localId ?? "");
    expect(task?.ownerId).toBe("p-kid");
    expect(task?.rewardStars).toBe(1);
  });

  it("leaves the approval gate to the role, not to the template", () => {
    const payloads = instantiateTemplate(template("child-task", "empty-dishwasher"), {
      now: NOW,
      ownerId: "p-kid",
    });

    expect(payloads[0]?.fields["requiresApproval"]).toBeUndefined();

    state.apply(
      makeOperation({
        opId: newId(),
        familyId: "fam-1",
        deviceId: "device-a",
        actorId: null,
        entityType: EntityTypes.membership,
        entityId: "m-kid",
        kind: "entity.create",
        payload: { personId: "p-kid", role: "child" },
        hlc: { wall: (wall += 1), counter: 0, deviceId: "device-a" },
      }),
    );
    apply(payloads);

    expect(readTask(state, payloads[0]?.localId ?? "")?.requiresApproval).toBe(true);
  });
});

describe("instantiating a shopping template (FR-717)", () => {
  it("fills the named list with grouped lines the list view can read", () => {
    const payloads = instantiateTemplate(template("shopping-template", "barbecue"), {
      now: NOW,
      ownerId: OWNER,
      listId: "list-1",
    });
    apply(payloads);

    const view = buildShoppingList(state, { listId: "list-1", now: NOW });
    const names = view.groups.flatMap((group) => group.lines.map((line) => line.name));

    expect(names).toContain("Charcoal");
    expect(names).toContain("Bread rolls");
    expect(view.openCount).toBe(payloads.length);
    expect(view.groups.map((group) => group.key)).toContain("bakery");
  });

  it("uses the canonical item key, so a seeded line and a typed one are the same thing", () => {
    const payloads = instantiateTemplate(template("shopping-template", "weekly-shop"), {
      now: NOW,
      ownerId: OWNER,
      listId: "list-1",
    });

    const milk = payloads.find((payload) => payload.localId.endsWith("milk"));
    expect(milk?.fields["itemKey"]).toBe("milk");
    expect(milk?.fields["checked"]).toBe(false);
  });

  it("leaves the list out when the caller has not chosen one yet", () => {
    const payloads = instantiateTemplate(template("shopping-template", "holiday-shop"), {
      now: NOW,
      ownerId: OWNER,
    });

    expect(payloads[0]?.fields["listId"]).toBeUndefined();
  });

  it("only ever produces shopping items", () => {
    for (const list of SHOPPING_TEMPLATES) {
      const payloads = instantiateTemplate(list, { now: NOW, ownerId: OWNER, listId: "list-1" });
      expect(payloads.every((payload) => payload.entityType === EntityTypes.shoppingItem)).toBe(true);
    }
  });
});

describe("every template can be instantiated", () => {
  it("produces at least one payload with a non-empty entity type and id", () => {
    for (const entry of allTemplates()) {
      const payloads = instantiateTemplate(entry, { now: NOW, ownerId: OWNER, listId: "list-1" });

      expect(payloads.length).toBeGreaterThan(0);
      for (const payload of payloads) {
        expect(payload.entityType.length).toBeGreaterThan(0);
        expect(payload.localId.length).toBeGreaterThan(0);
        expect(Object.keys(payload.fields).length).toBeGreaterThan(0);
      }
    }
  });

  it("never produces two payloads with the same id across the whole catalogue", () => {
    const ids = allTemplates().flatMap((entry) =>
      instantiateTemplate(entry, { now: NOW, ownerId: OWNER, listId: "list-1" }).map((payload) => payload.localId),
    );

    expect(new Set(ids).size).toBe(ids.length);
  });
});
