import { beforeEach, describe, expect, it } from "vitest";
import {
  DAY_MS,
  EntityTypes,
  FamilyState,
  WEEK_MS,
  activeLeadStage,
  approvalOutcome,
  blockers,
  completionOutcome,
  delegationState,
  dueMoment,
  effectiveOwner,
  escalationTarget,
  isAbsent,
  isBlocked,
  leadStages,
  makeOperation,
  newId,
  nextOccurrence,
  overdueTasks,
  readTask,
  responsibleOwner,
  rotationOccurrenceIndex,
  rotationOwner,
  rotationPlan,
  starBalance,
  tasksAwaitingApproval,
  type Operation,
  type Task,
  type Value,
} from "@fam/domain";

/** A Saturday, so weekly rotations and schedules read the way a family would. */
const START = Date.parse("2026-08-01T00:00:00Z");
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

function seedTask(id: string, fields: Record<string, Value>): Task {
  state.apply(op("entity.create", EntityTypes.task, id, { title: id, ...fields }));
  return readTask(state, id)!;
}

function seedMember(personId: string, role: string, absences: readonly { from: number; to: number }[] = []): void {
  state.apply(
    op("entity.create", EntityTypes.membership, "m-" + personId, {
      personId,
      role,
      absences: absences.map((absence) => ({ from: absence.from, to: absence.to })),
    }),
  );
}

beforeEach(() => {
  state = new FamilyState();
});

describe("reading a task", () => {
  it("carries owner, definition of done and effort as first-class fields (FR-301, FR-303, FR-309)", () => {
    const task = seedTask("t-1", {
      title: "Wash the swimming kit",
      definitionOfDone: "Kit dry and back in the bag",
      ownerId: "p-mum",
      dueAt: START,
      effortMinutes: 20,
      area: "basement",
    });

    expect(task.ownerId).toBe("p-mum");
    expect(task.definitionOfDone).toBe("Kit dry and back in the bag");
    expect(task.effortMinutes).toBe(20);
    expect(task.area).toBe("basement");
  });

  it("supports due dates, time windows and someday tasks (FR-304)", () => {
    const due = seedTask("t-due", { dueAt: START });
    const windowed = seedTask("t-window", { windowStartsAt: START, windowEndsAt: START + 2 * DAY_MS });
    const someday = seedTask("t-someday", {});

    expect(due.scheduling).toEqual({ kind: "due", dueAt: START });
    expect(windowed.scheduling).toEqual({ kind: "window", startsAt: START, endsAt: START + 2 * DAY_MS });
    expect(someday.scheduling).toEqual({ kind: "someday" });
    expect(dueMoment(someday)).toBeUndefined();
    expect(dueMoment(windowed)).toBe(START + 2 * DAY_MS);
  });

  it("reads subtasks and dependencies (FR-307, FR-308)", () => {
    const task = seedTask("t-2", {
      subtasks: [
        { id: "s-1", title: "Find the form", done: true },
        { id: "s-2", title: "Sign it", done: false },
      ],
      blockedBy: ["t-1"],
    });

    expect(task.subtasks.map((sub) => sub.done)).toEqual([true, false]);
    expect(task.blockedByTaskIds).toEqual(["t-1"]);
  });

  it("returns nothing for a deleted task", () => {
    seedTask("t-3", { ownerId: "p-mum" });
    state.apply(op("entity.delete", EntityTypes.task, "t-3", {}));

    expect(readTask(state, "t-3")).toBeUndefined();
    expect(readTask(state, "never-existed")).toBeUndefined();
  });
});

