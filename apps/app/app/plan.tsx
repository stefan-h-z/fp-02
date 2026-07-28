import type { ReactNode } from "react";
import { WeekPlanScreen } from "../src/screens/WeekPlanScreen.js";

export default function PlanRoute(): ReactNode {
  return <WeekPlanScreen weekPlanId="current" eaterIds={[]} />;
}
