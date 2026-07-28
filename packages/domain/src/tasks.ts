/**
 * Tasks and ownership (SPEC §6).
 *
 * The rule this module exists to protect is P-02 / FR-301: exactly one owner, and
 * ownership that covers noticing and planning as well as doing (FR-302). So the
 * three ways ownership can move — a rotation slot, a delegation offer, an absence
 * handover — all live on the same object and all stay visible. Nothing here ever
 * reassigns a task quietly: where a human still has to say yes, the result says so
 * instead of picking someone (FR-310).
 *
 * As with protocols (§12.2), only what a human did is stored — completed,
 * accepted, declined, approved. The next occurrence, the current rotation slot,
 * whether a task is blocked, the lead-time ladder and the star tally are all
 * derived, so correcting a recurrence corrects every future occurrence and two
 * devices that never spoke compute the same answer.
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
  readStringList,
} from "./schema.js";
import type { FamilyState } from "./state.js";

export const WEEK_MS = 7 * DAY_MS;

/** Calendar months and years vary; for prorating load an average is honest and a
 * wrong exact number is not (P-08). Occurrence dates never use these — they use
 * real calendar arithmetic in `addPeriod`. */
const AVERAGE_MONTH_MS = 30.4375 * DAY_MS;
const AVERAGE_YEAR_MS = 365.25 * DAY_MS;

export type FamilyRole = "adult" | "teen" | "child" | "separated-parent";

/** `blocked` is deliberately absent: it is derived from dependencies (FR-308),
 * never written, so a resolved blocker cannot leave a task stuck. */
export type TaskState = "open" | "awaiting-approval" | "done";

export type TaskKind = "everyday" | "project";

/**
 * FR-305 makes both modes first class, and the difference is load-bearing:
 * `schedule` keeps the grid (bin night is Tuesday whenever you last managed it),
 * `interval` counts from the actual completion (bedsheets 14 days after the last
 * change, not 14 days after the last time you meant to).
 */
export type RecurrenceMode = "none" | "schedule" | "interval";
export type RecurrenceUnit = "day" | "week" | "month" | "year";

export interface TaskRecurrence {
  readonly mode: RecurrenceMode;
  readonly every: number;
  readonly unit: RecurrenceUnit;
}

/** FR-304: three shapes, and "someday" is a real one rather than a null date. */
export type TaskScheduling =
  | { readonly kind: "due"; readonly dueAt: number }
  | { readonly kind: "window"; readonly startsAt: number; readonly endsAt: number }
  | { readonly kind: "someday" };

export interface TaskRotation {
  readonly memberIds: readonly string[];
  readonly period: "weekly" | "monthly";
  readonly startsAt: number;
}

export interface TaskDelegation {
  readonly toId: string;
  /** Kept so a decline can go back to the person who asked (FR-310). */
  readonly byId: string;
  readonly response: "accepted" | "declined" | undefined;
  readonly respondedAt: number | undefined;
}

export interface Subtask {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
}

/** FR-318: what is missing, and where it can be got. */
export type BlockerKind = "task" | "shoppingItem" | "contact" | "note";

export interface TaskBlocker {
  readonly kind: BlockerKind;
  readonly refId: string | undefined;
  readonly note: string;
  readonly resolved: boolean;
}

/** FR-325: history is a log on the object, not an analytics module. */
export interface TaskCompletion {
  readonly at: number;
  readonly byId: string | undefined;
  readonly note: string;
  /** FR-313, optional proof; the domain only carries the reference. */
  readonly photoRef: string | undefined;
  readonly stars: number | undefined;
}

