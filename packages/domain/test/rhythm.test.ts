import { describe, expect, it } from "vitest";
import { DAY_MS, calibrateInterval, computeRhythm, rankSuggestions, type Rhythm } from "@fam/domain";

const NOW = Date.parse("2026-07-28T08:00:00Z");

function daysAgo(days: number): number {
  return NOW - days * DAY_MS;
}

/** A weekly item bought on a stable rhythm, last purchase `sinceDays` ago. */
function weekly(itemKey: string, sinceDays: number, extra: Partial<Parameters<typeof computeRhythm>[0]> = {}) {
  return computeRhythm(
    {
      itemKey,
      purchases: [daysAgo(sinceDays + 21), daysAgo(sinceDays + 14), daysAgo(sinceDays + 7), daysAgo(sinceDays)],
      ...extra,
    },
    { now: NOW },
  );
}

describe("staples engine — claims nothing it cannot know", () => {
  it("says unknown while there are too few purchases (FR-732)", () => {
    const rhythm = computeRhythm({ itemKey: "capers", purchases: [daysAgo(30), daysAgo(3)] }, { now: NOW });

    expect(rhythm.state).toBe("unknown");
    expect(rhythm.intervalDays).toBeUndefined();
    expect(rhythm.confidence).toBe(0);
  });

  it("never produces a suggestion for a one-off purchase, however old (FR-741)", () => {
    const rhythm = computeRhythm({ itemKey: "cake tin", purchases: [daysAgo(400)] }, { now: NOW });
    const ranking = rankSuggestions([rhythm]);

    expect(rhythm.state).toBe("unknown");
    expect(ranking.probablyDue).toHaveLength(0);
    expect(ranking.more).toHaveLength(0);
  });

  it("uses the median so a bulk purchase does not distort the rhythm (FR-731)", () => {
    const rhythm = computeRhythm(
      {
        itemKey: "coffee",
        // Four ~7-day gaps and one 60-day gap after stocking up.
        purchases: [daysAgo(88), daysAgo(81), daysAgo(74), daysAgo(67), daysAgo(7)],
      },
      { now: NOW },
    );

    expect(rhythm.intervalDays).toBe(7);
  });
});

describe("staples engine — due states", () => {
  it("stays quiet well before the interval elapses", () => {
    expect(weekly("milk", 2).state).toBe("quiet");
  });

  it("warns shortly before the interval elapses", () => {
    expect(weekly("milk", 6).state).toBe("due-soon");
  });

  it("is due once the interval has elapsed (SPEC §10.2 acceptance 1)", () => {
    const rhythm = weekly("milk", 7);

    expect(rhythm.state).toBe("due");
    expect(rhythm.reason).toContain("usually every 7 days");
  });

  it("is overdue well past the interval", () => {
    expect(weekly("milk", 12).state).toBe("overdue");
  });

  it("lets a report override the prediction — reported beats predicted (FR-734)", () => {
    const rhythm = weekly("milk", 1, { emptyReports: [daysAgo(0.5)] });

    expect(rhythm.state).toBe("due");
    expect(rhythm.reported).toBe(true);
    expect(rhythm.reason).toBe("Reported as empty");
  });

  it("surfaces a reported item even when nothing about it is known yet", () => {
    const rhythm = computeRhythm({ itemKey: "yeast", purchases: [], emptyReports: [NOW] }, { now: NOW });

    expect(rhythm.state).toBe("due");
    expect(rhythm.reported).toBe(true);
  });

  it("pauses the clock while the family is away, so a holiday consumes nothing (FR-733)", () => {
    const rhythm = weekly("milk", 14, { pausedMs: 8 * DAY_MS });

    expect(rhythm.state).not.toBe("overdue");
  });
});

describe("staples engine — self-healing", () => {
  it("gets quieter after dismissals instead of more insistent (FR-742)", () => {
    const persistent = weekly("olives", 8);
    const dismissedTwice = weekly("olives", 8, { dismissals: [daysAgo(3), daysAgo(1)] });

    expect(persistent.state).toBe("due");
    expect(dismissedTwice.state).not.toBe("due");
    expect(dismissedTwice.reason).toContain("dismissed");
  });

  it("resets fully on the next purchase, so a missed event corrupts nothing (FR-738)", () => {
    const afterPurchase = weekly("milk", 0, { emptyReports: [daysAgo(3)], dismissals: [daysAgo(2)] });

    expect(afterPurchase.state).toBe("quiet");
    expect(afterPurchase.reported).toBe(false);
  });

  it("shortens the interval when the family runs out early (FR-737)", () => {
    expect(calibrateInterval(7, 4)).toBeLessThan(7);
  });

  it("lengthens the interval when it lasts longer than predicted", () => {
    expect(calibrateInterval(7, 12)).toBeGreaterThan(7);
  });

  it("damps calibration so one unusual week does not reset what was learned", () => {
    expect(calibrateInterval(7, 40)).toBeLessThan(20);
  });
});

describe("staples engine — the suggestion list", () => {
  it("scores a reliable rhythm above an erratic one", () => {
    const reliable = computeRhythm(
      { itemKey: "loo roll", purchases: [daysAgo(45), daysAgo(30), daysAgo(15), daysAgo(16)] },
      { now: NOW },
    );
    const erratic = computeRhythm(
      { itemKey: "olives", purchases: [daysAgo(120), daysAgo(50), daysAgo(45), daysAgo(20)] },
      { now: NOW },
    );

    expect(reliable.confidence).toBeGreaterThan(erratic.confidence);
  });

  it("shows reported items separately from predicted ones (FR-739)", () => {
    const rhythms: Rhythm[] = [weekly("milk", 8), weekly("bread", 1, { emptyReports: [NOW] })];
    const ranking = rankSuggestions(rhythms);

    expect(ranking.reported.map((r) => r.itemKey)).toEqual(["bread"]);
    expect(ranking.probablyDue.map((r) => r.itemKey)).toEqual(["milk"]);
  });

  it("caps what is visible and keeps the rest behind an expander (FR-742)", () => {
    const many = Array.from({ length: 9 }, (_, i) => weekly("item-" + i, 9));
    const ranking = rankSuggestions(many, 5);

    expect(ranking.probablyDue).toHaveLength(5);
    expect(ranking.more).toHaveLength(4);
  });

  it("ranks overdue above merely due", () => {
    const ranking = rankSuggestions([weekly("soon", 6), weekly("late", 15), weekly("due", 7)]);

    expect(ranking.probablyDue[0]?.itemKey).toBe("late");
  });
});
