/**
 * The texts the law requires to be reachable from inside the app.
 *
 * Three obligations, and none of them is satisfied by a document in a
 * repository: the privacy policy (FR-1401), the provider identification
 * (FR-1402) and the disclosure of where data actually flows (FR-1404) all have
 * to be readable by the person using the app, without an account and without a
 * network connection.
 *
 * They live here rather than in the i18n catalog because they are documents,
 * not labels — versioned, dated, and structured into sections a screen can lay
 * out. `PRIVACY_POLICY_VERSION` is what a consent record points at, so a
 * material change to the text is a change a family can be asked about again
 * (FR-1406).
 *
 * **What is deliberately not filled in.** Everything identifying the operator —
 * the legal name, the address, the contact, the responsible person — is a
 * `PLACEHOLDER`. Those are facts about a company that does not exist yet, and
 * inventing them would produce a document that looks compliant and is not.
 * `pendingPlaceholders()` lists what is still open, and a test asserts the app
 * refuses to present the policy as final while any remain.
 */

export const PRIVACY_POLICY_VERSION = "2026-07-28.1";

/** Marks a fact only the operator can supply. Rendered visibly, never silently. */
export const PLACEHOLDER = "«to be completed by the operator»";

export interface LegalSection {
  readonly heading: string;
  readonly body: readonly string[];
}

export interface LegalDocument {
  readonly title: string;
  readonly version: string;
  /** ISO date. Shown, because a policy without a date cannot be reasoned about. */
  readonly effectiveDate: string;
  readonly sections: readonly LegalSection[];
}

/** One row of the FR-1404 disclosure: who receives what, and on what basis. */
export interface DataFlow {
  readonly recipient: string;
  readonly purpose: string;
  readonly data: string;
  /** Where the processing happens. EU hosting is a binding constraint (ARC-03). */
  readonly location: string;
  readonly optional: boolean;
}

/**
 * Every place family data leaves the device, in the order a person would ask
 * about them. Derived from what the system actually does — the sync backend,
 * the AI gateway, the calendar connectors, inbound mail and push — so it stays
 * answerable against `docs/legal/records-of-processing.md`.
 */
export const DATA_FLOWS: readonly DataFlow[] = [
  {
    recipient: "The family's own backend",
    purpose: "Synchronising the family's data between their devices",
    data: "Everything the family enters",
    location: "European Union",
    optional: false,
  },
  {
    recipient: "Push notification service (Apple, Google)",
    purpose: "Waking a device so a reminder arrives",
    data: "A device token and the notification text",
    location: "United States",
    optional: true,
  },
  {
    recipient: "AI provider",
    purpose: "Turning a spoken note or a photographed letter into an entry",
    data: "Only the capture being processed, never the family's stored data",
    location: "European Union",
    optional: true,
  },
  {
    recipient: "Calendar providers (Google, Microsoft, CalDAV)",
    purpose: "Two-way appointment synchronisation, if connected",
    data: "The appointments in the connected calendar",
    location: "Depends on the provider the family chooses",
    optional: true,
  },
  {
    recipient: "Inbound mail provider",
    purpose: "Receiving mail sent to the family's own address",
    data: "The messages sent there",
    location: "European Union",
    optional: true,
  },
];

