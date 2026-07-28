/**
 * The health facts that are not schedules (SPEC §9).
 *
 * `protocols.ts` covers anything that recurs on a clock — a course of
 * antibiotics, a daily measurement. What is left is the standing knowledge
 * about a person: what they cannot eat, which preventive appointments are due,
 * which vaccinations are outstanding, and what a series of measurements looks
 * like when read as a curve rather than as rows.
 *
 * All of it is special-category data under Art. 9, so nothing here is written
 * unless the health area is switched on and consent given — that gate lives in
 * `compliance.ts` and is enforced by the commands, not by this file. What lives
 * here is the reasoning, kept pure so it can be asserted against the schedules
 * it claims to implement.
 *
 * **A deliberate limit.** The app is not a medical device and does not diagnose.
 * Everything below either restates a published schedule or arranges values a
 * person entered. Where a judgement would be medical it is not made: the fever
 * curve reports what was measured and how it is trending, and says nothing
 * about what to do.
 */
import type { FamilyState } from "./state.js";
import { EntityTypes, readRecords, readString } from "./schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

// ── Allergies and intolerances (FR-908) ───────────────────────────────────

export type AllergySeverity = "intolerance" | "allergy" | "anaphylaxis";

export interface AllergyEntry {
  /** Free text, matched case- and substring-insensitively against ingredients. */
  readonly allergen: string;
  readonly severity: AllergySeverity;
  readonly note: string;
}

/**
 * What a person cannot eat, as the emergency information a carer needs.
 *
 * Stored on the person rather than in a separate record: an allergy is not an
 * event, it is a fact that has to be findable in one place when somebody else
 * is looking after the child (FR-911).
 */
export function readAllergies(state: FamilyState, personId: string): readonly AllergyEntry[] {
  const person = state.get(EntityTypes.person, personId);
  if (person === undefined || person.deleted) return [];

  return readRecords(person, "allergies")
    .map((raw) => ({
      allergen: typeof raw["allergen"] === "string" ? raw["allergen"].trim() : "",
      severity: severityOf(raw["severity"]),
      note: typeof raw["note"] === "string" ? raw["note"] : "",
    }))
    .filter((entry) => entry.allergen.length > 0);
}

function severityOf(value: unknown): AllergySeverity {
  return value === "anaphylaxis" || value === "allergy" ? value : "intolerance";
}

/**
 * Does this ingredient list contain something this person reacts to?
 *
 * Substring matching, deliberately generous: "nut" has to catch "hazelnuts",
 * and a false warning about a dish that turns out to be fine costs a
 * conversation, while a missed one costs an ambulance. Where the two are not
 * equally bad, the code should not pretend they are.
 */
export function matchingAllergens(
  allergies: readonly AllergyEntry[],
  ingredients: readonly string[],
): readonly AllergyEntry[] {
  const haystack = ingredients.map((name) => name.toLowerCase());

  return allergies.filter((entry) =>
    haystack.some((name) => name.includes(entry.allergen.toLowerCase())),
  );
}

export interface MealWarning {
  readonly personId: string;
  readonly entry: AllergyEntry;
}

/**
 * FR-908 coupled to the meal plan: who at this table cannot eat what is
 * planned. Only people actually eating are considered — a dish nobody with the
 * allergy will touch is not a warning, it is noise.
 */
export function warnAboutMeal(
  state: FamilyState,
  input: { readonly eaterIds: readonly string[]; readonly ingredients: readonly string[] },
): readonly MealWarning[] {
  return input.eaterIds.flatMap((personId) =>
    matchingAllergens(readAllergies(state, personId), input.ingredients).map((entry) => ({
      personId,
      entry,
    })),
  );
}

/**
 * FR-518, the exclusion search. Returns the recipes that are safe, which is the
 * direction a person actually asks in ("what can we eat tonight"), rather than
 * the ones that are not.
 */
export function recipesWithout(
  state: FamilyState,
  input: { readonly exclude: readonly string[]; readonly recipeIds?: readonly string[] },
): readonly string[] {
  const excluded = input.exclude.map((term) => term.toLowerCase()).filter((t) => t.length > 0);
  const candidates =
    input.recipeIds ?? state.all(EntityTypes.recipe).map((recipe) => recipe.id);

  return candidates.filter((recipeId) => {
    const recipe = state.get(EntityTypes.recipe, recipeId);
    if (recipe === undefined || recipe.deleted) return false;

    const names = readRecords(recipe, "ingredients").map((raw) =>
      typeof raw["name"] === "string" ? raw["name"].toLowerCase() : "",
    );
    return !excluded.some((term) => names.some((name) => name.includes(term)));
  });
}

