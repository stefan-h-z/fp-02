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
  learningAllowed,
  occurrencesInWindow,
  planInstances,
  readOptionalString,
  readProtocol,
  readString,
  type CareGap,
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
      return planInstances(protocol, state, { from: now - DAY_MS, to: now + DAY_MS });
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

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function isoDate(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}
