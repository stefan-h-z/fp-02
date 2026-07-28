/**
 * Turning a web page into a recipe (SPEC §8.1).
 *
 * Almost every recipe site embeds schema.org structured data, which is what
 * makes import possible at all without guessing from prose. Fetching belongs to
 * the backend (AI-01); the extraction and the ingredient parsing live here,
 * because they are rules and rules deserve tests.
 *
 * Three requirements shape this file: quantities must come out structured or
 * they cannot be aggregated onto the shopping list (FR-508, FR-714); the story
 * about the author's grandmother must not (FR-510); and a page that cannot be
 * read must fail as "could not read this", never as a recipe with wrong amounts.
 */
import { canonicalItemKey } from "./schema.js";
import { normalizeUnitName } from "./units.js";

export interface ImportedIngredient {
  readonly name: string;
  readonly amount: number | undefined;
  readonly unit: string;
  /** "finely chopped" — kept for cooking, ignored for shopping (FR-512). */
  readonly note: string;
  readonly raw: string;
}

export interface ImportedRecipe {
  readonly title: string;
  readonly servings: number | undefined;
  readonly ingredients: readonly ImportedIngredient[];
  readonly steps: readonly string[];
  readonly totalMinutes: number | undefined;
  readonly imageUrl: string | undefined;
  readonly sourceUrl: string | undefined;
  readonly author: string | undefined;
}

export type ImportOutcome =
  | { readonly ok: true; readonly recipe: ImportedRecipe }
  | { readonly ok: false; readonly reason: "no-structured-data" | "not-a-recipe" | "unreadable" };

/**
 * Read a page's embedded structured data.
 *
 * Deliberately not a general HTML parser: the JSON-LD block is the one part of a
 * recipe page that is machine-readable by design, and anything else would be
 * reverse-engineering one site's markup.
 */
export function importRecipeFromHtml(html: string, sourceUrl?: string): ImportOutcome {
  const blocks = extractJsonLdBlocks(html);
  if (blocks.length === 0) return { ok: false, reason: "no-structured-data" };

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }

    const node = findRecipeNode(parsed);
    if (node === undefined) continue;

    return { ok: true, recipe: buildRecipe(node, sourceUrl) };
  }

  return { ok: false, reason: "not-a-recipe" };
}

/** The same extraction, for structured data handed over by the backend. */
export function importRecipeFromJsonLd(data: unknown, sourceUrl?: string): ImportOutcome {
  const node = findRecipeNode(data);
  if (node === undefined) return { ok: false, reason: "not-a-recipe" };
  return { ok: true, recipe: buildRecipe(node, sourceUrl) };
}

function extractJsonLdBlocks(html: string): readonly string[] {
  const blocks: string[] = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    const content = match[1];
    if (content !== undefined && content.trim().length > 0) blocks.push(content.trim());
  }
  return blocks;
}

type JsonObject = Record<string, unknown>;

