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
    "It is the only way back in if no other adult is around to approve a new device. Write it on paper now — the app cannot show it to you a second time.",
  "onboarding.recoveryCode.pending": "The code is issued the moment the family is created on the server.",
  "onboarding.recoveryCode.confirm": "I have written it down",
  "onboarding.whoHint": "Names are enough. Everything else can wait.",
  "onboarding.personName": "First name",
  "onboarding.addPerson": "Add",
  "onboarding.role.adult": "Adult",
  "onboarding.role.teen": "Teen",
  "onboarding.role.child": "Child",
  "onboarding.continue": "Continue",
  "onboarding.startHere": "Start here",

  "join.haveLink": "I have an invitation",
  "join.createFamily": "Start a new family",
  "join.lostDevice": "New or lost device",
  "join.codePlaceholder": "Paste the code from the link",
  "join.invitedAs": "{name} — joining {family}",
  "join.joinNow": "Join",
  "join.familyName": "Family name",
  "join.familyId": "Family id",
  "join.recoveryCode": "Recovery code",
  "join.recoverHint":
    "Normally another adult approves your new device. Use the recovery code only if nobody can.",
  "join.failed": "That did not work. Check the code and your connection.",

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

  "cook.step": "Step {current} of {total}",
  "cook.next": "Next",
  "cook.previous": "Back",
  "cook.startTimer": "Timer {minutes} min",
  "cook.timerLeft": "{label}: {remaining} left",
  "cook.timerDone": "{label} — time is up",
  "cook.stopTimer": "Stop",
  "cook.finish": "Finished cooking",
  "cook.notePlaceholder": "Ten minutes shorter next time",
  "cook.noSteps": "This recipe has no steps yet",

  "routine.title": "Your routine",
  "routine.progress": "{done} of {total} done",
  "routine.allDone": "All done",
  "routine.startTimer": "Start the timer",
  "routine.timeLeft": "{remaining} left",
  "routine.empty": "Nothing to tick off",

  "myday.title": "What concerns me today",
  "myday.nextThree": "The next three things",

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
  "privacy.exportExplained":
    "Everything the app holds about you, in a format another program can read.",
  "privacy.exportCount": "{count} entries",
  "privacy.deleteExplained": "See what will happen first — deleting cannot be undone.",
  "privacy.erasure.title": "What deleting does",
  "privacy.erasure.deletes": "{count} entries that are only about you are deleted.",
  "privacy.erasure.clears": "Your name is removed in {count} places.",
  "privacy.erasure.shared":
    "Shared entries — appointments, lists, recipes — stay with the family. Only the mark saying you wrote them is removed.",
  "privacy.erasure.lastAdult": "You are the last adult, so the whole family is deleted with you.",
  "privacy.erasure.confirm": "Delete for good",
  "privacy.deleteFamilyExplained":
    "This deletes everything for everyone, on every device. It cannot be undone.",

  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.undo": "Undo",
  "common.today": "today",
  "common.yesterday": "yesterday",
  "common.tomorrow": "tomorrow",

  "legal.title": "Legal",
  "legal.privacy": "Privacy",
  "legal.provider": "Provider",
  "legal.flows": "Where data goes",
  "legal.version": "Version {version}, effective {date}",
  "legal.incomplete": "This document is not finished yet",
  "legal.open": "Privacy, provider and data flows",
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
    "Er ist der einzige Weg zurück, wenn kein anderer Erwachsener ein neues Gerät freischalten kann. Schreib ihn jetzt auf Papier — die App zeigt ihn kein zweites Mal.",
  "onboarding.recoveryCode.pending": "Der Code entsteht, sobald die Familie auf dem Server angelegt ist.",
  "onboarding.recoveryCode.confirm": "Ich habe ihn aufgeschrieben",
  "onboarding.whoHint": "Namen reichen. Alles andere kann warten.",
  "onboarding.personName": "Vorname",
  "onboarding.addPerson": "Hinzufügen",
  "onboarding.role.adult": "Erwachsen",
  "onboarding.role.teen": "Jugendlich",
  "onboarding.role.child": "Kind",
  "onboarding.continue": "Weiter",
  "onboarding.startHere": "Hier starten",

  "join.haveLink": "Ich habe eine Einladung",
  "join.createFamily": "Neue Familie anlegen",
  "join.lostDevice": "Neues oder verlorenes Gerät",
  "join.codePlaceholder": "Code aus dem Link einfügen",
  "join.invitedAs": "{name} — tritt {family} bei",
  "join.joinNow": "Beitreten",
  "join.familyName": "Familienname",
  "join.familyId": "Familien-ID",
  "join.recoveryCode": "Wiederherstellungscode",
  "join.recoverHint":
    "Normalerweise schaltet ein anderer Erwachsener dein neues Gerät frei. Den Code brauchst du nur, wenn das niemand kann.",
  "join.failed": "Das hat nicht funktioniert. Prüfe den Code und die Verbindung.",

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

  "cook.step": "Schritt {current} von {total}",
  "cook.next": "Weiter",
  "cook.previous": "Zurück",
  "cook.startTimer": "Timer {minutes} Min.",
  "cook.timerLeft": "{label}: noch {remaining}",
  "cook.timerDone": "{label} — die Zeit ist um",
  "cook.stopTimer": "Stopp",
  "cook.finish": "Fertig gekocht",
  "cook.notePlaceholder": "Nächstes Mal zehn Minuten kürzer",
  "cook.noSteps": "Dieses Rezept hat noch keine Schritte",

  "routine.title": "Dein Ablauf",
  "routine.progress": "{done} von {total} geschafft",
  "routine.allDone": "Alles geschafft",
  "routine.startTimer": "Timer starten",
  "routine.timeLeft": "noch {remaining}",
  "routine.empty": "Gerade nichts abzuhaken",

  "myday.title": "Was mich heute betrifft",
  "myday.nextThree": "Die nächsten drei Dinge",

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
  "privacy.exportExplained":
    "Alles, was die App über dich gespeichert hat, in einem Format, das andere Programme lesen können.",
  "privacy.exportCount": "{count} Einträge",
  "privacy.deleteExplained": "Sieh dir zuerst an, was passiert — Löschen lässt sich nicht rückgängig machen.",
  "privacy.erasure.title": "Was das Löschen bewirkt",
  "privacy.erasure.deletes": "{count} Einträge, die nur dich betreffen, werden gelöscht.",
  "privacy.erasure.clears": "An {count} Stellen wird dein Name entfernt.",
  "privacy.erasure.shared":
    "Gemeinsame Einträge — Termine, Listen, Rezepte — bleiben bei der Familie. Nur der Vermerk, dass du sie geschrieben hast, verschwindet.",
  "privacy.erasure.lastAdult": "Du bist der letzte Erwachsene, deshalb wird die ganze Familie mit gelöscht.",
  "privacy.erasure.confirm": "Endgültig löschen",
  "privacy.deleteFamilyExplained":
    "Das löscht alles für alle, auf jedem Gerät. Es lässt sich nicht rückgängig machen.",

  "common.cancel": "Abbrechen",
  "common.save": "Speichern",
  "common.delete": "Löschen",
  "common.undo": "Rückgängig",
  "common.today": "heute",
  "common.yesterday": "gestern",
  "common.tomorrow": "morgen",

  "legal.title": "Rechtliches",
  "legal.privacy": "Datenschutz",
  "legal.provider": "Anbieter",
  "legal.flows": "Wohin Daten fließen",
  "legal.version": "Fassung {version}, gültig ab {date}",
  "legal.incomplete": "Dieses Dokument ist noch nicht vollständig",
  "legal.open": "Datenschutz, Anbieter und Datenflüsse",
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
