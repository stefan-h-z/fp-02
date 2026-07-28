import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_BUDGET,
  DEFAULT_LEAD_STAGE_DAYS,
  budgetFor,
  defaultPriority,
  escalateOverdue,
  eveningClose,
  isWithinQuietHours,
  morningBriefing,
  multiStageLeadWarnings,
  nextDigest,
  notificationId,
  planNotifications,
  protocolCandidates,
  quietHoursEndAt,
  routeToRecipients,
  weeklyPreview,
  weeklyReview,
  type FamilyRouting,
  type NotificationCandidate,
  type NotificationKind,
  type NotificationPriority,
  type NotificationSettings,
  type ProtocolInstance,
  type QuietHours,
} from "@fam/domain";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
/** A Wednesday, 10:00 UTC — safely outside any quiet window under test. */
const NOON = Date.parse("2026-08-05T10:00:00Z");
const MIDNIGHT = Date.parse("2026-08-05T00:00:00Z");

function candidate(overrides: Partial<NotificationCandidate> = {}): NotificationCandidate {
  const kind: NotificationKind = overrides.kind ?? "task-due";
  return {
    id: overrides.id ?? `n-${Math.random().toString(36).slice(2)}`,
    personId: "p-mum",
    kind,
    priority: overrides.priority ?? defaultPriority(kind),
    subjectEntityType: "task",
    subjectEntityId: "t-1",
    at: NOON,
    title: "Something",
    body: "",
    wakeCapable: false,
    ...overrides,
  };
}

function many(count: number, overrides: Partial<NotificationCandidate> = {}): NotificationCandidate[] {
  return Array.from({ length: count }, (_, i) => candidate({ id: `n-${i}`, ...overrides }));
}

const quiet = (over: Partial<QuietHours> = {}): QuietHours => ({
  enabled: true,
  startMinute: 21 * 60,
  endMinute: 6 * 60,
  ...over,
});

describe("daily budget (FR-1309, decision 24)", () => {
  it("defaults to five action-requiring pushes per person", () => {
    expect(DEFAULT_DAILY_BUDGET).toBe(5);
    expect(budgetFor({}, "p-mum")).toBe(5);
  });

  it("bundles the overflow into the digest instead of dropping it", () => {
    const candidates = many(8);

    const plan = planNotifications(candidates, {}, NOON);

    expect(plan.delivered).toHaveLength(5);
    expect(plan.bundled).toHaveLength(3);
    expect(plan.bundled.every((b) => b.reason === "budget")).toBe(true);
    // Nothing may vanish: every candidate is accounted for somewhere.
    expect(plan.delivered.length + plan.bundled.length + plan.suppressed.length).toBe(candidates.length);
  });

  it("continues where the day left off rather than starting over", () => {
    const plan = planNotifications(many(3), { perPerson: { "p-mum": { spentToday: 4 } } }, NOON);

    expect(plan.delivered).toHaveLength(1);
    expect(plan.bundled).toHaveLength(2);
  });

  it("counts per person, so one person's noisy day does not silence another", () => {
    const plan = planNotifications([...many(6), ...many(2, { personId: "p-dad" })], {}, NOON);

    expect(plan.delivered.filter((d) => d.candidate.personId === "p-mum")).toHaveLength(5);
    expect(plan.delivered.filter((d) => d.candidate.personId === "p-dad")).toHaveLength(2);
  });

  it("respects a per-person budget over the family default", () => {
    const settings: NotificationSettings = { dailyBudget: 4, perPerson: { "p-mum": { dailyBudget: 1 } } };

    expect(budgetFor(settings, "p-mum")).toBe(1);
    expect(budgetFor(settings, "p-dad")).toBe(4);
    expect(planNotifications(many(3), settings, NOON).delivered).toHaveLength(1);
  });

  it("sends the overflow to the next digest that is actually coming", () => {
    const morningPlan = planNotifications(many(6, { at: Date.parse("2026-08-05T21:30:00Z") }), {}, NOON);

    expect(morningPlan.bundled[0]?.digest).toBe("morning");
    expect(nextDigest(NOON, {}).kind).toBe("evening");
  });
});