/** Recipes hide in @graph arrays and top-level lists as often as they sit alone. */
function findRecipeNode(value: unknown, depth = 0): JsonObject | undefined {
  if (depth > 6 || value === null || typeof value !== "object") return undefined;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecipeNode(item, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const node = value as JsonObject;
  if (isRecipeType(node["@type"])) return node;

  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement"]) {
    const found = findRecipeNode(node[key], depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function isRecipeType(type: unknown): boolean {
  if (typeof type === "string") return type.toLowerCase().endsWith("recipe");
  if (Array.isArray(type)) return type.some((entry) => isRecipeType(entry));
  return false;
}

function buildRecipe(node: JsonObject, sourceUrl?: string): ImportedRecipe {
  const ingredients = toStringList(node["recipeIngredient"] ?? node["ingredients"]).map(parseIngredientLine);

  return {
    title: firstString(node["name"]) ?? "",
    servings: parseServings(node["recipeYield"]),
    ingredients,
    steps: parseInstructions(node["recipeInstructions"]),
    totalMinutes: parseIsoDuration(firstString(node["totalTime"]) ?? firstString(node["cookTime"])),
    imageUrl: parseImage(node["image"]),
    sourceUrl,
    author: parseAuthor(node["author"]),
  };
}

/**
 * Parse one ingredient line into something the shopping list can add up.
 *
 * Handles the forms people and sites actually write: "2 tbsp olive oil",
 * "1/2 Zwiebel", "200-250 g Mehl", "Salz", and a trailing or parenthesised
 * preparation note. When the amount cannot be read the ingredient still comes
 * through with no quantity — a named ingredient with no amount is useful, an
 * invented amount is not (SPEC P-08).
 */
export function parseIngredientLine(raw: string): ImportedIngredient {
  const line = raw.replace(/\s+/g, " ").trim();

  // A parenthesised aside is a note, never part of the name.
  const parenthetical = /\(([^)]*)\)/.exec(line);
  const withoutParenthetical = line.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

  const match =
    /^([\d]+\s*[-–]\s*[\d]+|[\d]+[.,][\d]+|[\d]+\s*\/\s*[\d]+|[\d]+|[½¼¾⅓⅔])?\s*([\p{L}.]+)?\s*(.*)$/u.exec(
      withoutParenthetical,
    );

  const amountText = match?.[1];
  const maybeUnit = match?.[2] ?? "";
  const remainder = (match?.[3] ?? "").trim();

  const amount = amountText === undefined ? undefined : parseAmount(amountText);
  const unitName = normalizeUnitName(maybeUnit);
  const looksLikeUnit = amount !== undefined && isKnownUnit(unitName);

  // "2 Zwiebeln" — a number then a noun means pieces, not a unit called
  // "Zwiebeln"; without that, counts would never aggregate.
  const namePart = looksLikeUnit ? remainder : [maybeUnit, remainder].filter((part) => part.length > 0).join(" ");
  const { name, note } = splitPreparationNote(namePart);

  return {
    name: name.trim(),
    amount,
    unit: looksLikeUnit ? unitName : amount === undefined ? "" : "piece",
    note: [note, parenthetical?.[1] ?? ""].filter((part) => part.trim().length > 0).join(", ").trim(),
    raw: line,
  };
}

const KNOWN_UNITS = new Set([
  "g",
  "kg",
  "mg",
  "ml",
  "cl",
  "dl",
  "l",
  "tbsp",
  "tsp",
  "cup",
  "piece",
  "pack",
  "can",
  "clove",
  "pinch",
  "bunch",
]);

function isKnownUnit(unit: string): boolean {
  return KNOWN_UNITS.has(unit);
}

const FRACTIONS: Readonly<Record<string, number>> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
};

function parseAmount(text: string): number | undefined {
  const trimmed = text.trim();
  const fraction = FRACTIONS[trimmed];
  if (fraction !== undefined) return round2(fraction);

  // A range means the lower bound: buying the smaller amount and needing more is
  // recoverable in a kitchen; the reverse is waste.
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(trimmed);
  if (range !== null) return Number(range[1]);

  const ratio = /^(\d+)\s*\/\s*(\d+)$/.exec(trimmed);
  if (ratio !== null) {
    const denominator = Number(ratio[2]);
    return denominator === 0 ? undefined : round2(Number(ratio[1]) / denominator);
  }

  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

/** "onion, finely chopped" — everything after the comma is for the cook. */
function splitPreparationNote(text: string): { name: string; note: string } {
  const comma = text.indexOf(",");
  if (comma < 0) return { name: text, note: "" };
  return { name: text.slice(0, comma), note: text.slice(comma + 1).trim() };
}

function parseInstructions(value: unknown): readonly string[] {
  if (typeof value === "string") return splitProse(value);
  if (!Array.isArray(value)) return [];

  return value
    .map((step) => {
      if (typeof step === "string") return step;
      if (step !== null && typeof step === "object") {
        const node = step as JsonObject;
        // HowToSection nests its steps one level deeper.
        if (Array.isArray(node["itemListElement"])) {
          return parseInstructions(node["itemListElement"]).join("\n");
        }
        return firstString(node["text"]) ?? firstString(node["name"]) ?? "";
      }
      return "";
    })
    .flatMap((step) => step.split("\n"))
    .map((step) => stripBallast(step))
    .filter((step) => step.length > 0);
}

/**
 * Remove the padding recipe pages carry (FR-510).
 *
 * Kept conservative on purpose: an over-eager filter that eats a real cooking
 * step is far worse than one that leaves a line of marketing behind.
 */
export function stripBallast(text: string): string {
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/^(advertisement|anzeige|werbung|sponsored)\b[:.\s-]*/i, "")
    .trim();

  const isPromotional =
    /^(subscribe|follow us|pin this|jump to recipe|print recipe|zum rezept springen|rezept drucken)\b/i.test(
      cleaned,
    );

  return isPromotional ? "" : cleaned;
}

function splitProse(value: string): readonly string[] {
  return value
    .split(/\n+|(?<=\.)\s{2,}/)
    .map((step) => stripBallast(step))
    .filter((step) => step.length > 0);
}

function parseServings(value: unknown): number | undefined {
  const text = firstString(value);
  if (text === undefined) return undefined;
  const match = /(\d+)/.exec(text);
  return match === null ? undefined : Number(match[1]);
}

export function parseIsoDuration(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value.trim());
  if (match === null) return undefined;

  const minutes = Number(match[1] ?? 0) * 1440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return minutes > 0 ? minutes : undefined;
}

function parseImage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return parseImage(value[0]);
  if (value !== null && typeof value === "object") return firstString((value as JsonObject)["url"]);
  return undefined;
}

function parseAuthor(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return parseAuthor(value[0]);
  if (value !== null && typeof value === "object") return firstString((value as JsonObject)["name"]);
  return undefined;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (Array.isArray(value)) return firstString(value[0]);
  return undefined;
}

function toStringList(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Is this recipe already in the collection (FR-509)?
 *
 * Matched on title and ingredient set rather than URL, because the same recipe
 * arrives from a share sheet, a photo and a link, and only one of those carries
 * an address.
 */
export function isDuplicateOf(
  candidate: ImportedRecipe,
  existing: { readonly title: string; readonly ingredientNames: readonly string[] },
): boolean {
  if (canonicalItemKey(candidate.title) !== canonicalItemKey(existing.title)) return false;

  const candidateKeys = new Set(candidate.ingredients.map((i) => canonicalItemKey(i.name)));
  const existingKeys = existing.ingredientNames.map((name) => canonicalItemKey(name));
  if (candidateKeys.size === 0 || existingKeys.length === 0) return true;

  const shared = existingKeys.filter((key) => candidateKeys.has(key)).length;
  return shared / Math.max(candidateKeys.size, existingKeys.length) >= 0.6;
}