const PRIVACY_EN: LegalDocument = {
  title: "Privacy",
  version: PRIVACY_POLICY_VERSION,
  effectiveDate: "2026-07-28",
  sections: [
    {
      heading: "Who is responsible",
      body: [
        `The controller for this app is ${PLACEHOLDER}.`,
        `You can reach us at ${PLACEHOLDER}.`,
      ],
    },
    {
      heading: "What we store, and why",
      body: [
        "Everything you enter: appointments, tasks, shopping lists, recipes, meal plans, documents you upload, and the people in your family.",
        "We store it to provide the app. That is the contract between us, and it is the legal basis for it (Art. 6(1)(b) GDPR).",
        "Your data lives on your devices and on our servers in the European Union. It is not sold, and it is not used to advertise to you — there is no advertising in this app.",
      ],
    },
    {
      heading: "Health data is different",
      body: [
        "Medication schedules, allergies and anything else in the health area are special-category data (Art. 9 GDPR). We store them only if you switch that area on and give explicit consent, and you can withdraw it at any time.",
        "Withdrawing it stops any further processing. What was already stored is deleted with it.",
      ],
    },
    {
      heading: "Children",
      body: [
        "Children in a family have no account and no login. What is stored about them is entered by an adult in the family, who decides what is stored.",
        "A child's own view shows only what that child needs to do.",
      ],
    },
    {
      heading: "What the app learns",
      body: [
        "The app notices patterns — that milk tends to run out every five days, that a certain task always falls to the same person — so it can anticipate instead of asking.",
        "This is optional. Turning it off in the settings stops the app deriving anything new and removes what it derived.",
      ],
    },
    {
      heading: "How long we keep it",
      body: [
        "For as long as your family uses the app. Delete something and it is gone; delete the family and everything goes with it.",
        "The history of who changed what is kept for five years, because that is what makes a shared record trustworthy. It is deleted with the family.",
      ],
    },
    {
      heading: "Your rights",
      body: [
        "You can ask for a copy of everything we hold about you, correct anything that is wrong, delete it, restrict what we do with it, take it elsewhere in a machine-readable form, and object to processing we base on a legitimate interest.",
        "All of it is in the app itself, under Privacy. Nothing needs an email to us first.",
        `You can also complain to a supervisory authority. The one responsible for us is ${PLACEHOLDER}.`,
      ],
    },
    {
      heading: "If something goes wrong",
      body: [
        "If data is exposed in a way that puts you at risk, we will tell you, and we will tell the supervisory authority within 72 hours of noticing.",
      ],
    },
  ],
};

const PRIVACY_DE: LegalDocument = {
  title: "Datenschutz",
  version: PRIVACY_POLICY_VERSION,
  effectiveDate: "2026-07-28",
  sections: [
    {
      heading: "Wer verantwortlich ist",
      body: [
        `Verantwortlich für diese App ist ${PLACEHOLDER}.`,
        `Sie erreichen uns unter ${PLACEHOLDER}.`,
      ],
    },
    {
      heading: "Was wir speichern, und warum",
      body: [
        "Alles, was Sie eingeben: Termine, Aufgaben, Einkaufslisten, Rezepte, Essenspläne, hochgeladene Dokumente und die Personen Ihrer Familie.",
        "Wir speichern das, um die App bereitzustellen. Das ist der Vertrag zwischen uns und zugleich die Rechtsgrundlage dafür (Art. 6 Abs. 1 lit. b DSGVO).",
        "Ihre Daten liegen auf Ihren Geräten und auf unseren Servern in der Europäischen Union. Sie werden nicht verkauft und nicht für Werbung genutzt — in dieser App gibt es keine Werbung.",
      ],
    },
    {
      heading: "Gesundheitsdaten sind etwas anderes",
      body: [
        "Medikamentenpläne, Allergien und alles Weitere im Gesundheitsbereich sind besondere Kategorien personenbezogener Daten (Art. 9 DSGVO). Wir speichern sie nur, wenn Sie diesen Bereich einschalten und ausdrücklich einwilligen — und Sie können das jederzeit widerrufen.",
        "Ein Widerruf beendet jede weitere Verarbeitung. Was bereits gespeichert war, wird mit gelöscht.",
      ],
    },
    {
      heading: "Kinder",
      body: [
        "Kinder in einer Familie haben kein Konto und keinen Login. Was über sie gespeichert wird, gibt ein Erwachsener der Familie ein, und dieser entscheidet darüber.",
        "Die eigene Ansicht eines Kindes zeigt nur, was dieses Kind zu tun hat.",
      ],
    },
    {
      heading: "Was die App lernt",
      body: [
        "Die App erkennt Muster — dass Milch etwa alle fünf Tage ausgeht, dass eine bestimmte Aufgabe immer bei derselben Person landet —, um vorauszudenken statt zu fragen.",
        "Das ist freiwillig. Wer es in den Einstellungen abschaltet, verhindert jede weitere Ableitung, und das bereits Abgeleitete wird entfernt.",
      ],
    },
    {
      heading: "Wie lange wir speichern",
      body: [
        "So lange Ihre Familie die App nutzt. Was Sie löschen, ist weg; löschen Sie die Familie, geht alles mit.",
        "Die Historie, wer wann was geändert hat, bewahren wir fünf Jahre auf — das ist es, was eine gemeinsame Aufzeichnung verlässlich macht. Sie wird mit der Familie gelöscht.",
      ],
    },
    {
      heading: "Ihre Rechte",
      body: [
        "Sie können eine Kopie von allem verlangen, was wir über Sie gespeichert haben, Falsches berichtigen, löschen lassen, die Verarbeitung einschränken, Ihre Daten maschinenlesbar mitnehmen und einer Verarbeitung widersprechen, die wir auf ein berechtigtes Interesse stützen.",
        "All das finden Sie in der App selbst unter Datenschutz. Nichts davon setzt eine E-Mail an uns voraus.",
        `Sie können sich außerdem bei einer Aufsichtsbehörde beschweren. Für uns zuständig ist ${PLACEHOLDER}.`,
      ],
    },
    {
      heading: "Wenn etwas schiefgeht",
      body: [
        "Werden Daten so offengelegt, dass für Sie ein Risiko entsteht, sagen wir Ihnen Bescheid — und der Aufsichtsbehörde innerhalb von 72 Stunden, nachdem wir es bemerkt haben.",
      ],
    },
  ],
};