describe("what the budget must never take", () => {
  it("still delivers a protocol reminder once the budget is spent (decision 24)", () => {
    const drops = candidate({ id: "n-drops", kind: "protocol-instance", subjectEntityType: "protocolInstance" });

    const plan = planNotifications([...many(2), drops], { perPerson: { "p-mum": { spentToday: 5 } } }, NOON);

    expect(plan.delivered.map((d) => d.candidate.id)).toEqual(["n-drops"]);
    expect(plan.delivered[0]?.cost).toBe("exempt-protocol");
    expect(plan.bundled).toHaveLength(2);
  });

  it("does not let protocol reminders consume the allowance either", () => {
    const plan = planNotifications([...many(3, { kind: "protocol-instance" }), ...many(5)], {}, NOON);

    expect(plan.delivered).toHaveLength(8);
    expect(plan.bundled).toHaveLength(0);
  });

  it("delivers silent information without spending budget (FR-1308)", () => {
    const plan = planNotifications([...many(4, { silent: true, kind: "staple-suggestion" }), ...many(5)], {}, NOON);

    expect(plan.delivered).toHaveLength(9);
    expect(plan.delivered.filter((d) => d.cost === "silent")).toHaveLength(4);
  });
});

describe("priority ordering", () => {
  it("keeps the important thing when the budget bites", () => {
    const overdue = candidate({ id: "n-overdue", kind: "task-overdue" });
    const suggestion = candidate({ id: "n-staple", kind: "staple-suggestion" });

    const plan = planNotifications([suggestion, overdue], { dailyBudget: 1 }, NOON);

    expect(plan.delivered.map((d) => d.candidate.id)).toEqual(["n-overdue"]);
    expect(plan.bundled.map((b) => b.candidate.id)).toEqual(["n-staple"]);
  });

  it("orders equal priorities by time, then by id, so a replan agrees with itself", () => {
    const late = candidate({ id: "n-a", at: NOON + HOUR });
    const early = candidate({ id: "n-b", at: NOON });

    const plan = planNotifications([late, early], { dailyBudget: 1 }, NOON);

    expect(plan.delivered.map((d) => d.candidate.id)).toEqual(["n-b"]);
  });

  it("ranks health above everything and suggestions below everything", () => {
    const ranked: readonly NotificationPriority[] = [
      defaultPriority("protocol-instance"),
      defaultPriority("conflict"),
      defaultPriority("task-due"),
      defaultPriority("staple-suggestion"),
    ];

    expect(ranked).toEqual(["critical", "high", "normal", "low"]);
  });
});