export interface Task {
  readonly id: string;
  readonly title: string;
  /** FR-303: negotiated once, shown at completion. */
  readonly definitionOfDone: string;
  readonly ownerId: string | undefined;
  readonly scheduling: TaskScheduling;
  /** FR-319: an attribute, not a management area of its own. */
  readonly area: string | undefined;
  /** FR-309; optional, because a guessed estimate is worse than none. */
  readonly effortMinutes: number | undefined;
  readonly state: TaskState;
  readonly kind: TaskKind;
  readonly category: string | undefined;
  readonly recurrence: TaskRecurrence;
  readonly rotation: TaskRotation | undefined;
  readonly delegation: TaskDelegation | undefined;
  /** FR-323: symbolic stars on children's tasks, never on adults' (§1.3). */
  readonly rewardStars: number;
  /** FR-312; true by construction when the owner is a child. */
  readonly requiresApproval: boolean;
  readonly blockedByTaskIds: readonly string[];
  readonly blockerRecords: readonly TaskBlocker[];
  readonly subtasks: readonly Subtask[];
  /** FR-321: the opportunity expires if nothing happens. */
  readonly deadline: boolean;
  /** FR-320 override: "this one needs N days of run-up". */
  readonly leadDays: number | undefined;
  /** FR-322: the tradesperson this task is about. */
  readonly contactId: string | undefined;
  readonly proofRequired: boolean;
  readonly completedAt: number | undefined;
  readonly createdAt: number | undefined;
  readonly completions: readonly TaskCompletion[];
}

export function readTask(state: FamilyState, taskId: string): Task | undefined {
  const entity = state.get(EntityTypes.task, taskId);
  if (entity === undefined || entity.deleted) return undefined;

  const ownerId = readOptionalString(entity, "ownerId");

  return {
    id: entity.id,
    title: readString(entity, "title"),
    definitionOfDone: readString(entity, "definitionOfDone"),
    ownerId,
    scheduling: readScheduling(entity),
    area: readOptionalString(entity, "area"),
    effortMinutes: readOptionalNumber(entity, "effortMinutes"),
    state: taskStateOf(readString(entity, "state")),
    kind: readString(entity, "kind") === "project" ? "project" : "everyday",
    category: readOptionalString(entity, "category"),
    recurrence: readRecurrence(entity),
    rotation: readRotation(entity),
    delegation: readDelegation(entity),
    rewardStars: readNumber(entity, "rewardStars", 0),
    // A child's task carries the approval gate whether or not anyone ticked a box
    // when creating it (FR-312).
    requiresApproval:
      readBoolean(entity, "requiresApproval") ||
      (ownerId !== undefined && readRole(state, ownerId) === "child"),
    blockedByTaskIds: readStringList(entity, "blockedBy"),
    blockerRecords: readBlockerRecords(entity),
    subtasks: readSubtasks(entity),
    deadline: readBoolean(entity, "deadline"),
    leadDays: readOptionalNumber(entity, "leadDays"),
    contactId: readOptionalString(entity, "contactId"),
    proofRequired: readBoolean(entity, "proofRequired"),
    completedAt: readOptionalNumber(entity, "completedAt"),
    createdAt: readOptionalNumber(entity, "createdAt"),
    completions: readCompletions(entity),
  };
}

export function readTasks(state: FamilyState): readonly Task[] {
  return state
    .all(EntityTypes.task)
    .map((entity) => readTask(state, entity.id))
    .filter((task): task is Task => task !== undefined);
}

export function readRecurrence(entity: StoredEntity | undefined): TaskRecurrence {
  return {
    mode: recurrenceModeOf(readString(entity, "recurrenceMode")),
    every: Math.max(1, Math.round(readNumber(entity, "recurrenceEvery", 1))),
    unit: recurrenceUnitOf(readString(entity, "recurrenceUnit")),
  };
}

/**
 * The moment a task is measured against. A time window is late only once it has
 * closed (FR-304), and a "someday" task can never be late — that is the whole
 * point of putting it there.
 */
export function dueMoment(task: Task): number | undefined {
  if (task.scheduling.kind === "due") return task.scheduling.dueAt;
  if (task.scheduling.kind === "window") return task.scheduling.endsAt;
  return undefined;
}

/**
 * FR-305, the distinction the two modes exist for.
 *
 * `schedule` returns the next slot on the original grid, so a task finished three
 * days late is still due on its usual day; `interval` measures from the actual
 * completion, so the same lateness moves everything after it. Completing early
 * still discharges the current occurrence — otherwise a Saturday job done on
 * Thursday would come straight back two days later.
 */
