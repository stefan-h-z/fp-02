/**
 * Every picture a routine can ask for must exist.
 *
 * `routineIcon` maps a parent's own words onto a glyph name, and the kids' view
 * is navigated by those pictures alone (FR-1206) — a child who cannot read has
 * nothing else to go on. An unregistered name does not crash: it renders a
 * placeholder and warns in development, which is precisely why it survives. The
 * two sides are written in different files and drift silently, so the only thing
 * that keeps them honest is asserting them against each other.
 */
import { describe, expect, it } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Path, Svg } from "react-native-svg";
import { isIconRegistered } from "@cp/ui";
import { routineIcon } from "../src/selectors.js";
import { registerAppIcons } from "../src/icons.js";
import { Hairbrush, Toothbrush } from "../src/glyphs.js";

/** One phrase per branch of the mapping table, in both languages it accepts. */
const ROUTINE_PHRASES: readonly string[] = [
  "Brush teeth",
  "Zähne putzen",
  "Get dressed",
  "Anziehen",
  "Put shoes on",
  "Schuhe anziehen",
  "Breakfast",
  "Frühstück essen",
  "Pack the school bag",
  "Schulranzen packen",
  "Wash hands",
  "Duschen",
  "Go to bed",
  "Schlafen gehen",
  "Read a book",
  "Hausaufgaben",
  "Tidy the toys",
  "Spielzeug aufräumen",
  // Nothing matches: the fallback must be registered too.
  "Something nobody anticipated",
];

/**
 * Every glyph a screen names as a literal, collected by reading the screens.
 * They fail the same silent way, so they are worth the same guard.
 */
const SCREEN_ICONS: readonly string[] = [
  "alert-triangle",
  "calendar",
  "check-circle",
  "check-square",
  "clock",
  "help-circle",
  "package",
  "pill",
  "shopping-cart",
  "user",
  "user-plus",
  "utensils",
];

describe("routine glyphs (SPEC FR-1206)", () => {
  it("resolves every icon the mapping can return", () => {
    registerAppIcons();

    const missing = [
      ...new Set(
        ROUTINE_PHRASES.map((phrase) => routineIcon(phrase)).filter(
          (name) => !isIconRegistered(name),
        ),
      ),
    ];

    expect(missing).toEqual([]);
  });

  it("resolves every glyph the screens ask for by name", () => {
    registerAppIcons();

    expect(SCREEN_ICONS.filter((name) => !isIconRegistered(name))).toEqual([]);
  });

  /**
   * The hand-drawn pair have no library behind them, so this asserts they are
   * real geometry rather than an empty frame — an `<Svg>` with nothing in it
   * would satisfy "renders" and show a child a blank square.
   */
  it.each([
    ["toothbrush", Toothbrush],
    ["hairbrush", Hairbrush],
  ])("draws %s rather than falling back", (_name, Glyph) => {
    const tree = render(<Glyph size={24} color="#101010" strokeWidth={2} />);

    const paths = tree.UNSAFE_getAllByType(Path);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(typeof path.props["d"]).toBe("string");
      expect((path.props["d"] as string).length).toBeGreaterThan(0);
    }
    expect(tree.UNSAFE_getByType(Svg).props["stroke"]).toBe("#101010");
  });
});
