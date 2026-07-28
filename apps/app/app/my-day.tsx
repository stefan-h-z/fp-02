/**
 * "What concerns me today" (FR-1205) — a phone route: on the kitchen tablet no
 * person is selected, and the household view at `/` is the right screen there.
 */
import type { ReactNode } from "react";
import { MyDayScreen } from "../src/screens/MyDayScreen.js";
import { TodayScreen } from "../src/screens/TodayScreen.js";
import { useRuntime } from "../src/runtime.js";

export default function MyDayRoute(): ReactNode {
  const { actorId } = useRuntime();
  return actorId === null ? <TodayScreen /> : <MyDayScreen personId={actorId} />;
}
