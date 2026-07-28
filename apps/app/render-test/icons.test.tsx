/**
 * The app's glyphs actually reach the design system.
 *
 * This is the test that found the bug it now guards. `registerIcons` accepts a
 * glyph only if `typeof glyph === "function"`, lucide's icons are `forwardRef`
 * objects, and `IconComponent` is a bare call signature that a `forwardRef`
 * object structurally satisfies — so the compiler was happy, registration was
 * rejected one name at a time at runtime, and every icon in the app fell back to
 * a placeholder. Nothing failed; the medication pill, the meal utensils and the
 * whole of a child's routine were simply blank shapes.
 *
 * Only a running registry can catch that, which is the argument for this harness
 * existing at all.
 */
import { describe, expect, it } from "@jest/globals";
import { isIconRegistered } from "@cp/ui";
import { APP_ICON_NAMES, registerAppIcons } from "../src/icons.js";

describe("app icon registration", () => {
  it("registers every name it claims to", () => {
    registerAppIcons();
    for (const name of APP_ICON_NAMES) {
      expect({ name, registered: isIconRegistered(name) }).toEqual({ name, registered: true });
    }
  });

  it("covers the routine glyphs the kids' view needs (FR-1207)", () => {
    registerAppIcons();
    for (const name of ["backpack", "shirt", "bath", "bed", "shoes", "toothbrush", "tidy"]) {
      expect(isIconRegistered(name)).toBe(true);
    }
  });

});
