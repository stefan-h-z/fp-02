/**
 * Mental load and fairness (SPEC §7).
 *
 * The deck exists because the work that hurts is the work nobody can see:
 * remembering that the swimming kit needs washing, noticing that the shoes are
 * too small, holding the birthday in your head for three weeks. FR-402 makes that
 * thinking a first-class object — a responsibility card — so this module counts
 * cards alongside tasks. Counting only executable tasks would reproduce exactly
 * the blindness the chapter is about.
 *
 * What this module deliberately does not do: score, rank, or compare people
 * against a target. §1.3 forbids a fairness score outright, and FR-408 says the
 * load-spike warning is "never as a score". So the outputs here are quantities a
 * family can talk about, not verdicts — see the note above `loadSpike`.
 */
import type { StoredEntity } from "./entity.js";
import { DAY_MS } from "./rhythm.js";
import {
  EntityTypes,
  readBoolean,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readRecords,
  readString,
} from "./schema.js";
import type { FamilyState } from "./state.js";
import {
  dueMoment,
  isAdult,
  readRecurrence,
  readRole,
  readTasks,
  recurrencePeriodMs,
  responsibleOwner,
  type Task,
  type TaskKind,
  type TaskRecurrence,
} from "./tasks.js";

/**
 * Polls (FR-406) are a decision tool of the family meeting rather than one of the
 * §18 key entities, so they are not in `EntityTypes`. The store is type-agnostic,
 * which lets them live here until the schema registry is next touched.
 */
export const POLL_ENTITY_TYPE = "poll";

export interface ResponsibilityCardNegotiation {
  readonly at: number;
  readonly byId: string | undefined;
  readonly fromOwnerId: string | undefined;
  readonly toOwnerId: string | undefined;
  readonly note: string;
}

export interface ResponsibilityCard {
  readonly id: string;
  readonly title: string;
  /** Undefined is a finding, not a state to live in (SC-011, P-02). */
  readonly ownerId: string | undefined;
  readonly category: string | undefined;
  readonly kind: TaskKind;
  /** FR-402: the parts of the responsibility that are pure head-work. */
  readonly includesNoticing: boolean;
  readonly includesPlanning: boolean;
  readonly effortMinutes: number;
  readonly recurrence: TaskRecurrence;
  /** FR-405: flagged for the next meeting by whoever disagrees. */
  readonly disputed: boolean;
  readonly createdAt: number | undefined;
  /** FR-407: renegotiation keeps its history. */
  readonly negotiations: readonly ResponsibilityCardNegotiation[];
}

export function readResponsibilityCard(state: FamilyState, cardId: string): ResponsibilityCard | undefined {
  const entity = state.get(EntityTypes.responsibilityCard, cardId);
  if (entity === undefined || entity.deleted) return undefined;

  return {
    id: entity.id,
    title: readString(entity, "title"),
    ownerId: readOptionalString(entity, "ownerId"),
    category: readOptionalString(entity, "category"),
    kind: readString(entity, "kind") === "project" ? "project" : "everyday",
    includesNoticing: readBoolean(entity, "includesNoticing", true),
    includesPlanning: readBoolean(entity, "includesPlanning", true),
    effortMinutes: readNumber(entity, "effortMinutes", 0),
    recurrence: readRecurrence(entity),
    disputed: readBoolean(entity, "disputed"),
    createdAt: readOptionalNumber(entity, "createdAt"),
    negotiations: readNegotiations(entity),
  };
}

export function readResponsibilityCards(state: FamilyState): readonly ResponsibilityCard[] {
  return state
    .all(EntityTypes.responsibilityCard)
    .map((entity) => readResponsibilityCard(state, entity.id))
    .filter((card): card is ResponsibilityCard => card !== undefined);
}

export interface LoadTotals {
  readonly count: number;
  readonly effortMinutes: number;
}

export interface CategoryLoad {
  readonly category: string;
  readonly totals: LoadTotals;
}

export interface PersonLoad {
  readonly personId: string;
  readonly totals: LoadTotals;
  readonly tasks: LoadTotals;
  /** FR-402: the head-work, kept separate so it cannot disappear into a sum. */
  readonly cards: LoadTotals;
  /** FR-404: a Tuesday of washing is not a kitchen renovation. */
  readonly everyday: LoadTotals;
  readonly project: LoadTotals;
  readonly byCategory: readonly CategoryLoad[];
}

export interface LoadWindow {
  readonly from: number;
  readonly to: number;
}