describe("recurrence in both modes (FR-305)", () => {
  it("keeps the grid when a scheduled task is completed late", () => {
    const task = seedTask("t-bins", { dueAt: START, recurrenceMode: "schedule", recurrenceEvery: 1, recurrenceUnit: "week" });

    expect(nextOccurrence(task, START + 3 * DAY_MS)).toBe(START + WEEK_MS);
  });

  it("slides with the actual completion when the interval is what matters", () => {
    const task = seedTask("t-sheets", { dueAt: START, recurrenceMode: "interval", recurrenceEvery: 1, recurrenceUnit: "week" });

    expect(nextOccurrence(task, START + 3 * DAY_MS)).toBe(START + 3 * DAY_MS + WEEK_MS);
  });

  it("makes the two modes diverge by exactly the lateness", () => {
    const scheduled = seedTask("t-a", { dueAt: START, recurrenceMode: "schedule", recurrenceEvery: 1, recurrenceUnit: "week" });
    const interval = seedTask("t-b", { dueAt: START, recurrenceMode: "interval", recurrenceEvery: 1, recurrenceUnit: "week" });
    const lateBy = 3 * DAY_MS;

    const scheduledNext = nextOccurrence(scheduled, START + lateBy)!;
    const intervalNext = nextOccurrence(interval, START + lateBy)!;

    expect(intervalNext - scheduledNext).toBe(lateBy);
  });

  it("skips several missed slots and lands back on the grid", () => {
    const task = seedTask("t-c", { dueAt: START, recurrenceMode: "schedule", recurrenceEvery: 1, recurrenceUnit: "week" });

    expect(nextOccurrence(task, START + 20 * DAY_MS)).toBe(START + 3 * WEEK_MS);
  });

  it("does not hand back the occurrence that was just completed early", () => {
    const task = seedTask("t-d", { dueAt: START, recurrenceMode: "schedule", recurrenceEvery: 1, recurrenceUnit: "week" });

    expect(nextOccurrence(task, START - 2 * DAY_MS)).toBe(START + WEEK_MS);
  });

  it("clamps a monthly schedule to a short month instead of jumping into March", () => {
    const january31 = Date.UTC(2026, 0, 31);
    const task = seedTask("t-e", { dueAt: january31, recurrenceMode: "schedule", recurrenceEvery: 1, recurrenceUnit: "month" });

    expect(nextOccurrence(task, january31)).toBe(Date.UTC(2026, 1, 28));
  });

  it("handles yearly intervals with real calendar arithmetic (FR-320)", () => {
    const task = seedTask("t-f", { dueAt: START, recurrenceMode: "interval", recurrenceEvery: 1, recurrenceUnit: "year" });

    expect(nextOccurrence(task, Date.UTC(2026, 7, 1))).toBe(Date.UTC(2027, 7, 1));
  });

  it("says nothing for a one-off task", () => {
    const task = seedTask("t-g", { dueAt: START });

    expect(nextOccurrence(task, START)).toBeUndefined();
  });

  it("falls back to the completion for a someday task that recurs by schedule", () => {
    const task = seedTask("t-h", { recurrenceMode: "schedule", recurrenceEvery: 2, recurrenceUnit: "day" });

    expect(nextOccurrence(task, START)).toBe(START + 2 * DAY_MS);
  });
});

