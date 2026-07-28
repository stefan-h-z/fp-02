/**
 * Data protection (SPEC §17.2). The controls are per person, so the screen
 * needs to know who is asking; on a shared device nobody has said yet (FR-116).
 */
import type { ReactNode } from "react";
import { SettingsScreen } from "../src/screens/SettingsScreen.js";
import { useRuntime, useTranslator } from "../src/runtime.js";
import { EmptyState } from "@cp/ui";

export default function SettingsRoute(): ReactNode {
  const { actorId } = useRuntime();
  const t = useTranslator();

  if (actorId === null) {
    return <EmptyState label={t.t("privacy.title")} leadingIcon="help-circle" hint={t.t("onboarding.who")} />;
  }
  return <SettingsScreen personId={actorId} />;
}
