import { beforeEach, describe, expect, it } from "vitest";
import {
  DAY_MS,
  EntityTypes,
  FamilyState,
  POLL_ENTITY_TYPE,
  completionLog,
  distribution,
  familyMeetingAgenda,
  loadSpike,
  makeOperation,
  newId,
  pollResult,
  readResponsibilityCard,
  unassignedCards,
  type Operation,
  type Value,
} from "@fam/domain";

const START = Date.parse("2026-08-01T00:00:00Z");
const WEEK = { from: START, to: START + 7 * DAY_MS };
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

function seedCard(id: string, fields: Record<string, Value>): void {
  state.apply(op("entity.create", EntityTypes.responsibilityCard, id, { title: id, ...fields }));
}

function seedTask(id: string, fields: Record<string, Value>): void {
  state.apply(op("entity.create", EntityTypes.task, id, { title: id, ...fields }));
}

function seedMember(personId: string, role: string): void {
  state.apply(op("entity.create", EntityTypes.membership, "m-" + personId, { personId, role }));
}

beforeEach(() => {
  state = new FamilyState();
});

describe("distribution (FR-403, FR-404)", () => {
  beforeEach(() => {
    seedCard("c-school", {
      ownerId: "p-mum",
      category: "school",
      kind: "everyday",
      effortMinutes: 30,
      recurrenceMode: "schedule",
      recurrenceEvery: 1,
      recurrenceUnit: "week",
    });
    seedCard("c-checkups", {
      ownerId: "p-mum",
      category: "health",
      kind: "project",
      effortMinutes: 60,
      recurrenceMode: "schedule",
      recurrenceEvery: 1,
      recurrenceUnit: "month",
    });
    seedTask("t-forms", { ownerId: "p-mum", dueAt: START + DAY_MS, effortMinutes: 45, category: "school" });
    seedTask("t-bins", { ownerId: "p-dad", dueAt: START + 2 * DAY_MS, effortMinutes: 20, category: "house" });
    seedTask("t-someday", { ownerId: "p-dad", effortMinutes: 300, category: "house" });
  });

  it("counts the thinking work, not only the executable tasks (FR-402)", () => {
    const mum = distribution(state, WEEK).perPerson.find((person) => person.personId === "p-mum");

    expect(mum?.cards).toEqual({ count: 2, effortMinutes: 44 });
    expect(mum?.tasks).toEqual({ count: 1, effortMinutes: 45 });
    expect(mum?.totals).toEqual({ count: 3, effortMinutes: 89 });
  });

  it("separates everyday work from projects (FR-404)", () => {
    const mum = distribution(state, WEEK).perPerson.find((person) => person.personId === "p-mum");

    expect(mum?.everyday).toEqual({ count: 2, effortMinutes: 75 });
    expect(mum?.project).toEqual({ count: 1, effortMinutes: 14 });
  });

  it("breaks the load down by category", () => {
    const mum = distribution(state, WEEK).perPerson.find((person) => person.personId === "p-mum");

    expect(mum?.byCategory).toEqual([
      { category: "health", totals: { count: 1, effortMinutes: 14 } },
      { category: "school", totals: { count: 2, effortMinutes: 75 } },
    ]);
  });

  it("leaves a someday task out of every period", () => {
    const dad = distribution(state, WEEK).perPerson.find((person) => person.personId === "p-dad");

    expect(dad?.totals).toEqual({ count: 1, effortMinutes: 20 });
  });

  it("lists people in id order, which is not a ranking (§1.3)", () => {
    expect(distribution(state, WEEK).perPerson.map((person) => person.personId)).toEqual(["p-dad", "p-mum"]);
  });
});