describe("quiet hours (decision 23, FR-1304)", () => {
  it("is off unless a family switched it on", () => {
    const atNight = candidate({ at: Date.parse("2026-08-05T23:30:00Z") });

    expect(isWithinQuietHours(undefined, atNight.at)).toBe(false);
    expect(planNotifications([atNight], {}, atNight.at).delivered).toHaveLength(1);
  });

  it("stays off when a window is configured but not enabled", () => {
    const at = Date.parse("2026-08-05T23:30:00Z");

    expect(isWithinQuietHours(quiet({ enabled: false }), at)).toBe(false);
  });

  it("holds ordinary notifications and names when they are released", () => {
    const at = Date.parse("2026-08-05T23:30:00Z");

    const plan = planNotifications([candidate({ id: "n-1", at })], { quietHours: quiet() }, at);

    expect(plan.delivered).toHaveLength(0);
    expect(plan.suppressed[0]?.reason).toBe("quiet-hours");
    expect(plan.suppressed[0]?.releaseAt).toBe(Date.parse("2026-08-06T06:00:00Z"));
  });

  it("lets a wake-capable item break through (FR-921)", () => {
    const at = Date.parse("2026-08-05T23:30:00Z");
    const drops = candidate({ id: "n-drops", kind: "protocol-instance", at, wakeCapable: true });
    const chore = candidate({ id: "n-chore", at });

    const plan = planNotifications([drops, chore], { quietHours: quiet() }, at);

    expect(plan.delivered.map((d) => d.candidate.id)).toEqual(["n-drops"]);
    expect(plan.suppressed.map((s) => s.candidate.id)).toEqual(["n-chore"]);
  });

  it("does not spend the budget on what it holds back", () => {
    const at = Date.parse("2026-08-05T23:30:00Z");
    const wake = many(3, { at, wakeCapable: true }).map((c, i) => ({ ...c, id: `w-${i}` }));
    const held = many(5, { at }).map((c, i) => ({ ...c, id: `h-${i}` }));

    const plan = planNotifications([...wake, ...held], { quietHours: quiet(), dailyBudget: 2 }, at);

    // Two of the three wake-capable items fit the budget; the five held ones did
    // not eat into it on their way to the bundle.
    expect(plan.delivered).toHaveLength(2);
    expect(plan.bundled).toHaveLength(1);
    expect(plan.suppressed).toHaveLength(5);
  });

  it("uses a per-person window over the family one", () => {
    const at = Date.parse("2026-08-05T14:30:00Z");
    const settings: NotificationSettings = {
      quietHours: quiet(),
      perPerson: { "p-mum": { quietHours: quiet({ startMinute: 14 * 60, endMinute: 15 * 60 }) } },
    };

    const plan = planNotifications([candidate({ personId: "p-mum", at }), candidate({ personId: "p-dad", at })], settings, at);

    expect(plan.suppressed.map((s) => s.candidate.personId)).toEqual(["p-mum"]);
    expect(plan.delivered.map((d) => d.candidate.personId)).toEqual(["p-dad"]);
  });

  it("computes the end of a window that does not wrap past midnight", () => {
    const at = Date.parse("2026-08-05T14:30:00Z");
    const window = quiet({ startMinute: 14 * 60, endMinute: 15 * 60 });

    expect(quietHoursEndAt(window, at)).toBe(Date.parse("2026-08-05T15:00:00Z"));
    expect(quietHoursEndAt(window, NOON)).toBe(NOON);
  });
});

describe("per-person muting (FR-1301)", () => {
  it("suppresses a muted kind with nothing to release later", () => {
    const settings: NotificationSettings = { perPerson: { "p-mum": { mutedKinds: ["staple-suggestion"] } } };

    const plan = planNotifications([candidate({ kind: "staple-suggestion" })], settings, NOON);

    expect(plan.suppressed[0]?.reason).toBe("muted");
    expect(plan.suppressed[0]?.releaseAt).toBeUndefined();
  });
});

