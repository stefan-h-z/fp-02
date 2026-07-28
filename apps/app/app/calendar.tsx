/**
 * The calendar route (FR-206).
 *
 * The timeline needs to know whose lanes to draw, and the answer is everybody in
 * the family rather than a selection: the question that view answers is "who is
 * where", and a lane you have to opt into is a lane you forget to opt into.
 */
import { useMemo, type ReactNode } from "react";
import { EntityTypes } from "@fam/domain";
import { CalendarScreen } from "../src/screens/CalendarScreen.js";
import { useFamilyState } from "../src/runtime.js";

export default function CalendarRoute(): ReactNode {
  const state = useFamilyState();
  const personIds = useMemo(
    () => state.all(EntityTypes.person).filter((person) => !person.deleted).map((person) => person.id),
    [state],
  );

  return <CalendarScreen personIds={personIds} />;
}
