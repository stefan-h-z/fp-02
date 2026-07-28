/**
 * The home route: what this family has to get through today.
 *
 * On the kitchen tablet no person is selected, so it shows the household view;
 * on a phone the joined person narrows it to what they are responsible for
 * (SPEC FR-1205).
 */
import type { ReactNode } from "react";
import { TodayScreen } from "../src/screens/TodayScreen.js";
import { useRuntime } from "../src/runtime.js";

export default function TodayRoute(): ReactNode {
  const { actorId } = useRuntime();
  return <TodayScreen {...(actorId === null ? {} : { personId: actorId })} />;
}
