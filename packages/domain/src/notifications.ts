/**
 * Notification planning (SPEC §16).
 *
 * The whole chapter exists to keep one promise: the app may interrupt a family
 * only as often as it has earned. So nothing here decides *whether* something is
 * interesting — callers hand in candidates for that — this file decides what a
 * person actually gets pushed, and what waits.
 *
 * Three rules carry the design:
 *  - A daily budget of action-requiring pushes (FR-1309, default 5). Anything
 *    over it is **bundled into the next digest**, never dropped: a silent drop
 *    would be exactly the "did the app tell me?" doubt the product must not
 *    create.
 *  - Protocol reminders are exempt (decision 24). Eye drops at 14:00 are the
 *    reason the app is trusted; a budget spent on shopping suggestions must
 *    never eat them.
 *  - Quiet hours are opt-in with no default (decision 23, FR-1304). While a
 *    window is on, only explicitly wake-capable items break through (FR-921);
 *    the rest are held and released as one bundle when the window ends.
 *
 * Everything is pure and deterministic — the same candidates and settings always
 * produce the same plan — because the actual push out of the door happens in the
 * backend and must be replayable and explainable after the fact.
 */
import { derivedId } from "./ids.js";
import type { ProtocolInstance } from "./protocols.js";
import { DAY_MS } from "./rhythm.js";

export type NotificationKind =
  | "task-due"
  | "task-overdue"
  | "event-lead"
  | "protocol-instance"
  | "staple-suggestion"
  | "conflict"
  | "inbox"
  /** A stage of an escalating deadline (FR-321, FR-1302). */
  | "deadline-stage"
  /** An uncovered care day found weeks ahead (FR-212). */
  | "care-gap";

/**
 * Four levels, not a score: when the budget bites, somebody has to lose, and a
 * numeric score would make that decision unexplainable to the person who did not
 * get the message.
 */
export type NotificationPriority = "critical" | "high" | "normal" | "low";

/**
 * Role addressing (FR-1311). `at-home` resolves from presence the family enters
 * by hand — never from location, which is a binding non-goal (§1.3).
 */
export type RoleAudience = "at-home" | "any-adult";

export interface NotificationCandidate {
  readonly id: string;
  /** The person this is *about*; routing may still deliver it elsewhere (FR-1310). */
  readonly personId: string;
  readonly kind: NotificationKind;
  readonly priority: NotificationPriority;
  readonly subjectEntityType: string;
  readonly subjectEntityId: string;
  /** When it wants to be delivered. */
  readonly at: number;
  readonly title: string;
  readonly body: string;
  /** May this break a quiet window? Explicit per item, as for protocols (FR-921). */
  readonly wakeCapable: boolean;
  /** Information without a required action — costs no budget (FR-1308). */
  readonly silent?: boolean;
  /** Address a role instead of a person (FR-1311). */
  readonly audience?: RoleAudience;
}

