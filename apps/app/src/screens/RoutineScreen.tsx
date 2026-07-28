/**
 * A child's routine (SPEC FR-1207, FR-1206, FR-103).
 *
 * Built for the kitchen tablet and for a child who cannot read yet: the steps
 * are pictures in a fixed order, each one tapped by the child themselves, and
 * the visual timer says how much of "getting ready" is left without naming a
 * clock time.
 *
 * There is deliberately no "who are you?" gate in front of this screen. FR-1207
 * says a child routine must never require a smartphone, and FR-116 keeps the
 * identity question for the places where attribution actually matters (giving a
 * dose). Ticking off your own morning is not one of them.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, EmptyState, List, Progress, Text } from "@cp/ui";
import { setRoutineStepDone } from "../commands.js";
import { formatDuration, selectRoutine } from "../selectors.js";
import { useFamilyState, useMutate, useRuntime, useTranslator } from "../runtime.js";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

export interface RoutineScreenProps {
  /** A routine is a task with subtasks — see `selectRoutine`. */
  readonly taskId: string;
}

export function RoutineScreen(props: RoutineScreenProps): ReactNode {
  const state = useFamilyState();
  const mutate = useMutate();
  const t = useTranslator();
  const { now } = useRuntime();

  const [endsAt, setEndsAt] = useState<number | undefined>(undefined);
  const [tick, setTick] = useState(() => now());

  const view = useMemo(() => selectRoutine(state, props.taskId), [state, props.taskId]);

  useEffect(() => {
    if (endsAt === undefined) return undefined;
    const handle = setInterval(() => setTick(now()), SECOND_MS);
    return () => clearInterval(handle);
  }, [endsAt, now]);

  if (view === undefined || view.steps.length === 0) {
    return <EmptyState label={t.t("routine.title")} leadingIcon="check-square" hint={t.t("routine.empty")} />;
  }

  const totalMs = (view.minutes ?? 0) * MINUTE_MS;
  const remainingMs = endsAt === undefined ? 0 : Math.max(0, endsAt - tick);

  return (
    <>
      <Text role="heading1">{view.title.length > 0 ? view.title : t.t("routine.title")}</Text>
      <Text role="caption">{t.t("routine.progress", { done: view.doneCount, total: view.steps.length })}</Text>
      <Progress value={view.percent} size="sm" variant="success" testID="routine-progress" />

      {/* The visual timer: a bar that empties, because "seven minutes" means
          nothing to a five-year-old and a shrinking bar does (FR-1207). */}
      {view.minutes === undefined ? null : endsAt === undefined ? (
        <Button
          label={t.t("routine.startTimer")}
          variant="outline"
          size="lg"
          onPress={() => {
            setTick(now());
            setEndsAt(now() + totalMs);
          }}
          testID="routine-timer-start"
        />
      ) : (
        <>
          <Progress
            value={totalMs === 0 ? 0 : (remainingMs / totalMs) * 100}
            variant={remainingMs === 0 ? "warning" : "brand"}
            size="lg"
            testID="routine-timer"
          />
          <Text role="heading3">{t.t("routine.timeLeft", { remaining: formatDuration(remainingMs) })}</Text>
        </>
      )}

      {/* FR-1206: the picture leads, the words are for whoever is helping. */}
      <List>
        {view.steps.map((step) => (
          <List.Item
            key={step.id}
            label={step.title}
            leadingIcon={step.done ? "check-circle" : step.icon}
            selected={step.done}
            pressable
            onPress={() =>
              void setRoutineStepDone(mutate, {
                taskId: view.taskId,
                steps: view.steps,
                stepId: step.id,
                done: !step.done,
              })
            }
            testID={"routine-step-" + step.id}
          />
        ))}
      </List>

      {/* Finishing is a celebration, not a submission: a child's task still
          needs an adult's confirmation, which happens on the task (FR-312). */}
      {view.complete ? <Text role="heading2">{t.t("routine.allDone")}</Text> : null}
    </>
  );
}
