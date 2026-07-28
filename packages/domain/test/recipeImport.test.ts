import { describe, expect, it } from "vitest";
import {
  importRecipeFromHtml,
  importRecipeFromText,
  importRecipeFromJsonLd,
  isDuplicateOf,
  parseIngredientLine,
  parseIsoDuration,
  stripBallast,
} from "@fam/domain";

function page(jsonLd: unknown): string {
  return [
    "<html><head>",
    '<script type="application/ld+json">',
    JSON.stringify(jsonLd),
    "</script>",
    "</head><body>Lots of prose about the author's grandmother.</body></html>",
  ].join("\n");
}

const BOLOGNESE = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Bolognese",
  author: { "@type": "Person", name: "A Cook" },
  recipeYield: "4 servings",
  totalTime: "PT1H30M",
  image: ["https://example.test/bolognese.jpg"],
  recipeIngredient: ["2 onions", "500 g minced beef", "2 tbsp olive oil", "Salt"],
  recipeInstructions: [
    { "@type": "HowToStep", text: "Chop the onions." },
    { "@type": "HowToStep", text: "Brown the beef." },
  ],
};

describe("reading a recipe off a page (FR-501)", () => {
  it("extracts the recipe from embedded structured data", () => {
    const outcome = importRecipeFromHtml(page(BOLOGNESE), "https://example.test/bolognese");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.recipe.title).toBe("Bolognese");
    expect(outcome.recipe.servings).toBe(4);
    expect(outcome.recipe.totalMinutes).toBe(90);
    expect(outcome.recipe.sourceUrl).toBe("https://example.test/bolognese");
    expect(outcome.recipe.author).toBe("A Cook");
  });

  it("finds a recipe nested in a @graph, where most sites put it", () => {
    const outcome = importRecipeFromHtml(
      page({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, BOLOGNESE] }),
    );

    expect(outcome.ok).toBe(true);
  });

  it("accepts a type array, which several sites emit", () => {
    const outcome = importRecipeFromJsonLd({ ...BOLOGNESE, "@type": ["Recipe", "NewsArticle"] });

    expect(outcome.ok).toBe(true);
  });

  it("says it could not read a page rather than inventing a recipe", () => {
    const outcome = importRecipeFromHtml("<html><body>A blog post</body></html>");

    expect(outcome).toEqual({ ok: false, reason: "no-structured-data" });
  });

  it("says so when the structured data is not a recipe", () => {
    const outcome = importRecipeFromHtml(page({ "@type": "NewsArticle", name: "Something else" }));

    expect(outcome).toEqual({ ok: false, reason: "not-a-recipe" });
  });

  it("skips a malformed block instead of failing the whole import", () => {
    const html = [
      '<script type="application/ld+json">{ not json </script>',
      '<script type="application/ld+json">',
      JSON.stringify(BOLOGNESE),
      "</script>",
    ].join("\n");

    expect(importRecipeFromHtml(html).ok).toBe(true);
  });

  it("flattens the nested steps of a sectioned recipe", () => {
    const outcome = importRecipeFromJsonLd({
      ...BOLOGNESE,
      recipeInstructions: [
        { "@type": "HowToSection", itemListElement: [{ "@type": "HowToStep", text: "Chop." }] },
        { "@type": "HowToStep", text: "Cook." },
      ],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.recipe.steps).toEqual(["Chop.", "Cook."]);
  });
});

describe("ingredient parsing (FR-508)", () => {
  it("separates amount, unit and ingredient", () => {
    expect(parseIngredientLine("500 g minced beef")).toMatchObject({
      amount: 500,
      unit: "g",
      name: "minced beef",
    });
  });

  it("reads the German kitchen shorthand", () => {
    expect(parseIngredientLine("2 EL Olivenöl")).toMatchObject({ amount: 2, unit: "tbsp", name: "Olivenöl" });
  });

  it("treats a bare count as pieces, so it can be added up", () => {
    expect(parseIngredientLine("2 onions")).toMatchObject({ amount: 2, unit: "piece", name: "onions" });
  });

  it("keeps an ingredient with no amount rather than dropping it", () => {
    expect(parseIngredientLine("Salt")).toMatchObject({ amount: undefined, name: "Salt" });
  });

  it("reads fractions, both written and typographic", () => {
    expect(parseIngredientLine("1/2 onion").amount).toBe(0.5);
    expect(parseIngredientLine("½ onion").amount).toBe(0.5);
  });

  it("reads a decimal comma, as German recipes write it", () => {
    expect(parseIngredientLine("0,5 l Milch")).toMatchObject({ amount: 0.5, unit: "l", name: "Milch" });
  });

  it("takes the lower bound of a range, because buying too little is recoverable", () => {
    expect(parseIngredientLine("200-250 g Mehl").amount).toBe(200);
  });

  it("moves the preparation note out of the name", () => {
    expect(parseIngredientLine("2 onions, finely chopped")).toMatchObject({
      name: "onions",
      note: "finely chopped",
    });
  });

  it("treats a parenthesised aside as a note", () => {
    const parsed = parseIngredientLine("200 g flour (type 405)");

    expect(parsed.name).toBe("flour");
    expect(parsed.note).toContain("type 405");
  });

  it("keeps the original line, so the cook can always see what was written", () => {
    expect(parseIngredientLine("  2   tbsp   olive oil ").raw).toBe("2 tbsp olive oil");
  });
});

