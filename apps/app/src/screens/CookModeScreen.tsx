/**
 * Cook mode (SPEC §8.3, FR-527…536).
 *
 * The screen is read from two metres away with sticky hands, so it shows one
 * step in the largest type the design system has (FR-528) and keeps everything
 * else — ingredients, running timers — underneath it rather than behind a
 * navigation gesture.
 *
 * Ingredient ticks and timers are local state on purpose: what is already in the
 * bowl is nobody else's business and must not wait for a round trip, whereas the
 * note at the end is about the recipe and therefore shared (FR-536).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useKeepAwake } from "expo-keep-awake";
import { Button, Card, EmptyState, List, Progress, Text, Textarea } from "@cp/ui";
import { noteAfterCooking } from "../commands.js";
import { describeTimers, selectCookMode, type CookTimer } from "../selectors.js";
import { useFamilyState, useMutate, useRuntime, useTranslator } from "../runtime.js";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

export interface CookModeScreenProps {
  readonly recipeId: string;
  /** Who is eating tonight, when it differs from what the recipe is written for. */
  readonly eaters?: number;
  /** Leaving cook mode after the last step; the note stays reachable until then. */
  readonly onFinished?: () => void;
}

export function CookModeScreen(props: CookModeScreenProps): ReactNode {
  const state = useFamilyState();
  const mutate = useMutate();
  const t = useTranslator();
  const { now } = useRuntime();

  const [stepIndex, setStepIndex] = useState(0);
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const [timers, setTimers] = useState<readonly CookTimer[]>([]);
  const [tick, setTick] = useState(() => now());
  const [note, setNote] = useState("");

  const view = useMemo(
    () => selectCookMode(state, { recipeId: props.recipeId, ...(props.eaters === undefined ? {} : { eaters: props.eaters }) }),
    [state, props.recipeId, props.eaters],
  );

  // FR-527: the display stays on for as long as this screen is mounted, and
  // goes back to the device's own setting the moment it unmounts. Cooking is
  // the one place in the product where the person's hands are wet or full, so
  // a screen that dims after thirty seconds costs them the step they were on.
  // The hook is a no-op on the web, where the platform gives no such control.
  useKeepAwake();

  // One interval for every timer: the countdown is a rendering concern, so it
  // ticks the clock rather than the timers themselves (FR-529).
  useEffect(() => {
    if (timers.length === 0) return undefined;
    const handle = setInterval(() => setTick(now()), SECOND_MS);
    return () => clearInterval(handle);
  }, [timers.length, now]);

  const running = describeTimers(timers, tick);
  const step = view.steps[stepIndex];

  if (view.steps.length === 0) {
    return <EmptyState label={view.title} leadingIcon="utensils" hint={t.t("cook.noSteps")} />;
  }

  return (
    <>
      <Text role="heading2">{view.title}</Text>
      <Text role="caption">{t.t("recipe.servings", { count: view.servings })}</Text>

      {/* Where you are: the number is the orientation, the bar is how much
          recipe is left — the two questions a cook asks between steps. */}
      <Text role="label">
        {t.t("cook.step", { current: stepIndex + 1, total: view.steps.length })}
      </Text>
      <Progress value={((stepIndex + 1) / view.steps.length) * 100} size="sm" />

      {/* FR-528: the instruction itself gets the largest role in the system. */}
      <Text role="display">{step === undefined ? "" : step.text}</Text>

      {step === undefined || step.minutes === undefined ? null : (
        <StartTimerButton
          label={t.t("cook.startTimer", { minutes: step.minutes })}
          onStart={(minutes) =>
            setTimers([
              ...timers,
              {
                id: String(step.index) + ":" + String(now()),
                label: t.t("cook.step", { current: step.index + 1, total: view.steps.length }),
                endsAt: now() + minutes * MINUTE_MS,
              },
            ])
          }
          minutes={step.minutes}
          testID={"cook-timer-start-" + String(step.index)}
        />
      )}

      <Button
        label={t.t("cook.previous")}
        variant="ghost"
        disabled={stepIndex === 0}
        onPress={() => setStepIndex(Math.max(0, stepIndex - 1))}
        testID="cook-previous"
      />
      {/* The last step's button is the way out of cook mode, not a dead end. */}
      <Button
        label={stepIndex === view.steps.length - 1 ? t.t("cook.finish") : t.t("cook.next")}
        variant="primary"
        onPress={() =>
          stepIndex === view.steps.length - 1
            ? props.onFinished?.()
            : setStepIndex(Math.min(view.steps.length - 1, stepIndex + 1))
        }
        testID="cook-next"
      />

      {running.length > 0 ? (
        <List>
          {running.map((timer) => (
            <List.Item
              key={timer.id}
              label={
                timer.done
                  ? t.t("cook.timerDone", { label: timer.label })
                  : t.t("cook.timerLeft", { label: timer.label, remaining: timer.remainingLabel })
              }
              leadingIcon={timer.done ? "alert-circle" : "clock"}
              trailingContent={
                <Button
                  label={t.t("cook.stopTimer")}
                  variant="ghost"
                  size="sm"
                  onPress={() => setTimers(timers.filter((candidate) => candidate.id !== timer.id))}
                />
              }
              testID={"cook-timer-" + timer.id}
            />
          ))}
        </List>
      ) : null}

      {/* FR-530: ticking an ingredient off is what stops the second onion. */}
      <List>
        <List.Header label={t.t("recipe.ingredients")} />
        {view.ingredients.map((ingredient) => (
          <List.Item
            key={ingredient.key}
            label={ingredient.label}
            {...(ingredient.note.length === 0 ? {} : { subtitle: ingredient.note })}
            leadingIcon={ticked.includes(ingredient.key) ? "check-circle" : "circle"}
            selected={ticked.includes(ingredient.key)}
            pressable
            onPress={() =>
              setTicked(
                ticked.includes(ingredient.key)
                  ? ticked.filter((key) => key !== ingredient.key)
                  : [...ticked, ingredient.key],
              )
            }
            testID={"cook-ingredient-" + ingredient.key}
          />
        ))}
      </List>

      {/* FR-536: the one thing worth writing down is what to do differently. */}
      <Card variant="outlined">
        <Card.Body>
          <Textarea
            value={note}
            label={t.t("recipe.note")}
            placeholder={view.note.length > 0 ? view.note : t.t("cook.notePlaceholder")}
            rows={2}
            onValueChange={setNote}
            testID="cook-note"
          />
        </Card.Body>
        <Card.Footer>
          <Button
            label={t.t("common.save")}
            variant="primary"
            disabled={note.trim().length === 0}
            onPress={() => {
              void noteAfterCooking(mutate, { recipeId: props.recipeId, note, at: now() });
              setNote("");
            }}
            testID="cook-note-save"
          />
        </Card.Footer>
      </Card>
    </>
  );
}

/** Split out so the step's duration survives into the press handler as a value
 * rather than as a narrowing the closure has to preserve. */
function StartTimerButton(props: {
  readonly label: string;
  readonly minutes: number;
  readonly onStart: (minutes: number) => void;
  readonly testID: string;
}): ReactNode {
  return (
    <Button
      label={props.label}
      variant="outline"
      leadingIcon="clock"
      onPress={() => props.onStart(props.minutes)}
      testID={props.testID}
    />
  );
}