export function nextOccurrence(task: Task, completedAt: number): number | undefined {
  const { mode, every, unit } = task.recurrence;
  if (mode === "none") return undefined;
  if (mode === "interval") return addPeriod(completedAt, every, unit);

  const anchor = task.scheduling.kind === "someday" ? completedAt : (dueMoment(task) ?? completedAt);
  let next = addPeriod(anchor, every, unit);
  for (let guard = 0; next <= completedAt && guard < 1000; guard += 1) {
    next = addPeriod(next, every, unit);
  }
  return next;
}

/**
 * Which slot of the rotation a moment falls into (FR-306). Slots are counted from
 * the rotation's own start rather than from an epoch, so the family's "you start"
 * decision is what the plan is anchored to.
 */
export function rotationOccurrenceIndex(task: Task, at: number): number {
  const rotation = task.rotation;
  if (rotation === undefined) return 0;
  if (rotation.period === "weekly") return Math.floor((at - rotation.startsAt) / WEEK_MS);
  return wholeMonthsBetween(rotation.startsAt, at);
}

/**
 * FR-306 plus FR-110/FR-311: an absent person is skipped and the slot passes to
 * the next in the rotation. The skip is automatic because the rotation already
 * carries everyone's consent to take a turn — that is what agreeing to a rotation
 * means. If everybody is away the plain slot is returned anyway: a task without an
 * owner would be the anonymous pool P-02 forbids, and an owner who is away is
 * something the family can see and talk about.
 */
export function rotationOwner(
  task: Task,
  occurrenceIndex: number,
  absentPersonIds: readonly string[] = [],
): string | undefined {
  const members = task.rotation?.memberIds ?? [];
  if (members.length === 0) return undefined;

  const start = ((occurrenceIndex % members.length) + members.length) % members.length;
  for (let step = 0; step < members.length; step += 1) {
    const candidate = members[(start + step) % members.length];
    if (candidate !== undefined && !absentPersonIds.includes(candidate)) return candidate;
  }
  return members[start];
}

export interface RotationSlot {
  readonly index: number;
  readonly startsAt: number;
  readonly ownerId: string | undefined;
  /** Who the plain rotation would have named, when absence moved it (FR-311). */
  readonly insteadOfId: string | undefined;
}

/** FR-306 asks for a *visible* rotation plan, so the plan is a value the family
 * can look at, not a rule the app applies in private. */
export function rotationPlan(state: FamilyState, task: Task, from: number, count: number): readonly RotationSlot[] {
  const rotation = task.rotation;
  if (rotation === undefined) return [];

  const firstIndex = rotationOccurrenceIndex(task, from);
  const slots: RotationSlot[] = [];
  for (let step = 0; step < Math.max(0, count); step += 1) {
    const index = firstIndex + step;
    const startsAt = rotationSlotStart(rotation, index);
    const plain = rotationOwner(task, index);
    const actual = rotationOwner(task, index, absentPersonIds(state, startsAt));
    slots.push({
      index,
      startsAt,
      ownerId: actual,
      insteadOfId: actual === plain ? undefined : plain,
    });
  }
  return slots;
}

export type DelegationState = "none" | "offered" | "accepted" | "declined";

/**
 * FR-310. A decline is a recorded answer, not a silent bounce: the task never
 * moved in the first place, so it is still the delegating owner's — which is what
 * "returns to the delegating owner" has to mean if nothing was reassigned.
 */
export function delegationState(task: Task): DelegationState {
  const delegation = task.delegation;
  if (delegation === undefined) return "none";
  if (delegation.response === "accepted") return "accepted";
  if (delegation.response === "declined") return "declined";
  return "offered";
}

/** Who carries the task right now — the delegate only once they said yes. */
export function responsibleOwner(task: Task): string | undefined {
  const delegation = task.delegation;
  if (delegation !== undefined && delegation.response === "accepted") return delegation.toId;
  return task.ownerId;
}

export type OwnerSource =
  | "owner"
  | "delegate"
  | "offer-pending"
  | "rotation"
  | "rotation-absence"
  | "handover-pending"
  | "none";

