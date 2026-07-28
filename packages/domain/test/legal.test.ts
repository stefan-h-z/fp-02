/**
 * The three texts that have to be inside the app before it can ship.
 *
 * These are not tested for prose. They are tested for the properties the law
 * attaches to them: that they exist in both languages, that they carry a
 * version and a date, that they say where data goes, and — the one that
 * matters most here — that the app can tell the difference between a finished
 * policy and one still waiting on the operator.
 */
import { describe, expect, it } from "vitest";
import {
  DATA_FLOWS,
  PLACEHOLDER,
  PRIVACY_POLICY_VERSION,
  imprint,
  isPublishable,
  pendingPlaceholders,
  privacyPolicy,
  type LegalLocale,
} from "../src/index.js";

const LOCALES: readonly LegalLocale[] = ["en", "de"];

describe("privacy policy (FR-1401)", () => {
  it.each(LOCALES)("exists in %s, versioned and dated", (locale) => {
    const doc = privacyPolicy(locale);

    expect(doc.version).toBe(PRIVACY_POLICY_VERSION);
    expect(doc.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(doc.sections.length).toBeGreaterThanOrEqual(6);
    for (const section of doc.sections) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.body.length).toBeGreaterThan(0);
    }
  });

  /**
   * The two disclosures with their own legal basis: health data is Art. 9, and
   * children are the reason the DPIA exists. A policy that omits either would
   * pass every other check here.
   */
  it.each(LOCALES)("covers health data and children in %s", (locale) => {
    const headings = privacyPolicy(locale).sections.map((s) => s.heading.toLowerCase());

    expect(headings.some((h) => /health|gesundheit/.test(h))).toBe(true);
    expect(headings.some((h) => /child|kinder/.test(h))).toBe(true);
  });

  it.each(LOCALES)("names every right the app implements, in %s", (locale) => {
    const text = privacyPolicy(locale)
      .sections.flatMap((s) => s.body)
      .join(" ")
      .toLowerCase();

    for (const right of locale === "de"
      ? ["kopie", "berichtigen", "löschen", "einschränken", "mitnehmen", "widersprechen"]
      : ["copy", "correct", "delete", "restrict", "take it elsewhere", "object"]) {
      expect(text).toContain(right);
    }
  });
});

describe("provider identification (FR-1402)", () => {
  it.each(LOCALES)("exists in %s", (locale) => {
    expect(imprint(locale).sections.length).toBeGreaterThan(0);
  });
});

describe("where the data goes (FR-1404)", () => {
  it("names every recipient outside the device", () => {
    expect(DATA_FLOWS.length).toBeGreaterThanOrEqual(5);
    for (const flow of DATA_FLOWS) {
      expect(flow.recipient.length).toBeGreaterThan(0);
      expect(flow.purpose.length).toBeGreaterThan(0);
      expect(flow.location.length).toBeGreaterThan(0);
    }
  });

  /**
   * The sync backend is the one flow a family cannot decline — it is the app.
   * Everything else has to be optional, or the consent it asks for is not free.
   */
  it("marks everything except the family's own backend as optional", () => {
    const mandatory = DATA_FLOWS.filter((flow) => !flow.optional);

    expect(mandatory).toHaveLength(1);
    expect(mandatory[0]?.recipient).toMatch(/backend/i);
  });

  /** AI processing at an EU provider is binding, not a preference (AI-02, ARC-03). */
  it("keeps AI processing in the EU", () => {
    const ai = DATA_FLOWS.find((flow) => /ai/i.test(flow.recipient));

    expect(ai?.location).toBe("European Union");
  });
});

describe("what the operator still owes", () => {
  it("reports the sections a placeholder is still sitting in", () => {
    const pending = pendingPlaceholders(privacyPolicy("en"));

    expect(pending).toContain("Who is responsible");
    expect(pending).toContain("Your rights");
  });

  /**
   * The app must never present these as final while the controller is unnamed.
   * When the operator fills the placeholders in, this test starts asserting the
   * opposite — which is the point: it is the switch, not a formality.
   */
  it("refuses to call an unfinished policy publishable", () => {
    expect(isPublishable(privacyPolicy("en"))).toBe(false);
    expect(isPublishable(privacyPolicy("de"))).toBe(false);
    expect(isPublishable(imprint("en"))).toBe(false);
  });

  it("treats a completed document as publishable", () => {
    const filled = {
      title: "Provider",
      version: PRIVACY_POLICY_VERSION,
      effectiveDate: "2026-07-28",
      sections: [{ heading: "Provider", body: ["A real company, a real address"] }],
    };

    expect(pendingPlaceholders(filled)).toEqual([]);
    expect(isPublishable(filled)).toBe(true);
    expect(PLACEHOLDER.length).toBeGreaterThan(0);
  });
});