export interface LoadDistribution extends LoadWindow {
  readonly perPerson: readonly PersonLoad[];
  /** SC-011 expects this to stay empty; it is shown so that it can be seen. */
  readonly unassigned: LoadTotals;
  readonly totalEffortMinutes: number;
}

const UNCATEGORIZED = "uncategorized";

/**
 * FR-403 / FR-404: who carries what, in a period.
 *
 * Tasks count once, at the occurrence that falls inside the window — the ongoing
 * weight of a recurring duty is what the card is for, and counting both would
 * double it. A card counts once as a responsibility however rare it is (holding
 * it is the load), while its minutes are prorated over the window, so a weekly
 * card weighs four times a monthly one in the same month.
 *
 * People are sorted by id. Sorting by load would be a ranking, and a ranking is
 * the thing §1.3 rules out.
 */
export function distribution(state: FamilyState, window: LoadWindow): LoadDistribution {
  const contributions = [
    ...taskContributions(state, window),
    ...cardContributions(state, window),
  ];

  const byPerson = new Map<string, Contribution[]>();
  let unassignedCount = 0;
  let unassignedMinutes = 0;

  for (const contribution of contributions) {
    if (contribution.personId === undefined) {
      unassignedCount += 1;
      unassignedMinutes += contribution.effortMinutes;
      continue;
    }
    const bucket = byPerson.get(contribution.personId) ?? [];
    bucket.push(contribution);
    byPerson.set(contribution.personId, bucket);
  }

  const perPerson = [...byPerson.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([personId, own]) => personLoad(personId, own));

  return {
    from: window.from,
    to: window.to,
    perPerson,
    unassigned: { count: unassignedCount, effortMinutes: unassignedMinutes },
    totalEffortMinutes: contributions.reduce((sum, item) => sum + item.effortMinutes, 0),
  };
}

/**
 * SC-011 / P-02: the anonymous pool has to be visible precisely so that it can be
 * empty. A card without an owner is an unfinished negotiation, and the family
 * meeting is where it belongs (FR-405).
 */
export function unassignedCards(state: FamilyState): readonly ResponsibilityCard[] {
  return readResponsibilityCards(state).filter((card) => card.ownerId === undefined);
}

export interface LoadSpikeOptions extends LoadWindow {
  /** How many times an even share counts as disproportionate. */
  readonly threshold?: number;
  /** Below this there is nothing to warn about, whatever the ratio. */
  readonly minimumMinutes?: number;
}

export interface LoadSpike {
  readonly personId: string;
  readonly effortMinutes: number;
  readonly share: number;
  readonly evenShare: number;
  readonly factor: number;
}

const DEFAULT_SPIKE_THRESHOLD = 1.5;
const DEFAULT_SPIKE_MINIMUM_MINUTES = 120;

/**
 * FR-408, and the definition chosen for it.
 *
 * A spike is: an adult's share of the adults' total effort in the window exceeds
 * an even split by a factor (default 1.5 — half again as much as sharing evenly
 * would give), and their absolute load is worth mentioning at all (default two
 * hours). The relative test alone would fire on a quiet week where twenty minutes
 * beats five; the absolute test alone would fire on a busy week everyone shares.
 *
 * Deliberately not implemented, and not to be added: a fairness score, a running
 * balance, or a per-person ranking. §1.3 excludes them because they invite
 * score-keeping, which is the problem this chapter is trying to remove. The
 * result is therefore only the people above the line — no list of everyone, and
 * sorted by id rather than by load — and children are not counted at all, because
 * chores are not a claim on this negotiation (FR-408: surfaced to the adults).
 */
export function loadSpike(state: FamilyState, options: LoadSpikeOptions): readonly LoadSpike[] {
  const threshold = options.threshold ?? DEFAULT_SPIKE_THRESHOLD;
  const minimumMinutes = options.minimumMinutes ?? DEFAULT_SPIKE_MINIMUM_MINUTES;

  const adults = distribution(state, options).perPerson.filter((person) =>
    isAdult(readRole(state, person.personId)),
  );
  // With one adult everything is 100 % of everything; a warning would be noise.
  if (adults.length < 2) return [];

  const total = adults.reduce((sum, person) => sum + person.totals.effortMinutes, 0);
  if (total <= 0) return [];

  const evenShare = 1 / adults.length;

  return adults
    .filter((person) => person.totals.effortMinutes >= minimumMinutes)
    .map((person) => {
      const share = person.totals.effortMinutes / total;
      return {
        personId: person.personId,
        effortMinutes: person.totals.effortMinutes,
        share: round2(share),
        evenShare: round2(evenShare),
        factor: round2(share / evenShare),
      };
    })
    .filter((spike) => spike.factor >= threshold)
    .sort((a, b) => (a.personId < b.personId ? -1 : 1));
}