/** The exclusion list a family gets for free from what it already recorded. */
export function allergensOf(state: FamilyState, personIds: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  for (const personId of personIds) {
    for (const entry of readAllergies(state, personId)) seen.add(entry.allergen.toLowerCase());
  }
  return [...seen].sort();
}

// ── Preventive care (FR-903, FR-904) ──────────────────────────────────────

export interface DueCheck {
  readonly key: string;
  readonly label: string;
  /** Inclusive window, as milliseconds since the person's date of birth. */
  readonly fromAgeMs: number;
  readonly toAgeMs: number;
}

/**
 * The German well-child examinations (U1–U9, J1), by the statutory windows.
 *
 * Restated rather than derived: these are dates a statutory health insurer
 * publishes, and the app's job is to surface them before they close, not to
 * have an opinion about them. The windows are the *entitlement* windows — an
 * examination outside them is still possible, it is simply no longer covered,
 * which is exactly why a reminder weeks ahead is worth anything (FR-903).
 */
export const WELL_CHILD_CHECKS: readonly DueCheck[] = [
  { key: "U1", label: "U1", fromAgeMs: 0, toAgeMs: 1 * DAY_MS },
  { key: "U2", label: "U2", fromAgeMs: 3 * DAY_MS, toAgeMs: 10 * DAY_MS },
  { key: "U3", label: "U3", fromAgeMs: 28 * DAY_MS, toAgeMs: 42 * DAY_MS },
  { key: "U4", label: "U4", fromAgeMs: 3 * MONTH_MS, toAgeMs: 4 * MONTH_MS + 15 * DAY_MS },
  { key: "U5", label: "U5", fromAgeMs: 6 * MONTH_MS, toAgeMs: 7 * MONTH_MS },
  { key: "U6", label: "U6", fromAgeMs: 10 * MONTH_MS, toAgeMs: 12 * MONTH_MS },
  { key: "U7", label: "U7", fromAgeMs: 21 * MONTH_MS, toAgeMs: 24 * MONTH_MS },
  { key: "U7a", label: "U7a", fromAgeMs: 34 * MONTH_MS, toAgeMs: 36 * MONTH_MS },
  { key: "U8", label: "U8", fromAgeMs: 46 * MONTH_MS, toAgeMs: 48 * MONTH_MS },
  { key: "U9", label: "U9", fromAgeMs: 60 * MONTH_MS, toAgeMs: 64 * MONTH_MS },
  { key: "J1", label: "J1", fromAgeMs: 12 * 12 * MONTH_MS, toAgeMs: 15 * 12 * MONTH_MS },
];

/**
 * The childhood vaccination series, by the age at which each dose becomes due.
 *
 * Only the *earliest* recommended age is modelled. A catch-up schedule depends
 * on what was already given and on a doctor's judgement, and an app that
 * guessed at it would be practising medicine.
 */
export const VACCINATION_SCHEDULE: readonly DueCheck[] = [
  { key: "rotavirus-1", label: "Rotavirus (1)", fromAgeMs: 6 * 7 * DAY_MS, toAgeMs: 12 * 7 * DAY_MS },
  { key: "6-fold-1", label: "Six-in-one (1)", fromAgeMs: 2 * MONTH_MS, toAgeMs: 3 * MONTH_MS },
  { key: "6-fold-2", label: "Six-in-one (2)", fromAgeMs: 4 * MONTH_MS, toAgeMs: 5 * MONTH_MS },
  { key: "6-fold-3", label: "Six-in-one (3)", fromAgeMs: 11 * MONTH_MS, toAgeMs: 14 * MONTH_MS },
  { key: "mmr-1", label: "MMR (1)", fromAgeMs: 11 * MONTH_MS, toAgeMs: 14 * MONTH_MS },
  { key: "mmr-2", label: "MMR (2)", fromAgeMs: 15 * MONTH_MS, toAgeMs: 23 * MONTH_MS },
  { key: "meningococcal-c", label: "Meningococcal C", fromAgeMs: 12 * MONTH_MS, toAgeMs: 23 * MONTH_MS },
  { key: "varicella-1", label: "Varicella (1)", fromAgeMs: 11 * MONTH_MS, toAgeMs: 14 * MONTH_MS },
  { key: "hpv-1", label: "HPV (1)", fromAgeMs: 9 * 12 * MONTH_MS, toAgeMs: 15 * 12 * MONTH_MS },
];