describe("rotation (FR-306)", () => {
  const rotationFields = {
    rotationMemberIds: ["p-a", "p-b", "p-c"],
    rotationPeriod: "weekly",
    rotationStartsAt: START,
  };

  it("passes the turn on by occurrence", () => {
    const task = seedTask("t-rot", rotationFields);

    expect([0, 1, 2, 3].map((index) => rotationOwner(task, index))).toEqual(["p-a", "p-b", "p-c", "p-a"]);
  });

  it("derives the occurrence from the date, weekly and monthly", () => {
    const weekly = seedTask("t-rot-w", rotationFields);
    const monthly = seedTask("t-rot-m", {
      rotationMemberIds: ["p-a", "p-b"],
      rotationPeriod: "monthly",
      rotationStartsAt: Date.UTC(2026, 0, 15),
    });

    expect(rotationOccurrenceIndex(weekly, START + 15 * DAY_MS)).toBe(2);
    expect(rotationOccurrenceIndex(monthly, Date.UTC(2026, 2, 14))).toBe(1);
    expect(rotationOccurrenceIndex(monthly, Date.UTC(2026, 2, 16))).toBe(2);
  });

  it("skips an absent person and passes the task to the next in line (FR-110, FR-311)", () => {
    const task = seedTask("t-rot-abs", rotationFields);

    expect(rotationOwner(task, 1, ["p-b"])).toBe("p-c");
    expect(rotationOwner(task, 1, ["p-b", "p-c"])).toBe("p-a");
  });

  it("still names someone when the whole rotation is away, rather than opening an anonymous pool (P-02)", () => {
    const task = seedTask("t-rot-all", rotationFields);

    expect(rotationOwner(task, 1, ["p-a", "p-b", "p-c"])).toBe("p-b");
  });

  it("shows the plan, including who a slot would have gone to (FR-306)", () => {
    seedMember("p-a", "adult");
    seedMember("p-b", "adult", [{ from: START + 7 * DAY_MS, to: START + 12 * DAY_MS }]);
    seedMember("p-c", "adult");
    const task = seedTask("t-rot-plan", rotationFields);

    const plan = rotationPlan(state, task, START, 3);

    expect(plan.map((slot) => slot.ownerId)).toEqual(["p-a", "p-c", "p-c"]);
    expect(plan[1]?.insteadOfId).toBe("p-b");
    expect(plan[0]?.insteadOfId).toBeUndefined();
    expect(plan[1]?.startsAt).toBe(START + WEEK_MS);
  });

  it("reports the absence skip as the reason for the current owner", () => {
    seedMember("p-b", "adult", [{ from: START + 7 * DAY_MS, to: START + 12 * DAY_MS }]);
    const task = seedTask("t-rot-eff", rotationFields);

    const ownership = effectiveOwner(state, task, START + 8 * DAY_MS);

    expect(ownership).toEqual({
      personId: "p-c",
      source: "rotation-absence",
      needsAcceptance: false,
      skippedPersonIds: ["p-b"],
    });
  });

  it("has no rotation owner when nobody is in the rotation", () => {
    const task = seedTask("t-rot-empty", { ownerId: "p-mum", dueAt: START });

    expect(rotationOwner(task, 0)).toBeUndefined();
    expect(rotationPlan(state, task, START, 3)).toEqual([]);
  });
});

describe("delegation requires acceptance (FR-310)", () => {
  it("leaves the task where it was while the offer is open", () => {
    const task = seedTask("t-del", { ownerId: "p-mum", dueAt: START, delegatedToId: "p-dad", delegatedById: "p-mum" });

    expect(delegationState(task)).toBe("offered");
    expect(responsibleOwner(task)).toBe("p-mum");
    expect(effectiveOwner(state, task, START)).toMatchObject({ personId: "p-mum", needsAcceptance: true });
  });

  it("moves it only once the other person said yes", () => {
    const task = seedTask("t-del-ok", {
      ownerId: "p-mum",
      dueAt: START,
      delegatedToId: "p-dad",
      delegatedById: "p-mum",
      delegationResponse: "accepted",
      delegationRespondedAt: START,
    });

    expect(delegationState(task)).toBe("accepted");
    expect(responsibleOwner(task)).toBe("p-dad");
    expect(effectiveOwner(state, task, START)).toMatchObject({ personId: "p-dad", source: "delegate" });
  });

  it("returns a declined delegation to the delegating owner", () => {
    const task = seedTask("t-del-no", {
      ownerId: "p-mum",
      dueAt: START,
      delegatedToId: "p-dad",
      delegatedById: "p-mum",
      delegationResponse: "declined",
      delegationRespondedAt: START,
    });

    expect(delegationState(task)).toBe("declined");
    expect(responsibleOwner(task)).toBe("p-mum");
    expect(effectiveOwner(state, task, START)).toMatchObject({ personId: "p-mum", source: "owner" });
  });

  it("has no delegation state when nobody was asked", () => {
    expect(delegationState(seedTask("t-del-none", { ownerId: "p-mum" }))).toBe("none");
  });
});