describe("card load over a period", () => {
  it("prorates a recurring card, so a weekly duty weighs four times as much in a month", () => {
    seedCard("c-wash", {
      ownerId: "p-mum",
      effortMinutes: 30,
      recurrenceMode: "schedule",
      recurrenceEvery: 1,
      recurrenceUnit: "week",
    });

    const week = distribution(state, WEEK).perPerson[0];
    const month = distribution(state, { from: START, to: START + 28 * DAY_MS }).perPerson[0];

    expect(week?.cards.effortMinutes).toBe(30);
    expect(month?.cards.effortMinutes).toBe(120);
  });

  it("counts a rare responsibility as one responsibility, however little time it takes", () => {
    seedCard("c-insurance", {
      ownerId: "p-mum",
      effortMinutes: 120,
      recurrenceMode: "schedule",
      recurrenceEvery: 1,
      recurrenceUnit: "year",
    });

    const week = distribution(state, WEEK).perPerson[0];

    expect(week?.cards.count).toBe(1);
    expect(week?.cards.effortMinutes).toBe(2);
  });

  it("takes a standing card without a rhythm at face value", () => {
    seedCard("c-standing", { ownerId: "p-mum", effortMinutes: 15 });

    expect(distribution(state, WEEK).perPerson[0]?.cards.effortMinutes).toBe(15);
  });

  it("moves a task's load to the person who accepted it (FR-310)", () => {
    seedTask("t-del", {
      ownerId: "p-mum",
      dueAt: START,
      effortMinutes: 40,
      delegatedToId: "p-dad",
      delegatedById: "p-mum",
      delegationResponse: "accepted",
    });

    expect(distribution(state, WEEK).perPerson.map((person) => person.personId)).toEqual(["p-dad"]);
  });
});

describe("the anonymous pool has to be visible so it can be empty (SC-011, P-02)", () => {
  it("collects cards nobody has taken", () => {
    seedCard("c-orphan", { category: "house", effortMinutes: 20 });
    seedCard("c-owned", { ownerId: "p-mum", effortMinutes: 20 });

    expect(unassignedCards(state).map((card) => card.id)).toEqual(["c-orphan"]);
    expect(distribution(state, WEEK).unassigned).toEqual({ count: 1, effortMinutes: 20 });
  });

  it("is empty when every responsibility has a name on it", () => {
    seedCard("c-owned", { ownerId: "p-mum", effortMinutes: 20 });

    expect(unassignedCards(state)).toEqual([]);
    expect(distribution(state, WEEK).unassigned).toEqual({ count: 0, effortMinutes: 0 });
  });

  it("reports nothing at all for a family that has not started (empty state)", () => {
    expect(distribution(state, WEEK)).toEqual({
      from: WEEK.from,
      to: WEEK.to,
      perPerson: [],
      unassigned: { count: 0, effortMinutes: 0 },
      totalEffortMinutes: 0,
    });
  });

  it("reads a card with its negotiation history (FR-407)", () => {
    seedCard("c-history", {
      ownerId: "p-dad",
      createdAt: START,
      negotiations: [
        { at: START + DAY_MS, byId: "p-mum", fromOwnerId: "p-mum", toOwnerId: "p-dad", note: "swapped after the shift change" },
      ],
    });

    const card = readResponsibilityCard(state, "c-history");

    expect(card?.negotiations).toHaveLength(1);
    expect(card?.negotiations[0]?.fromOwnerId).toBe("p-mum");
    expect(readResponsibilityCard(state, "c-nothing")).toBeUndefined();
  });
});

