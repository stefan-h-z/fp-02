/**
 * Working backwards from a moment (SPEC FR-531, FR-805, FR-216, FR-219).
 *
 * Four small things that share one shape: something has to be true at a fixed
 * time, so the work has to start earlier — and working out how much earlier is
 * exactly the arithmetic people get wrong when they are tired.
 */
import { DAY_MS } from "./rhythm.js";

/* ------------------------------------------------------------------------- *
 * Getting several dishes ready at the same time (FR-531)
 * ------------------------------------------------------------------------- */

export interface DishPlan {
  readonly recipeId: string;
  readonly title: string;
  /** Hands-on time: chopping, stirring — the cook cannot do two at once. */
  readonly activeMinutes: number;
  /** Unattended time: baking, simmering, resting. */
  readonly passiveMinutes: number;
  /** Preparation that must happen much earlier: defrosting, soaking (FR-609). */
  readonly leadMinutes?: number;
}

export interface CookingStep {
  readonly recipeId: string;
  readonly title: string;
  readonly startAt: number;
  readonly kind: "lead" | "active" | "passive";
  readonly minutes: number;
}

export interface CookingTimeline {
  readonly serveAt: number;
  readonly startAt: number;
  readonly steps: readonly CookingStep[];
  /** True when the cook would have to be in two places at once. */
  readonly overloaded: boolean;
}

/**
 * Schedule several dishes so they land together.
 *
 * Each dish is placed by its own total duration counted back from serving, which
 * is what a cook does in their head. The one thing the app adds is noticing when
 * the hands-on stretches overlap — because that is the failure that makes dinner
 * late, and it is invisible until it happens.
 */
export function planCooking(dishes: readonly DishPlan[], serveAt: number): CookingTimeline {
  const steps: CookingStep[] = [];

  for (const dish of dishes) {
    const total = dish.activeMinutes + dish.passiveMinutes;
    const dishStart = serveAt - total * 60_000;

    if (dish.leadMinutes !== undefined && dish.leadMinutes > 0) {
      steps.push({
        recipeId: dish.recipeId,
        title: dish.title,
        startAt: dishStart - dish.leadMinutes * 60_000,
        kind: "lead",
        minutes: dish.leadMinutes,
      });
    }
    if (dish.activeMinutes > 0) {
      steps.push({
        recipeId: dish.recipeId,
        title: dish.title,
        startAt: dishStart,
        kind: "active",
        minutes: dish.activeMinutes,
      });
    }
    if (dish.passiveMinutes > 0) {
      steps.push({
        recipeId: dish.recipeId,
        title: dish.title,
        startAt: dishStart + dish.activeMinutes * 60_000,
        kind: "passive",
        minutes: dish.passiveMinutes,
      });
    }
  }

  steps.sort((a, b) => a.startAt - b.startAt || (a.recipeId < b.recipeId ? -1 : 1));

  return {
    serveAt,
    startAt: steps[0]?.startAt ?? serveAt,
    steps,
    overloaded: hasOverlappingActiveWork(steps),
  };
}

function hasOverlappingActiveWork(steps: readonly CookingStep[]): boolean {
  const active = steps.filter((step) => step.kind === "active");
  for (let i = 1; i < active.length; i += 1) {
    const previous = active[i - 1];
    const current = active[i];
    if (previous === undefined || current === undefined) continue;
    if (previous.startAt + previous.minutes * 60_000 > current.startAt) return true;
  }
  return false;
}

/* ------------------------------------------------------------------------- *
 * Study planning, backwards from the exam (FR-805)
 * ------------------------------------------------------------------------- */

export interface StudyBlock {
  readonly topic: string;
  readonly at: number;
  readonly minutes: number;
  /** The last pass before the exam gets its own label; it is a review, not new
   * material, and treating it as new material is how revision runs out of time. */
  readonly kind: "learn" | "review";
}

export interface StudyPlanInput {
  readonly examAt: number;
  readonly topics: readonly string[];
  readonly minutesPerSession: number;
  /** Days the child is not available — a holiday, a match, a birthday. */
  readonly blockedDays?: readonly number[];
  readonly startFrom: number;
  /** Which hour of the day a session is placed at. */
  readonly hourOfDay?: number;
}

/**
 * Spread the topics over the days available and keep the day before the exam
 * for review. Deliberately simple: an elaborate spaced-repetition schedule would
 * be a plan nobody follows, and SPEC §9.2's lesson applies here too — a plan
 * that is repeatedly ignored is the wrong plan.
 */
export function planStudy(input: StudyPlanInput): readonly StudyBlock[] {
  const blocked = new Set((input.blockedDays ?? []).map(startOfDay));
  const hour = input.hourOfDay ?? 16;

  const days: number[] = [];
  for (let day = startOfDay(input.startFrom); day < startOfDay(input.examAt); day += DAY_MS) {
    if (!blocked.has(day)) days.push(day + hour * 3_600_000);
  }
  if (days.length === 0 || input.topics.length === 0) return [];

  // The last available day is review; everything else carries new material.
  const reviewDay = days.at(-1);
  const learningDays = days.slice(0, Math.max(1, days.length - 1));

  const blocks: StudyBlock[] = input.topics.map((topic, index) => ({
    topic,
    at: learningDays[index % learningDays.length] ?? learningDays[0] ?? days[0]!,
    minutes: input.minutesPerSession,
    kind: "learn" as const,
  }));

  if (reviewDay !== undefined && days.length > 1) {
    blocks.push({
      topic: input.topics.join(", "),
      at: reviewDay,
      minutes: input.minutesPerSession,
      kind: "review",
    });
  }

  return blocks.sort((a, b) => a.at - b.at);
}

/* ------------------------------------------------------------------------- *
 * Asking someone whether they can (FR-216)
 * ------------------------------------------------------------------------- */

export type RequestState = "asked" | "accepted" | "declined" | "withdrawn";

export interface AppointmentRequest {
  readonly id: string;
  readonly askedById: string;
  readonly askedOfId: string;
  readonly subject: string;
  readonly proposedAt: number;
  readonly state: RequestState;
  readonly answeredAt: number | undefined;
  readonly note: string;
}

/**
 * "Can you do Thursday?" is a question, not an assignment — which is the same
 * rule delegation follows (FR-310). Nothing about the family's schedule changes
 * until somebody says yes, so an unanswered request must never look like cover.
 */
export function isCovered(request: AppointmentRequest): boolean {
  return request.state === "accepted";
}

export function pendingRequestsFor(
  requests: readonly AppointmentRequest[],
  personId: string,
): readonly AppointmentRequest[] {
  return requests
    .filter((request) => request.askedOfId === personId && request.state === "asked")
    .sort((a, b) => a.proposedAt - b.proposedAt);
}

/**
 * A request nobody answered before the day arrives is not a quiet no — it is the
 * thing that has to be surfaced, because the family is about to discover the gap
 * at the worst moment.
 */
export function unansweredBy(
  requests: readonly AppointmentRequest[],
  now: number,
): readonly AppointmentRequest[] {
  return requests.filter((request) => request.state === "asked" && request.proposedAt <= now);
}

/* ------------------------------------------------------------------------- *
 * How many more sleeps (FR-219)
 * ------------------------------------------------------------------------- */

/**
 * Counted in nights rather than hours, because that is how a child counts and
 * because "in 18 hours" is meaningless to somebody who cannot read a clock.
 */
export function sleepsUntil(at: number, now: number): number {
  return Math.max(0, Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS));
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}