describe("absence handover (FR-110, FR-311)", () => {
  it("keeps an absent owner's task with them until somebody accepts it", () => {
    seedMember("p-mum", "adult", [{ from: START, to: START + 5 * DAY_MS }]);
    const task = seedTask("t-abs", { ownerId: "p-mum", dueAt: START + DAY_MS });

    expect(isAbsent(state, "p-mum", START + DAY_MS)).toBe(true);
    expect(effectiveOwner(state, task, START + DAY_MS)).toEqual({
      personId: "p-mum",
      source: "handover-pending",
      needsAcceptance: true,
      skippedPersonIds: [],
    });
  });

  it("goes back to the plain owner once the absence is over", () => {
    seedMember("p-mum", "adult", [{ from: START, to: START + 5 * DAY_MS }]);
    const task = seedTask("t-abs-2", { ownerId: "p-mum", dueAt: START + 9 * DAY_MS });

    expect(effectiveOwner(state, task, START + 9 * DAY_MS)).toMatchObject({ source: "owner", needsAcceptance: false });
  });

  it("flags an ownerless task instead of picking somebody", () => {
    const task = seedTask("t-abs-3", { dueAt: START });

    expect(effectiveOwner(state, task, START)).toMatchObject({ personId: undefined, source: "none", needsAcceptance: true });
  });
});

describe("children's tasks are approved, not simply ticked (FR-312)", () => {
  beforeEach(() => {
    seedMember("p-kid", "child");
    seedMember("p-mum", "adult");
    seedMember("p-sib", "child");
  });

  it("turns the child's tick into a request for confirmation", () => {
    const task = seedTask("t-kid", { ownerId: "p-kid", dueAt: START, rewardStars: 2 });

    expect(task.requiresApproval).toBe(true);
    expect(completionOutcome(state, task, "p-kid")).toBe("awaiting-approval");
  });

  it("lets a parent confirm it", () => {
    const task = seedTask("t-kid-2", { ownerId: "p-kid", dueAt: START, state: "awaiting-approval" });

    expect(approvalOutcome(state, task, "p-mum")).toBe("done");
    expect(tasksAwaitingApproval(state).map((item) => item.id)).toEqual(["t-kid-2"]);
  });

  it("does not let a sibling confirm it", () => {
    const task = seedTask("t-kid-3", { ownerId: "p-kid", dueAt: START, state: "awaiting-approval" });

    expect(approvalOutcome(state, task, "p-sib")).toBe("awaiting-approval");
  });

  it("finishes the same task outright when the parent does it themselves", () => {
    const task = seedTask("t-kid-4", { ownerId: "p-kid", dueAt: START });

    expect(completionOutcome(state, task, "p-mum")).toBe("done");
  });

  it("does not gate an adult's own task", () => {
    const task = seedTask("t-adult", { ownerId: "p-mum", dueAt: START });

    expect(task.requiresApproval).toBe(false);
    expect(completionOutcome(state, task, "p-mum")).toBe("done");
  });

  it("leaves an already finished task alone", () => {
    const task = seedTask("t-kid-5", { ownerId: "p-kid", dueAt: START, state: "done" });

    expect(approvalOutcome(state, task, "p-mum")).toBe("done");
  });
});