describe("load-spike warning (FR-408)", () => {
  beforeEach(() => {
    seedMember("p-a", "adult");
    seedMember("p-b", "adult");
  });

  it("names the person carrying disproportionately much next week", () => {
    seedTask("t-1", { ownerId: "p-a", dueAt: START + DAY_MS, effortMinutes: 400 });
    seedTask("t-2", { ownerId: "p-b", dueAt: START + DAY_MS, effortMinutes: 100 });

    expect(loadSpike(state, WEEK)).toEqual([
      { personId: "p-a", effortMinutes: 400, share: 0.8, evenShare: 0.5, factor: 1.6 },
    ]);
  });

  it("stays quiet when the week is evenly shared", () => {
    seedTask("t-1", { ownerId: "p-a", dueAt: START + DAY_MS, effortMinutes: 300 });
    seedTask("t-2", { ownerId: "p-b", dueAt: START + DAY_MS, effortMinutes: 280 });

    expect(loadSpike(state, WEEK)).toEqual([]);
  });

  it("stays quiet on a light week even when the ratio is lopsided", () => {
    seedTask("t-1", { ownerId: "p-a", dueAt: START + DAY_MS, effortMinutes: 60 });
    seedTask("t-2", { ownerId: "p-b", dueAt: START + DAY_MS, effortMinutes: 10 });

    expect(loadSpike(state, WEEK)).toEqual([]);
  });

  it("says nothing in a one-adult household, where every share is the whole thing", () => {
    seedTask("t-1", { ownerId: "p-a", dueAt: START + DAY_MS, effortMinutes: 400 });
    state.apply(op("entity.delete", EntityTypes.membership, "m-p-b", {}));

    expect(loadSpike(state, WEEK)).toEqual([]);
  });

  it("measures the adults against each other; a child's chores are not a claim on this", () => {
    seedMember("p-kid", "child");
    seedTask("t-1", { ownerId: "p-a", dueAt: START + DAY_MS, effortMinutes: 400 });
    seedTask("t-2", { ownerId: "p-b", dueAt: START + DAY_MS, effortMinutes: 100 });
    seedTask("t-3", { ownerId: "p-kid", dueAt: START + DAY_MS, effortMinutes: 5000 });

    expect(loadSpike(state, WEEK).map((spike) => spike.personId)).toEqual(["p-a"]);
  });

  it("returns those over the line in id order — deliberately not a leaderboard (§1.3)", () => {
    seedMember("p-c", "adult");
    seedMember("p-d", "adult");
    seedTask("t-1", { ownerId: "p-a", dueAt: START + DAY_MS, effortMinutes: 400 });
    seedTask("t-2", { ownerId: "p-b", dueAt: START + DAY_MS, effortMinutes: 500 });
    seedTask("t-3", { ownerId: "p-c", dueAt: START + DAY_MS, effortMinutes: 50 });
    seedTask("t-4", { ownerId: "p-d", dueAt: START + DAY_MS, effortMinutes: 50 });

    expect(loadSpike(state, WEEK).map((spike) => spike.personId)).toEqual(["p-a", "p-b"]);
  });

  it("lets the family choose how lopsided is too lopsided", () => {
    seedTask("t-1", { ownerId: "p-a", dueAt: START + DAY_MS, effortMinutes: 400 });
    seedTask("t-2", { ownerId: "p-b", dueAt: START + DAY_MS, effortMinutes: 100 });

    expect(loadSpike(state, { ...WEEK, threshold: 1.9 })).toEqual([]);
    expect(loadSpike(state, { ...WEEK, threshold: 1.9, minimumMinutes: 10 })).toEqual([]);
    expect(loadSpike(state, { ...WEEK, threshold: 1.2 }).map((spike) => spike.personId)).toEqual(["p-a"]);
  });

  it("has nothing to warn about in an empty week", () => {
    expect(loadSpike(state, WEEK)).toEqual([]);
  });
});

describe("the family meeting prepares its own agenda (FR-405)", () => {
  const now = START + 3 * DAY_MS;

  beforeEach(() => {
    state.apply(op("entity.create", EntityTypes.family, "f-1", { lastMeetingAt: START }));
    seedMember("p-mum", "adult");
    seedMember("p-dad", "adult");
  });

  it("brings up what is new since the last meeting", () => {
    seedCard("c-new", { ownerId: "p-mum", createdAt: START + DAY_MS });
    seedCard("c-old", { ownerId: "p-mum", createdAt: START - 30 * DAY_MS });

    const agenda = familyMeetingAgenda(state, now);

    expect(agenda.since).toBe(START);
    expect(agenda.items.filter((item) => item.kind === "new-card").map((item) => item.cardId)).toEqual(["c-new"]);
  });

  it("brings up what was renegotiated and what is contested (FR-407)", () => {
    seedCard("c-renegotiated", {
      ownerId: "p-dad",
      createdAt: START - 30 * DAY_MS,
      negotiations: [{ at: START + DAY_MS, byId: "p-mum", note: "swapped" }],
    });
    seedCard("c-disputed", { ownerId: "p-mum", createdAt: START - 30 * DAY_MS, disputed: true });

    const kinds = familyMeetingAgenda(state, now).items.map((item) => item.kind);

    expect(kinds).toContain("renegotiated-card");
    expect(kinds).toContain("disputed-card");
  });

  it("brings up next week's load spike and whatever nobody has taken", () => {
    seedCard("c-orphan", { createdAt: START - 30 * DAY_MS });
    seedTask("t-1", { ownerId: "p-mum", dueAt: now + DAY_MS, effortMinutes: 400 });
    seedTask("t-2", { ownerId: "p-dad", dueAt: now + DAY_MS, effortMinutes: 50 });

    const agenda = familyMeetingAgenda(state, now);

    expect(agenda.items.find((item) => item.kind === "load-spike")?.personId).toBe("p-mum");
    expect(agenda.items.find((item) => item.kind === "unassigned-card")?.cardId).toBe("c-orphan");
  });

  it("treats every card as new before the first meeting (FR-128)", () => {
    state = new FamilyState();
    seedCard("c-1", { ownerId: "p-mum", createdAt: START - 30 * DAY_MS });

    const agenda = familyMeetingAgenda(state, now);

    expect(agenda.since).toBe(0);
    expect(agenda.items.map((item) => item.kind)).toEqual(["new-card"]);
  });

  it("has an empty agenda when nothing changed", () => {
    seedCard("c-settled", { ownerId: "p-mum", createdAt: START - 30 * DAY_MS });

    expect(familyMeetingAgenda(state, now).items).toEqual([]);
  });
});

