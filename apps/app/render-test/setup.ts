/**
 * Runs before every render test file.
 *
 * Only one thing belongs here: the glyph registration the app itself performs at
 * boot (`src/icons.ts`). Without it the design system warns on every routine
 * icon, which would bury a real failure under noise.
 */
import "@testing-library/react-native/extend-expect";
import { registerAppIcons } from "../src/icons.js";

registerAppIcons();
