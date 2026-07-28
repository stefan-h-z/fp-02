import type { ReactNode } from "react";
import { useLocalSearchParams } from "expo-router";
import { RoutineScreen } from "../../src/screens/RoutineScreen.js";

export default function RoutineRoute(): ReactNode {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  return <RoutineScreen taskId={taskId} />;
}