export type AgendaItemKind = "new-card" | "renegotiated-card" | "disputed-card" | "unassigned-card" | "load-spike";

export interface AgendaItem {
  readonly kind: AgendaItemKind;
  readonly cardId: string | undefined;
  readonly personId: string | undefined;
  readonly label: string;
}

export interface FamilyMeetingAgenda {
  readonly preparedAt: number;
  /** The last meeting; zero means this is the first, so everything is new. */
  readonly since: number;
  readonly items: readonly AgendaItem[];
}

/**
 * FR-405: the agenda prepares itself, because a negotiation appointment that
 * needs an hour of preparation is an appointment that gets cancelled. The four
 * sections are the ones the SPEC names, in that order — what is new, what is
 * contested, where next week is lopsided, what nobody has taken.
 */
export function familyMeetingAgenda(state: FamilyState, now: number): FamilyMeetingAgenda {
  const since = lastMeetingAt(state);
  const cards = readResponsibilityCards(state);
  const items: AgendaItem[] = [];

  for (const card of cards) {
    if (card.createdAt !== undefined && card.createdAt > since) {
      items.push({ kind: "new-card", cardId: card.id, personId: card.ownerId, label: card.title });
    }
  }

  for (const card of cards) {
    if (card.negotiations.some((entry) => entry.at > since)) {
      items.push({ kind: "renegotiated-card", cardId: card.id, personId: card.ownerId, label: card.title });
    }
    if (card.disputed) {
      items.push({ kind: "disputed-card", cardId: card.id, personId: card.ownerId, label: card.title });
    }
  }

  for (const spike of loadSpike(state, { from: now, to: now + 7 * DAY_MS })) {
    items.push({
      kind: "load-spike",
      cardId: undefined,
      personId: spike.personId,
      label: spike.effortMinutes + " minutes in the coming week",
    });
  }

  for (const card of unassignedCards(state)) {
    items.push({ kind: "unassigned-card", cardId: card.id, personId: undefined, label: card.title });
  }

  return { preparedAt: now, since, items };
}

export interface PollTally {
  readonly optionId: string;
  readonly label: string;
  readonly votes: number;
  readonly voterIds: readonly string[];
}

export interface PollResult {
  readonly pollId: string;
  readonly question: string;
  readonly closed: boolean;
  readonly tallies: readonly PollTally[];
  readonly voterCount: number;
  /** Plural on purpose: a tie is a result, and breaking it is the family's job. */
  readonly leadingOptionIds: readonly string[];
}

/**
 * FR-406. A plain tally and nothing more — no weighting by age or by who does the
 * work, no quorum, no automatic decision. The poll is a decision *tool*; the
 * decision stays with the people.
 *
 * A person's latest vote replaces their earlier one, because a vote is a current
 * opinion rather than an event to accumulate.
 */
export function pollResult(state: FamilyState, pollId: string, now?: number): PollResult | undefined {
  const poll = state.get(POLL_ENTITY_TYPE, pollId);
  if (poll === undefined || poll.deleted) return undefined;

  const options = readRecords(poll, "options").map((raw, position) => ({
    id: typeof raw["id"] === "string" ? raw["id"] : String(position),
    label: typeof raw["label"] === "string" ? raw["label"] : "",
  }));

  const latestByVoter = new Map<string, { optionId: string; at: number }>();
  for (const raw of readRecords(poll, "votes")) {
    const personId = raw["personId"];
    const optionId = raw["optionId"];
    if (typeof personId !== "string" || typeof optionId !== "string") continue;
    const at = typeof raw["at"] === "number" ? raw["at"] : 0;
    const previous = latestByVoter.get(personId);
    if (previous === undefined || at >= previous.at) latestByVoter.set(personId, { optionId, at });
  }

  const tallies = options.map((option) => {
    const voterIds = [...latestByVoter.entries()]
      .filter(([, vote]) => vote.optionId === option.id)
      .map(([personId]) => personId)
      .sort();
    return { optionId: option.id, label: option.label, votes: voterIds.length, voterIds };
  });

  const most = tallies.reduce((max, tally) => Math.max(max, tally.votes), 0);
  const closesAt = readOptionalNumber(poll, "closesAt");

  return {
    pollId,
    question: readString(poll, "question"),
    closed: closesAt !== undefined && now !== undefined && now > closesAt,
    tallies,
    voterCount: latestByVoter.size,
    leadingOptionIds: most === 0 ? [] : tallies.filter((tally) => tally.votes === most).map((tally) => tally.optionId),
  };
}