describe("digests (FR-1305, FR-1306)", () => {
  const today = [
    candidate({ id: "d-1", kind: "protocol-instance", at: MIDNIGHT + 8 * HOUR }),
    candidate({ id: "d-2", kind: "task-overdue", at: MIDNIGHT + 9 * HOUR }),
    candidate({ id: "d-3", kind: "task-due", at: MIDNIGHT + 12 * HOUR }),
    candidate({ id: "d-4", kind: "event-lead", at: MIDNIGHT + 16 * HOUR }),
  ];

  it("collects today's items into the morning briefing", () => {
    const digest = morningBriefing({ personId: "p-mum", at: MIDNIGHT + 7 * HOUR, candidates: today });

    expect(digest.kind).toBe("morning");
    expect(digest.itemCount).toBe(4);
    expect(digest.sections.map((s) => s.key)).toEqual(["care", "attention", "day", "due"]);
  });

  it("drops empty sections rather than rendering blank headings", () => {
    const digest = morningBriefing({
      personId: "p-mum",
      at: MIDNIGHT + 7 * HOUR,
      candidates: [candidate({ kind: "task-due", at: MIDNIGHT + 12 * HOUR })],
    });

    expect(digest.sections.map((s) => s.key)).toEqual(["due"]);
  });

  it("honours what the budget held back, so the app visibly keeps its word", () => {
    const digest = morningBriefing({
      personId: "p-mum",
      at: MIDNIGHT + 7 * HOUR,
      candidates: [],
      bundled: [candidate({ id: "b-1" }), candidate({ id: "b-2", personId: "p-dad" })],
    });

    expect(digest.sections.map((s) => s.key)).toEqual(["held-back"]);
    expect(digest.sections[0]?.items.map((i) => i.id)).toEqual(["b-1"]);
  });

  it("ignores other people's candidates entirely", () => {
    const digest = morningBriefing({
      personId: "p-dad",
      at: MIDNIGHT + 7 * HOUR,
      candidates: today,
    });

    expect(digest.itemCount).toBe(0);
  });

  it("puts tomorrow's preparation into the evening close", () => {
    const digest = eveningClose({
      personId: "p-mum",
      at: MIDNIGHT + 20 * HOUR,
      candidates: [...today, candidate({ id: "d-5", kind: "event-lead", at: MIDNIGHT + DAY + 8 * HOUR })],
    });

    expect(digest.sections.find((s) => s.key === "open")?.items.map((i) => i.id)).toEqual(["d-2", "d-3"]);
    expect(digest.sections.find((s) => s.key === "prepare")?.items.map((i) => i.id)).toEqual(["d-5"]);
  });

  it("previews the coming seven days and stops there", () => {
    const digest = weeklyPreview({
      personId: "p-mum",
      at: MIDNIGHT,
      candidates: [
        candidate({ id: "w-1", kind: "care-gap", at: MIDNIGHT + 3 * DAY }),
        candidate({ id: "w-2", kind: "deadline-stage", at: MIDNIGHT + 6 * DAY }),
        candidate({ id: "w-3", kind: "event-lead", at: MIDNIGHT + 9 * DAY }),
      ],
    });

    expect(digest.itemCount).toBe(2);
    expect(digest.sections.map((s) => s.key)).toEqual(["gaps", "deadlines"]);
  });

  it("reviews the week behind without producing a score", () => {
    const digest = weeklyReview({
      personId: "p-mum",
      at: MIDNIGHT,
      candidates: [
        candidate({ id: "r-1", kind: "task-overdue", at: MIDNIGHT - 2 * DAY }),
        candidate({ id: "r-2", kind: "task-due", at: MIDNIGHT - 1 * DAY }),
        candidate({ id: "r-3", kind: "task-overdue", at: MIDNIGHT - 30 * DAY }),
      ],
    });

    expect(digest.sections.find((s) => s.key === "slipped")?.items.map((i) => i.id)).toEqual(["r-1"]);
    expect(Object.keys(digest)).not.toContain("score");
  });

  it("gives the same digest a stable id across recomputation", () => {
    const input = { personId: "p-mum", at: MIDNIGHT + 7 * HOUR, candidates: today };

    expect(morningBriefing(input).id).toBe(morningBriefing({ ...input, at: MIDNIGHT + 8 * HOUR }).id);
  });
});

