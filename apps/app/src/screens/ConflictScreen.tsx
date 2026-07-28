/**
 * Resolving a conflict (SPEC FR-1215, SC-009).
 *
 * The screen exists so that the app never has to overwrite anything quietly. It
 * shows both versions with who wrote each and when, and asks one question. That
 * is the whole interaction: two buttons, no merge editor, no diff — because the
 * person reading this is usually holding a phone in a hallway, not sitting down
 * to adjudicate.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Card, EmptyState, Text } from "@cp/ui";
import type { ConflictRecord } from "@fam/storage";
import type { Value } from "@fam/domain";
import { useRuntime, useTranslator } from "../runtime.js";

export function ConflictScreen(): ReactNode {
  const { client, now } = useRuntime();
  const t = useTranslator();
  const [conflicts, setConflicts] = useState<readonly ConflictRecord[]>([]);

  const refresh = useCallback(async () => {
    setConflicts(await client.openConflicts());
  }, [client]);

  useEffect(() => {
    void refresh();
    return client.onChange(() => void refresh());
  }, [client, refresh]);

  const resolve = useCallback(
    async (conflict: ConflictRecord, choice: "keep-current" | "take-incoming") => {
      await client.resolveConflict(conflict, choice, new Date(now()).toISOString());
      await refresh();
    },
    [client, now, refresh],
  );

  if (conflicts.length === 0) {
    return <EmptyState label={t.t("sync.upToDate")} leadingIcon="check-circle" size="sm" />;
  }

  return (
    <>
      {conflicts.map((conflict) => (
        <Card key={conflict.id} variant="outlined">
          <Card.Header>
            <Text role="heading3">{t.t("conflict.title")}</Text>
          </Card.Header>
          <Card.Body>
            <Alert
              variant="info"
              label={conflict.field}
              hint={t.t("conflict.explain", {
                person: conflict.incomingActorId ?? "—",
                value: display(conflict.incomingValue),
              })}
            />
          </Card.Body>
          <Card.Footer>
            <Button
              label={t.t("conflict.keepCurrent", { value: display(conflict.currentValue) })}
              variant="outline"
              onPress={() => void resolve(conflict, "keep-current")}
              testID={"conflict-keep-" + conflict.id}
            />
            <Button
              label={t.t("conflict.takeIncoming", { value: display(conflict.incomingValue) })}
              variant="primary"
              onPress={() => void resolve(conflict, "take-incoming")}
              testID={"conflict-take-" + conflict.id}
            />
          </Card.Footer>
        </Card>
      ))}
    </>
  );
}

/**
 * Conflicting values are raw field values, so they may be a timestamp, a person
 * id or a flag. Rendering them needs a human-readable fallback rather than
 * `[object Object]` in the one dialog that must be trustworthy.
 */
function display(value: Value | undefined): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
