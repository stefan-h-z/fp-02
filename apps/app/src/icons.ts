/**
 * The glyphs this app needs beyond the design system's built-in set.
 *
 * `@cp/ui` ships a deliberately small icon set and exposes `registerIcons` as
 * the supported way for an application to add its own — so a pill, a saucepan
 * and a toothbrush belong here rather than in the library, which has no reason
 * to know about medication schedules or a child's morning routine.
 *
 * Called once from the shell. An unregistered name renders a visible placeholder
 * and warns in development, which is why this list is worth keeping honest: a
 * missing glyph is a silent-looking bug on a screen a child is meant to read.
 */
import { createElement } from "react";
import { registerIcons, type IconComponent } from "@cp/ui";
import { Hairbrush, Toothbrush } from "./glyphs.js";
import {
  Backpack,
  Bath,
  BedDouble,
  Calendar,
  Circle,
  CircleMinus,
  Clock,
  Filter,
  Footprints,
  Package,
  Pill,
  Shirt,
  Sparkles,
  Timer,
  Utensils,
  type LucideIcon,
} from "lucide-react-native";

/**
 * Wraps a lucide icon in a plain function component.
 *
 * Not ceremony: `registerIcons` accepts a glyph only if `typeof glyph ===
 * "function"`, and lucide's icons are `forwardRef` objects, so registering one
 * directly is rejected — individually and at runtime, leaving every name to fall
 * back to a placeholder. TypeScript could not catch it because `IconComponent`
 * is a bare call signature that a `forwardRef` object structurally satisfies;
 * the `as IconComponent` casts this file used to carry were hiding it. A render
 * test caught it (`render-test/icons.test.tsx`), which is why that test exists.
 */
function glyph(Source: LucideIcon): IconComponent {
  return (props) => createElement(Source, props);
}

/**
 * Kebab-case names, matching the design system's convention.
 *
 * `toothbrush` and `hairbrush` are drawn in `glyphs.tsx` rather than taken from
 * lucide, which has neither — its nearest offer is a painter's brush, and a
 * routine icon a four-year-old cannot recognise is worse than a generic one
 * (SPEC FR-1206).
 */
const APP_ICONS: Readonly<Record<string, IconComponent>> = {
  // Protocols and health
  pill: glyph(Pill),
  timer: glyph(Timer),

  // Meals
  utensils: glyph(Utensils),
  package: glyph(Package),

  // Calendar and lists
  calendar: glyph(Calendar),
  clock: glyph(Clock),
  circle: glyph(Circle),
  "minus-circle": glyph(CircleMinus),
  filter: glyph(Filter),

  // A child's routine (FR-1207)
  backpack: glyph(Backpack),
  shirt: glyph(Shirt),
  bath: glyph(Bath),
  bed: glyph(BedDouble),
  shoes: glyph(Footprints),
  toothbrush: Toothbrush,
  hairbrush: Hairbrush,
  // Not a stand-in: sparkles is what "tidied up" looks like, and a child reads
  // it as the room being finished rather than as an object to fetch.
  tidy: glyph(Sparkles),
};

let registered = false;

export function registerAppIcons(): void {
  // Idempotent: the shell may remount during development, and registering twice
  // would be harmless but the guard makes the intent explicit.
  if (registered) return;
  registered = true;
  registerIcons(APP_ICONS);
}

export const APP_ICON_NAMES: readonly string[] = Object.keys(APP_ICONS);
