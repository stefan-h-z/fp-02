/**
 * A treatment protocol (SPEC §12.2).
 *
 * The screen that has to be right when two tired parents are both looking at it:
 * every instance says whether it was given, by whom, and at exactly what time
 * (FR-917). That line is the feature — it is what stops the second dose.
 *
 * Acknowledging is the one action in the product where a shared device must ask
 * who is standing in front of it, so the button is disabled until somebody has
 * been selected (FR-116).
 */
import { useMemo, useState, type ReactNode } from "react";
import { Alert, Badge, Button, EmptyState, List, Text } from "@cp/ui";
import { EntityTypes, planInstances, readProtocol, summarizeProtocol, type ProtocolInstance } from "@fam/domain";
import { acknowledgeDose, skipDose } from "../commands.js";
import { useFamilyState, useMutate, useRuntime, useTranslator } from "../runtime.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProtocolScreenProps {
  readonly protocolId: string;
}

export function ProtocolScreen(props: ProtocolScreenProps): ReactNode {
  const state = useFamilyState();
  const mutate = useMutate();
  const t = useTranslator();
  const { actorId, now } = useRuntime();
  const [skipping, setSkipping] = useState<string | undefined>(undefined);

  const protocol = useMemo(() => readProtocol(state, props.protocolId), [state, props.protocolId]);

  const instances = useMemo(
    () =>
      protocol === undefined
        ? []
        : planInstances(protocol, state, { from: now() - DAY_MS, to: now() + 2 * DAY_MS, now: now() }),
    [protocol, state, now],
  );

  const summary = useMemo(
    () => (protocol === undefined ? undefined : summarizeProtocol(protocol, state, now())),
    [protocol, state, now],
  );

  if (protocol === undefined) {
    return <EmptyState label={t.t("protocol.title")} leadingIcon="pill" size="sm" />;
  }

  return (
    <>
      <Text role="heading2">{protocol.label}</Text>
      {/* The instruction is shown exactly as it was prescribed; the app never
          computes a dose (FR-913, FR-915). */}
      <Alert variant="info" label={t.t("protocol.title")} hint={protocol.instruction} />

      {actorId === null ? (
        <Alert variant="warning" label={t.t("protocol.acknowledge")} hint={t.t("onboarding.who")} />
      ) : null}

      <List>
        {instances.map((instance) => (
          <List.Item
            key={instance.id}
            label={t.formatTime(instance.dueAt)}
            subtitle={subtitleFor(instance, t)}
            leadingIcon={iconFor(instance)}
            trailingContent={
              instance.state === "acknowledged" || instance.state === "skipped" ? (
                <Badge
                  label={instance.state === "acknowledged" ? t.t("protocol.acknowledge") : t.t("protocol.skip")}
                  variant={instance.state === "acknowledged" ? "success" : "neutral"}
                  size="sm"
                />
              ) : (
                <>
                  <Button
                    label={t.t("protocol.acknowledge")}
                    variant="primary"
                    size="sm"
                    disabled={actorId === null}
                    onPress={() =>
                      actorId === null
                        ? undefined
                        : void acknowledgeDose(mutate, {
                            instanceId: instance.id,
                            personId: actorId,
                            at: now(),
                          })
                    }
                    testID={"ack-" + instance.id}
                  />
                  <Button
                    label={t.t("protocol.skip")}
                    variant="ghost"
                    size="sm"
                    disabled={actorId === null}
                    onPress={() => setSkipping(instance.id)}
                  />
                </>
              )
            }
            testID={"instance-" + instance.id}
          />
        ))}
      </List>

      {skipping !== undefined && actorId !== null ? (
        <SkipPrompt
          label={t.t("protocol.skipReason")}
          confirmLabel={t.t("common.save")}
          cancelLabel={t.t("common.cancel")}
          onCancel={() => setSkipping(undefined)}
          onConfirm={(note) => {
            void skipDose(mutate, { instanceId: skipping, personId: actorId, note, at: now() });
            setSkipping(undefined);
          }}
        />
      ) : null}

      {summary === undefined ? null : (
        <Text role="caption">
          {String(summary.acknowledged) + "/" + String(summary.total) + " · " + String(summary.missed)}
        </Text>
      )}
    </>
  );
}

/**
 * A skip always needs a reason, so it can never look like an oversight later
 * (FR-919). Two fixed reasons cover almost every real case; anything else is
 * typed.
 */
function SkipPrompt(props: {
  readonly label: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: (note: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  return (
    <>
      <Text role="body">{props.label}</Text>
      <Button label="Asleep" variant="outline" size="sm" onPress={() => props.onConfirm("Asleep")} />
      <Button label="Refused" variant="outline" size="sm" onPress={() => props.onConfirm("Refused")} />
      <Button label={props.cancelLabel} variant="ghost" size="sm" onPress={props.onCancel} />
    </>
  );
}

function subtitleFor(instance: ProtocolInstance, t: ReturnType<typeof useTranslator>): string {
  if (instance.state === "acknowledged" && instance.acknowledgedBy !== undefined) {
    return t.t("protocol.givenBy", {
      person: instance.acknowledgedBy,
      time: instance.acknowledgedAt === undefined ? "" : t.formatTime(instance.acknowledgedAt),
    });
  }
  if (instance.state === "skipped") return instance.skipNote ?? t.t("protocol.skip");
  return "";
}

function iconFor(instance: ProtocolInstance): string {
  switch (instance.state) {
    case "acknowledged":
      return "check-circle";
    case "skipped":
      return "minus-circle";
    case "missed":
      return "alert-circle";
    default:
      return "clock";
  }
}

/** Every protocol that still has something outstanding, for the today view. */
export function useOpenProtocols(): readonly string[] {
  const state = useFamilyState();
  const { now } = useRuntime();

  return useMemo(
    () =>
      state
        .all(EntityTypes.protocol)
        .filter((entity) => {
          const protocol = readProtocol(state, entity.id);
          return protocol !== undefined && now() >= protocol.startsAt && now() <= protocol.endsAt;
        })
        .map((entity) => entity.id),
    [state, now],
  );
}
