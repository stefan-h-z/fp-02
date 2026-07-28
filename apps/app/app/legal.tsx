/**
 * The legal texts (FR-1401, FR-1402, FR-1404).
 *
 * Deliberately outside the signed-in area: a person deciding whether to join a
 * family has to be able to read what happens to their data first, and the join
 * screen is where they are standing when they want to.
 */
import type { ReactNode } from "react";
import { LegalScreen } from "../src/screens/LegalScreen.js";

export default function LegalRoute(): ReactNode {
  return <LegalScreen />;
}
