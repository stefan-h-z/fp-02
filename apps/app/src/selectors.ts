/**
 * Selectors: what each screen shows.
 *
 * The screens hold no logic of their own — they render what these functions
 * return. That keeps the interesting decisions (what counts as "today", what
 * belongs on the focus view, when a conflict is worth a person's attention) in
 * testable code rather than in a component tree nobody can assert against.
 */
import {
  DAY_MS,
  EntityTypes,
  buildShoppingList,
  derivePlannedNeeds,
  detectCareGaps,
  detectConflicts,
  exportPersonalData,
  formatQuantity,
  hasConsent,
  learningAllowed,
  normalizeQuantity,
  occurrencesInWindow,
  planErasure,
  planInstances,
  readConsents,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readProtocol,
  readRecipeIngredients,
  readRecords,
  readString,
  readStringList,
  scaleQuantity,
  type CareGap,
  type ErasurePlan,
  type FamilyState,
  type Occurrence,
  type ProtocolInstance,
  type ScheduleConflict,
  type ShoppingListView,
} from "@fam/domain";

export interface TodayView {
  readonly occurrences: readonly Occurrence[];
  readonly dueDoses: readonly ProtocolInstance[];
  readonly meals: readonly { readonly mealSlotId: string; readonly mealType: string; readonly title: string; readonly cookOwnerId: string | undefined }[];
  readonly conflicts: readonly ScheduleConflict[];
  readonly careGaps: readonly CareGap[];
}

/** The kitchen tablet's home screen, and the first thing anyone opens. */
export function selectToday(state: FamilyState, now: number): TodayView {
  const from = startOfDay(now);
  const to = from + DAY_MS;
  const occurrences = occurrencesInWindow(state, { from, to });

  return {
    occurrences: occurrences.filter((occurrence) => !occurrence.cancelled),
    dueDoses: selectDueDoses(state, now),
    meals: state
      .all(EntityTypes.mealSlot)
      .filter((slot) => readString(slot, "date") === isoDate(now))
      .map((slot) => {
        const recipeId = readOptionalString(slot, "recipeId");
        return {
          mealSlotId: slot.id,
          mealType: readString(slot, "mealType"),
          title:
            recipeId === undefined
              ? readString(slot, "label")
              : readString(state.get(EntityTypes.recipe, recipeId), "title"),
          cookOwnerId: readOptionalString(slot, "cookOwnerId"),
        };
      }),
    conflicts: detectConflicts(occurrences),
    careGaps: detectCareGaps(state, { from, to: to + 60 * DAY_MS }),
  };
}

/**
 * "What concerns me today" (FR-1205).
 *
 * Deliberately narrow: the things this person is responsible for, not everything
 * that happens to fall on the date. A view that shows everything is the same as
 * no view at all for the person already carrying the load.
 */
export function selectMyDay(
  state: FamilyState,
  personId: string,
  now: number,
): TodayView {
  const today = selectToday(state, now);

  return {
    ...today,
    occurrences: today.occurrences.filter(
      (occurrence) =>
        occurrence.bringOwnerId === personId ||
        occurrence.fetchOwnerId === personId ||
        occurrence.participantIds.includes(personId),
    ),
    meals: today.meals.filter((meal) => meal.cookOwnerId === undefined || meal.cookOwnerId === personId),
    conflicts: today.conflicts.filter((conflict) => conflict.personId === personId),
  };
}

/**
 * The focus view: the next three things (FR-1212). Fewer, because the point is
 * to be usable at the moment somebody is overwhelmed.
 */
export function selectNextThree(
  state: FamilyState,
  personId: string,
  now: number,
): readonly { readonly kind: "dose" | "event"; readonly at: number; readonly label: string }[] {
  const day = selectMyDay(state, personId, now);

  const items = [
    ...day.dueDoses.map((dose) => ({ kind: "dose" as const, at: dose.dueAt, label: dose.label })),
    ...day.occurrences.map((occurrence) => ({ kind: "event" as const, at: occurrence.startsAt, label: occurrence.title })),
  ];

  return items
    .filter((item) => item.at >= now - DAY_MS)
    .sort((a, b) => a.at - b.at)
    .slice(0, 3);
}