describe("long lead times and deadlines (FR-320, FR-321)", () => {
  const due = START + 200 * DAY_MS;

  it("opens a yearly task weeks ahead", () => {
    const task = seedTask("t-tyres", { dueAt: due, recurrenceMode: "schedule", recurrenceEvery: 1, recurrenceUnit: "year" });

    expect(leadStages(task, START).map((stage) => stage.leadDays)).toEqual([42, 21, 11, 6]);
    expect(leadStages(task, START)[0]?.urgency).toBe("early");
  });

  it("never pushes a yearly task on the day it is due", () => {
    const task = seedTask("t-tyres-2", { dueAt: due, recurrenceMode: "schedule", recurrenceEvery: 1, recurrenceUnit: "year" });

    expect(leadStages(task, START).some((stage) => stage.leadDays === 0)).toBe(false);
    expect(leadStages(task, START).at(-1)?.at).toBeLessThan(due);
  });

  it("escalates: every stage is closer than the one before", () => {
    const task = seedTask("t-tyres-3", { dueAt: due, recurrenceMode: "schedule", recurrenceEvery: 1, recurrenceUnit: "year" });

    const leads = leadStages(task, START).map((stage) => stage.leadDays);

    expect(leads).toEqual([...leads].sort((a, b) => b - a));
    expect(new Set(leads).size).toBe(leads.length);
  });

  it("gives a shorter run-up to a monthly task than to a yearly one", () => {
    const yearly = seedTask("t-y", { dueAt: due, recurrenceMode: "schedule", recurrenceEvery: 1, recurrenceUnit: "year" });
    const monthly = seedTask("t-m", { dueAt: due, recurrenceMode: "schedule", recurrenceEvery: 1, recurrenceUnit: "month" });

    expect(leadStages(monthly, START)[0]?.leadDays).toBe(7);
    expect(leadStages(yearly, START)[0]?.leadDays).toBe(42);
  });

  it("ends a deadline task with a last call on the day, because the chance expires (FR-321)", () => {
    const task = seedTask("t-deadline", { dueAt: due, deadline: true, createdAt: due - 90 * DAY_MS });

    const stages = leadStages(task, START);

    expect(stages[0]?.leadDays).toBe(21);
    expect(stages.at(-1)).toMatchObject({ leadDays: 0, urgency: "final", at: due });
  });

  it("honours an explicit run-up on the task", () => {
    const task = seedTask("t-lead", { dueAt: due, leadDays: 60 });

    expect(leadStages(task, START).map((stage) => stage.leadDays)).toEqual([60, 30, 15, 8]);
  });

  it("keeps one usable warning for a task created after its early stages", () => {
    const task = seedTask("t-late", {
      dueAt: START + 5 * DAY_MS,
      createdAt: START,
      recurrenceMode: "schedule",
      recurrenceEvery: 1,
      recurrenceUnit: "year",
    });

    const stages = leadStages(task, START);

    expect(stages).toHaveLength(1);
    expect(stages[0]?.leadDays).toBe(6);
  });

  it("reports the stage a task is currently in", () => {
    const task = seedTask("t-active", { dueAt: due, recurrenceMode: "schedule", recurrenceEvery: 1, recurrenceUnit: "year" });

    expect(activeLeadStage(task, due - 10 * DAY_MS)?.leadDays).toBe(11);
    expect(activeLeadStage(task, due - 100 * DAY_MS)).toBeUndefined();
  });

  it("has nothing to escalate for a someday task", () => {
    expect(leadStages(seedTask("t-someday-lead", {}), START)).toEqual([]);
  });
});

describe("blockers (FR-308, FR-318)", () => {
  it("blocks on an unfinished dependency and clears when it is done", () => {
    seedTask("t-dep", { title: "Collect the key", dueAt: START });
    seedTask("t-main", { dueAt: START, blockedBy: ["t-dep"] });

    expect(isBlocked(state, "t-main")).toBe(true);
    expect(blockers(state, "t-main")[0]).toMatchObject({ kind: "task", refId: "t-dep", note: "Collect the key" });

    state.apply(op("entity.setFields", EntityTypes.task, "t-dep", { state: "done" }));

    expect(isBlocked(state, "t-main")).toBe(false);
  });

  it("names a missing part and clears it when the part has been bought", () => {
    state.apply(op("entity.create", EntityTypes.shoppingItem, "i-1", { name: "Door hinge", checked: false }));
    seedTask("t-fix", { dueAt: START, blockers: [{ kind: "shoppingItem", refId: "i-1", note: "Hinge missing" }] });

    expect(isBlocked(state, "t-fix")).toBe(true);

    state.apply(op("entity.setFields", EntityTypes.shoppingItem, "i-1", { checked: true }));

    expect(isBlocked(state, "t-fix")).toBe(false);
  });

  it("treats a missing contact as the blocker (FR-322)", () => {
    seedTask("t-plumber", { dueAt: START, blockers: [{ kind: "contact", refId: "c-1", note: "No plumber yet" }] });

    expect(isBlocked(state, "t-plumber")).toBe(true);

    state.apply(op("entity.create", EntityTypes.contact, "c-1", { name: "Schmidt" }));

    expect(isBlocked(state, "t-plumber")).toBe(false);
  });

  it("lets a free-text blocker be resolved by hand", () => {
    seedTask("t-note", { dueAt: START, blockers: [{ kind: "note", note: "Waiting for the neighbour" }] });
    expect(isBlocked(state, "t-note")).toBe(true);

    state.apply(
      op("entity.setFields", EntityTypes.task, "t-note", {
        blockers: [{ kind: "note", note: "Waiting for the neighbour", resolvedAt: START }],
      }),
    );

    expect(isBlocked(state, "t-note")).toBe(false);
  });

  it("does not wait forever on a dependency that was deleted", () => {
    seedTask("t-main-2", { dueAt: START, blockedBy: ["t-gone"] });

    expect(isBlocked(state, "t-main-2")).toBe(false);
  });

  it("is not blocked when nothing is in the way", () => {
    seedTask("t-clear", { dueAt: START });

    expect(blockers(state, "t-clear")).toEqual([]);
    expect(isBlocked(state, "t-clear")).toBe(false);
    expect(blockers(state, "t-missing")).toEqual([]);
  });
});

