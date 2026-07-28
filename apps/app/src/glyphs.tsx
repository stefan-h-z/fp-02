/**
 * Glyphs drawn here because no icon set has them.
 *
 * The kids' view is navigated by picture alone (FR-1206), so its icons are not
 * decoration — they are the interface. lucide has no toothbrush, and the nearest
 * thing in it is a painter's brush, which is a different object to a
 * four-year-old looking for the one that means teeth.
 *
 * Drawn to lucide's own conventions so they sit beside the rest without looking
 * borrowed: a 24×24 box, stroked rather than filled, round caps and joins, and
 * the stroke width supplied by the render site rather than baked in. `color` and
 * `strokeWidth` arrive already resolved from the design system's tokens
 * (`IconGlyphProps`), so nothing here decides what a glyph looks like in a
 * theme — it only decides its shape.
 */
import type { ReactNode } from "react";
import { Path, Rect, Svg } from "react-native-svg";
import type { IconGlyphProps } from "@cp/ui";

const BOX = 24;

/**
 * A toothbrush: bristle head with three visible tufts, a shaft, and a grip.
 *
 * The tufts are what stop it reading as a lollipop or a flag at small sizes,
 * which is the size it is actually used at in a routine list.
 */
export function Toothbrush(props: IconGlyphProps): ReactNode {
  return (
    <Glyph {...props}>
      <Rect x="8.5" y="2" width="7" height="5.5" rx="2" />
      <Path d="M10.5 3.75v2M12 3.75v2M13.5 3.75v2" />
      <Path d="M12 7.5v11" />
      <Path d="M10.5 18.5h3v2a1.5 1.5 0 0 1-3 0z" />
    </Glyph>
  );
}

/**
 * A hairbrush: an oval paddle with bristles and a handle.
 *
 * Deliberately rounder than the toothbrush and wider than it is tall at the
 * head, because the pair have to be told apart at a glance by someone who
 * cannot read either label.
 */
export function Hairbrush(props: IconGlyphProps): ReactNode {
  return (
    <Glyph {...props}>
      <Rect x="7" y="2" width="10" height="9" rx="5" />
      <Path d="M9.75 5v3M12 4.5v3.5M14.25 5v3" />
      <Path d="M12 11v9" />
      <Path d="M10.5 20h3" />
    </Glyph>
  );
}

/**
 * The frame every glyph above shares.
 *
 * `fill="none"` and `stroke={color}` rather than the other way round: the
 * design system hands down a resolved text colour and expects the glyph to be
 * an outline, the same as every lucide icon it renders beside this one.
 */
function Glyph(props: IconGlyphProps & { readonly children: ReactNode }): ReactNode {
  const size = props.size ?? BOX;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(BOX)} ${String(BOX)}`}
      fill="none"
      stroke={props.color ?? "currentColor"}
      strokeWidth={props.strokeWidth ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {props.children}
    </Svg>
  );
}