export function selectDueDoses(state: FamilyState, now: number): readonly ProtocolInstance[] {
  return state
    .all(EntityTypes.protocol)
    .flatMap((entity) => {
      const protocol = readProtocol(state, entity.id);
      if (protocol === undefined) return [];
      return planInstances(protocol, state, { from: now - DAY_MS, to: now + DAY_MS, now });
    })
    .filter((instance) => instance.state === "due" || instance.state === "missed")
    .sort((a, b) => a.dueAt - b.dueAt);
}

export interface ShoppingScreenOptions {
  readonly listId: string;
  readonly now: number;
  readonly weekPlanId?: string;
  readonly grouping?: "store" | "productGroup";
  readonly atStore?: string;
  readonly personId?: string | null;
}

/**
 * The shopping screen. Learning is checked here rather than inside the engine,
 * so that switching it off silences suggestions everywhere at once, and a child
 * profile never triggers any analysis (AI-06, FR-1417).
 */
export function selectShoppingList(state: FamilyState, options: ShoppingScreenOptions): ShoppingListView {
  const plannedNeeds =
    options.weekPlanId === undefined ? [] : derivePlannedNeeds(state, options.weekPlanId);

  return buildShoppingList(state, {
    listId: options.listId,
    now: options.now,
    plannedNeeds,
    learningEnabled: learningAllowed(state, options.personId ?? null),
    ...(options.grouping === undefined ? {} : { grouping: options.grouping }),
    ...(options.atStore === undefined ? {} : { atStore: options.atStore }),
  });
}

/** The sync badge (FR-1216): what is still only on this device. */
export interface SyncStatus {
  readonly pending: number;
  readonly online: boolean;
  readonly openConflicts: number;
}

export function describeSyncStatus(status: SyncStatus): "synced" | "pending" | "offline" | "needs-attention" {
  if (status.openConflicts > 0) return "needs-attention";
  if (!status.online) return "offline";
  return status.pending > 0 ? "pending" : "synced";
}

/** One line of the cook-mode ingredient list, already scaled (FR-514). */
export interface CookIngredient {
  /** Stable across a re-render, so a tick survives moving between steps. */
  readonly key: string;
  readonly label: string;
  readonly note: string;
}

export interface CookStep {
  readonly index: number;
  readonly text: string;
  /** Present when the step itself says how long it runs — that is what makes a
   * timer startable from the step rather than typed in (FR-529). */
  readonly minutes: number | undefined;
}

export interface CookModeView {
  readonly title: string;
  readonly servings: number;
  readonly ingredients: readonly CookIngredient[];
  readonly steps: readonly CookStep[];
  /** What the family wrote down the last time they cooked it (FR-536). */
  readonly note: string;
}

export interface CookModeOptions {
  readonly recipeId: string;
  /** Who is actually eating tonight, when it differs from the recipe (FR-603). */
  readonly eaters?: number;
}

/**
 * Cook mode (SPEC §8.3).
 *
 * Steps are accepted in both shapes the recipe importer can produce — plain
 * strings, or records carrying their own duration — because a recipe scraped
 * from a website rarely has minutes on every step and the screen must not care.
 */
export function selectCookMode(state: FamilyState, options: CookModeOptions): CookModeView {
  const recipe = state.get(EntityTypes.recipe, options.recipeId);
  const servings = readNumber(recipe, "servings", 0);
  const factor = options.eaters === undefined || servings <= 0 ? 1 : options.eaters / servings;

  const ingredients = readRecipeIngredients(state, options.recipeId).map((ingredient, position) => ({
    key: String(position) + ":" + ingredient.name,
    label: ingredientLabel(ingredient.name, ingredient.amount, ingredient.unit, factor),
    note: ingredient.note,
  }));

  const records = readRecords(recipe, "steps");
  const steps: CookStep[] =
    records.length > 0
      ? records.map((raw, index) => ({
          index,
          text: typeof raw["text"] === "string" ? raw["text"] : "",
          minutes: typeof raw["minutes"] === "number" && raw["minutes"] > 0 ? raw["minutes"] : undefined,
        }))
      : readStringList(recipe, "steps").map((text, index) => ({ index, text, minutes: undefined }));

  return {
    title: readString(recipe, "title"),
    servings: options.eaters ?? servings,
    ingredients,
    steps,
    note: readString(recipe, "nextTimeNote"),
  };
}