export interface TaskOwnership {
  readonly personId: string | undefined;
  readonly source: OwnerSource;
  /** True while a human still has to answer; never a reason to pick for them. */
  readonly needsAcceptance: boolean;
  readonly skippedPersonIds: readonly string[];
}

/**
 * The owner as of a moment, with all three movement mechanisms applied in the
 * order the SPEC implies: an accepted delegation wins over everything (FR-310), a
 * rotation resolves its own absences (FR-306, FR-311), and a lone absent owner
 * keeps the task until somebody accepts the handover — FR-110 redistributes "per
 * FR-310", i.e. with an accepting owner, so there is nobody to move it to yet.
 */
export function effectiveOwner(state: FamilyState, task: Task, at: number): TaskOwnership {
  const delegation = task.delegation;
  if (delegation?.response === "accepted") {
    return { personId: delegation.toId, source: "delegate", needsAcceptance: false, skippedPersonIds: [] };
  }
  if (delegation !== undefined && delegation.response === undefined) {
    return { personId: task.ownerId, source: "offer-pending", needsAcceptance: true, skippedPersonIds: [] };
  }

  if (task.rotation !== undefined && task.rotation.memberIds.length > 0) {
    const index = rotationOccurrenceIndex(task, at);
    const absent = absentPersonIds(state, at);
    const plain = rotationOwner(task, index);
    const actual = rotationOwner(task, index, absent);
    const skipped = plain !== undefined && plain !== actual ? [plain] : [];
    return {
      personId: actual,
      source: skipped.length > 0 ? "rotation-absence" : "rotation",
      needsAcceptance: false,
      skippedPersonIds: skipped,
    };
  }

  if (task.ownerId === undefined) {
    return { personId: undefined, source: "none", needsAcceptance: true, skippedPersonIds: [] };
  }
  if (isAbsent(state, task.ownerId, at)) {
    return { personId: task.ownerId, source: "handover-pending", needsAcceptance: true, skippedPersonIds: [] };
  }
  return { personId: task.ownerId, source: "owner", needsAcceptance: false, skippedPersonIds: [] };
}

/**
 * FR-312. The child's tick is a claim, not a verdict; an adult ticking the same
 * task finishes it outright, because asking a parent to confirm their own work
 * would be ceremony.
 */
export function completionOutcome(state: FamilyState, task: Task, completedById: string): TaskState {
  if (task.requiresApproval && !isAdult(readRole(state, completedById))) return "awaiting-approval";
  return "done";
}

export function approvalOutcome(state: FamilyState, task: Task, approvedById: string): TaskState {
  if (task.state !== "awaiting-approval") return task.state;
  return isAdult(readRole(state, approvedById)) ? "done" : "awaiting-approval";
}

export function tasksAwaitingApproval(state: FamilyState): readonly Task[] {
  return readTasks(state).filter((task) => task.state === "awaiting-approval");
}

export type LeadUrgency = "early" | "approaching" | "imminent" | "final";

export interface LeadStage {
  readonly at: number;
  readonly leadDays: number;
  readonly urgency: LeadUrgency;
  readonly reached: boolean;
}

/**
 * FR-320 / FR-321 / FR-1302: how far ahead a task has to start talking.
 *
 * The ladder is geometric — first call, then half that lead, then half again —
 * because a run-up that matters gets shorter as the date approaches. Where it
 * starts follows the task's own horizon: a yearly job (winter tyres, inspection)
 * opens six weeks out, a quarterly one three weeks, a monthly one a week. A
 * non-deadline long-interval task deliberately has no stage on the due date at
 * all: a push on the morning of the vehicle inspection is information, not help.
 * Only a deadline task, where the opportunity actually expires, gets that last
 * call (FR-321).
 */