export type DueState = "upcoming" | "open" | "closing" | "missed" | "done";

export interface PreventiveItem {
  readonly key: string;
  readonly label: string;
  readonly opensAt: number;
  readonly closesAt: number;
  readonly state: DueState;
}

/**
 * Where each entitlement stands for one person.
 *
 * `closing` exists because the whole point is to be told *before* a window
 * shuts: an appointment needs booking, and a reminder on the last day is not a
 * reminder. The lead time is the caller's, since a family that books months
 * ahead and one that phones the same morning want different warnings.
 */
export function preventiveSchedule(
  state: FamilyState,
  input: {
    readonly personId: string;
    readonly checks: readonly DueCheck[];
    readonly now: number;
    readonly closingLeadMs?: number;
  },
): readonly PreventiveItem[] {
  const person = state.get(EntityTypes.person, input.personId);
  if (person === undefined || person.deleted) return [];

  const birth = Date.parse(readString(person, "bornOn"));
  if (Number.isNaN(birth)) return [];

  const completed = new Set(
    readRecords(person, "preventiveDone")
      .map((raw) => (typeof raw["key"] === "string" ? raw["key"] : ""))
      .filter((key) => key.length > 0),
  );
  const lead = input.closingLeadMs ?? 30 * DAY_MS;

  return input.checks.map((check) => {
    const opensAt = birth + check.fromAgeMs;
    const closesAt = birth + check.toAgeMs;

    return {
      key: check.key,
      label: check.label,
      opensAt,
      closesAt,
      state: completed.has(check.key)
        ? "done"
        : input.now < opensAt
          ? "upcoming"
          : input.now > closesAt
            ? "missed"
            : closesAt - input.now <= lead
              ? "closing"
              : "open",
    };
  });
}

/** What a family should be told about now: open, closing, or already missed. */
export function actionablePreventive(
  items: readonly PreventiveItem[],
): readonly PreventiveItem[] {
  return items
    .filter((item) => item.state === "open" || item.state === "closing" || item.state === "missed")
    .sort((a, b) => a.closesAt - b.closesAt);
}

// ── Measurement series (FR-906) ───────────────────────────────────────────

export interface Measurement {
  readonly at: number;
  readonly value: number;
}

export type Trend = "rising" | "falling" | "steady" | "unknown";

export interface MeasurementSeries {
  readonly points: readonly Measurement[];
  readonly min: number;
  readonly max: number;
  readonly latest: Measurement | undefined;
  readonly trend: Trend;
}

/**
 * A course of measurements, read as a curve (FR-906).
 *
 * The trend compares the most recent value with the one before it and nothing
 * more. A smarter statistic over three feverish nights would be a claim about a
 * child's condition, which is not this app's to make — the curve is here so a
 * parent can show it to a doctor, not so the app can interpret it.
 */
export function measurementSeries(
  state: FamilyState,
  input: { readonly protocolId: string; readonly from?: number; readonly to?: number },
): MeasurementSeries {
  const points = state
    .all(EntityTypes.protocolInstance)
    .filter((instance) => instance.id.startsWith(input.protocolId + "@"))
    .map((instance) => ({
      at: Number(instance.fields["measuredAt"] ?? instance.fields["acknowledgedAt"] ?? Number.NaN),
      value: Number(instance.fields["value"] ?? Number.NaN),
    }))
    .filter((point) => Number.isFinite(point.at) && Number.isFinite(point.value))
    .filter((point) => (input.from === undefined || point.at >= input.from))
    .filter((point) => (input.to === undefined || point.at <= input.to))
    .sort((a, b) => a.at - b.at);

  if (points.length === 0) {
    return { points, min: Number.NaN, max: Number.NaN, latest: undefined, trend: "unknown" };
  }

  const values = points.map((point) => point.value);
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];

  return {
    points,
    min: Math.min(...values),
    max: Math.max(...values),
    latest,
    trend:
      previous === undefined || latest === undefined
        ? "unknown"
        : latest.value > previous.value
          ? "rising"
          : latest.value < previous.value
            ? "falling"
            : "steady",
  };
}