/** Opt-in window. Absent settings mean off — there is no default (decision 23). */
export interface QuietHours {
  readonly enabled: boolean;
  /** Minutes past midnight; start > end means the window wraps past midnight. */
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface PersonNotificationSettings {
  /** Overrides the family budget for this person (FR-1309 "adjustable per person"). */
  readonly dailyBudget?: number;
  readonly quietHours?: QuietHours;
  /** Per-person, per-kind silence (FR-1301). */
  readonly mutedKinds?: readonly NotificationKind[];
  /** Pushes already spent today, so planning mid-day continues where it left off. */
  readonly spentToday?: number;
}

export interface NotificationSettings {
  readonly dailyBudget?: number;
  readonly quietHours?: QuietHours;
  readonly perPerson?: Readonly<Record<string, PersonNotificationSettings>>;
  /** Minutes past midnight at which the two digests go out (FR-1305). */
  readonly morningMinute?: number;
  readonly eveningMinute?: number;
}

export interface DeliveredNotification {
  readonly candidate: NotificationCandidate;
  readonly deliverAt: number;
  /** Why it survived — the audit trail for "why did I get this?" (FR-1309). */
  readonly cost: "budget" | "exempt-protocol" | "silent";
}

export interface BundledNotification {
  readonly candidate: NotificationCandidate;
  readonly reason: "budget";
  readonly digest: DigestKind;
  readonly deliverAt: number;
}

export interface SuppressedNotification {
  readonly candidate: NotificationCandidate;
  readonly reason: "quiet-hours" | "muted";
  /** When the held item is released as a bundle; undefined for a muted kind. */
  readonly releaseAt: number | undefined;
}

export interface NotificationPlan {
  readonly delivered: readonly DeliveredNotification[];
  readonly bundled: readonly BundledNotification[];
  readonly suppressed: readonly SuppressedNotification[];
}

/** FR-1309, decision 24. */
export const DEFAULT_DAILY_BUDGET = 5;
const DEFAULT_MORNING_MINUTE = 7 * 60;
const DEFAULT_EVENING_MINUTE = 20 * 60;

const PRIORITY_RANK: Readonly<Record<NotificationPriority, number>> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/**
 * The default weight of each kind, so two callers building candidates never
 * disagree about what beats what. Health and genuine conflicts outrank anything
 * the family could also find on the list by itself.
 */
const DEFAULT_PRIORITY: Readonly<Record<NotificationKind, NotificationPriority>> = {
  "protocol-instance": "critical",
  "task-overdue": "high",
  conflict: "high",
  "deadline-stage": "high",
  "care-gap": "normal",
  "task-due": "normal",
  "event-lead": "normal",
  inbox: "low",
  "staple-suggestion": "low",
};

export function defaultPriority(kind: NotificationKind): NotificationPriority {
  return DEFAULT_PRIORITY[kind];
}

/** Deterministic, so a replan does not produce a second copy of the same push. */
export function notificationId(kind: NotificationKind, subjectEntityId: string, at: number): string {
  return derivedId("notification", kind, subjectEntityId, String(at));
}

/**
 * Plan one delivery moment.
 *
 * Candidates are considered per person and in priority order, so an exhausted
 * budget takes the least important item rather than whichever arrived last.
 */
export function planNotifications(
  candidates: readonly NotificationCandidate[],
  settings: NotificationSettings,
  now: number,
): NotificationPlan {
  const delivered: DeliveredNotification[] = [];
  const bundled: BundledNotification[] = [];
  const suppressed: SuppressedNotification[] = [];

  for (const [personId, group] of byPerson(candidates)) {
    const person = settings.perPerson?.[personId];
    const budget = budgetFor(settings, personId);
    const quiet = person?.quietHours ?? settings.quietHours;
    const muted = new Set(person?.mutedKinds ?? []);
    let spent = person?.spentToday ?? 0;

    for (const candidate of group) {
      const deliverAt = Math.max(candidate.at, now);

      if (muted.has(candidate.kind)) {
        suppressed.push({ candidate, reason: "muted", releaseAt: undefined });
        continue;
      }

      // Quiet hours are checked before the budget: a held item is not a push and
      // must not consume a person's allowance for the day (FR-1304).
      if (isWithinQuietHours(quiet, deliverAt) && !candidate.wakeCapable) {
        suppressed.push({ candidate, reason: "quiet-hours", releaseAt: quietHoursEndAt(quiet, deliverAt) });
        continue;
      }

      if (candidate.kind === "protocol-instance") {
        delivered.push({ candidate, deliverAt, cost: "exempt-protocol" });
        continue;
      }
      if (candidate.silent === true) {
        delivered.push({ candidate, deliverAt, cost: "silent" });
        continue;
      }

      if (spent < budget) {
        spent += 1;
        delivered.push({ candidate, deliverAt, cost: "budget" });
      } else {
        const digest = nextDigest(deliverAt, settings);
        bundled.push({ candidate, reason: "budget", digest: digest.kind, deliverAt: digest.at });
      }
    }
  }

  return { delivered, bundled, suppressed };
}

export function budgetFor(settings: NotificationSettings, personId: string): number {
  const person = settings.perPerson?.[personId]?.dailyBudget;
  const family = settings.dailyBudget;
  return Math.max(0, person ?? family ?? DEFAULT_DAILY_BUDGET);
}

/** Grouped and ordered deterministically: priority, then time, then id. */
function byPerson(
  candidates: readonly NotificationCandidate[],
): readonly (readonly [string, readonly NotificationCandidate[]])[] {
  const buckets = new Map<string, NotificationCandidate[]>();
  for (const candidate of candidates) {
    const bucket = buckets.get(candidate.personId);
    if (bucket === undefined) buckets.set(candidate.personId, [candidate]);
    else bucket.push(candidate);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([personId, group]) => [personId, [...group].sort(compareCandidates)] as const);
}

function compareCandidates(a: NotificationCandidate, b: NotificationCandidate): number {
  const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (rank !== 0) return rank;
  if (a.at !== b.at) return a.at - b.at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function isWithinQuietHours(quiet: QuietHours | undefined, at: number): boolean {
  // No settings means no quiet hours at all — opt-in, never assumed (decision 23).
  if (quiet === undefined || !quiet.enabled) return false;

  const minute = minutesIntoDay(at);
  const { startMinute: start, endMinute: end } = quiet;
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** The moment the current window ends — when everything held is released (FR-1304). */
export function quietHoursEndAt(quiet: QuietHours | undefined, at: number): number {
  if (!isWithinQuietHours(quiet, at) || quiet === undefined) return at;

  const end = startOfDay(at) + quiet.endMinute * 60 * 1000;
  return end <= at ? end + DAY_MS : end;
}

export type DigestKind = "morning" | "evening" | "weekly-preview" | "weekly-review";

/** Where overflow lands: whichever of the two daily digests comes next (FR-1305). */
export function nextDigest(
  at: number,
  settings: NotificationSettings,
): { readonly kind: "morning" | "evening"; readonly at: number } {
  const morning = settings.morningMinute ?? DEFAULT_MORNING_MINUTE;
  const evening = settings.eveningMinute ?? DEFAULT_EVENING_MINUTE;
  const day = startOfDay(at);
  const minute = minutesIntoDay(at);

  if (minute < morning) return { kind: "morning", at: day + morning * 60 * 1000 };
  if (minute < evening) return { kind: "evening", at: day + evening * 60 * 1000 };
  return { kind: "morning", at: day + DAY_MS + morning * 60 * 1000 };
}

export interface DigestSection {
  /** Stable machine key — the UI translates it (§2.4); `heading` is the English default. */
  readonly key: string;
  readonly heading: string;
  readonly items: readonly NotificationCandidate[];
}

export interface Digest {
  readonly id: string;
  readonly personId: string;
  readonly kind: DigestKind;
  readonly at: number;
  readonly title: string;
  readonly sections: readonly DigestSection[];
  readonly itemCount: number;
}

export interface DigestInput {
  readonly personId: string;
  readonly at: number;
  readonly candidates: readonly NotificationCandidate[];
  /** What the budget held back — the digest is where it is honoured (FR-1309). */
  readonly bundled?: readonly NotificationCandidate[];
}

/**
 * What today asks of this person (FR-1305).
 *
 * Ordered by what cannot wait: care first, then what has already slipped, then
 * the day itself. Everything the budget held back is named explicitly rather
 * than merged into the rest, so the person can see the app kept its word.
 */
export function morningBriefing(input: DigestInput): Digest {
  const from = startOfDay(input.at);
  const today = inWindow(input.candidates, input.personId, from, from + DAY_MS);

  return digest(input, "morning", "Today", [
    section("care", "Care", today.filter((c) => c.kind === "protocol-instance")),
    section("attention", "Needs attention", today.filter((c) => c.kind === "task-overdue" || c.kind === "conflict")),
    section("day", "Today", today.filter((c) => c.kind === "event-lead" || c.kind === "care-gap")),
    section("due", "Due today", today.filter((c) => c.kind === "task-due" || c.kind === "deadline-stage")),
    section("info", "For information", today.filter((c) => c.kind === "staple-suggestion" || c.kind === "inbox")),
    heldBack(input),
  ]);
}

/**
 * The close of the day (FR-1305): what is still open, and what tomorrow needs
 * *tonight* — the gym bag is packed the evening before or not at all (FR-213).
 */
export function eveningClose(input: DigestInput): Digest {
  const from = startOfDay(input.at);
  const today = inWindow(input.candidates, input.personId, from, from + DAY_MS);
  const tomorrow = inWindow(input.candidates, input.personId, from + DAY_MS, from + 2 * DAY_MS);

  return digest(input, "evening", "This evening", [
    section("open", "Still open", today.filter((c) => c.kind === "task-due" || c.kind === "task-overdue")),
    section("prepare", "For tomorrow", tomorrow.filter((c) => c.kind === "event-lead" || c.kind === "task-due")),
    section("care", "Care tomorrow", tomorrow.filter((c) => c.kind === "protocol-instance")),
    heldBack(input),
  ]);
}

/** The week ahead (FR-1306) — long enough out that something can still be done. */
export function weeklyPreview(input: DigestInput): Digest {
  const from = startOfDay(input.at);
  const week = inWindow(input.candidates, input.personId, from, from + 7 * DAY_MS);

  return digest(input, "weekly-preview", "The week ahead", [
    section("gaps", "Uncovered days", week.filter((c) => c.kind === "care-gap")),
    section("deadlines", "Deadlines", week.filter((c) => c.kind === "deadline-stage")),
    section("appointments", "Appointments", week.filter((c) => c.kind === "event-lead")),
    section("conflicts", "Clashes", week.filter((c) => c.kind === "conflict")),
    section("tasks", "Tasks", week.filter((c) => c.kind === "task-due")),
  ]);
}

/**
 * The week behind (FR-1306).
 *
 * It reports what slipped and what is still open — never a completion rate. A
 * number that looks like a score turns into score-keeping between adults, which
 * is a binding non-goal (§1.3).
 */
export function weeklyReview(input: DigestInput): Digest {
  const to = startOfDay(input.at) + DAY_MS;
  const week = inWindow(input.candidates, input.personId, to - 7 * DAY_MS, to);

  return digest(input, "weekly-review", "The week behind", [
    section("slipped", "Slipped", week.filter((c) => c.kind === "task-overdue")),
    section("open", "Still open", week.filter((c) => c.kind === "task-due")),
    section("care", "Care", week.filter((c) => c.kind === "protocol-instance")),
    heldBack(input),
  ]);
}

function heldBack(input: DigestInput): DigestSection {
  return section("held-back", "Held back for you", (input.bundled ?? []).filter((c) => c.personId === input.personId));
}

function digest(input: DigestInput, kind: DigestKind, title: string, sections: readonly DigestSection[]): Digest {
  // Empty sections are dropped rather than rendered blank: a digest with five
  // headings and one line reads as noise (P-04).
  const filled = sections.filter((s) => s.items.length > 0);

  return {
    id: derivedId("digest", kind, input.personId, String(startOfDay(input.at))),
    personId: input.personId,
    kind,
    at: input.at,
    title,
    sections: filled,
    itemCount: filled.reduce((sum, s) => sum + s.items.length, 0),
  };
}

function section(key: string, heading: string, items: readonly NotificationCandidate[]): DigestSection {
  return { key, heading, items: [...items].sort(compareCandidates) };
}

function inWindow(
  candidates: readonly NotificationCandidate[],
  personId: string,
  from: number,
  to: number,
): readonly NotificationCandidate[] {
  return candidates.filter((c) => c.personId === personId && c.at >= from && c.at < to);
}

/**
 * Escalating lead points before a due date (FR-1302).
 *
 * A yearly task — winter service, vehicle inspection — is useless as a push on
 * the day it is due (FR-320), and an event needs its preparation early enough to
 * still buy the gift (FR-213). One function serves both: the stages are days
 * before, the urgency climbs as they run out.
 */
export const DEFAULT_LEAD_STAGE_DAYS: readonly number[] = [28, 14, 7, 2, 0];

export interface LeadWarning {
  readonly at: number;
  readonly daysBefore: number;
  /** 0 is the earliest stage; the last one is the deadline itself. */
  readonly stage: number;
  readonly isFinal: boolean;
  readonly priority: NotificationPriority;
  /** Already elapsed at `now` — a stage added late must not fire retroactively. */
  readonly passed: boolean;
}

export function multiStageLeadWarnings(
  dueAt: number,
  now: number,
  stages: readonly number[] = DEFAULT_LEAD_STAGE_DAYS,
): readonly LeadWarning[] {
  const days = [...new Set(stages.filter((d) => Number.isFinite(d) && d >= 0))].sort((a, b) => b - a);
  if (days.length === 0) return [];

  return days.map((daysBefore, index) => {
    const at = dueAt - daysBefore * DAY_MS;
    return {
      at,
      daysBefore,
      stage: index,
      isFinal: index === days.length - 1,
      priority: leadPriority(index, days.length),
      passed: at <= now,
    };
  });
}

/** Low while there is time, critical once there is none — the escalation itself. */
function leadPriority(index: number, count: number): NotificationPriority {
  if (index === count - 1) return "critical";
  if (index >= count - 2) return "high";
  if (index === 0 && count > 2) return "low";
  return "normal";
}

/** Turn due protocol reminders into candidates for every responsible adult (FR-916). */
export function protocolCandidates(
  instances: readonly ProtocolInstance[],
  recipientIds: readonly string[],
  wakeCapable: boolean,
): readonly NotificationCandidate[] {
  return instances.flatMap((instance) =>
    recipientIds.map((personId) => ({
      // One per adult, so the ids stay distinct while both stay derivable.
      id: derivedId("notification", "protocol-instance", instance.id, String(instance.dueAt), personId),
      personId,
      kind: "protocol-instance" as const,
      priority: defaultPriority("protocol-instance"),
      subjectEntityType: "protocolInstance",
      subjectEntityId: instance.id,
      at: instance.dueAt,
      title: instance.label,
      body: instance.kind === "measurement" ? "Measurement due" : "Dose due",
      wakeCapable,
    })),
  );
}

export interface OverdueEscalation {
  readonly taskId: string;
  readonly title: string;
  /** Every task has exactly one owner (P-02, FR-301). */
  readonly ownerId: string;
  /** Who ran into it. Recorded, never notified — see below. */
  readonly noticedBy?: string;
  readonly dueAt: number;
  readonly now: number;
}

/**
 * Overdue escalation goes to the owner (FR-314, FR-1307).
 *
 * Deliberately not to whoever noticed: routing it there is how a household ends
 * up with one person chasing everybody else, which is the mental-load problem
 * the app exists to remove (§7, P-02).
 */
export function escalateOverdue(input: OverdueEscalation): NotificationCandidate {
  const overdueDays = Math.floor((input.now - input.dueAt) / DAY_MS);

  return {
    id: notificationId("task-overdue", input.taskId, input.dueAt),
    personId: input.ownerId,
    kind: "task-overdue",
    priority: defaultPriority("task-overdue"),
    subjectEntityType: "task",
    subjectEntityId: input.taskId,
    at: input.now,
    title: input.title,
    body: overdueDays >= 1 ? `Overdue by ${overdueDays} day(s)` : "Overdue",
    wakeCapable: false,
  };
}

export type MemberRole = "adult" | "teen" | "child" | "guest" | "separated-parent";

export interface FamilyMember {
  readonly personId: string;
  readonly role: MemberRole;
  /** Children have no account and often no phone (FR-115, FR-1310). */
  readonly hasOwnDevice: boolean;
  /** Who looks after this person — the fallback addressee (FR-1310). */
  readonly caringAdultIds?: readonly string[];
  /**
   * Presence the family entered itself (FR-1311). There is deliberately no
   * derivation from position: location tracking of family members is a binding
   * non-goal (§1.3), so an unanswered presence question stays unanswered.
   */
  readonly presentAtHome?: boolean;
  /** Away on a trip, shift or in hospital (FR-110) — not a recipient. */
  readonly absent?: boolean;
}

export interface FamilyRouting {
  readonly members: readonly FamilyMember[];
  /** Kitchen tablet(s), permanently signed in as the household (FR-116). */
  readonly sharedDeviceIds?: readonly string[];
}

export type RecipientChannel = "person-device" | "shared-device" | "adult-task";

export interface Recipient {
  readonly personId: string | undefined;
  readonly deviceId: string | undefined;
  readonly channel: RecipientChannel;
  /** Plain-language justification — the routing must be answerable to a human. */
  readonly reason: string;
}

/**
 * Resolve a candidate to the people and devices that will actually see it
 * (FR-1310, FR-1311).
 */
export function routeToRecipients(
  candidate: NotificationCandidate,
  family: FamilyRouting,
): readonly Recipient[] {
  const targets = candidate.audience === undefined
    ? [candidate.personId]
    : resolveAudience(candidate.audience, family);

  const out: Recipient[] = [];
  for (const personId of targets) {
    out.push(...routeOne(personId, family));
  }

  const seen = new Set<string>();
  return out
    .filter((r) => {
      const key = `${r.channel}|${r.personId ?? ""}|${r.deviceId ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : 0));
}

function resolveAudience(audience: RoleAudience, family: FamilyRouting): readonly string[] {
  const available = family.members.filter((m) => m.absent !== true);
  const adults = available.filter((m) => m.role === "adult" || m.role === "separated-parent");

  if (audience === "any-adult") return adults.map((m) => m.personId);

  // "Whoever is at home right now" — answered only by what somebody told the app.
  // If nobody has, the app says nothing clever and asks all the adults (P-08).
  const atHome = available.filter((m) => m.presentAtHome === true && m.role !== "guest");
  return (atHome.length > 0 ? atHome : adults).map((m) => m.personId);
}

function routeOne(personId: string, family: FamilyRouting): readonly Recipient[] {
  const member = family.members.find((m) => m.personId === personId);

  if (member === undefined || member.hasOwnDevice) {
    return [{ personId, deviceId: undefined, channel: "person-device", reason: "Has their own device" }];
  }

  const shared = family.sharedDeviceIds ?? [];
  if (shared.length > 0) {
    return shared.map((deviceId) => ({
      personId,
      deviceId,
      channel: "shared-device" as const,
      reason: "No own device — shown on the shared household device",
    }));
  }

  // No device anywhere: it becomes work for the adult who looks after them,
  // because an unreachable child is not a reason for something to go undone.
  const caring = member.caringAdultIds ?? [];
  const fallback = caring.length > 0
    ? caring
    : family.members.filter((m) => m.role === "adult" && m.absent !== true).map((m) => m.personId);

  return fallback.map((adultId) => ({
    personId: adultId,
    deviceId: undefined,
    channel: "adult-task" as const,
    reason: `No device for ${personId} — handed to the caring adult`,
  }));
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function minutesIntoDay(at: number): number {
  const date = new Date(at);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}