/** A timer a cook started from a step. Several run at once (FR-529). */
export interface CookTimer {
  readonly id: string;
  readonly label: string;
  readonly endsAt: number;
}

export interface CookTimerView extends CookTimer {
  readonly remainingMs: number;
  readonly remainingLabel: string;
  readonly done: boolean;
}

/** Countdown text for every running timer, so the screen only renders. */
export function describeTimers(timers: readonly CookTimer[], now: number): readonly CookTimerView[] {
  return timers
    .map((timer) => {
      const remainingMs = Math.max(0, timer.endsAt - now);
      return {
        ...timer,
        remainingMs,
        remainingLabel: formatDuration(remainingMs),
        done: remainingMs === 0,
      };
    })
    .sort((a, b) => a.remainingMs - b.remainingMs);
}

/** mm:ss, because a cook glances rather than reads. */
export function formatDuration(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return String(minutes) + ":" + String(seconds).padStart(2, "0");
}

export interface RoutineStep {
  readonly id: string;
  readonly title: string;
  /** The picture a preschooler navigates by; the text is the adult's fallback
   * (FR-103, FR-1206). */
  readonly icon: string;
  readonly done: boolean;
}

export interface RoutineView {
  readonly taskId: string;
  readonly title: string;
  readonly ownerId: string | undefined;
  readonly steps: readonly RoutineStep[];
  readonly doneCount: number;
  /** 0…100, for the visual timer's companion bar (FR-1207). */
  readonly percent: number;
  readonly complete: boolean;
  /** How long the routine usually takes — the timer's length when it is set. */
  readonly minutes: number | undefined;
}

/**
 * A child's routine (FR-1207).
 *
 * A routine is a task with subtasks; nothing new is modelled for it, because the
 * ownership, approval and rotation rules a routine needs are the ones tasks
 * already have (§6). The screen only needs the sequence and whether each part is
 * ticked.
 */
export function selectRoutine(state: FamilyState, taskId: string): RoutineView | undefined {
  const entity = state.get(EntityTypes.task, taskId);
  if (entity === undefined || entity.deleted) return undefined;

  const steps = readRecords(entity, "subtasks").map((raw, position) => {
    const title = typeof raw["title"] === "string" ? raw["title"] : "";
    return {
      id: typeof raw["id"] === "string" ? raw["id"] : String(position),
      title,
      icon: typeof raw["icon"] === "string" && raw["icon"].length > 0 ? raw["icon"] : routineIcon(title),
      done: raw["done"] === true,
    };
  });

  const doneCount = steps.filter((step) => step.done).length;

  return {
    taskId,
    title: readString(entity, "title"),
    ownerId: readOptionalString(entity, "ownerId"),
    steps,
    doneCount,
    percent: steps.length === 0 ? 0 : Math.round((doneCount / steps.length) * 100),
    complete: steps.length > 0 && doneCount === steps.length,
    minutes: readOptionalNumber(entity, "effortMinutes"),
  };
}

/**
 * Which picture a step gets when the routine does not carry one.
 *
 * Keyword matching rather than a curated list: routines are typed by parents in
 * their own words, and a wrong-but-stable picture is still something a child who
 * cannot read can navigate by (FR-103).
 */
