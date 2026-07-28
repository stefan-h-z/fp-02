import { describe, expect, it } from "vitest";
import {
  isCovered,
  pendingRequestsFor,
  planCooking,
  planStudy,
  sleepsUntil,
  unansweredBy,
  type AppointmentRequest,
} from "@fam/domain";

const SERVE = Date.parse("2026-08-03T18:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("getting several dishes ready together (FR-531)", () => {
  it("starts each dish so that it finishes at serving time", () => {
    const timeline = planCooking(
      [
        { recipeId: "r-roast", title: "Roast", activeMinutes: 15, passiveMinutes: 90 },
        { recipeId: "r-beans", title: "Beans", activeMinutes: 5, passiveMinutes: 10 },
      ],
      SERVE,
    );

    const roastStart = timeline.steps.find((s) => s.recipeId === "r-roast" && s.kind === "active");
    const beansStart = timeline.steps.find((s) => s.recipeId === "r-beans" && s.kind === "active");

    expect(roastStart?.startAt).toBe(SERVE - 105 * 60_000);
    expect(beansStart?.startAt).toBe(SERVE - 15 * 60_000);
  });

  it("says when the cook would have to be in two places at once", () => {
    const timeline = planCooking(
      [
        { recipeId: "r-a", title: "A", activeMinutes: 30, passiveMinutes: 0 },
        { recipeId: "r-b", title: "B", activeMinutes: 30, passiveMinutes: 0 },
      ],
      SERVE,
    );

    expect(timeline.overloaded).toBe(true);
  });

  it("does not complain when the hands-on stretches do not overlap", () => {
    const timeline = planCooking(
      [
        { recipeId: "r-a", title: "A", activeMinutes: 10, passiveMinutes: 60 },
        { recipeId: "r-b", title: "B", activeMinutes: 10, passiveMinutes: 0 },
      ],
      SERVE,
    );

    expect(timeline.overloaded).toBe(false);
  });

  it("places a defrost far enough ahead of the cooking (FR-609)", () => {
    const timeline = planCooking(
      [{ recipeId: "r-fish", title: "Fish", activeMinutes: 20, passiveMinutes: 0, leadMinutes: 480 }],
      SERVE,
    );

    const lead = timeline.steps.find((s) => s.kind === "lead");
    expect(lead?.startAt).toBe(SERVE - 20 * 60_000 - 480 * 60_000);
  });

  it("reports when the whole evening's cooking has to begin", () => {
    const timeline = planCooking(
      [
        { recipeId: "r-a", title: "A", activeMinutes: 10, passiveMinutes: 0 },
        { recipeId: "r-b", title: "B", activeMinutes: 10, passiveMinutes: 110 },
      ],
      SERVE,
    );

    expect(timeline.startAt).toBe(SERVE - 120 * 60_000);
  });

  it("handles an empty evening without inventing steps", () => {
    const timeline = planCooking([], SERVE);

    expect(timeline.steps).toHaveLength(0);
    expect(timeline.startAt).toBe(SERVE);
  });
});

describe("planning backwards from an exam (FR-805)", () => {
  const EXAM = Date.parse("2026-08-10T09:00:00Z");
  const START = Date.parse("2026-08-03T09:00:00Z");

  it("spreads the topics over the days available", () => {
    const blocks = planStudy({
      examAt: EXAM,
      topics: ["Vocabulary", "Grammar", "Reading"],
      minutesPerSession: 30,
      startFrom: START,
    });

    expect(blocks.filter((b) => b.kind === "learn")).toHaveLength(3);
    expect(new Set(blocks.map((b) => b.at)).size).toBeGreaterThan(1);
  });

  it("keeps the last day before the exam for review", () => {
    const blocks = planStudy({
      examAt: EXAM,
      topics: ["Vocabulary", "Grammar"],
      minutesPerSession: 30,
      startFrom: START,
    });

    expect(blocks.at(-1)?.kind).toBe("review");
    expect(blocks.at(-1)!.at).toBeLessThan(EXAM);
  });

  it("skips days the child is not available", () => {
    const matchDay = Date.parse("2026-08-05T00:00:00Z");
    const blocks = planStudy({
      examAt: EXAM,
      topics: ["Vocabulary", "Grammar", "Reading"],
      minutesPerSession: 30,
      startFrom: START,
      blockedDays: [matchDay],
    });

    const days = blocks.map((b) => new Date(b.at).toISOString().slice(0, 10));
    expect(days).not.toContain("2026-08-05");
  });

  it("plans nothing when there is no time left, rather than piling up today", () => {
    expect(planStudy({ examAt: START, topics: ["Vocabulary"], minutesPerSession: 30, startFrom: START })).toHaveLength(0);
  });

  it("plans nothing when there is nothing to learn", () => {
    expect(planStudy({ examAt: EXAM, topics: [], minutesPerSession: 30, startFrom: START })).toHaveLength(0);
  });
});

describe("asking whether somebody can (FR-216)", () => {
  const base: AppointmentRequest = {
    id: "req-1",
    askedById: "p-mum",
    askedOfId: "p-dad",
    subject: "Pick-up on Thursday",
    proposedAt: Date.parse("2026-08-06T15:00:00Z"),
    state: "asked",
    answeredAt: undefined,
    note: "",
  };

  it("does not count an unanswered question as cover", () => {
    expect(isCovered(base)).toBe(false);
  });

  it("counts an acceptance as cover", () => {
    expect(isCovered({ ...base, state: "accepted" })).toBe(true);
  });

  it("does not count a decline as cover", () => {
    expect(isCovered({ ...base, state: "declined" })).toBe(false);
  });

  it("shows a person what they have been asked, soonest first", () => {
    const later = { ...base, id: "req-2", proposedAt: base.proposedAt + DAY };
    const pending = pendingRequestsFor([later, base], "p-dad");

    expect(pending.map((r) => r.id)).toEqual(["req-1", "req-2"]);
  });

  it("does not show one person another person's questions", () => {
    expect(pendingRequestsFor([base], "p-mum")).toHaveLength(0);
  });

  it("surfaces a question the day has caught up with", () => {
    expect(unansweredBy([base], base.proposedAt + 3_600_000).map((r) => r.id)).toEqual(["req-1"]);
  });

  it("leaves an answered question alone even once the day arrives", () => {
    expect(unansweredBy([{ ...base, state: "declined" }], base.proposedAt + 3_600_000)).toHaveLength(0);
  });
});

describe("counting sleeps (FR-219)", () => {
  const now = Date.parse("2026-08-03T19:00:00Z");

  it("counts nights, not hours", () => {
    // Tomorrow morning is one sleep away, even though it is 14 hours off.
    expect(sleepsUntil(Date.parse("2026-08-04T09:00:00Z"), now)).toBe(1);
  });

  it("says none for today", () => {
    expect(sleepsUntil(Date.parse("2026-08-03T23:00:00Z"), now)).toBe(0);
  });

  it("never counts backwards for something already past", () => {
    expect(sleepsUntil(Date.parse("2026-07-30T09:00:00Z"), now)).toBe(0);
  });
});