describe("polls as a decision tool (FR-406)", () => {
  function seedPoll(votes: readonly { personId: string; optionId: string; at: number }[], closesAt?: number): void {
    state.apply(
      op("entity.create", POLL_ENTITY_TYPE, "poll-1", {
        question: "Where to go on holiday?",
        options: [
          { id: "o-sea", label: "Sea" },
          { id: "o-mountains", label: "Mountains" },
        ],
        votes: votes.map((vote) => ({ personId: vote.personId, optionId: vote.optionId, at: vote.at })),
        ...(closesAt === undefined ? {} : { closesAt }),
      }),
    );
  }

  it("counts plain votes", () => {
    seedPoll([
      { personId: "p-mum", optionId: "o-sea", at: START },
      { personId: "p-dad", optionId: "o-sea", at: START },
      { personId: "p-kid", optionId: "o-mountains", at: START },
    ]);

    const result = pollResult(state, "poll-1");

    expect(result?.tallies).toEqual([
      { optionId: "o-sea", label: "Sea", votes: 2, voterIds: ["p-dad", "p-mum"] },
      { optionId: "o-mountains", label: "Mountains", votes: 1, voterIds: ["p-kid"] },
    ]);
    expect(result?.voterCount).toBe(3);
    expect(result?.leadingOptionIds).toEqual(["o-sea"]);
  });

  it("lets a person change their mind, replacing their earlier vote", () => {
    seedPoll([
      { personId: "p-mum", optionId: "o-sea", at: START },
      { personId: "p-mum", optionId: "o-mountains", at: START + DAY_MS },
    ]);

    const result = pollResult(state, "poll-1");

    expect(result?.voterCount).toBe(1);
    expect(result?.leadingOptionIds).toEqual(["o-mountains"]);
  });

  it("reports a tie as a tie instead of breaking it", () => {
    seedPoll([
      { personId: "p-mum", optionId: "o-sea", at: START },
      { personId: "p-dad", optionId: "o-mountains", at: START },
    ]);

    expect(pollResult(state, "poll-1")?.leadingOptionIds).toEqual(["o-sea", "o-mountains"]);
  });

  it("knows when the vote has closed", () => {
    seedPoll([{ personId: "p-mum", optionId: "o-sea", at: START }], START + DAY_MS);

    expect(pollResult(state, "poll-1", START)?.closed).toBe(false);
    expect(pollResult(state, "poll-1", START + 2 * DAY_MS)?.closed).toBe(true);
    expect(pollResult(state, "poll-1")?.closed).toBe(false);
  });

  it("leads with nothing while nobody has voted, and knows no such poll", () => {
    seedPoll([]);

    expect(pollResult(state, "poll-1")?.leadingOptionIds).toEqual([]);
    expect(pollResult(state, "poll-none")).toBeUndefined();
  });
});

describe("completion history as a conversation basis (FR-411)", () => {
  it("is a log in time order, with no totals per person", () => {
    seedTask("t-1", {
      ownerId: "p-mum",
      dueAt: START,
      completions: [
        { at: START + 2 * DAY_MS, byId: "p-mum" },
        { at: START - 30 * DAY_MS, byId: "p-mum" },
      ],
    });
    seedTask("t-2", { ownerId: "p-dad", dueAt: START, completions: [{ at: START + DAY_MS, byId: "p-dad" }] });

    const log = completionLog(state, WEEK);

    expect(log.map((entry) => entry.taskId)).toEqual(["t-2", "t-1"]);
    expect(log.map((entry) => entry.personId)).toEqual(["p-dad", "p-mum"]);
  });

  it("has nothing to say about a family that has not finished anything", () => {
    expect(completionLog(state, WEEK)).toEqual([]);
  });
});
