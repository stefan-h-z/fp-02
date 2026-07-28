/**
 * The calendar, in whichever of the five ways the family wants to read it
 * (FR-206).
 *
 * One screen rather than five, because they are five projections of the same
 * week and a family switching between them should never wonder whether they are
 * looking at the same data. The tab is the only state this screen owns; the
 * anchor moves and everything else is derived.
 *
 * What each view is *for* is what shapes it here: the month grid stays six rows
 * tall so paging does not make the page jump, the agenda skips empty days
 * because "what is next" is the question it answers, and the timeline keeps a
 * lane for a person with nothing on because "nothing booked" is an answer and a
 * missing lane is not.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Button, Card, EmptyState, List, Text } from "@cp/ui";
import {
  selectAgenda,
  selectMonth,
  selectTimeline,
  startOfDayUtc,
  type MonthCell,
} from "@fam/domain";
import { selectToday } from "../selectors.js";
import { useFamilyState, useRuntime, useTranslator } from "../runtime.js";

const DAY_MS = 86_400_000;

export type CalendarTab = "day" | "month" | "agenda" | "timeline";

export interface CalendarScreenProps {
  /** Whose lanes the timeline shows. Empty means the timeline has nothing to draw. */
  readonly personIds?: readonly string[];
  readonly initialTab?: CalendarTab;
}

export function CalendarScreen(props: CalendarScreenProps): ReactNode {
  const t = useTranslator();
  const { now } = useRuntime();

  const [tab, setTab] = useState<CalendarTab>(props.initialTab ?? "month");
  // Offset in days from today, so "Earlier" and "Later" mean the same thing in
  // every view without each one keeping its own cursor.
  const [offsetDays, setOffsetDays] = useState(0);

  const anchor = startOfDayUtc(now()) + offsetDays * DAY_MS;
  const personIds = props.personIds ?? [];

  return (
    <>
      <Text role="heading1">{t.t("calendar.today")}</Text>

      {/* Buttons rather than list rows, because choosing a view is an action:
          `List.Item` only fires `onPress` when it is also `pressable`, and a row
          that looks tappable but is not is worse than no affordance at all. A
          Tabs control would be the other candidate, but four labels wrap on a
          phone and this row already carries the paging controls. */}
      {(
        [
          ["day", "calendar.day"],
          ["month", "calendar.month"],
          ["agenda", "calendar.agenda"],
          ["timeline", "calendar.timeline"],
        ] as const
      ).map(([value, key]) => (
        <Button
          key={value}
          label={t.t(key)}
          variant={tab === value ? "primary" : "outline"}
          size="sm"
          onPress={() => setTab(value)}
          testID={"calendar-tab-" + value}
        />
      ))}

      <Button
        label={t.t("calendar.previous")}
        variant="outline"
        size="sm"
        onPress={() => setOffsetDays((days) => days - (tab === "month" ? 28 : 1))}
        testID="calendar-previous"
      />
      <Button
        label={t.t("calendar.next")}
        variant="outline"
        size="sm"
        onPress={() => setOffsetDays((days) => days + (tab === "month" ? 28 : 1))}
        testID="calendar-next"
      />

      {tab === "day" ? <DayView anchor={anchor} /> : null}
      {tab === "month" ? <MonthView anchor={anchor} /> : null}
      {tab === "agenda" ? <AgendaView anchor={anchor} /> : null}
      {tab === "timeline" ? <TimelineView anchor={anchor} personIds={personIds} /> : null}
    </>
  );
}

function DayView(props: { readonly anchor: number }): ReactNode {
  const state = useFamilyState();
  const t = useTranslator();
  const view = useMemo(() => selectToday(state, props.anchor), [state, props.anchor]);

  if (view.occurrences.length === 0) {
    return <EmptyState label={t.t("calendar.nothingOn")} leadingIcon="calendar" testID="calendar-day-empty" />;
  }

  return (
    <List testID="calendar-day">
      <List.Header label={t.formatDate(props.anchor)} />
      {view.occurrences.map((occurrence) => (
        <List.Item
          key={occurrence.id}
          label={occurrence.private ? t.t("calendar.busy") : occurrence.title}
          trailingLabel={occurrence.allDay ? "" : t.formatTime(occurrence.startsAt)}
          leadingIcon="calendar"
          testID={"calendar-day-" + occurrence.id}
        />
      ))}
    </List>
  );
}

