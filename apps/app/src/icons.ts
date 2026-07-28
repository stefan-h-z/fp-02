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
import { registerIcons, type IconComponent } from "@cp/ui";
import {
  Backpack,
  Bath,
  BedDouble,
  Brush,
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
} from "lucide-react-native";

/**
 * Kebab-case names, matching the design system's convention. The two flagged
 * below are stand-ins: lucide has no toothbrush or hairbrush, and a routine icon
 * a four-year-old cannot recognise is worse than a generic one, so this needs a
 * real glyph before the kids' view ships (SPEC FR-1206).
 */
const APP_ICONS: Readonly<Record<string, IconComponent>> = {
  // Protocols and health
  pill: Pill as IconComponent,
  timer: Timer as IconComponent,

  // Meals
  utensils: Utensils as IconComponent,
  package: Package as IconComponent,

  // Calendar and lists
  calendar: Calendar as IconComponent,
  clock: Clock as IconComponent,
  circle: Circle as IconComponent,
  "minus-circle": CircleMinus as IconComponent,
  filter: Filter as IconComponent,

  // A child's routine (FR-1207)
  backpack: Backpack as IconComponent,
  shirt: Shirt as IconComponent,
  bath: Bath as IconComponent,
  bed: BedDouble as IconComponent,
  shoes: Footprints as IconComponent,
  toothbrush: Brush as IconComponent, // stand-in, see above
  tidy: Sparkles as IconComponent, // stand-in, see above
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
