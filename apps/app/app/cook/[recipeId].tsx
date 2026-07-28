import type { ReactNode } from "react";
import { useLocalSearchParams } from "expo-router";
import { CookModeScreen } from "../../src/screens/CookModeScreen.js";

export default function CookRoute(): ReactNode {
  const { recipeId } = useLocalSearchParams<{ recipeId: string }>();
  return <CookModeScreen recipeId={recipeId} />;
}
