/**
 * Selector tests for the screens added after the first five.
 *
 * Same rule as `commands.test.ts`: the screens hold no logic, so everything
 * worth asserting is in here — what cook mode scales to, what a routine's
 * sequence looks like after a child taps it, and above all what the privacy
 * screen promises before it deletes anything.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { EntityTypes, readOptionalString, readString } from "@fam/domain";
import { MemoryStateStore } from "@fam/storage";
import { ReferenceServer, SyncClient } from "@fam/sync";
import {
  addFamilyMember,
  chooseStartArea,
  eraseFamilyData,
  erasePersonalData,
  grantConsent,
  noteAfterCooking,
  revokeConsent,
  setRoutineStepDone,
} from "../src/commands.js";
import {
  describeTimers,
  formatDuration,
  routineIcon,
  selectCookMode,
  selectErasurePreview,
  selectFamilyErasure,
  selectPrivacy,
  selectRoutine,
} from "../src/selectors.js";

const FAMILY = "fam-1";
const NOW = Date.parse("2026-07-28T08:00:00Z");

let server: ReferenceServer;
let client: SyncClient;
let clock: number;

beforeEach(async () => {
  clock = 1_700_000_000_000;
  server = new ReferenceServer({ families: [FAMILY] });
  client = new SyncClient({
    familyId: FAMILY,
    deviceId: "kitchen-tablet",
    store: new MemoryStateStore(),
    transport: server,
    now: () => (clock += 1000),
  });
  await client.open();
  client.setActor("person-mum");
  await client.mutate((b) => {
    b.create(EntityTypes.family, FAMILY, { name: "Müller", learningEnabled: true });
  });
});

const mutate = (describe: Parameters<SyncClient["mutate"]>[0]) => client.mutate(describe);

describe("cook mode (SPEC §8.3)", () => {
  beforeEach(async () => {
    await mutate((b) => {
      b.create(EntityTypes.recipe, "recipe-chili", {
        title: "Chili",
        servings: 4,
        ingredients: [
          { name: "Beans", amount: 400, unit: "g" },
          { name: "Chili", amount: 1, unit: "", note: "finely chopped" },
          { name: "Salt" },
        ],
        steps: [
          { text: "Fry the onions", minutes: 5 },
          { text: "Let it simmer", minutes: 30 },
          { text: "Season" },
        ],
      });
    });
  });

  it("scales the ingredients to who is actually eating (FR-514, FR-603)", () => {
    const view = selectCookMode(client.state(), { recipeId: "recipe-chili", eaters: 2 });

    expect(view.ingredients[0]?.label).toBe("200 g Beans");
    expect(view.servings).toBe(2);
  });

  it("leaves a quantity-less ingredient as its bare name (FR-512)", () => {
    const view = selectCookMode(client.state(), { recipeId: "recipe-chili" });

    expect(view.ingredients[2]?.label).toBe("Salt");
    expect(view.ingredients[1]?.note).toBe("finely chopped");
  });

  it("carries each step's own duration, so a timer starts from the step (FR-529)", () => {
    const steps = selectCookMode(client.state(), { recipeId: "recipe-chili" }).steps;

    expect(steps.map((step) => step.minutes)).toEqual([5, 30, undefined]);
  });

  it("accepts steps written as plain strings, which is what an import produces", async () => {
    await mutate((b) => b.create(EntityTypes.recipe, "recipe-toast", { title: "Toast", steps: ["Toast it"] }));

    const view = selectCookMode(client.state(), { recipeId: "recipe-toast" });
    expect(view.steps).toEqual([{ index: 0, text: "Toast it", minutes: undefined }]);
  });

  it("keeps the note for next time on the recipe (FR-536)", async () => {
    await noteAfterCooking(mutate, { recipeId: "recipe-chili", note: " Ten minutes shorter ", at: NOW });

    expect(selectCookMode(client.state(), { recipeId: "recipe-chili" }).note).toBe("Ten minutes shorter");
  });

  it("counts several timers down at once and puts the next one first (FR-529)", () => {
    const view = describeTimers(
      [
        { id: "b", label: "Simmer", endsAt: NOW + 300_000 },
        { id: "a", label: "Onions", endsAt: NOW + 60_000 },
      ],
      NOW,
    );

    expect(view.map((timer) => timer.id)).toEqual(["a", "b"]);
    expect(view[0]?.remainingLabel).toBe("1:00");
    expect(view.every((timer) => !timer.done)).toBe(true);
  });

  it("reports an expired timer as done rather than as a negative number", () => {
    const [timer] = describeTimers([{ id: "a", label: "Onions", endsAt: NOW - 5000 }], NOW);

    expect(timer?.done).toBe(true);
    expect(timer?.remainingLabel).toBe("0:00");
  });

  it("formats a countdown the way a cook glances at it", () => {
    expect(formatDuration(90_000)).toBe("1:30");
    expect(formatDuration(0)).toBe("0:00");
  });
});

describe("a child's routine (FR-1207)", () => {
  beforeEach(async () => {
    await mutate((b) => {
      b.create(EntityTypes.task, "task-morning", {
        title: "Morning",
        ownerId: "person-kid",
        effortMinutes: 10,
        subtasks: [
          { id: "s1", title: "Brush your teeth", done: false },
          { id: "s2", title: "Get dressed", done: false },
        ],
      });
    });
  });

  it("gives every step a picture even when the routine carries none (FR-103)", () => {
    const view = selectRoutine(client.state(), "task-morning");

    expect(view?.steps.map((step) => step.icon)).toEqual(["toothbrush", "shirt"]);
  });

  it("prefers the picture the routine itself carries", async () => {
    await mutate((b) =>
      b.set(EntityTypes.task, "task-morning", {
        subtasks: [{ id: "s1", title: "Brush your teeth", icon: "star", done: false }],
      }),
    );

    expect(selectRoutine(client.state(), "task-morning")?.steps[0]?.icon).toBe("star");
  });

  it("falls back to a neutral picture for a step nothing matches", () => {
    expect(routineIcon("Feed the goldfish")).toBe("circle");
  });

  it("ticks one step off without disturbing the others", async () => {
    const before = selectRoutine(client.state(), "task-morning");
    await setRoutineStepDone(mutate, {
      taskId: "task-morning",
      steps: before?.steps ?? [],
      stepId: "s2",
      done: true,
    });

    const after = selectRoutine(client.state(), "task-morning");
    expect(after?.steps.map((step) => step.done)).toEqual([false, true]);
    expect(after?.doneCount).toBe(1);
    expect(after?.percent).toBe(50);
    expect(after?.complete).toBe(false);
  });

  it("reports completion without closing the task, because a child's task needs approval (FR-312)", async () => {
    for (const stepId of ["s1", "s2"]) {
      const view = selectRoutine(client.state(), "task-morning");
      await setRoutineStepDone(mutate, { taskId: "task-morning", steps: view?.steps ?? [], stepId, done: true });
    }

    expect(selectRoutine(client.state(), "task-morning")?.complete).toBe(true);
    expect(readString(client.state().get(EntityTypes.task, "task-morning"), "state")).toBe("");
  });

  it("has nothing to show for a task that is gone", async () => {
    await mutate((b) => b.delete(EntityTypes.task, "task-morning"));

    expect(selectRoutine(client.state(), "task-morning")).toBeUndefined();
  });
});

describe("onboarding (SPEC §4.5)", () => {
  it("creates the person and the membership together (FR-124, FR-105)", async () => {
    const personId = await addFamilyMember(mutate, { familyId: FAMILY, name: " Mia ", role: "child" });

    expect(readString(client.state().get(EntityTypes.person, personId), "name")).toBe("Mia");
    const membership = client.state().all(EntityTypes.membership)[0];
    expect(readString(membership, "personId")).toBe(personId);
    expect(readString(membership, "role")).toBe("child");
  });

  it("switches on exactly the area that was chosen (FR-125)", async () => {
    await chooseStartArea(mutate, { familyId: FAMILY, area: "food" });

    expect(readString(client.state().get(EntityTypes.family, FAMILY), "activeArea")).toBe("food");
  });
});

describe("the privacy screen (SPEC §17.2)", () => {
  beforeEach(async () => {
    await mutate((b) => {
      b.create(EntityTypes.person, "person-mum", { name: "Mum" });
      b.create(EntityTypes.membership, "m-mum", { familyId: FAMILY, personId: "person-mum", role: "adult" });
      b.create(EntityTypes.membership, "m-dad", { familyId: FAMILY, personId: "person-dad", role: "adult" });
      b.create(EntityTypes.event, "event-swim", { title: "Swimming", bringOwnerId: "person-mum" });
      b.create(EntityTypes.catalogItem, "milk", { name: "Milk" });
    });
  });

  it("hands out everything held about the person, machine-readable (FR-1411, FR-1412)", () => {
    const view = selectPrivacy(client.state(), "person-mum", "2026-07-28T08:00:00.000Z");

    expect(view.exportEntryCount).toBeGreaterThan(0);
    expect(JSON.parse(view.exportJson)).toMatchObject({ subjectId: "person-mum" });
    // The shared event is in the bundle, and says why it is there (FR-1417a).
    expect(view.exportNotes.length).toBe(1);
  });

  it("shows what erasure will do before it does it (FR-1414)", () => {
    const preview = selectErasurePreview(client.state(), "person-mum");

    expect(preview.deletes).toBeGreaterThan(0);
    expect(preview.clears).toBe(1);
    expect(preview.deletesWholeFamily).toBe(false);
    expect(preview.anonymizeAuthorship).toBe(true);
  });

  it("keeps the shared entry and only drops the name on it (FR-1417a)", async () => {
    const preview = selectErasurePreview(client.state(), "person-mum");
    await erasePersonalData(mutate, preview.plan);

    const event = client.state().get(EntityTypes.event, "event-swim");
    expect(event?.deleted).toBe(false);
    expect(readString(event, "title")).toBe("Swimming");
    expect(readOptionalString(event, "bringOwnerId")).toBeUndefined();
    expect(client.state().get(EntityTypes.person, "person-mum")?.deleted).toBe(true);
  });

  it("says so when the person leaving is the last adult (FR-1417a)", async () => {
    await mutate((b) => b.delete(EntityTypes.membership, "m-dad"));

    expect(selectErasurePreview(client.state(), "person-mum").deletesWholeFamily).toBe(true);
  });

  it("grants and withdraws the health consent with the same one tap (FR-1407, FR-1408)", async () => {
    const at = "2026-07-28T08:00:00.000Z";
    const consentId = await grantConsent(mutate, {
      personId: "person-mum",
      subject: "health",
      policyVersion: "1.0",
      at,
    });

    expect(selectPrivacy(client.state(), "person-mum", at).healthConsentGranted).toBe(true);

    await revokeConsent(mutate, { consentIds: [consentId], at: "2026-07-29T08:00:00.000Z" });
    const after = selectPrivacy(client.state(), "person-mum", at);

    expect(after.healthConsentGranted).toBe(false);
    // The record itself survives — it is the evidence (FR-1410).
    expect(readString(client.state().get(EntityTypes.consent, consentId), "grantedAt")).toBe(at);
  });

  it("deletes the whole family from inside the app (FR-1415)", async () => {
    await eraseFamilyData(mutate, selectFamilyErasure(client.state()));

    expect(selectFamilyErasure(client.state())).toEqual([]);
  });
});
