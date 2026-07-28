/**
 * The shopping list (SPEC §10).
 *
 * The screen that has to work in a supermarket aisle with one hand and no
 * signal, so it does as little as possible: the sections come from the selector,
 * a tap is a check-off, and the grouping switch is the only chrome. Reported
 * items sit above predicted ones because the family can trust them differently
 * (FR-739).
 */
import { useMemo, useState, type ReactNode } from "react";
import { Badge, Button, EmptyState, List, Text } from "@cp/ui";
import { checkOff, checkOffPlanned, dismissSuggestion, uncheck } from "../commands.js";
import { selectShoppingList } from "../selectors.js";
import { useFamilyState, useMutate, useRuntime, useTranslator } from "../runtime.js";
import type { Grouping, ListLine, Rhythm } from "@fam/domain";

export interface ShoppingScreenProps {
  readonly listId: string;
  readonly weekPlanId?: string;
  /** Set while standing in a particular shop (FR-705). */
  readonly atStore?: string;
}

export function ShoppingScreen(props: ShoppingScreenProps): ReactNode {
  const state = useFamilyState();
  const mutate = useMutate();
  const t = useTranslator();
  const { actorId, now } = useRuntime();

  // Planning happens by shop, shopping happens by aisle (FR-704).
  const [grouping, setGrouping] = useState<Grouping>(props.atStore === undefined ? "store" : "productGroup");
  const [expanded, setExpanded] = useState(false);

  const view = useMemo(
    () =>
      selectShoppingList(state, {
        listId: props.listId,
        now: now(),
        grouping,
        personId: actorId,
        ...(props.weekPlanId === undefined ? {} : { weekPlanId: props.weekPlanId }),
        ...(props.atStore === undefined ? {} : { atStore: props.atStore }),
      }),
    [state, props.listId, props.weekPlanId, props.atStore, grouping, actorId, now],
  );

  const toggle = (line: ListLine): void => {
    if (line.checked) {
      void uncheck(mutate, line.id);
      return;
    }
    if (line.origin === "plan" && props.weekPlanId !== undefined) {
      void checkOffPlanned(mutate, {
        weekPlanId: props.weekPlanId,
        itemKey: line.itemKey,
        listId: props.listId,
        at: now(),
      });
      return;
    }
    void checkOff(mutate, { itemId: line.id, itemKey: line.itemKey, at: now() });
  };

  if (view.groups.length === 0 && view.reported.length === 0 && view.probablyDue.length === 0) {
    return <EmptyState label={t.t("list.empty")} leadingIcon="shopping-cart" hint={t.t("list.addItem")} />;
  }

  return (
    <>
      <Button
        label={grouping === "store" ? t.t("list.groupBy.productGroup") : t.t("list.groupBy.store")}
        variant="ghost"
        size="sm"
        onPress={() => setGrouping(grouping === "store" ? "productGroup" : "store")}
      />

      {view.reported.length > 0 ? (
        <List>
          <List.Header label={t.t("list.section.reported")} />
          {view.reported.map((rhythm) => (
            <SuggestionRow key={rhythm.itemKey} rhythm={rhythm} reason={t.t("list.whyDue")} />
          ))}
        </List>
      ) : null}

      {view.probablyDue.length > 0 ? (
        <List>
          <List.Header label={t.t("list.section.probablyDue")} />
          {(expanded ? [...view.probablyDue, ...view.moreDue] : view.probablyDue).map((rhythm) => (
            <SuggestionRow
              key={rhythm.itemKey}
              rhythm={rhythm}
              reason={t.t("list.whyDue")}
              onDismiss={() => void dismissSuggestion(mutate, { itemKey: rhythm.itemKey, at: now() })}
            />
          ))}
          {view.moreDue.length > 0 && !expanded ? (
            <List.Item label={t.t("list.section.more")} pressable onPress={() => setExpanded(true)} />
          ) : null}
        </List>
      ) : null}

      {view.groups.map((group) => (
        <List key={group.key}>
          <List.Header label={group.label} />
          {group.lines.map((line) => (
            <List.Item
              key={line.id}
              label={line.name}
              {...(subtitleFor(line) === undefined ? {} : { subtitle: subtitleFor(line)! })}
              leadingIcon={line.checked ? "check-circle" : "circle"}
              trailingLabel={line.quantityLabel}
              trailingContent={
                line.awaitingApproval ? <Badge label={t.t("list.awaitingApproval")} variant="warning" size="sm" /> : null
              }
              pressable
              onPress={() => toggle(line)}
              selected={line.checked}
              testID={"list-line-" + line.id}
            />
          ))}
        </List>
      ))}
    </>
  );
}

/** The "why is this here?" line, shown on request rather than by default (FR-740). */
function SuggestionRow(props: {
  readonly rhythm: Rhythm;
  readonly reason: string;
  readonly onDismiss?: () => void;
}): ReactNode {
  const [showReason, setShowReason] = useState(false);

  return (
    <List.Item
      label={props.rhythm.itemKey}
      {...(showReason ? { subtitle: props.rhythm.reason } : {})}
      leadingIcon={props.rhythm.reported ? "alert-circle" : "clock"}
      trailingContent={
        <>
          <Button label={props.reason} variant="ghost" size="sm" onPress={() => setShowReason(!showReason)} />
          {props.onDismiss === undefined ? null : (
            <Button label="✕" variant="ghost" size="sm" onPress={props.onDismiss} />
          )}
        </>
      }
      testID={"suggestion-" + props.rhythm.itemKey}
    />
  );
}

function subtitleFor(line: ListLine): string | undefined {
  if (line.openQuestion !== undefined) return line.openQuestion;
  if (line.plannedFrom.length > 0) return line.plannedFrom.join(", ");
  if (line.note.length > 0) return line.note;
  return undefined;
}

export function ShoppingHeading(props: { readonly openCount: number }): ReactNode {
  return <Text role="heading1">{String(props.openCount)}</Text>;
}