export function leadStages(task: Task, now: number): readonly LeadStage[] {
  const due = dueMoment(task);
  if (due === undefined) return [];

  const first = task.leadDays ?? ladderStartDays(horizonDays(task));
  const leads: number[] = [];
  for (let lead = Math.max(1, Math.round(first)); lead >= 1 && leads.length < 4; lead = Math.round(lead / 2)) {
    if (!leads.includes(lead)) leads.push(lead);
    if (lead === 1) break;
  }
  if (task.deadline) leads.push(0);

  const stages = leads.map((leadDays) => ({
    at: due - leadDays * DAY_MS,
    leadDays,
    urgency: urgencyFor(leadDays),
    reached: due - leadDays * DAY_MS <= now,
  }));

  // A task created a week before a yearly due date would otherwise have its whole
  // ladder in the past; it still deserves the one warning it can still act on.
  const createdAt = task.createdAt;
  if (createdAt === undefined) return stages;
  const inRange = stages.filter((stage) => stage.at >= createdAt);
  return inRange.length > 0 ? inRange : stages.slice(-1);
}

/** The stage a task is currently in — the latest one whose moment has come. */
export function activeLeadStage(task: Task, now: number): LeadStage | undefined {
  return leadStages(task, now)
    .filter((stage) => stage.reached)
    .at(-1);
}

/**
 * FR-308 and FR-318 answered together, because a family does not distinguish
 * them: something is missing, and here is where to get it. A dependency is
 * resolved by the other task being done; a part by it being bought; a contact by
 * it existing at all — "we have no plumber" is the blocker.
 */
export function blockers(state: FamilyState, taskId: string): readonly TaskBlocker[] {
  const task = readTask(state, taskId);
  if (task === undefined) return [];

  const fromDependencies = task.blockedByTaskIds.map((refId) => ({
    kind: "task" as const,
    refId,
    note: readString(state.get(EntityTypes.task, refId), "title"),
    resolved: dependencyResolved(state, refId),
  }));

  const fromRecords = task.blockerRecords.map((blocker) => ({
    ...blocker,
    resolved: blocker.resolved || blockerRefResolved(state, blocker),
  }));

  return [...fromDependencies, ...fromRecords];
}

export function isBlocked(state: FamilyState, taskId: string): boolean {
  return blockers(state, taskId).some((blocker) => !blocker.resolved);
}

export interface OverdueTask {
  readonly taskId: string;
  readonly title: string;
  readonly dueAt: number;
  readonly overdueMs: number;
  /** Who hears about it (FR-314) — carried here so no caller has to look. */
  readonly escalateToId: string | undefined;
  readonly blocked: boolean;
}

/**
 * Tasks past their moment (FR-314). A task waiting for a parent's confirmation is
 * not among them: the child did their part, and the pending action belongs to the
 * approver — see `tasksAwaitingApproval`.
 */
export function overdueTasks(state: FamilyState, now: number): readonly OverdueTask[] {
  const out: OverdueTask[] = [];
  for (const task of readTasks(state)) {
    if (task.state !== "open") continue;
    const due = dueMoment(task);
    if (due === undefined || due >= now) continue;
    out.push({
      taskId: task.id,
      title: task.title,
      dueAt: due,
      overdueMs: now - due,
      escalateToId: escalationTarget(task),
      blocked: isBlocked(state, task.id),
    });
  }
  return out.sort((a, b) => (a.dueAt !== b.dueAt ? a.dueAt - b.dueAt : a.taskId < b.taskId ? -1 : 1));
}

/**
 * FR-314 / FR-1307: escalation goes to the owner. Whoever noticed has already
 * done their bit by noticing, and a reminder that lands on them is exactly the
 * mechanism that turns one person into the household's memory (§1.1).
 */
export function escalationTarget(task: Task): string | undefined {
  return responsibleOwner(task);
}

/**
 * FR-323 and decision 22: a tally, nothing else. There is no redemption, no
 * catalogue and no balance to spend, because what stars mean is negotiated by the
 * parents outside the app — and no equivalent exists for adults (§1.3).
 */
export function starBalance(state: FamilyState, personId: string): number {
  let stars = 0;
  for (const task of readTasks(state)) {
    const logged = task.completions.filter((entry) => entry.byId === personId);
    if (logged.length > 0) {
      stars += logged.reduce((sum, entry) => sum + (entry.stars ?? task.rewardStars), 0);
      continue;
    }
    // A task completed before anyone wrote a log line still counts once.
    if (task.state === "done" && responsibleOwner(task) === personId) stars += task.rewardStars;
  }
  return stars;
}