describe("removing the padding (FR-510)", () => {
  it("strips an advertisement marker", () => {
    expect(stripBallast("Anzeige: Chop the onions.")).toBe("Chop the onions.");
  });

  it("drops a call to action entirely", () => {
    expect(stripBallast("Jump to recipe")).toBe("");
  });

  it("leaves a genuine cooking step alone", () => {
    expect(stripBallast("Brown the beef for 5 minutes.")).toBe("Brown the beef for 5 minutes.");
  });
});

describe("durations", () => {
  it("reads the ISO form recipe sites use", () => {
    expect(parseIsoDuration("PT1H30M")).toBe(90);
    expect(parseIsoDuration("PT20M")).toBe(20);
  });

  it("returns nothing for an unreadable duration", () => {
    expect(parseIsoDuration("soon")).toBeUndefined();
    expect(parseIsoDuration(undefined)).toBeUndefined();
  });
});

describe("duplicate detection (FR-509)", () => {
  const recipe = (() => {
    const outcome = importRecipeFromJsonLd(BOLOGNESE);
    if (!outcome.ok) throw new Error("fixture failed to parse");
    return outcome.recipe;
  })();

  it("recognises the same recipe arriving a second time", () => {
    expect(
      isDuplicateOf(recipe, {
        title: "bolognese",
        ingredientNames: ["onions", "minced beef", "olive oil", "salt"],
      }),
    ).toBe(true);
  });

  it("does not confuse two recipes that merely share a name", () => {
    expect(isDuplicateOf(recipe, { title: "Bolognese", ingredientNames: ["tofu", "soy sauce", "rice"] })).toBe(
      false,
    );
  });

  it("does not confuse two different recipes", () => {
    expect(isDuplicateOf(recipe, { title: "Lasagne", ingredientNames: ["onions", "minced beef"] })).toBe(false);
  });
});

/**
 * The path somebody takes when the recipe came from a grandmother, a message,
 * or their own memory (FR-505). There is no markup to lean on — only the shape
 * people already write recipes in.
 */
describe("importing a recipe from plain text (FR-505)", () => {
  it("reads the German shape, with headings", () => {
    const result = importRecipeFromText(
      [
        "Omas Kartoffelsuppe",
        "Für 4 Personen",
        "Zutaten",
        "500 g Kartoffeln",
        "2 Karotten",
        "1 EL Butter",
        "Zubereitung",
        "Kartoffeln schälen und würfeln.",
        "Alles 20 Minuten köcheln lassen.",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.recipe.title).toBe("Omas Kartoffelsuppe");
    expect(result.recipe.servings).toBe(4);
    expect(result.recipe.ingredients.map((i) => i.name)).toEqual([
      "Kartoffeln",
      "Karotten",
      "Butter",
    ]);
    expect(result.recipe.ingredients[0]?.amount).toBe(500);
    expect(result.recipe.steps).toHaveLength(2);
  });

  /**
   * The case that actually matters: somebody typing from memory writes no
   * headings at all. Ingredients are short lines starting with a quantity; a
   * step is a sentence.
   */
  it("infers the split from line shape when there are no headings", () => {
    const result = importRecipeFromText(
      [
        "Pancakes",
        "200 g flour",
        "2 eggs",
        "300 ml milk",
        "Whisk everything together and let it rest for ten minutes.",
        "Fry in a hot pan until golden.",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.recipe.ingredients.map((i) => i.name)).toEqual(["flour", "eggs", "milk"]);
    expect(result.recipe.steps).toHaveLength(2);
    expect(result.recipe.steps[0]).toMatch(/^Whisk/);
  });

  it("strips bullets and step numbering", () => {
    const result = importRecipeFromText(
      ["Salad", "- 2 tomatoes", "• 1 cucumber", "Method", "1. Chop everything.", "2) Toss."].join("\n"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.recipe.ingredients.map((i) => i.name)).toEqual(["tomatoes", "cucumber"]);
    expect(result.recipe.steps).toEqual(["Chop everything.", "Toss."]);
  });

  /** Empty input is the one thing it cannot make a recipe out of. */
  it("refuses only when there is nothing at all", () => {
    expect(importRecipeFromText("   \n  \n ").ok).toBe(false);
  });

  it("keeps the source when there is one", () => {
    const result = importRecipeFromText("Toast\n2 slices bread", "https://example.test/toast");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.sourceUrl).toBe("https://example.test/toast");
  });
});