export function routineIcon(title: string): string {
  const text = title.toLowerCase();
  const table: readonly (readonly [readonly string[], string])[] = [
    [["teeth", "zähne", "zahn", "brush"], "toothbrush"],
    [["dress", "anziehen", "clothes", "kleid"], "shirt"],
    [["shoe", "schuh"], "shoe"],
    [["breakfast", "frühstück", "eat", "essen"], "utensils"],
    [["bag", "ranzen", "tasche", "school", "schule"], "backpack"],
    [["wash", "waschen", "shower", "duschen"], "droplet"],
    [["bed", "bett", "sleep", "schlafen"], "moon"],
    [["book", "buch", "read", "lesen", "homework", "hausaufgab"], "book"],
    [["toy", "spielzeug", "tidy", "aufräum"], "package"],
  ];

  for (const [needles, icon] of table) {
    if (needles.some((needle) => text.includes(needle))) return icon;
  }
  return "circle";
}

/** The erasure preview a person sees *before* anything is written (FR-1414). */
export interface ErasurePreview {
  readonly deletes: number;
  readonly clears: number;
  readonly setRemovals: number;
  readonly deletesWholeFamily: boolean;
  readonly anonymizeAuthorship: boolean;
  /** Handed straight to the command, so what was shown is what is applied. */
  readonly plan: ErasurePlan;
}

export function selectErasurePreview(state: FamilyState, personId: string): ErasurePreview {
  const plan = planErasure(state, personId);

  return {
    deletes: plan.deleteEntityRefs.length,
    clears: plan.clearFields.length,
    setRemovals: plan.removeSetMembers.length,
    deletesWholeFamily: plan.deletesWholeFamily,
    anonymizeAuthorship: plan.anonymizeAuthorship,
    plan,
  };
}

/** Everything the settings screen needs to render the data-protection controls. */
export interface PrivacyView {
  readonly familyId: string | undefined;
  readonly learningEnabled: boolean;
  readonly healthConsentGranted: boolean;
  /** The consents a withdrawal has to stamp (FR-1408). */
  readonly healthConsentIds: readonly string[];
  /** What switching learning off has to forget (AI-06). */
  readonly catalogItemIds: readonly string[];
  readonly exportEntryCount: number;
  /** The Art. 20 bundle as text, which is the one form that works on every
   * platform without a file API (FR-1412). */
  readonly exportJson: string;
  readonly exportNotes: readonly string[];
  readonly erasure: ErasurePreview;
}

export const HEALTH_CONSENT_SUBJECT = "health";

export function selectPrivacy(state: FamilyState, personId: string, generatedAt: string): PrivacyView {
  const bundle = exportPersonalData(state, personId, generatedAt);
  const family = state.all(EntityTypes.family)[0];

  return {
    familyId: family?.id,
    learningEnabled: family?.fields["learningEnabled"] !== false,
    healthConsentGranted: hasConsent(state, { personId, subject: HEALTH_CONSENT_SUBJECT }),
    healthConsentIds: readConsents(state, personId)
      .filter(
        (consent) =>
          consent.subject === HEALTH_CONSENT_SUBJECT &&
          consent.grantedAt !== undefined &&
          consent.revokedAt === undefined,
      )
      .map((consent) => consent.id),
    catalogItemIds: state.all(EntityTypes.catalogItem).map((entity) => entity.id),
    exportEntryCount: Object.values(bundle.entities).reduce((sum, list) => sum + list.length, 0),
    exportJson: JSON.stringify(bundle, null, 2),
    exportNotes: bundle.notes,
    erasure: selectErasurePreview(state, personId),
  };
}

/**
 * Every entity in the family, for "delete the family" (FR-1415).
 *
 * Deliberately built from the entity types actually present rather than from the
 * type registry: deleting has to reach data written by a newer client that this
 * build has never heard of.
 */
export function selectFamilyErasure(
  state: FamilyState,
): readonly { readonly type: string; readonly id: string }[] {
  return state.types().flatMap((type) => state.all(type).map((entity) => ({ type, id: entity.id })));
}

function ingredientLabel(name: string, amount: number | undefined, unit: string, factor: number): string {
  if (amount === undefined) return name;
  const quantity = scaleQuantity(normalizeQuantity({ amount, unit }), factor);
  // An amount with no unit formats as a bare number with a trailing space.
  const formatted = formatQuantity(quantity).trim();
  return formatted.length === 0 ? name : formatted + " " + name;
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function isoDate(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}