const IMPRINT_EN: LegalDocument = {
  title: "Provider",
  version: PRIVACY_POLICY_VERSION,
  effectiveDate: "2026-07-28",
  sections: [
    {
      heading: "Provider",
      body: [
        `${PLACEHOLDER}`,
        `Address: ${PLACEHOLDER}`,
        `Represented by: ${PLACEHOLDER}`,
      ],
    },
    {
      heading: "Contact",
      body: [`Email: ${PLACEHOLDER}`, `Support: ${PLACEHOLDER}`],
    },
    {
      heading: "Register and tax",
      body: [
        `Commercial register: ${PLACEHOLDER}`,
        `VAT identification number: ${PLACEHOLDER}`,
      ],
    },
  ],
};

const IMPRINT_DE: LegalDocument = {
  title: "Anbieter",
  version: PRIVACY_POLICY_VERSION,
  effectiveDate: "2026-07-28",
  sections: [
    {
      heading: "Anbieter",
      body: [
        `${PLACEHOLDER}`,
        `Anschrift: ${PLACEHOLDER}`,
        `Vertreten durch: ${PLACEHOLDER}`,
      ],
    },
    {
      heading: "Kontakt",
      body: [`E-Mail: ${PLACEHOLDER}`, `Support: ${PLACEHOLDER}`],
    },
    {
      heading: "Register und Steuern",
      body: [
        `Handelsregister: ${PLACEHOLDER}`,
        `Umsatzsteuer-Identifikationsnummer: ${PLACEHOLDER}`,
      ],
    },
  ],
};

export type LegalLocale = "en" | "de";

export function privacyPolicy(locale: LegalLocale): LegalDocument {
  return locale === "de" ? PRIVACY_DE : PRIVACY_EN;
}

export function imprint(locale: LegalLocale): LegalDocument {
  return locale === "de" ? IMPRINT_DE : IMPRINT_EN;
}

/**
 * Which sections still contain a placeholder.
 *
 * The app shows this rather than hiding it: a policy that names no controller
 * is not a policy, and the person reading it should be able to see that as
 * plainly as the operator who has to fix it.
 */
export function pendingPlaceholders(document: LegalDocument): readonly string[] {
  return document.sections
    .filter((section) => section.body.some((line) => line.includes(PLACEHOLDER)))
    .map((section) => section.heading);
}

/** True only when nothing is left for the operator to supply. */
export function isPublishable(document: LegalDocument): boolean {
  return pendingPlaceholders(document).length === 0;
}