/** FR-325: the log the object carries, oldest first. */
export function completionHistory(state: FamilyState, taskId: string): readonly TaskCompletion[] {
  return readTask(state, taskId)?.completions ?? [];
}

/** FR-110. Absence is a date range on the membership, so it is one fact, stated
 * once, that everything else reads. */
export function isAbsent(state: FamilyState, personId: string, at: number): boolean {
  const membership = readMembership(state, personId);
  return readRecords(membership, "absences").some((absence) => {
    const from = absence["from"];
    const to = absence["to"];
    return typeof from === "number" && typeof to === "number" && at >= from && at <= to;
  });
}

export function absentPersonIds(state: FamilyState, at: number): readonly string[] {
  return state
    .all(EntityTypes.membership)
    .map((membership) => readString(membership, "personId"))
    .filter((personId) => personId.length > 0 && isAbsent(state, personId, at))
    .sort();
}

export function readRole(state: FamilyState, personId: string): FamilyRole {
  const role = readString(readMembership(state, personId), "role");
  if (role === "teen" || role === "child" || role === "separated-parent") return role;
  // Unknown people are treated as adults on purpose: a missing membership must
  // never lock a family out of finishing its own tasks.
  return "adult";
}

export function isAdult(role: FamilyRole): boolean {
  return role === "adult" || role === "separated-parent";
}

/** Approximate length of one recurrence period, for prorating load over a window. */
export function recurrencePeriodMs(recurrence: TaskRecurrence): number | undefined {
  if (recurrence.mode === "none") return undefined;
  const every = Math.max(1, recurrence.every);
  if (recurrence.unit === "day") return every * DAY_MS;
  if (recurrence.unit === "week") return every * WEEK_MS;
  if (recurrence.unit === "month") return every * AVERAGE_MONTH_MS;
  return every * AVERAGE_YEAR_MS;
}

function readMembership(state: FamilyState, personId: string): StoredEntity | undefined {
  return state.all(EntityTypes.membership).find((membership) => readString(membership, "personId") === personId);
}

function readScheduling(entity: StoredEntity): TaskScheduling {
  const dueAt = readOptionalNumber(entity, "dueAt");
  if (dueAt !== undefined) return { kind: "due", dueAt };

  const startsAt = readOptionalNumber(entity, "windowStartsAt");
  const endsAt = readOptionalNumber(entity, "windowEndsAt");
  if (startsAt !== undefined && endsAt !== undefined) return { kind: "window", startsAt, endsAt };

  return { kind: "someday" };
}

function readRotation(entity: StoredEntity): TaskRotation | undefined {
  const memberIds = readStringList(entity, "rotationMemberIds");
  if (memberIds.length === 0) return undefined;
  return {
    memberIds,
    period: readString(entity, "rotationPeriod") === "monthly" ? "monthly" : "weekly",
    startsAt: readNumber(entity, "rotationStartsAt", 0),
  };
}

function readDelegation(entity: StoredEntity): TaskDelegation | undefined {
  const toId = readOptionalString(entity, "delegatedToId");
  if (toId === undefined) return undefined;
  const response = readString(entity, "delegationResponse");
  return {
    toId,
    byId: readString(entity, "delegatedById"),
    response: response === "accepted" || response === "declined" ? response : undefined,
    respondedAt: readOptionalNumber(entity, "delegationRespondedAt"),
  };
}

function readSubtasks(entity: StoredEntity): readonly Subtask[] {
  return readRecords(entity, "subtasks").map((raw, position) => ({
    id: typeof raw["id"] === "string" ? raw["id"] : String(position),
    title: typeof raw["title"] === "string" ? raw["title"] : "",
    done: raw["done"] === true,
  }));
}