describe("multi-stage lead warnings (FR-1302, FR-320)", () => {
  const due = Date.parse("2026-12-01T09:00:00Z");

  it("warns weeks ahead of a yearly task instead of on the day", () => {
    const stages = multiStageLeadWarnings(due, due - 60 * DAY);

    expect(stages).toHaveLength(DEFAULT_LEAD_STAGE_DAYS.length);
    expect(stages[0]?.daysBefore).toBe(28);
    expect(stages[0]?.at).toBe(due - 28 * DAY);
    expect(stages.every((s) => !s.passed)).toBe(true);
  });

  it("escalates towards the deadline and ends critical", () => {
    const stages = multiStageLeadWarnings(due, due - 60 * DAY);
    const last = stages[stages.length - 1];

    expect(stages[0]?.priority).toBe("low");
    expect(last?.priority).toBe("critical");
    expect(last?.isFinal).toBe(true);
    expect(last?.at).toBe(due);
  });

  it("marks stages that have already gone by, so nothing fires retroactively", () => {
    const stages = multiStageLeadWarnings(due, due - 5 * DAY);

    expect(stages.filter((s) => s.passed).map((s) => s.daysBefore)).toEqual([28, 14, 7]);
    expect(stages.filter((s) => !s.passed).map((s) => s.daysBefore)).toEqual([2, 0]);
  });

  it("accepts custom stages, sorting and de-duplicating them", () => {
    const stages = multiStageLeadWarnings(due, due - 100 * DAY, [3, 10, 3, -1]);

    expect(stages.map((s) => s.daysBefore)).toEqual([10, 3]);
    expect(stages[1]?.isFinal).toBe(true);
  });

  it("returns nothing when there are no usable stages", () => {
    expect(multiStageLeadWarnings(due, due, [])).toEqual([]);
  });

  it("serves event preparation with the same shape (FR-213)", () => {
    const party = Date.parse("2026-09-12T15:00:00Z");

    const stages = multiStageLeadWarnings(party, party - 20 * DAY, [14, 7, 1]);

    expect(stages.map((s) => s.at)).toEqual([party - 14 * DAY, party - 7 * DAY, party - 1 * DAY]);
  });
});

describe("escalation goes to the owner (FR-1307, FR-314)", () => {
  it("addresses the owner and not the person who noticed", () => {
    const escalation = escalateOverdue({
      taskId: "t-bins",
      title: "Put the bins out",
      ownerId: "p-dad",
      noticedBy: "p-mum",
      dueAt: NOON - 2 * DAY,
      now: NOON,
    });

    expect(escalation.personId).toBe("p-dad");
    expect(escalation.kind).toBe("task-overdue");
    expect(escalation.body).toContain("2");
  });

  it("produces a stable id, so a task does not escalate twice for the same due date", () => {
    const input = { taskId: "t-bins", title: "Put the bins out", ownerId: "p-dad", dueAt: NOON - DAY, now: NOON };

    expect(escalateOverdue(input).id).toBe(escalateOverdue({ ...input, now: NOON + HOUR }).id);
    expect(escalateOverdue(input).id).toBe(notificationId("task-overdue", "t-bins", NOON - DAY));
  });

  it("outranks the day's noise in the plan", () => {
    const escalation = escalateOverdue({
      taskId: "t-bins",
      title: "Put the bins out",
      ownerId: "p-dad",
      dueAt: NOON - DAY,
      now: NOON,
    });

    const plan = planNotifications(
      [...many(2, { personId: "p-dad", kind: "staple-suggestion" }), escalation],
      { dailyBudget: 1 },
      NOON,
    );

    expect(plan.delivered.map((d) => d.candidate.id)).toEqual([escalation.id]);
  });
});

