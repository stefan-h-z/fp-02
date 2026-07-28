/**
 * Today (SPEC FR-1205, FR-1212).
 *
 * The first thing anyone opens, and the kitchen tablet's home screen. It answers
 * one question — what does this family have to get through today — and it puts
 * the things that go wrong when nobody notices at the top: a dose that is due, a
 * parent expected in two places, a childcare day nobody has taken.
 */
import { useMemo, type ReactNode } from "react";
import { Alert, Badge, EmptyState, List, Text } from "@cp/ui";
import { selectMyDay, selectNextThree, selectToday } from "../selectors.js";
import { useFamilyState, useRuntime, useTranslator } from "../runtime.js";

export interface TodayScreenProps {
  /** When set, the view narrows to what this person is responsible for. */
  readonly personId?: string;
}

export function TodayScreen(props: TodayScreenProps): ReactNode {
  const state = useFamilyState();
  const t = useTranslator();
  const { now } = useRuntime();

  const view = useMemo(
    () => (props.personId === undefined ? selectToday(state, now()) : selectMyDay(state, props.personId, now())),
    [state, props.personId, now],
  );

  const empty =
    view.occurrences.length === 0 &&
    view.dueDoses.length === 0 &&
    view.meals.length === 0 &&
    view.careGaps.length === 0;

  if (empty) {
    return <EmptyState label={t.t("calendar.today")} leadingIcon="calendar" hint={t.t("inbox.empty")} />;
  }

  return (
    <>
      {/* Conflicts and care gaps first: they are the ones that cost something
          when they are noticed late (SPEC P-09). */}
      {view.conflicts.map((conflict) => (
        <Alert
          key={conflict.first.id + conflict.second.id}
          variant="warning"
          label={t.t("calendar.conflict", { person: conflict.personId })}
          hint={conflict.first.title + " · " + conflict.second.title}
        />
      ))}

      {view.careGaps.map((gap) => (
        <Alert
          key={gap.childId + String(gap.date)}
          variant="warning"
          label={t.t("calendar.careGap", { child: gap.childId, date: t.formatDate(gap.date) })}
          hint={gap.reason}
        />
      ))}

      {view.dueDoses.length > 0 ? (
        <List>
          <List.Header label={t.t("protocol.title")} />
          {view.dueDoses.map((dose) => (
            <List.Item
              key={dose.id}
              label={dose.label}
              subtitle={t.formatTime(dose.dueAt)}
              leadingIcon="pill"
              trailingContent={
                dose.state === "missed" ? <Badge label={String(dose.state)} variant="error" size="sm" /> : null
              }
              testID={"dose-" + dose.id}
            />
          ))}
        </List>
      ) : null}

      {view.meals.length > 0 ? (
        <List>
          <List.Header label={t.t("plan.title")} />
          {view.meals.map((meal) => (
            <List.Item
              key={meal.mealSlotId}
              label={meal.title.length > 0 ? meal.title : meal.mealType}
              {...(meal.cookOwnerId === undefined
                ? {}
                : { subtitle: t.t("plan.cook", { person: meal.cookOwnerId }) })}
              leadingIcon="utensils"
              testID={"meal-" + meal.mealSlotId}
            />
          ))}
        </List>
      ) : null}

      {view.occurrences.length > 0 ? (
        <List>
          <List.Header label={t.t("calendar.today")} />
          {view.occurrences.map((occurrence) => (
            <List.Item
              key={occurrence.id}
              label={occurrence.title}
              subtitle={responsibilityLine(occurrence.bringOwnerId, occurrence.fetchOwnerId, t)}
              trailingLabel={occurrence.allDay ? "" : t.formatTime(occurrence.startsAt)}
              leadingIcon="calendar"
              testID={"event-" + occurrence.id}
            />
          ))}
        </List>
      ) : null}
    </>
  );
}

/** Who brings and who fetches is the information the calendar exists for (FR-209). */
function responsibilityLine(
  bringOwnerId: string | undefined,
  fetchOwnerId: string | undefined,
  t: ReturnType<typeof useTranslator>,
): string {
  const parts: string[] = [];
  if (bringOwnerId !== undefined) parts.push(t.t("calendar.brings") + ": " + bringOwnerId);
  if (fetchOwnerId !== undefined) parts.push(t.t("calendar.fetches") + ": " + fetchOwnerId);
  return parts.join(" · ");
}

/** The focus view: the next three things and nothing else (FR-1212). */
export function FocusList(props: { readonly personId: string }): ReactNode {
  const state = useFamilyState();
  const t = useTranslator();
  const { now } = useRuntime();

  const items = useMemo(() => selectNextThree(state, props.personId, now()), [state, props.personId, now]);

  if (items.length === 0) {
    return <Text role="body">{t.t("inbox.empty")}</Text>;
  }

  return (
    <List>
      {items.map((item) => (
        <List.Item
          key={item.kind + String(item.at)}
          label={item.label}
          subtitle={t.formatTime(item.at)}
          leadingIcon={item.kind === "dose" ? "pill" : "calendar"}
        />
      ))}
    </List>
  );
}
