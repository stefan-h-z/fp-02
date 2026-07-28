/**
 * Localization (SPEC §2.4).
 *
 * German and English ship together from the first release. Carrying both from
 * day one is deliberate: it is the only reliable way to keep hard-coded strings
 * out, and the German market is the primary one, so German is a maintained
 * translation rather than an afterthought.
 *
 * Source strings are English (the repository's working language); `de` is a
 * first-class catalog held to the same key set by a test.
 */
export type Locale = "en" | "de";

export const LOCALES: readonly Locale[] = ["en", "de"];
export const DEFAULT_LOCALE: Locale = "de";

export const en = {
  "app.name": "Family",

  "onboarding.who": "Who is in the family?",
  "onboarding.whatHurts": "Which part is wearing you down right now?",
  "onboarding.area.food": "Meals and shopping",
  "onboarding.area.calendar": "Appointments",
  "onboarding.area.tasks": "Who does what",
  "onboarding.area.health": "Health and medication",
  "onboarding.joinWithCode": "Join with a code",
  "onboarding.recoveryCode.title": "Write this code down",
  "onboarding.recoveryCode.body":
    "It is the only way back in if no other adult is around to approve a new device.",

  "list.title": "Shopping",
  "list.section.reported": "Reported empty",
  "list.section.probablyDue": "Probably due",
  "list.section.more": "Show more",
  "list.empty": "Nothing on the list",
  "list.groupBy.store": "By shop",
  "list.groupBy.productGroup": "By aisle",
  "list.everywhere": "Available everywhere",
  "list.atStore": "I am at {store}",
  "list.addItem": "Add something",
  "list.awaitingApproval": "Waiting for a parent",
  "list.question": "Question from the shop",
  "list.whyDue": "Why this?",
  "list.takeOver": "I will do this shop",
  "list.fromPlan": "From the plan: {recipes}",

  "plan.title": "This week",
  "plan.owner": "Planned by {person}",
  "plan.cook": "Cooked by {person}",
  "plan.whoEats": "Who is eating",
  "plan.suggest": "What shall we cook?",
  "plan.reroll": "Something else",
  "plan.emergency": "From the cupboard",
  "plan.leftovers": "Leftovers",

  "recipe.servings": "For {count} people",
  "recipe.cookMode": "Cook mode",
  "recipe.ingredients": "Ingredients",
  "recipe.steps": "Steps",
  "recipe.note": "Note for next time",

  "calendar.today": "Today",
  "calendar.week": "Week",
  "calendar.month": "Month",
  "calendar.brings": "Brings",
  "calendar.fetches": "Fetches",
  "calendar.fallback": "Fallback",
  "calendar.conflict": "{person} is expected in two places",
  "calendar.careGap": "Nobody is covering {child} on {date}",

  "task.owner": "Owner",
  "task.definitionOfDone": "Done means",
  "task.delegate": "Ask someone else",
  "task.delegationPending": "Waiting for {person} to accept",
  "task.approve": "Confirm it is done",
  "task.blocked": "Blocked: {reason}",

  "protocol.title": "Treatment",
  "protocol.acknowledge": "Given",
  "protocol.skip": "Skipped",
  "protocol.skipReason": "Why was it skipped?",
  "protocol.givenBy": "Given by {person} at {time}",
  "protocol.measure": "Record the reading",
  "protocol.export": "Export for the doctor",

  "sync.offline": "Offline — your changes are saved here",
  "sync.pending": "{count} changes not sent yet",
  "sync.upToDate": "Everything is synced",
  "conflict.title": "Two people changed this",
  "conflict.keepCurrent": "Keep {value}",
  "conflict.takeIncoming": "Use {value}",
  "conflict.explain": "{person} changed it to {value}",

  "inbox.title": "Inbox",
  "inbox.count": "{count} to sort",
  "inbox.empty": "Nothing waiting",

  "privacy.title": "Privacy",
  "privacy.export": "Download my data",
  "privacy.delete": "Delete my data",
  "privacy.deleteFamily": "Delete the family",
  "privacy.learning": "Let the app learn our rhythms",
  "privacy.learningExplained":
    "The app learns how often you buy things so it can remind you. Switch this off and it forgets what it learned.",
  "privacy.healthConsent": "Store health data",
  "privacy.healthConsentExplained":
    "Medication plans and readings are health data. They are only stored while this is switched on.",
  "privacy.aiNotice": "Voice and photo input is processed by an AI service in the EU.",

  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.undo": "Undo",
  "common.today": "today",
  "common.yesterday": "yesterday",
  "common.tomorrow": "tomorrow",
} as const;

export type MessageKey = keyof typeof en;

