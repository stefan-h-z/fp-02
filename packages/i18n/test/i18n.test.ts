import { describe, expect, it } from "vitest";
import { LOCALES, createTranslator, de, en, missingKeys, type MessageKey } from "@fam/i18n";

describe("catalogs", () => {
  it("ships German and English with the same keys (SPEC §2.4)", () => {
    for (const locale of LOCALES) {
      expect(missingKeys(locale)).toEqual([]);
    }
  });

  it("has no key left untranslated by copying the English string", () => {
    const identical = (Object.keys(en) as MessageKey[]).filter(
      (key) => de[key] === en[key] && !isProperNoun(key),
    );

    expect(identical).toEqual([]);
  });

  it("keeps every placeholder the English string uses", () => {
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(placeholders(de[key])).toEqual(placeholders(en[key]));
    }
  });
});

/** Keys whose German and English forms are legitimately identical. */
function isProperNoun(key: MessageKey): boolean {
  return key === "calendar.month";
}

function placeholders(template: string): readonly string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

describe("translation", () => {
  it("fills placeholders", () => {
    const t = createTranslator("de");

    expect(t.t("list.atStore", { store: "Aldi" })).toBe("Ich bin gerade bei Aldi");
  });

  it("leaves an unknown placeholder visible rather than printing 'undefined'", () => {
    const t = createTranslator("en");

    expect(t.t("list.atStore", {})).toBe("I am at {store}");
  });

  it("does not let a translation smuggle in logic", () => {
    const t = createTranslator("de");

    expect(t.t("sync.pending", { count: 3 })).toBe("3 Änderungen noch nicht übertragen");
  });
});

describe("formatting", () => {
  const at = Date.parse("2026-08-03T14:05:00Z");

  it("writes dates the way each locale expects", () => {
    expect(createTranslator("de").formatDate(at)).toBe("03.08.2026");
    expect(createTranslator("en").formatDate(at)).toBe("08/03/2026");
  });

  it("uses the locale's clock convention", () => {
    expect(createTranslator("de").formatTime(at)).toBe("14:05");
    expect(createTranslator("en").formatTime(at)).toMatch(/02:05\s?PM/);
  });

  it("says today, yesterday and tomorrow before falling back to a date", () => {
    const t = createTranslator("de");
    const now = Date.parse("2026-08-03T09:00:00Z");

    expect(t.formatRelativeDay(at, now)).toBe("heute");
    expect(t.formatRelativeDay(at - 86_400_000, now)).toBe("gestern");
    expect(t.formatRelativeDay(at + 86_400_000, now)).toBe("morgen");
    expect(t.formatRelativeDay(at + 5 * 86_400_000, now)).toContain("Sa");
  });
});