describe("routing (FR-1310, FR-1311)", () => {
  const family: FamilyRouting = {
    members: [
      { personId: "p-mum", role: "adult", hasOwnDevice: true, presentAtHome: true },
      { personId: "p-dad", role: "adult", hasOwnDevice: true },
      { personId: "p-kid", role: "child", hasOwnDevice: false, caringAdultIds: ["p-mum"] },
    ],
    sharedDeviceIds: ["kitchen-tablet"],
  };

  it("delivers to an adult's own device", () => {
    const recipients = routeToRecipients(candidate({ personId: "p-mum" }), family);

    expect(recipients).toEqual([{ personId: "p-mum", deviceId: undefined, channel: "person-device", reason: "Has their own device" }]);
  });

  it("routes a child without a device to the shared kitchen device", () => {
    const recipients = routeToRecipients(candidate({ personId: "p-kid" }), family);

    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.channel).toBe("shared-device");
    expect(recipients[0]?.deviceId).toBe("kitchen-tablet");
  });

  it("falls back to the caring adult when the family has no shared device", () => {
    const recipients = routeToRecipients(candidate({ personId: "p-kid" }), { members: family.members });

    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.channel).toBe("adult-task");
    expect(recipients[0]?.personId).toBe("p-mum");
  });

  it("hands an unaccompanied child's reminder to the adults rather than dropping it", () => {
    const recipients = routeToRecipients(candidate({ personId: "p-kid" }), {
      members: [
        { personId: "p-mum", role: "adult", hasOwnDevice: true },
        { personId: "p-dad", role: "adult", hasOwnDevice: true },
        { personId: "p-kid", role: "child", hasOwnDevice: false },
      ],
    });

    expect(recipients.map((r) => r.personId).sort()).toEqual(["p-dad", "p-mum"]);
    expect(recipients.every((r) => r.channel === "adult-task")).toBe(true);
  });

  it("resolves 'whoever is at home' from presence the family supplied itself", () => {
    const recipients = routeToRecipients(candidate({ audience: "at-home" }), family);

    expect(recipients.map((r) => r.personId)).toEqual(["p-mum"]);
  });

  it("asks all the adults when nobody has said who is at home — never a location", () => {
    const nobodyDeclared: FamilyRouting = {
      members: family.members.map((m) => ({ personId: m.personId, role: m.role, hasOwnDevice: m.hasOwnDevice })),
    };

    const recipients = routeToRecipients(candidate({ audience: "at-home" }), nobodyDeclared);

    expect(recipients.map((r) => r.personId).sort()).toEqual(["p-dad", "p-mum"]);
  });

  it("leaves absent members out of a role address (FR-110)", () => {
    const recipients = routeToRecipients(candidate({ audience: "any-adult" }), {
      members: [
        { personId: "p-mum", role: "adult", hasOwnDevice: true, absent: true },
        { personId: "p-dad", role: "adult", hasOwnDevice: true },
      ],
    });

    expect(recipients.map((r) => r.personId)).toEqual(["p-dad"]);
  });

  it("does not deliver the same thing twice", () => {
    const recipients = routeToRecipients(candidate({ personId: "p-mum", audience: "any-adult" }), {
      members: [
        { personId: "p-mum", role: "adult", hasOwnDevice: true },
        { personId: "p-mum", role: "adult", hasOwnDevice: true },
      ],
    });

    expect(recipients).toHaveLength(1);
  });
});

describe("protocol candidates", () => {
  const instance: ProtocolInstance = {
    id: "~protocolInstance|proto-1|1",
    protocolId: "proto-1",
    personId: "p-kid",
    label: "Eye drops",
    kind: "acknowledgement",
    dueAt: NOON,
    state: "due",
    acknowledgedBy: undefined,
    acknowledgedAt: undefined,
    measuredValue: undefined,
    skipNote: undefined,
  };

  it("reminds every responsible adult, not one designated person (FR-916)", () => {
    const candidates = protocolCandidates([instance], ["p-mum", "p-dad"], false);

    expect(candidates.map((c) => c.personId)).toEqual(["p-mum", "p-dad"]);
    expect(candidates.every((c) => c.priority === "critical")).toBe(true);
  });

  it("carries the protocol's own wake permission through to the plan (FR-921)", () => {
    const at = Date.parse("2026-08-05T23:30:00Z");
    const nightly = { ...instance, dueAt: at };

    const plan = planNotifications(protocolCandidates([nightly], ["p-mum"], true), { quietHours: quiet() }, at);

    expect(plan.delivered).toHaveLength(1);
    expect(plan.suppressed).toHaveLength(0);
  });
});