function readBlockerRecords(entity: StoredEntity): readonly TaskBlocker[] {
  return readRecords(entity, "blockers").map((raw) => ({
    kind: blockerKindOf(typeof raw["kind"] === "string" ? raw["kind"] : ""),
    refId: typeof raw["refId"] === "string" ? raw["refId"] : undefined,
    note: typeof raw["note"] === "string" ? raw["note"] : "",
    resolved: typeof raw["resolvedAt"] === "number",
  }));
}

function readCompletions(entity: StoredEntity): readonly TaskCompletion[] {
  return readRecords(entity, "completions")
    .map((raw) => ({
      at: typeof raw["at"] === "number" ? raw["at"] : 0,
      byId: typeof raw["byId"] === "string" ? raw["byId"] : undefined,
      note: typeof raw["note"] === "string" ? raw["note"] : "",
      photoRef: typeof raw["photoRef"] === "string" ? raw["photoRef"] : undefined,
      stars: typeof raw["stars"] === "number" ? raw["stars"] : undefined,
    }))
    .sort((a, b) => a.at - b.at);
}

function dependencyResolved(state: FamilyState, taskId: string): boolean {
  const blocking = readTask(state, taskId);
  // A dependency that no longer exists cannot be waited for.
  return blocking === undefined || blocking.state === "done";
}

function blockerRefResolved(state: FamilyState, blocker: TaskBlocker): boolean {
  const refId = blocker.refId;
  if (refId === undefined) return false;
  if (blocker.kind === "task") return dependencyResolved(state, refId);
  if (blocker.kind === "shoppingItem") {
    const item = state.get(EntityTypes.shoppingItem, refId);
    return item === undefined || item.deleted || readBoolean(item, "checked");
  }
  if (blocker.kind === "contact") {
    const contact = state.get(EntityTypes.contact, refId);
    return contact !== undefined && !contact.deleted;
  }
  return false;
}

function horizonDays(task: Task): number {
  const period = recurrencePeriodMs(task.recurrence);
  if (period !== undefined) return period / DAY_MS;

  const due = dueMoment(task);
  const createdAt = task.createdAt;
  if (due === undefined || createdAt === undefined) return 0;
  return Math.max(0, (due - createdAt) / DAY_MS);
}

function ladderStartDays(horizon: number): number {
  if (horizon >= 365) return 42;
  if (horizon >= 90) return 21;
  if (horizon >= 28) return 7;
  if (horizon >= 7) return 2;
  return 1;
}

function urgencyFor(leadDays: number): LeadUrgency {
  if (leadDays >= 21) return "early";
  if (leadDays >= 7) return "approaching";
  if (leadDays >= 1) return "imminent";
  return "final";
}

function rotationSlotStart(rotation: TaskRotation, index: number): number {
  if (rotation.period === "weekly") return rotation.startsAt + index * WEEK_MS;
  return addPeriod(rotation.startsAt, index, "month");
}

/** Real calendar arithmetic: the 31st plus one month is the end of February, not
 * the 3rd of March. */
function addPeriod(at: number, every: number, unit: RecurrenceUnit): number {
  const steps = Math.round(every);
  if (steps === 0) return at;
  if (unit === "day") return at + steps * DAY_MS;
  if (unit === "week") return at + steps * WEEK_MS;

  const source = new Date(at);
  const dayOfMonth = source.getUTCDate();
  const target = new Date(at);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + (unit === "year" ? steps * 12 : steps));
  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(dayOfMonth, daysInTargetMonth));
  return target.getTime();
}

function wholeMonthsBetween(from: number, to: number): number {
  const start = new Date(from);
  const end = new Date(to);
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  return end.getUTCDate() < start.getUTCDate() ? months - 1 : months;
}

function taskStateOf(value: string): TaskState {
  return value === "done" || value === "awaiting-approval" ? value : "open";
}

function recurrenceModeOf(value: string): RecurrenceMode {
  return value === "schedule" || value === "interval" ? value : "none";
}

function recurrenceUnitOf(value: string): RecurrenceUnit {
  return value === "week" || value === "month" || value === "year" ? value : "day";
}

function blockerKindOf(value: string): BlockerKind {
  return value === "task" || value === "shoppingItem" || value === "contact" ? value : "note";
}
