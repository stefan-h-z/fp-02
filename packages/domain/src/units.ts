/**
 * Units and quantities.
 *
 * Quantities exist for one reason: so the same ingredient coming from three
 * recipes becomes one line on the shopping list (SPEC FR-714). That only works if
 * "2 tbsp", "30 ml" and "0.03 l" are comparable, which is what normalization is
 * for (FR-513).
 *
 * Where a conversion would be a guess — a pinch, a bunch, "some" — the quantity
 * stays unconverted and the line says so. A wrong number is worse than no number
 * (SPEC P-08).
 */
export type Dimension = "mass" | "volume" | "count" | "opaque";

export interface Quantity {
  readonly amount: number;
  /** The unit as written by the author, for display. */
  readonly unit: string;
}

export interface NormalizedQuantity {
  readonly dimension: Dimension;
  /** Amount in the dimension's canonical unit: g, ml, or pieces. */
  readonly canonicalAmount: number;
  readonly originalUnit: string;
}

interface UnitDefinition {
  readonly dimension: Dimension;
  readonly toCanonical: number;
}

/**
 * Spoon and cup measures are volume by convention (metric kitchen values). They
 * are approximations by nature, which is fine for shopping but is why cooking
 * steps always show the author's original wording.
 */
const UNITS: Readonly<Record<string, UnitDefinition>> = {
  g: { dimension: "mass", toCanonical: 1 },
  gram: { dimension: "mass", toCanonical: 1 },
  grams: { dimension: "mass", toCanonical: 1 },
  kg: { dimension: "mass", toCanonical: 1000 },
  mg: { dimension: "mass", toCanonical: 0.001 },
  ml: { dimension: "volume", toCanonical: 1 },
  cl: { dimension: "volume", toCanonical: 10 },
  dl: { dimension: "volume", toCanonical: 100 },
  l: { dimension: "volume", toCanonical: 1000 },
  liter: { dimension: "volume", toCanonical: 1000 },
  litre: { dimension: "volume", toCanonical: 1000 },
  tbsp: { dimension: "volume", toCanonical: 15 },
  tsp: { dimension: "volume", toCanonical: 5 },
  cup: { dimension: "volume", toCanonical: 240 },
  piece: { dimension: "count", toCanonical: 1 },
  pieces: { dimension: "count", toCanonical: 1 },
  pack: { dimension: "count", toCanonical: 1 },
  can: { dimension: "count", toCanonical: 1 },
  clove: { dimension: "count", toCanonical: 1 },
};

/** Aliases people actually type, including the German kitchen shorthand. */
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  el: "tbsp",
  tl: "tsp",
  tbs: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  stk: "piece",
  st: "piece",
  stück: "piece",
  pkg: "pack",
  packet: "pack",
  dose: "can",
  zehe: "clove",
  cloves: "clove",
  cups: "cup",
  liters: "l",
  litres: "l",
};

export function normalizeUnitName(unit: string): string {
  const lowered = unit.trim().toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[lowered] ?? lowered;
}

export function normalizeQuantity(quantity: Quantity): NormalizedQuantity {
  const name = normalizeUnitName(quantity.unit);
  const definition = UNITS[name];
  if (definition === undefined) {
    return { dimension: "opaque", canonicalAmount: quantity.amount, originalUnit: quantity.unit };
  }
  return {
    dimension: definition.dimension,
    canonicalAmount: quantity.amount * definition.toCanonical,
    originalUnit: quantity.unit,
  };
}

/**
 * Two quantities can be added when they share a dimension — and, for the
 * unconvertible ones, when they are literally the same unit ("2 pinches").
 */
export function isAddable(a: NormalizedQuantity, b: NormalizedQuantity): boolean {
  if (a.dimension !== b.dimension) return false;
  if (a.dimension !== "opaque") return true;
  return normalizeUnitName(a.originalUnit) === normalizeUnitName(b.originalUnit);
}

