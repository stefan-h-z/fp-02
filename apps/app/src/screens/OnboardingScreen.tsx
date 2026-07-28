/**
 * Onboarding (SPEC §4.5, FR-124…130).
 *
 * Two questions and then the app: who is in the family, and which part is
 * wearing this family down right now. The second answer decides which area is
 * switched on (FR-125) — everything else appears when it is needed, so there is
 * nothing to configure and nothing to skip.
 *
 * The recovery code (FR-120) sits between the two questions and the app because
 * it is the only screen in the product that must be read rather than tapped
 * through: it is the way back in when no second adult is available.
 */
import { useState, type ReactNode } from "react";
import { Alert, Badge, Button, Card, Input, List, Text } from "@cp/ui";
import { addFamilyMember, chooseStartArea } from "../commands.js";
import { useMutate, useTranslator } from "../runtime.js";

type Step = "who" | "area" | "recovery";

type Role = "adult" | "teen" | "child";

/** The four answers to "which part hurts?", each mapping to one enabled area. */
const AREAS = [
  { area: "food", labelKey: "onboarding.area.food" },
  { area: "calendar", labelKey: "onboarding.area.calendar" },
  { area: "tasks", labelKey: "onboarding.area.tasks" },
  { area: "health", labelKey: "onboarding.area.health" },
] as const;

const ROLES: readonly Role[] = ["adult", "teen", "child"];

export interface OnboardingScreenProps {
  readonly familyId: string;
  /**
   * Issued once, by the server, when the family is created (FR-120). Absent
   * while the join flow is still missing (docs/status.md, WP-0.8) — the step is
   * shown either way, because a family that never saw the screen would never
   * learn the code exists.
   */
  readonly recoveryCode?: string;
  /** Where to go once the area is chosen — the app itself, not a tour. */
  readonly onFinished?: (area: string) => void;
}

export function OnboardingScreen(props: OnboardingScreenProps): ReactNode {
  const mutate = useMutate();
  const t = useTranslator();

  const [step, setStep] = useState<Step>("who");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("adult");
  const [people, setPeople] = useState<readonly { readonly id: string; readonly name: string; readonly role: Role }[]>(
    [],
  );
  const [area, setArea] = useState<string | undefined>(undefined);

  // FR-129: there is no progress bar and no "profile 60 % complete" here. It
  // would be two lines to add and it is deliberately absent — a family that has
  // answered both questions is finished, not 60 % of the way to something.

  const add = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;

    const id = await addFamilyMember(mutate, { familyId: props.familyId, name: trimmed, role });
    setPeople([...people, { id, name: trimmed, role }]);
    setName("");
    // The role stays where it was: families type the adults first and the
    // children after, so resetting it would cost a tap on every entry.
  };

  if (step === "who") {
    return (
      <>
        <Text role="heading1">{t.t("onboarding.who")}</Text>
        <Text role="caption">{t.t("onboarding.whoHint")}</Text>

        <Input
          value={name}
          label={t.t("onboarding.personName")}
          onValueChange={setName}
          onSubmit={() => void add()}
          testID="onboarding-name"
        />
        {ROLES.map((candidate) => (
          <Button
            key={candidate}
            label={t.t(roleKey(candidate))}
            variant={candidate === role ? "primary" : "outline"}
            size="sm"
            onPress={() => setRole(candidate)}
            testID={"onboarding-role-" + candidate}
          />
        ))}
        <Button
          label={t.t("onboarding.addPerson")}
          variant="outline"
          disabled={name.trim().length === 0}
          onPress={() => void add()}
          testID="onboarding-add"
        />

        {people.length === 0 ? null : (
          <List>
            {people.map((person) => (
              <List.Item
                key={person.id}
                label={person.name}
                leadingIcon="user"
                trailingContent={<Badge label={t.t(roleKey(person.role))} size="sm" />}
                testID={"onboarding-person-" + person.id}
              />
            ))}
          </List>
        )}

        <Button
          label={t.t("onboarding.continue")}
          variant="primary"
          disabled={people.length === 0}
          onPress={() => setStep("area")}
          testID="onboarding-continue"
        />
        {/* FR-118: a joiner never answers any of this — their invitation
            already carries their name and role. */}
        <Button label={t.t("onboarding.joinWithCode")} variant="ghost" size="sm" testID="onboarding-join" />
      </>
    );
  }

  if (step === "area") {
    return (
      <>
        <Text role="heading1">{t.t("onboarding.whatHurts")}</Text>
        {AREAS.map((candidate) => (
          <Button
            key={candidate.area}
            label={t.t(candidate.labelKey)}
            variant="outline"
            fullWidth
            onPress={() => {
              setArea(candidate.area);
              void chooseStartArea(mutate, { familyId: props.familyId, area: candidate.area });
              setStep("recovery");
            }}
            testID={"onboarding-area-" + candidate.area}
          />
        ))}
      </>
    );
  }

  return (
    <Card variant="outlined">
      <Card.Header>
        <Text role="heading2">{t.t("onboarding.recoveryCode.title")}</Text>
      </Card.Header>
      <Card.Body>
        {/* Shown as large as a heading because it is meant to be copied onto
            paper, not memorized (FR-120). */}
        <Text role="display">{props.recoveryCode ?? "—"}</Text>
        <Alert
          variant={props.recoveryCode === undefined ? "warning" : "info"}
          label={t.t("onboarding.recoveryCode.title")}
          hint={
            props.recoveryCode === undefined
              ? t.t("onboarding.recoveryCode.pending")
              : t.t("onboarding.recoveryCode.body")
          }
        />
      </Card.Body>
      <Card.Footer>
        <Button
          label={t.t("onboarding.recoveryCode.confirm")}
          variant="primary"
          onPress={() => props.onFinished?.(area ?? "food")}
          testID="onboarding-recovery-confirm"
        />
      </Card.Footer>
    </Card>
  );
}

function roleKey(role: Role): "onboarding.role.adult" | "onboarding.role.teen" | "onboarding.role.child" {
  if (role === "adult") return "onboarding.role.adult";
  if (role === "teen") return "onboarding.role.teen";
  return "onboarding.role.child";
}