describe("overdue tasks escalate to the owner (FR-314)", () => {
  const now = START + 10 * DAY_MS;

  it("lists what is past its moment, earliest first", () => {
    seedTask("t-late-1", { ownerId: "p-mum", dueAt: START + 5 * DAY_MS });
    seedTask("t-late-2", { ownerId: "p-dad", dueAt: START + 2 * DAY_MS });
    seedTask("t-soon", { ownerId: "p-dad", dueAt: now + DAY_MS });

    expect(overdueTasks(state, now).map((entry) => entry.taskId)).toEqual(["t-late-2", "t-late-1"]);
    expect(overdueTasks(state, now)[0]?.overdueMs).toBe(8 * DAY_MS);
  });

  it("sends the escalation to the owner, never to whoever noticed", () => {
    const task = seedTask("t-esc", { ownerId: "p-mum", dueAt: START, noticedById: "p-dad" });

    expect(escalationTarget(task)).toBe("p-mum");
    expect(overdueTasks(state, now)[0]?.escalateToId).toBe("p-mum");
  });

  it("follows an accepted delegation, because the delegate is now the owner", () => {
    const task = seedTask("t-esc-2", {
      ownerId: "p-mum",
      dueAt: START,
      delegatedToId: "p-dad",
      delegatedById: "p-mum",
      delegationResponse: "accepted",
    });

    expect(escalationTarget(task)).toBe("p-dad");
  });

  it("does not chase the child for a task that is waiting on a parent", () => {
    seedTask("t-wait", { ownerId: "p-kid", dueAt: START, state: "awaiting-approval" });

    expect(overdueTasks(state, now)).toEqual([]);
  });

  it("never makes a someday task late (FR-304)", () => {
    seedTask("t-idle", { ownerId: "p-mum" });

    expect(overdueTasks(state, now)).toEqual([]);
  });

  it("says when an overdue task is stuck rather than ignored", () => {
    seedTask("t-block-dep", { dueAt: START });
    seedTask("t-blocked", { ownerId: "p-mum", dueAt: START, blockedBy: ["t-block-dep"] });

    expect(overdueTasks(state, now).find((entry) => entry.taskId === "t-blocked")?.blocked).toBe(true);
  });

  it("has nothing to report in an empty family", () => {
    expect(overdueTasks(state, now)).toEqual([]);
  });
});

describe("stars are a tally and nothing else (FR-323, decision 22)", () => {
  it("adds up what a child actually completed", () => {
    seedTask("t-star-1", {
      ownerId: "p-kid",
      dueAt: START,
      rewardStars: 2,
      completions: [
        { at: START, byId: "p-kid", stars: 2 },
        { at: START + 7 * DAY_MS, byId: "p-kid", stars: 2 },
      ],
    });

    expect(starBalance(state, "p-kid")).toBe(4);
  });

  it("counts a finished task that predates the log exactly once", () => {
    seedTask("t-star-2", { ownerId: "p-kid", dueAt: START, rewardStars: 3, state: "done" });

    expect(starBalance(state, "p-kid")).toBe(3);
  });

  it("falls back to the task's own star value when a log line does not carry one", () => {
    seedTask("t-star-3", { ownerId: "p-kid", dueAt: START, rewardStars: 5, completions: [{ at: START, byId: "p-kid" }] });

    expect(starBalance(state, "p-kid")).toBe(5);
  });

  it("gives nothing for an unfinished task, and nothing in an empty family", () => {
    seedTask("t-star-4", { ownerId: "p-kid", dueAt: START, rewardStars: 4 });

    expect(starBalance(state, "p-kid")).toBe(0);
    expect(starBalance(state, "p-nobody")).toBe(0);
  });
});