export function addQuantities(
  a: NormalizedQuantity,
  b: NormalizedQuantity,
): NormalizedQuantity | undefined {
  if (!isAddable(a, b)) return undefined;
  return { ...a, canonicalAmount: a.canonicalAmount + b.canonicalAmount };
}

/**
 * Render a normalized amount the way a person would write it, rounding to
 * something you can actually buy or measure (FR-514: sensible rounding).
 */
export function formatQuantity(quantity: NormalizedQuantity): string {
  switch (quantity.dimension) {
    case "mass":
      return quantity.canonicalAmount >= 1000
        ? trim(quantity.canonicalAmount / 1000) + " kg"
        : trim(roundKitchen(quantity.canonicalAmount)) + " g";
    case "volume":
      return quantity.canonicalAmount >= 1000
        ? trim(quantity.canonicalAmount / 1000) + " l"
        : trim(roundKitchen(quantity.canonicalAmount)) + " ml";
    case "count":
      return trim(quantity.canonicalAmount) + "×";
    case "opaque":
      return trim(quantity.canonicalAmount) + " " + quantity.originalUnit.trim();
  }
}

/** Nobody weighs 187 g of flour: round to steps a kitchen scale shows. */
function roundKitchen(amount: number): number {
  if (amount < 10) return Math.round(amount * 2) / 2;
  if (amount < 100) return Math.round(amount / 5) * 5;
  return Math.round(amount / 10) * 10;
}

function trim(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

/**
 * Scale a recipe quantity to a different number of eaters (FR-514, FR-603).
 * Counts stay whole — half an egg is not a shopping instruction.
 */
export function scaleQuantity(quantity: NormalizedQuantity, factor: number): NormalizedQuantity {
  const scaled = quantity.canonicalAmount * factor;
  if (quantity.dimension === "count") {
    return { ...quantity, canonicalAmount: Math.max(1, Math.round(scaled)) };
  }
  return { ...quantity, canonicalAmount: scaled };
}

// ── Oven temperatures (FR-533) ────────────────────────────────────────────

/**
 * Convection is not a unit, it is a different oven.
 *
 * Recipes are written for one and cooked in the other, and the rule of thumb
 * every German cookbook prints — twenty degrees lower with the fan on — is the
 * one thing a person at the hob actually needs. It is a rule of thumb and is
 * labelled as one: ovens differ, and this is a starting point rather than a
 * promise.
 */
export const CONVECTION_OFFSET_C = 20;

export type OvenMode = "conventional" | "convection";

export interface OvenTemperature {
  readonly celsius: number;
  readonly mode: OvenMode;
}

export function toConvection(celsius: number): number {
  return celsius - CONVECTION_OFFSET_C;
}

export function toConventional(celsius: number): number {
  return celsius + CONVECTION_OFFSET_C;
}

/** Rounded to the nearest 5 °C, because no oven dial is finer than that. */
export function convertOven(temperature: OvenTemperature, to: OvenMode): OvenTemperature {
  if (temperature.mode === to) return temperature;

  const celsius =
    to === "convection" ? toConvection(temperature.celsius) : toConventional(temperature.celsius);
  return { celsius: Math.round(celsius / 5) * 5, mode: to };
}

export function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return Math.round(((fahrenheit - 32) * 5) / 9);
}

/**
 * Finds an oven temperature in a step's text, so cook mode can offer the
 * conversion instead of asking the person to do arithmetic with wet hands.
 * Returns `undefined` rather than guessing when there is no temperature.
 */
export function readOvenTemperature(text: string): OvenTemperature | undefined {
  const celsius = /(\d{2,3})\s*°?\s*C\b/i.exec(text);
  if (celsius !== null) {
    const value = Number(celsius[1]);
    return {
      celsius: value,
      mode: /umluft|convection|fan/i.test(text) ? "convection" : "conventional",
    };
  }

  const fahrenheit = /(\d{3})\s*°?\s*F\b/i.exec(text);
  if (fahrenheit !== null) {
    return { celsius: fahrenheitToCelsius(Number(fahrenheit[1])), mode: "conventional" };
  }
  return undefined;
}