export interface CompletionLogEntry {
  readonly taskId: string;
  readonly title: string;
  readonly personId: string | undefined;
  readonly at: number;
}

/**
 * FR-411: what actually got done, as a conversation basis. It is a log in time
 * order and stays one — no totals per person, no streaks, no "who did more".
 * Whether the week was fair is a conversation, not a computation.
 */
export function completionLog(state: FamilyState, window: LoadWindow): readonly CompletionLogEntry[] {
  const entries: CompletionLogEntry[] = [];
  for (const task of readTasks(state)) {
    for (const completion of task.completions) {
      if (completion.at < window.from || completion.at > window.to) continue;
      entries.push({ taskId: task.id, title: task.title, personId: completion.byId, at: completion.at });
    }
  }
  return entries.sort((a, b) => (a.at !== b.at ? a.at - b.at : a.taskId < b.taskId ? -1 : 1));
}

interface Contribution {
  readonly personId: string | undefined;
  readonly source: "task" | "card";
  readonly kind: TaskKind;
  readonly category: string;
  readonly effortMinutes: number;
}

function taskContributions(state: FamilyState, window: LoadWindow): readonly Contribution[] {
  return readTasks(state)
    .filter((task) => fallsInWindow(task, window))
    .map((task) => ({
      personId: responsibleOwner(task),
      source: "task" as const,
      kind: task.kind,
      category: task.category ?? UNCATEGORIZED,
      // An unestimated task is still something carried (FR-309 is optional), so it
      // counts once with no minutes rather than being dropped.
      effortMinutes: task.effortMinutes ?? 0,
    }));
}

function cardContributions(state: FamilyState, window: LoadWindow): readonly Contribution[] {
  return readResponsibilityCards(state).map((card) => ({
    personId: card.ownerId,
    source: "card" as const,
    kind: card.kind,
    category: card.category ?? UNCATEGORIZED,
    effortMinutes: cardEffortInWindow(card, window),
  }));
}

function cardEffortInWindow(card: ResponsibilityCard, window: LoadWindow): number {
  const period = recurrencePeriodMs(card.recurrence);
  const span = Math.max(0, window.to - window.from);
  if (period === undefined || period <= 0) return card.effortMinutes;
  return Math.round((card.effortMinutes * span) / period);
}

/** A "someday" task belongs to no period, which is exactly why it is parked. */
function fallsInWindow(task: Task, window: LoadWindow): boolean {
  const due = dueMoment(task);
  return due !== undefined && due >= window.from && due <= window.to;
}

function personLoad(personId: string, own: readonly Contribution[]): PersonLoad {
  const categories = new Map<string, Contribution[]>();
  for (const contribution of own) {
    const bucket = categories.get(contribution.category) ?? [];
    bucket.push(contribution);
    categories.set(contribution.category, bucket);
  }

  return {
    personId,
    totals: totalsOf(own),
    tasks: totalsOf(own.filter((item) => item.source === "task")),
    cards: totalsOf(own.filter((item) => item.source === "card")),
    everyday: totalsOf(own.filter((item) => item.kind === "everyday")),
    project: totalsOf(own.filter((item) => item.kind === "project")),
    byCategory: [...categories.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([category, items]) => ({ category, totals: totalsOf(items) })),
  };
}

function totalsOf(items: readonly Contribution[]): LoadTotals {
  return {
    count: items.length,
    effortMinutes: items.reduce((sum, item) => sum + item.effortMinutes, 0),
  };
}

function readNegotiations(entity: StoredEntity): readonly ResponsibilityCardNegotiation[] {
  return readRecords(entity, "negotiations")
    .map((raw) => ({
      at: typeof raw["at"] === "number" ? raw["at"] : 0,
      byId: typeof raw["byId"] === "string" ? raw["byId"] : undefined,
      fromOwnerId: typeof raw["fromOwnerId"] === "string" ? raw["fromOwnerId"] : undefined,
      toOwnerId: typeof raw["toOwnerId"] === "string" ? raw["toOwnerId"] : undefined,
      note: typeof raw["note"] === "string" ? raw["note"] : "",
    }))
    .sort((a, b) => a.at - b.at);
}

function lastMeetingAt(state: FamilyState): number {
  return state
    .all(EntityTypes.family)
    .reduce((latest, family) => Math.max(latest, readNumber(family, "lastMeetingAt", 0)), 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
