/**
 * First start (SPEC §4.5). The family id is the shell's local one until the
 * join flow exists (docs/status.md, WP-0.8), and so is the recovery code —
 * which is why the screen shows the step without one rather than skipping it.
 */
import type { ReactNode } from "react";
import { OnboardingScreen } from "../src/screens/OnboardingScreen.js";

export default function OnboardingRoute(): ReactNode {
  return <OnboardingScreen familyId="local" />;
}
