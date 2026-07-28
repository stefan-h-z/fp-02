/**
 * Bringing a child into the family app (SPEC §4.5, FR-130).
 *
 * Separate from `templates.ts` because setting a child up is not seeding an
 * empty area — it is a different conversation with a different person, and for a
 * preschool child it is a conversation the parent has *about* them rather than
 * *with* them.
 *
 * Two rules run through everything here, both from the spec rather than from
 * taste. FR-129: no progress bar, no "profile 60 % complete" — a child is not a
 * form to complete, and a family that stops after two steps has not failed at
 * anything. And FR-1206/FR-103: a child who cannot read yet gets symbols, so
 * every step carries an icon and every step's icon is load-bearing rather than
 * decoration.
 */
import { childTasksForAge, type ChildTaskTemplate } from "./templates.js";

/**
 * Who is actually doing the setting up.
 *
 * The distinction FR-130 draws: a preschool child does not answer questions
 * about themselves, a parent answers them on their behalf, and the app should
 * not pretend otherwise by showing a four-year-old a form. A school child does
 * it themselves, with a parent beside them.
 */
export type OnboardingMode = "parentLed" | "childLed";

/** The age at which a child does their own setup, which is roughly school age. */
export const CHILD_LED_FROM_AGE = 6;

export function onboardingMode(ageYears: number): OnboardingMode {
  return ageYears >= CHILD_LED_FROM_AGE ? "childLed" : "parentLed";
}

export interface ChildOnboardingStep {
  readonly key: string;
  /** Asked of whoever the mode says is answering. */
  readonly prompt: string;
  /** The symbol that carries the step for a child who cannot read (FR-1206). */
  readonly icon: string;
  /** True when this step can be skipped and the app still works. */
  readonly optional: boolean;
}

/**
 * The steps, in order, for a child of this age.
 *
 * Short on purpose. Every step here is one a family will actually answer in the
 * first five minutes; anything that can be discovered later is discovered later,
 * because an onboarding a parent abandons halfway leaves a half-built child
 * profile and a bad first impression at the same time.
 */
export function childOnboardingSteps(ageYears: number): readonly ChildOnboardingStep[] {
  const mode = onboardingMode(ageYears);

  const common: readonly ChildOnboardingStep[] = [
    {
      key: "name",
      prompt: mode === "childLed" ? "What should we call you?" : "What is the child called?",
      icon: "user",
      optional: false,
    },
    {
      key: "colour",
      prompt: mode === "childLed" ? "Pick your colour." : "Pick a colour for them.",
      icon: "palette",
      optional: false,
    },
    {
      key: "avatar",
      prompt: mode === "childLed" ? "Pick your picture." : "Pick a picture for them.",
      icon: "smile",
      optional: true,
    },
  ];

  if (mode === "parentLed") {
    return [
      ...common,
      // A preschooler has no device and no reading, so what remains is what the
      // adults need to know about them: when they are looked after, and by whom.
      { key: "care", prompt: "Who looks after them, and when?", icon: "clock", optional: true },
    ];
  }

  return [
    ...common,
    { key: "routine", prompt: "What do you do every morning?", icon: "sun", optional: true },
    { key: "jobs", prompt: "Which jobs are yours?", icon: "check", optional: true },
  ];
}

/**
 * What to suggest once the steps are answered, so the child's view is not empty
 * the first time they open it (FR-126).
 *
 * Age-appropriate rather than exhaustive: three suggestions a six-year-old can
 * genuinely do beat twelve that a parent has to prune.
 */
export function childStarterTasks(ageYears: number, limit = 3): readonly ChildTaskTemplate[] {
  return childTasksForAge(ageYears).slice(0, limit);
}

export interface ChildOnboardingProgress {
  readonly answered: readonly string[];
  readonly remaining: readonly ChildOnboardingStep[];
  /** True when the required steps are done — the app is usable from here. */
  readonly usable: boolean;
}

/**
 * Where the setup has got to.
 *
 * Note what this deliberately does not return: a percentage. FR-129 forbids
 * "profile 60 % complete", and it is forbidden because a progress bar turns a
 * family into a task list that is permanently unfinished. `usable` is the only
 * judgement offered, it flips as soon as the required steps are in, and the
 * optional ones simply stay available without ever nagging.
 */
export function childOnboardingProgress(
  ageYears: number,
  answered: readonly string[],
): ChildOnboardingProgress {
  const steps = childOnboardingSteps(ageYears);
  const done = new Set(answered);

  return {
    answered: steps.filter((step) => done.has(step.key)).map((step) => step.key),
    remaining: steps.filter((step) => !done.has(step.key)),
    usable: steps.every((step) => step.optional || done.has(step.key)),
  };
}
