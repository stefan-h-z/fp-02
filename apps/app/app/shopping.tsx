import type { ReactNode } from "react";
import { ShoppingScreen } from "../src/screens/ShoppingScreen.js";

export default function ShoppingRoute(): ReactNode {
  return <ShoppingScreen listId="list-groceries" />;
}
