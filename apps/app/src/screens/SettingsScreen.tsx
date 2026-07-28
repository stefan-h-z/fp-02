/**
 * Data protection as working controls (SPEC §17.2).
 *
 * Every right in §17.2 that a person can actually exercise from a phone lives on
 * this one screen: get my data (FR-1411, FR-1412), delete my data (FR-1414),
 * delete the family (FR-1415), stop the learning (AI-06, FR-1417), and withdraw
 * the health consent (FR-1408).
 *
 * The screen's one real design decision: erasure shows its plan before it runs.
 * `planErasure` exists so that a person can read what will be deleted, what will
 * merely lose their name, and — the part every family app gets wrong — that the
 * shared entries stay with the family with the authorship anonymized (FR-1417a).
 */
import { useMemo, useState, type ReactNode } from "react";
import { Alert, Button, Card, List, Switch, Text, Textarea } from "@cp/ui";
import {
  eraseFamilyData,
  erasePersonalData,
  grantConsent,
  revokeConsent,
  setLearningEnabled,
} from "../commands.js";
import { HEALTH_CONSENT_SUBJECT, selectFamilyErasure, selectPrivacy } from "../selectors.js";
import { useFamilyState, useMutate, useRuntime, useTranslator } from "../runtime.js";

/** The version a consent is recorded against, so "what did I agree to" has an
 * answer years later (FR-1410). */
const POLICY_VERSION = "1.0";

export interface SettingsScreenProps {
  readonly personId: string;
}

export function SettingsScreen(props: SettingsScreenProps): ReactNode {
  const state = useFamilyState();
  const mutate = useMutate();
  const t = useTranslator();
  const { now } = useRuntime();

  const [showExport, setShowExport] = useState(false);
  const [confirming, setConfirming] = useState<"person" | "family" | undefined>(undefined);

  const view = useMemo(
    () => selectPrivacy(state, props.personId, new Date(now()).toISOString()),
    [state, props.personId, now],
  );

  return (
    <>
      <Text role="heading1">{t.t("privacy.title")}</Text>

      {/* Access and portability in one control: the bundle is shown as text
          because that is the form that works on every platform without a file
          picker (FR-1411, FR-1412). */}
      <Card variant="outlined">
        <Card.Header>
          <Card.Title label={t.t("privacy.export")} subtitle={t.t("privacy.exportExplained")} />
        </Card.Header>
        <Card.Body>
          <Text role="caption">{t.t("privacy.exportCount", { count: view.exportEntryCount })}</Text>
          {view.exportNotes.map((note) => (
            <Alert key={note} variant="info" label={t.t("privacy.title")} hint={note} />
          ))}
          {showExport ? (
            <Textarea value={view.exportJson} readOnly rows={12} testID="privacy-export-json" />
          ) : null}
        </Card.Body>
        <Card.Footer>
          <Button
            label={t.t("privacy.export")}
            variant="outline"
            onPress={() => setShowExport(!showExport)}
            testID="privacy-export"
          />
        </Card.Footer>
      </Card>

      {/* FR-1414: the plan is on screen before anything is written. */}
      <Card variant="outlined">
        <Card.Header>
          <Card.Title label={t.t("privacy.delete")} subtitle={t.t("privacy.deleteExplained")} />
        </Card.Header>
        <Card.Body>
          {confirming === "person" ? (
            <>
              <Text role="heading3">{t.t("privacy.erasure.title")}</Text>
              <List>
                <List.Item
                  label={t.t("privacy.erasure.deletes", { count: view.erasure.deletes })}
                  leadingIcon="alert-triangle"
                />
                <List.Item
                  label={t.t("privacy.erasure.clears", {
                    count: view.erasure.clears + view.erasure.setRemovals,
                  })}
                  leadingIcon="user-plus"
                />
                <List.Item label={t.t("privacy.erasure.shared")} leadingIcon="help-circle" />
              </List>
              {view.erasure.deletesWholeFamily ? (
                <Alert
                  variant="error"
                  label={t.t("privacy.deleteFamily")}
                  hint={t.t("privacy.erasure.lastAdult")}
                />
              ) : null}
            </>
          ) : null}
        </Card.Body>
        <Card.Footer>
          {confirming === "person" ? (
            <>
              <Button
                label={t.t("common.cancel")}
                variant="ghost"
                onPress={() => setConfirming(undefined)}
              />
              <Button
                label={t.t("privacy.erasure.confirm")}
                variant="destructive"
                onPress={() => {
                  void erasePersonalData(mutate, view.erasure.plan);
                  setConfirming(undefined);
                }}
                testID="privacy-delete-confirm"
              />
            </>
          ) : (
            <Button
              label={t.t("privacy.delete")}
              variant="outline"
              onPress={() => setConfirming("person")}
              testID="privacy-delete"
            />
          )}
        </Card.Footer>
      </Card>

      {/* FR-1415: account deletion inside the app, as the stores require. */}
      <Card variant="outlined">
        <Card.Header>
          <Card.Title label={t.t("privacy.deleteFamily")} subtitle={t.t("privacy.deleteFamilyExplained")} />
        </Card.Header>
        <Card.Footer>
          {confirming === "family" ? (
            <>
              <Button
                label={t.t("common.cancel")}
                variant="ghost"
                onPress={() => setConfirming(undefined)}
              />
              <Button
                label={t.t("privacy.erasure.confirm")}
                variant="destructive"
                onPress={() => {
                  void eraseFamilyData(mutate, selectFamilyErasure(state));
                  setConfirming(undefined);
                }}
                testID="privacy-delete-family-confirm"
              />
            </>
          ) : (
            <Button
              label={t.t("privacy.deleteFamily")}
              variant="outline"
              onPress={() => setConfirming("family")}
              testID="privacy-delete-family"
            />
          )}
        </Card.Footer>
      </Card>

      {/* AI-06: switching this off also forgets what was learned, which is why
          the command needs the catalog the selector hands it. */}
      <Switch
        checked={view.learningEnabled}
        label={t.t("privacy.learning")}
        hint={t.t("privacy.learningExplained")}
        disabled={view.familyId === undefined}
        onValueChange={(enabled) =>
          view.familyId === undefined
            ? undefined
            : void setLearningEnabled(mutate, {
                familyId: view.familyId,
                enabled,
                catalogItemIds: view.catalogItemIds,
              })
        }
        testID="privacy-learning"
      />

      {/* FR-1407 / FR-1408: granting and withdrawing are the same one tap. */}
      <Switch
        checked={view.healthConsentGranted}
        label={t.t("privacy.healthConsent")}
        hint={t.t("privacy.healthConsentExplained")}
        onValueChange={(granted) => {
          const at = new Date(now()).toISOString();
          if (granted) {
            void grantConsent(mutate, {
              personId: props.personId,
              subject: HEALTH_CONSENT_SUBJECT,
              policyVersion: POLICY_VERSION,
              at,
            });
            return;
          }
          void revokeConsent(mutate, { consentIds: view.healthConsentIds, at });
        }}
        testID="privacy-health-consent"
      />

      {/* FR-1405: where AI-assisted processing happens, said plainly. */}
      <Alert variant="info" label={t.t("privacy.title")} hint={t.t("privacy.aiNotice")} />
    </>
  );
}
