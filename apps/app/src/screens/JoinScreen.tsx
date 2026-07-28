/**
 * Getting into a family (SPEC §4.3, §4.4).
 *
 * Three ways in, and the ordering on screen matters: joining by link is first,
 * because that is what everyone except the very first adult does, and the
 * invitation already carries their name and role so there is nothing to fill in
 * (FR-118). Creating a family is second. Redeeming a recovery code is last —
 * it is the path somebody takes when their phone is gone, and it should not be
 * the first thing a new user reads.
 *
 * No password appears anywhere on this screen, by design.
 */
import { useCallback, useState, type ReactNode } from "react";
import { Alert, Button, Card, Input, Text } from "@cp/ui";
import type { AuthClient, DeviceSession, InviteDetails } from "@fam/api";
import { useTranslator } from "../runtime.js";

export interface JoinScreenProps {
  readonly auth: AuthClient;
  readonly onJoined: (session: DeviceSession, recoveryCode?: string) => void;
  /** Prefilled when the app was opened from an invitation link. */
  readonly inviteToken?: string;
}

type Mode = "choose" | "join" | "create" | "recover";

export function JoinScreen(props: JoinScreenProps): ReactNode {
  const t = useTranslator();
  const [mode, setMode] = useState<Mode>(props.inviteToken === undefined ? "choose" : "join");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Anything that talks to the server shares this wrapper: the failure has to be
  // visible and the button has to stop being pressable, or a person on a bad
  // connection creates three families.
  const attempt = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch {
      setError(t.t("join.failed"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  if (mode === "join") {
    return (
      <JoinByInvite
        auth={props.auth}
        busy={busy}
        error={error}
        attempt={attempt}
        onJoined={props.onJoined}
        onBack={() => setMode("choose")}
        {...(props.inviteToken === undefined ? {} : { inviteToken: props.inviteToken })}
      />
    );
  }
  if (mode === "create") {
    return (
      <CreateFamily
        auth={props.auth}
        busy={busy}
        error={error}
        attempt={attempt}
        onJoined={props.onJoined}
        onBack={() => setMode("choose")}
      />
    );
  }
  if (mode === "recover") {
    return (
      <Recover
        auth={props.auth}
        busy={busy}
        error={error}
        attempt={attempt}
        onJoined={props.onJoined}
        onBack={() => setMode("choose")}
      />
    );
  }

  return (
    <>
      <Text role="heading1">{t.t("app.name")}</Text>
      <Button label={t.t("join.haveLink")} variant="primary" onPress={() => setMode("join")} testID="join-invite" />
      <Button label={t.t("join.createFamily")} variant="outline" onPress={() => setMode("create")} testID="join-create" />
      <Button label={t.t("join.lostDevice")} variant="ghost" onPress={() => setMode("recover")} testID="join-recover" />
    </>
  );
}

interface StepProps {
  readonly auth: AuthClient;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly attempt: (work: () => Promise<void>) => Promise<void>;
  readonly onJoined: (session: DeviceSession, recoveryCode?: string) => void;
  readonly onBack: () => void;
}

/**
 * The joiner sees who invited them and as what, before committing — an
 * invitation is the one moment where the app can show that it already knows the
 * answer, so it should (FR-118).
 */
function JoinByInvite(props: StepProps & { readonly inviteToken?: string }): ReactNode {
  const t = useTranslator();
  const [token, setToken] = useState(props.inviteToken ?? "");
  const [details, setDetails] = useState<InviteDetails | undefined>(undefined);

  const inspect = () =>
    void props.attempt(async () => {
      setDetails(await props.auth.inspectInvite(token.trim()));
    });

  const redeem = () =>
    void props.attempt(async () => {
      const session = await props.auth.redeemInvite({ inviteToken: token.trim(), deviceName: deviceName() });
      props.onJoined(session);
    });

  return (
    <>
      <Text role="heading2">{t.t("join.haveLink")}</Text>
      {props.error === undefined ? null : <Alert variant="error" label={props.error} />}

      <Input value={token} onValueChange={setToken} placeholder={t.t("join.codePlaceholder")} testID="invite-token" />

      {details === undefined ? (
        <Button
          label={t.t("common.save")}
          variant="primary"
          disabled={props.busy || token.trim().length === 0}
          onPress={inspect}
          testID="invite-inspect"
        />
      ) : (
        <Card variant="outlined">
          <Card.Body>
            <Text role="body">{t.t("join.invitedAs", { name: details.name, family: details.familyName })}</Text>
          </Card.Body>
          <Card.Footer>
            <Button label={t.t("join.joinNow")} variant="primary" disabled={props.busy} onPress={redeem} testID="invite-redeem" />
          </Card.Footer>
        </Card>
      )}

      <Button label={t.t("common.cancel")} variant="ghost" onPress={props.onBack} />
    </>
  );
}

/**
 * The first adult. The recovery code comes back from this call and is shown
 * exactly once, which is why it is handed straight to the caller rather than
 * stored — it must reach paper, not local storage (FR-120).
 */
function CreateFamily(props: StepProps): ReactNode {
  const t = useTranslator();
  const [familyName, setFamilyName] = useState("");
  const [personName, setPersonName] = useState("");

  const create = () =>
    void props.attempt(async () => {
      const result = await props.auth.createFamily({
        familyName: familyName.trim(),
        personName: personName.trim(),
        deviceName: deviceName(),
      });
      props.onJoined(result.session, result.recoveryCode);
    });

  return (
    <>
      <Text role="heading2">{t.t("join.createFamily")}</Text>
      {props.error === undefined ? null : <Alert variant="error" label={props.error} />}

      <Input value={familyName} onValueChange={setFamilyName} placeholder={t.t("join.familyName")} testID="family-name" />
      <Input value={personName} onValueChange={setPersonName} placeholder={t.t("onboarding.personName")} testID="person-name" />

      <Button
        label={t.t("join.createFamily")}
        variant="primary"
        disabled={props.busy || familyName.trim().length === 0 || personName.trim().length === 0}
        onPress={create}
        testID="family-create"
      />
      <Button label={t.t("common.cancel")} variant="ghost" onPress={props.onBack} />
    </>
  );
}

/**
 * The fallback when there is no second adult to approve the device (FR-120).
 * Redeeming issues a fresh code, so the family is never left without one.
 */
function Recover(props: StepProps): ReactNode {
  const t = useTranslator();
  const [familyId, setFamilyId] = useState("");
  const [code, setCode] = useState("");

  const redeem = () =>
    void props.attempt(async () => {
      const result = await props.auth.redeemRecoveryCode({
        familyId: familyId.trim(),
        recoveryCode: code.trim(),
        deviceName: deviceName(),
      });
      props.onJoined(result.session, result.recoveryCode);
    });

  return (
    <>
      <Text role="heading2">{t.t("join.lostDevice")}</Text>
      <Alert variant="info" label={t.t("join.recoverHint")} />
      {props.error === undefined ? null : <Alert variant="error" label={props.error} />}

      <Input value={familyId} onValueChange={setFamilyId} placeholder={t.t("join.familyId")} testID="recover-family" />
      <Input value={code} onValueChange={setCode} placeholder={t.t("join.recoveryCode")} testID="recover-code" />

      <Button
        label={t.t("join.joinNow")}
        variant="primary"
        disabled={props.busy || code.trim().length === 0}
        onPress={redeem}
        testID="recover-redeem"
      />
      <Button label={t.t("common.cancel")} variant="ghost" onPress={props.onBack} />
    </>
  );
}

/** Named so the device list is readable by a person deciding what to revoke. */
function deviceName(): string {
  return "This device";
}
