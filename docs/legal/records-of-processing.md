# Record of processing activities (Art. 30 GDPR)

**Status:** draft, derived from the implemented system · **not legal advice**
**Must be reviewed by a data protection lawyer before publication** — the app
processes health data and children's data, which is the strictest tier there is.

The small-organization exemption in Art. 30(5) does **not** apply here, because
processing includes special categories under Art. 9 (SPEC §17.1).

## Controller

| | |
|---|---|
| Controller | The natural person who publishes the app (SPEC §17.1) — personally, not a company |
| Contact | The support address published on the store listing (SPEC FR-1403) |
| Data protection officer | Assessed as not required at this scale; the assessment itself must be documented (OBL-08) |

## 1. Running a family's shared organization

| | |
|---|---|
| **Purpose** | Providing the app: shared lists, meal plans, calendar, tasks, documents |
| **Legal basis** | Art. 6(1)(b) — performance of the contract with the user |
| **Categories of data subjects** | Adults, teenagers and children in a family; guests holding a scoped link |
| **Categories of data** | Names, roles, colors/avatars; appointments and who is responsible for them; tasks and their owners; shopping items; recipes and per-person ratings; meal plans; documents and contacts; free-text notes and comments |
| **Recipients** | Hosting provider (EU); push services (Apple, Google) for notification delivery only |
| **Third-country transfers** | Push notification delivery technically routes through Apple and Google (OBL-04) |
| **Retention** | Until deletion by the user; object histories and purchase-rhythm data are pruned after five years (SPEC OBL-07) |
| **Technical measures** | Encryption in transit and at rest; long-lived device tokens, individually revocable; access log for sensitive areas (SPEC §16B) |

Implementation notes: every domain object belongs to exactly one family and is
scoped by `family_id`; devices authenticate with a hashed long-lived token and
carry no password.

## 2. Anticipating recurring needs (the staples engine)

| | |
|---|---|
| **Purpose** | Learning how often a household buys a thing, so the app can remind them before it runs out (SPEC §10.2) |
| **Legal basis** | Art. 6(1)(b) — this is the contracted service, not an add-on. Users can switch it off, which deletes what was learned (SPEC AI-06) |
| **Categories of data subjects** | Adults and teenagers only. **Child profiles are excluded unconditionally** — not a setting (SPEC FR-1417) |
| **Categories of data** | Timestamps at which an item was ticked off; "is empty" reports; dismissed suggestions |
| **Automated decision-making** | This is profiling in the sense of Art. 4(4). It produces a suggestion on a list and nothing else: no legal or similarly significant effect, so Art. 22 does not apply |
| **Retention** | Five years of raw check-off timestamps; derived intervals are discarded when the user switches learning off (SPEC OBL-07) |

The implementation is in `packages/domain/src/rhythm.ts`; the two independent
gates are in `packages/domain/src/compliance.ts` (`learningAllowed`).

## 3. Health data (opt-in module)

| | |
|---|---|
| **Purpose** | Medication and treatment protocols, measurement series, preventive-care deadlines (SPEC §12) |
| **Legal basis** | Art. 9(2)(a) — explicit consent, obtained separately from any other consent, at module activation (SPEC FR-1407) |
| **Categories of data subjects** | Family members for whom a protocol is created, including children (consent by the guardian, FR-1409) |
| **Categories of data** | Medication names and prescribed instructions, administration times and who administered, measured values, photographs of prescriptions or leaflets |
| **Special note** | **No health data exists at all unless the module is activated.** Deactivation offers deletion of everything the module holds |
| **Retention** | Until deletion; a finished protocol remains as documentation and is separately deletable |
| **Technical measures** | Second factor required for the module's administration (SPEC FR-117); separately keyed storage |

## 4. AI-assisted capture

| | |
|---|---|
| **Purpose** | Turning voice notes, photographs and pasted pages into list items, appointments and recipes (SPEC §14) |
| **Legal basis** | Art. 6(1)(b) — the capture feature is contracted |
| **Categories of data** | Audio recordings (transcribed then deleted immediately), photographs, free text; whatever the user captured |
| **Processor** | The EU-hosted AI provider, under an Art. 28 agreement that must exclude training on this data (SPEC AI-03) |
| **Third-country transfers** | None — provider selection is constrained to the EU (SPEC AI-02) |
| **Retention** | Audio is deleted at transcription; only the resulting text persists (SPEC OBL-07) |

## 5. Account and device management

| | |
|---|---|
| **Purpose** | Joining a family, approving and revoking devices, recovery |
| **Legal basis** | Art. 6(1)(b) |
| **Categories of data** | Device identifiers and token hashes, platform and last-seen timestamp; an email address only where the user chose to provide one; recovery-code hashes; invitation tokens carrying a name and role |
| **Retention** | Until the device is revoked or the account deleted |

## What is deliberately not processed

Stated here because the absence is itself a control (SPEC §17.6): no analytics,
no tracking SDKs, no advertising, no location data, no payment data, and no
content shared between families beyond an explicit, directed recipe share.

## Open items before publication

- Name the hosting provider, push configuration and AI provider, and attach
  their Art. 28 agreements (OBL-03).
- Complete the third-country transfer assessment for push (OBL-04).
- Document the technical and organizational measures per Art. 32 (OBL-05).
- Have the whole record reviewed professionally.
