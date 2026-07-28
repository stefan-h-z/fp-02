/**
 * The week plan (SPEC §9).
 *
 * Where the actual work of feeding a family sits — not in the cooking. So the
 * screen shows two things a meal planner usually hides: who is planning this week
 * (rotatable, FR-615) and who is cooking each meal (FR-608). The suggestions come
 * with their reasons, because an unexplained suggestion is one more thing to
 * evaluate rather than one less.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Button, Card, EmptyState, List, Text } from "@cp/ui";
import {
  EntityTypes,
  emergencyMeals,
  readOptionalString,
  readString,
  rerollDay,
  suggestMeals,
  type Suggestion,
} from "@fam/domain";
import { markCooked, planMeal, unplanMeal } from "../commands.js";
import { useFamilyState, useMutate, useRuntime, useTranslator } from "../runtime.js";

export interface WeekPlanScreenProps {
  readonly weekPlanId: string;
  readonly eaterIds: readonly string[];
  /** Minutes available tonight — a training day shortens the list (FR-610). */
  readonly maxMinutes?: number;
}

export function WeekPlanScreen(props: WeekPlanScreenProps): ReactNode {
  const state = useFamilyState();
  const mutate = useMutate();
  const t = useTranslator();
  const { actorId, now } = useRuntime();
  const [rejected, setRejected] = useState<readonly string[]>([]);

  const slots = useMemo(
    () =>
      state
        .all(EntityTypes.mealSlot)
        .filter((slot) => readOptionalString(slot, "weekPlanId") === props.weekPlanId)
        .map((slot) => {
          const recipeId = readOptionalString(slot, "recipeId");
          return {
            id: slot.id,
            date: readString(slot, "date"),
            mealType: readString(slot, "mealType"),
            recipeId,
            cookOwnerId: readOptionalString(slot, "cookOwnerId"),
            state: readString(slot, "state"),
            title:
              recipeId === undefined
                ? readString(slot, "label")
                : readString(state.get(EntityTypes.recipe, recipeId), "title"),
          };
        })
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [state, props.weekPlanId],
  );

  const plannedRecipeIds = slots
    .map((slot) => slot.recipeId)
    .filter((id): id is string => id !== undefined);

  const suggestions = useMemo(
    () =>
      rerollDay(
        state,
        {
          now: now(),
          eaterIds: props.eaterIds,
          plannedRecipeIds,
          ...(props.maxMinutes === undefined ? {} : { maxMinutes: props.maxMinutes }),
        },
        rejected,
      ),
    [state, now, props.eaterIds, props.maxMinutes, plannedRecipeIds, rejected],
  );

  const planningOwnerId = readOptionalString(state.get(EntityTypes.weekPlan, props.weekPlanId), "planningOwnerId");

  return (
    <>
      {planningOwnerId === undefined ? null : (
        <Text role="caption">{t.t("plan.owner", { person: planningOwnerId })}</Text>
      )}

      {slots.length === 0 ? (
        <EmptyState label={t.t("plan.title")} leadingIcon="utensils" hint={t.t("plan.suggest")} />
      ) : (
        <List>
          {slots.map((slot) => (
            <List.Item
              key={slot.id}
              label={slot.title.length > 0 ? slot.title : slot.mealType}
              subtitle={
                slot.cookOwnerId === undefined
                  ? t.formatRelativeDay(Date.parse(slot.date), now())
                  : t.t("plan.cook", { person: slot.cookOwnerId })
              }
              leadingIcon="utensils"
              trailingContent={
                slot.state === "cooked" ? null : (
                  <Button
                    label={t.t("common.save")}
                    variant="ghost"
                    size="sm"
                    onPress={() =>
                      void markCooked(mutate, {
                        mealSlotId: slot.id,
                        at: now(),
                        ...(slot.recipeId === undefined ? {} : { recipeId: slot.recipeId }),
                      })
                    }
                  />
                )
              }
              pressable
              onPress={() => void unplanMeal(mutate, slot.id)}
              testID={"slot-" + slot.id}
            />
          ))}
        </List>
      )}

      <Text role="heading3">{t.t("plan.suggest")}</Text>
      {suggestions.map((suggestion) => (
        <SuggestionCard
          key={suggestion.recipeId}
          suggestion={suggestion}
          onAccept={() =>
            void planMeal(mutate, {
              weekPlanId: props.weekPlanId,
              date: new Date(now()).toISOString().slice(0, 10),
              mealType: "dinner",
              recipeId: suggestion.recipeId,
              eaterIds: props.eaterIds,
              ...(actorId === null ? {} : { cookOwnerId: actorId }),
            })
          }
          onReject={() => setRejected([...rejected, suggestion.recipeId])}
          acceptLabel={t.t("common.save")}
          rejectLabel={t.t("plan.reroll")}
        />
      ))}

      <EmergencyMeals />
    </>
  );
}

/** A suggestion always carries its reason (FR-619). */
function SuggestionCard(props: {
  readonly suggestion: Suggestion;
  readonly onAccept: () => void;
  readonly onReject: () => void;
  readonly acceptLabel: string;
  readonly rejectLabel: string;
}): ReactNode {
  return (
    <Card variant="outlined">
      <Card.Header>
        <Text role="heading3">{props.suggestion.title}</Text>
      </Card.Header>
      <Card.Body>
        <Text role="caption">{props.suggestion.reasons.join(" · ")}</Text>
      </Card.Body>
      <Card.Footer>
        <Button label={props.rejectLabel} variant="ghost" onPress={props.onReject} />
        <Button label={props.acceptLabel} variant="primary" onPress={props.onAccept} />
      </Card.Footer>
    </Card>
  );
}

/** Three dishes that always work from the cupboard, for the bad days (FR-622). */
function EmergencyMeals(): ReactNode {
  const state = useFamilyState();
  const t = useTranslator();
  const meals = useMemo(() => emergencyMeals(state), [state]);

  if (meals.length === 0) return null;

  return (
    <List>
      <List.Header label={t.t("plan.emergency")} />
      {meals.map((meal) => (
        <List.Item key={meal.recipeId} label={meal.title} leadingIcon="package" />
      ))}
    </List>
  );
}

/** Suggestions ignoring what is already planned — used by the "what shall we
 * cook tonight?" entry point rather than the week view (FR-618). */
export function tonightSuggestions(
  state: ReturnType<typeof useFamilyState>,
  input: { readonly now: number; readonly eaterIds: readonly string[]; readonly maxMinutes?: number },
): readonly Suggestion[] {
  return suggestMeals(state, {
    now: input.now,
    eaterIds: input.eaterIds,
    ...(input.maxMinutes === undefined ? {} : { maxMinutes: input.maxMinutes }),
  });
}