function MonthView(props: { readonly anchor: number }): ReactNode {
  const state = useFamilyState();
  const t = useTranslator();
  const { now } = useRuntime();

  const view = useMemo(
    () => selectMonth(state, { anchor: props.anchor, now: now() }),
    [state, props.anchor, now],
  );

  return (
    <Card variant="outlined" testID="calendar-month">
      <Card.Body>
        <Text role="heading3">{t.formatDate(view.monthStart)}</Text>
        {view.weeks.map((week) => (
          <List key={String(week[0]?.date)}>
            {week.map((cell) => (
              <MonthDay key={String(cell.date)} cell={cell} />
            ))}
          </List>
        ))}
      </Card.Body>
    </Card>
  );
}

function MonthDay(props: { readonly cell: MonthCell }): ReactNode {
  const t = useTranslator();
  const { cell } = props;
  const day = String(new Date(cell.date).getUTCDate());

  return (
    <List.Item
      label={day}
      // The count rather than silent clipping: a cell that showed two of four
      // is how a family misses the fourth thing.
      subtitle={
        cell.overflow > 0
          ? t.t("calendar.more", { count: String(cell.overflow) })
          : cell.occurrences.map((occurrence) => occurrence.title).join(" · ")
      }
      {...(cell.isToday ? { leadingIcon: "calendar" as const } : {})}
      testID={
        "calendar-month-day-" +
        new Date(cell.date).toISOString().slice(0, 10) +
        (cell.inMonth ? "" : "-outside")
      }
    />
  );
}

function AgendaView(props: { readonly anchor: number }): ReactNode {
  const state = useFamilyState();
  const t = useTranslator();
  const view = useMemo(() => selectAgenda(state, { anchor: props.anchor }), [state, props.anchor]);

  if (view.days.length === 0) {
    return (
      <EmptyState label={t.t("calendar.nothingOn")} leadingIcon="calendar" testID="calendar-agenda-empty" />
    );
  }

  return (
    <List testID="calendar-agenda">
      {/* One flat list with a header per day rather than a list per day: the
          design system's List takes Item / Header / Separator children only,
          and a run of separate Lists would draw a border between every day. */}
      {view.days.flatMap((day) => [
        <List.Header key={"h-" + String(day.date)} label={t.formatDate(day.date)} />,
        ...day.occurrences.map((occurrence) => (
          <List.Item
            key={occurrence.id}
            label={occurrence.private ? t.t("calendar.busy") : occurrence.title}
            trailingLabel={occurrence.allDay ? "" : t.formatTime(occurrence.startsAt)}
            leadingIcon="calendar"
            testID={"calendar-agenda-" + occurrence.id}
          />
        )),
      ])}
    </List>
  );
}

function TimelineView(props: {
  readonly anchor: number;
  readonly personIds: readonly string[];
}): ReactNode {
  const state = useFamilyState();
  const t = useTranslator();

  const view = useMemo(
    () => selectTimeline(state, { anchor: props.anchor, personIds: props.personIds }),
    [state, props.anchor, props.personIds],
  );

  if (view.lanes.length === 0) {
    return (
      <EmptyState label={t.t("calendar.nothingOn")} leadingIcon="user" testID="calendar-timeline-empty" />
    );
  }

  return (
    <Card variant="outlined" testID="calendar-timeline">
      <Card.Body>
        {view.lanes.map((lane) => (
          <List key={lane.personId} testID={"calendar-lane-" + lane.personId}>
            <List.Header label={lane.personId} />
            {/* An empty lane says "nothing booked". A missing lane would say
                "no data", which is the opposite answer. */}
            {lane.entries.length === 0 ? (
              <List.Item
                label={t.t("calendar.nothingOn")}
                testID={"calendar-lane-empty-" + lane.personId}
              />
            ) : (
              lane.entries.map((entry) => (
                <List.Item
                  key={entry.occurrence.id}
                  label={
                    entry.occurrence.title.length === 0
                      ? t.t("calendar.busy")
                      : entry.occurrence.title
                  }
                  trailingLabel={t.formatTime(entry.occurrence.startsAt)}
                  testID={"calendar-entry-" + entry.occurrence.id}
                />
              ))
            )}
          </List>
        ))}
      </Card.Body>
    </Card>
  );
}