export const de: Readonly<Record<MessageKey, string>> = {
  "app.name": "Familie",

  "onboarding.who": "Wer gehört zur Familie?",
  "onboarding.whatHurts": "Was nervt gerade am meisten?",
  "onboarding.area.food": "Essen und Einkauf",
  "onboarding.area.calendar": "Termine",
  "onboarding.area.tasks": "Wer macht was",
  "onboarding.area.health": "Gesundheit und Medikamente",
  "onboarding.joinWithCode": "Mit Code beitreten",
  "onboarding.recoveryCode.title": "Diesen Code aufschreiben",
  "onboarding.recoveryCode.body":
    "Er ist der einzige Weg zurück, wenn kein anderer Erwachsener ein neues Gerät freischalten kann.",

  "list.title": "Einkauf",
  "list.section.reported": "Ist alle",
  "list.section.probablyDue": "Vermutlich fällig",
  "list.section.more": "Mehr anzeigen",
  "list.empty": "Nichts auf der Liste",
  "list.groupBy.store": "Nach Geschäft",
  "list.groupBy.productGroup": "Nach Warengruppe",
  "list.everywhere": "Überall erhältlich",
  "list.atStore": "Ich bin gerade bei {store}",
  "list.addItem": "Etwas hinzufügen",
  "list.awaitingApproval": "Wartet auf Freigabe",
  "list.question": "Rückfrage aus dem Laden",
  "list.whyDue": "Warum das?",
  "list.takeOver": "Ich kaufe ein",
  "list.fromPlan": "Aus dem Plan: {recipes}",

  "plan.title": "Diese Woche",
  "plan.owner": "Geplant von {person}",
  "plan.cook": "Kocht: {person}",
  "plan.whoEats": "Wer isst mit",
  "plan.suggest": "Was kochen wir?",
  "plan.reroll": "Etwas anderes",
  "plan.emergency": "Aus dem Vorrat",
  "plan.leftovers": "Reste",

  "recipe.servings": "Für {count} Personen",
  "recipe.cookMode": "Kochmodus",
  "recipe.ingredients": "Zutaten",
  "recipe.steps": "Schritte",
  "recipe.note": "Notiz fürs nächste Mal",

  "calendar.today": "Heute",
  "calendar.week": "Woche",
  "calendar.month": "Monat",
  "calendar.brings": "Bringt",
  "calendar.fetches": "Holt ab",
  "calendar.fallback": "Ersatz",
  "calendar.conflict": "{person} wird an zwei Orten gebraucht",
  "calendar.careGap": "Für {child} ist am {date} niemand da",

  "task.owner": "Zuständig",
  "task.definitionOfDone": "Erledigt heißt",
  "task.delegate": "Jemand anderen fragen",
  "task.delegationPending": "Wartet auf Zusage von {person}",
  "task.approve": "Erledigung bestätigen",
  "task.blocked": "Blockiert: {reason}",

  "protocol.title": "Behandlung",
  "protocol.acknowledge": "Gegeben",
  "protocol.skip": "Ausgelassen",
  "protocol.skipReason": "Warum ausgelassen?",
  "protocol.givenBy": "Gegeben von {person} um {time}",
  "protocol.measure": "Messwert eintragen",
  "protocol.export": "Für den Arzt exportieren",

  "sync.offline": "Offline — deine Änderungen sind hier gespeichert",
  "sync.pending": "{count} Änderungen noch nicht übertragen",
  "sync.upToDate": "Alles synchronisiert",
  "conflict.title": "Zwei Personen haben das geändert",
  "conflict.keepCurrent": "{value} behalten",
  "conflict.takeIncoming": "{value} übernehmen",
  "conflict.explain": "{person} hat es auf {value} geändert",

  "inbox.title": "Eingang",
  "inbox.count": "{count} zu sortieren",
  "inbox.empty": "Nichts offen",

  "privacy.title": "Datenschutz",
  "privacy.export": "Meine Daten herunterladen",
  "privacy.delete": "Meine Daten löschen",
  "privacy.deleteFamily": "Familie löschen",
  "privacy.learning": "Die App darf unsere Rhythmen lernen",
  "privacy.learningExplained":
    "Die App lernt, wie oft ihr etwas kauft, um euch rechtzeitig zu erinnern. Ausschalten löscht das Gelernte.",
  "privacy.healthConsent": "Gesundheitsdaten speichern",
  "privacy.healthConsentExplained":
    "Medikamentenpläne und Messwerte sind Gesundheitsdaten. Sie werden nur gespeichert, solange das eingeschaltet ist.",
  "privacy.aiNotice": "Sprache und Fotos werden von einem KI-Dienst in der EU verarbeitet.",

  "common.cancel": "Abbrechen",
  "common.save": "Speichern",
  "common.delete": "Löschen",
  "common.undo": "Rückgängig",
  "common.today": "heute",
  "common.yesterday": "gestern",
  "common.tomorrow": "morgen",
};

const CATALOGS: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { en, de };

export interface Translator {
  readonly locale: Locale;
  t(key: MessageKey, values?: Readonly<Record<string, string | number>>): string;
  formatDate(at: number, style?: "short" | "long" | "weekday"): string;
  formatTime(at: number): string;
  formatRelativeDay(at: number, now: number): string;
}

export function createTranslator(locale: Locale): Translator {
  const catalog = CATALOGS[locale];

  return {
    locale,
    t(key, values) {
      const template = catalog[key] ?? en[key];
      if (values === undefined) return template;
      // Interpolation is deliberately dumb: no expressions, no nesting, so a
      // translator can never accidentally introduce logic into a string.
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in values ? String(values[name]) : match,
      );
    },
    formatDate(at, style = "short") {
      const options: Intl.DateTimeFormatOptions =
        style === "long"
          ? { day: "numeric", month: "long", year: "numeric" }
          : style === "weekday"
            ? { weekday: "long", day: "numeric", month: "short" }
            : { day: "2-digit", month: "2-digit", year: "numeric" };
      return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(at);
    },
    formatTime(at) {
      return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(at);
    },
    formatRelativeDay(at, now) {
      const days = Math.round((startOfUtcDay(at) - startOfUtcDay(now)) / 86_400_000);
      if (days === 0) return this.t("common.today");
      if (days === -1) return this.t("common.yesterday");
      if (days === 1) return this.t("common.tomorrow");
      return this.formatDate(at, "weekday");
    },
  };
}

function startOfUtcDay(at: number): number {
  const date = new Date(at);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

/** Missing keys are a build-time question, not a runtime surprise. */
export function missingKeys(locale: Locale): readonly MessageKey[] {
  const catalog = CATALOGS[locale] as Record<string, string | undefined>;
  return (Object.keys(en) as MessageKey[]).filter((key) => catalog[key] === undefined);
}
