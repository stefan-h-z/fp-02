# Requirement traceability

`docs/status.md` tracks the work packages in `PLAN.md`. This tracks the other
axis: the 363 numbered requirements in [`SPEC.md`](../SPEC.md), and specifically
the 154 whose identifier appears nowhere in the code, the tests or the docs.

An unreferenced identifier is not the same as an unimplemented requirement, and
that turns out to matter more than the raw number suggests. The spec composes
much of its surface out of a small set of objects — FR-801 says so outright for
the whole of chapter 8: *everything ingested here becomes events, tasks, or
deadlines — it is not a separate module.* A requirement satisfied that way has
nothing to cite it, and needs no code of its own.

## How to read this

| status | meaning |
|---|---|
| **done** | implemented; the identifier is simply not cited anywhere |
| **primitive** | satisfied by composing existing objects, as the spec intends. No dedicated code was ever called for |
| **by design** | a negative or architectural statement, true by construction |
| **missing** | genuinely not implemented |
| **partial** | the substance exists, a named part of the requirement does not |
| **backend** | server-side, in `backend-php-01`; its suite runs (241 tests), but the transports need a live provider |
| **platform** | needs a device, store or OS capability |
| **organizational** | a legal or operational duty, not code |
| **parked** | deliberately out of scope per SPEC OPEN-02 |

**What this is.** A desk review: the spec text read against the domain model
(`EntityTypes` in `packages/domain/src/schema.ts`), the module inventory, and
targeted searches. Roughly a dozen entries were verified by reading the
implementation. The rest are judgements from that evidence, not proofs — a
**done** here means "the capability is present", never "the behaviour is
correct". Where a search found nothing at all, the entry says **missing** and
that is reliable in the negative direction.

## Summary

Counted from the tables below, per identifier — the STO and CON rows are
grouped in the table and expanded here.

| | count | at first review |
|---|---:|---:|
| done — implemented | 85 | 41 |
| primitive — composes from existing objects | 21 | 21 |
| organizational | 12 | 12 |
| by design | 11 | 11 |
| backend | 10 | 10 |
| platform | 8 | 8 |
| parked (OPEN-02) | 3 | 3 |
| missing — genuinely absent | 2 | 33 |
| partial — substance there, a named part is not | 2 | 15 |
| **total** | **154** | **154** |

**The honest headline: 2 of 363 requirements are absent outright, and a further
2 are half-built.** The two are FR-503 (importing a recipe from a social video)
and FR-532 (voice control while cooking). Neither is undone work: one needs an
AI service and the other a speech capability, and no amount of effort in this
repository produces either.

The first review put those figures at 33 and 15, and that gap deserves an
explanation rather than a celebration. Sixteen requirements genuinely closed
since. **The other thirty were never missing.** They were built in earlier
sessions and their rows were simply never flipped: linked child profiles, pets,
emergency access, paste-import, exclusion search, leftovers, meal patterns, week
balance, A/B school weeks, the well-child and vaccination schedules, the allergy
pass, the in-app legal texts, the access log, the second factor, person colours,
the separated-parent scope, carpool rotas, time zones, oven-temperature
conversion, week templates, wish days, growth curves, and the device-revocation
contract. A row that says **missing** about code that exists is the worst kind
of error in a document like this, because it is the kind people act on — it
sends somebody to build what is already there.

The lesson is in the process, not the count. This table has now been corrected
three times, and each correction found the previous pass had only re-checked the
rows it happened to be touching. Every **missing** and **partial** row is now
verified against a named export in the source.

The remaining 150 divide into three groups that are easy to conflate and should
not be: 85 are built, 32 need nothing (composed from primitives, or true by
construction), and 33 are waiting on something outside the code — a server, a
device, or a signature.

---

## §1 Family and accounts

| | | status |
|---|---|---|
| FR-101 | Profile with name, colour, avatar | **done** — `readProfile` carries all three; `PERSON_COLOURS` / `nextFreeColour` hand out a free colour, and the avatar is its own onboarding step |
| FR-102 | Roles adult / teen / child / guest | **done** — `MemberRole`, used in routing and task ownership |
| FR-104 | Separated parent with restricted scope | **done** — `isVisibleTo`: a separated parent needs the item to be both shared *and* about their own child |
| FR-106 | Linked child profiles across two households | **done** — `linkedChildren` in `people.ts`; a separated parent sees a shared item only when it is also about their own child |
| FR-107 | Extended circle as lightweight contacts | **primitive** — `contact` + `guestLink` |
| FR-109 | Pets as care-receivers | **done** — `pets` in `people.ts`: a care-receiver without access, which is what a pet is |
| FR-111 | Emergency access for a designated adult | **done** — `emergencyGrants` in `people.ts` |
| FR-113 | Passkey / biometrics at first start | **platform** |
| FR-123 | No central password reset | **by design** — there are no passwords |
| FR-127 | Import instead of typing | **backend** — the ICS subscription connector |
| FR-130 | Separate, playful child onboarding | **done** — `childOnboarding.ts`; parent-led under six, child-led from six, every step carries a symbol (FR-1206), progress reports `usable` and never a percentage (FR-129) |

## §2 Calendar

| | | status |
|---|---|---|
| FR-201 | Sub-calendars with per-person colour | **done** — the colour gap it depended on (FR-101) is closed |
| FR-202 | Sub-calendars with filters | **done** — `calendarId` |
| FR-204 | All-day, timed, multi-day | **done** |
| FR-206 | Day, week, month, agenda, timeline views | **done** — `calendarViews.ts` + `CalendarScreen`; month grid with overflow counts, agenda skipping empty days, per-person lanes. Browser-tested |
| FR-214 | Carpools with a rota | **done** — `readCarpools` / `driverOn` / `upcomingTurns` in `timetable.ts` |
| FR-217 | Comment thread per event | **done** — `comment` entity |
| FR-218 | Attachments per event | **primitive** — `document` |
| FR-220 | Travel buffers and time zones | **done** — `zoneOffsetMinutes` / `crossesOffsetChange` / `startOfDayInZone`, resolved through `Intl` rather than a table |
| FR-221 | History per event | **by design** — the operation log is the history |

## §4 Tasks and mental load

| | | status |
|---|---|---|
| FR-401 | Explicit distribution via the card deck | **done** — `mentalload.ts`, `responsibilityCard` |
| FR-409 | Anticipated work is a system service | **done** — `rhythm.ts`, `suggest.ts` |
| FR-410 | Suggestions instead of questions | **done** — `suggest.ts` |

## §5 Recipes and cooking

The largest concentration of genuine gaps: 21 unreferenced, and most are real.

| | | status |
|---|---|---|
| FR-502 | Import from photo | **backend** — `src/AI/Jobs/ExtractFromImage` |
| FR-503 | Import from social video | **missing** |
| FR-504 | Import from PDF | **backend** — same vision path |
| FR-505 | Import by pasting text | **done** — `recipeImport.ts` parses a typed or pasted recipe |
| FR-506 | Share target from browser or messenger | **platform** |
| FR-507 | Manual entry, structured ingredients | **done** |
| FR-511 | Bulk import and migration | **done** — `importMany`, partial success with per-entry reasons and duplicate detection |
| FR-515 | Categories, tags, cuisine, season, effort | **done** — `readFacets` / `findRecipes` / `seasonOf`; an unnamed season means all year, not never |
| FR-517 | "What can I cook with what's here" | **done** — `suggest.ts` scores against staples state |
| FR-518 | Exclusion search ("without nuts") | **done** — `recipesWithout`, coupled to the stored allergies as the spec asks |
| FR-520 | Own result photo | **done** — `recipeImages` keeps the family's photo beside the one the recipe arrived with, rather than over it |
| FR-521 | Modifications and versioning | **done** — `revisions` / `latestRevision`, kept as the sentence a person wrote |
| FR-522 | Source attribution and link | **done** — `recipeImport.ts` |
| FR-523 | Collections / own cookbooks | **primitive** — `collection` |
| FR-524 | Fully available offline | **by design** |
| FR-525 | Sharing with other families, export | **done** — `shareRecipe` / `exportRecipes`; asserted from the leak direction, no entity, person or family id leaves |
| FR-526 | Heritage recipes archive | **primitive** — `collection` + `document` |
| FR-532 | Voice control during cooking | **missing** |
| FR-533 | Unit and temperature conversion | **done** — `convertOven` / `readOvenTemperature` alongside the unit conversions |
| FR-534 | Nutrition facts, optional and informational | **done** — `readNutrition`; reports what the recipe brought and computes nothing, off until switched on |
| FR-535 | Kids' cook mode, picture-based steps | **done** — `kidSteps` / `recipesForKids`; adult steps marked rather than removed, a parent's tag overrides the matcher |

## §6 Meal planning

| | | status |
|---|---|---|
| FR-601 | Drag & drop from the recipe collection | **partial** — the capability is there as pick-up-then-put-down (`plan-library` → `plan-target`), deliberately instead of a pointer drag, which excludes keyboard and screen-reader use. The drag gesture itself is not implemented |
| FR-602 | Meal types | **done** — `mealType` |
| FR-605 | Leftovers as first-class linked entries | **done** — `leftoverSlotIds` in `mealPlanning.ts`, linked to the meal they came from |
| FR-606 | Recurring patterns (Friday pizza) | **done** — `mealPatterns` / `patternFor` |
| FR-607 | Plan templates, reuse of past weeks | **done** — `weekAsTemplate` / `shiftTemplate` take a whole week forward |
| FR-612 | Wish days and vetoes | **done** — `wishDays` / `vetoedRecipeIds` |
| FR-614 | Balance across the week | **done** — `weekBalance`; counts only, never a score (SPEC §1.3) |
| FR-616 | Automatic week suggestion | **done** — `suggest.ts` |

## §7 Shopping

Mostly built — the unreferenced count here is the most misleading of all.

| | | status |
|---|---|---|
| FR-706 | Product group vs aisle order | **done** |
| FR-708 | Store learned from history | **done** — `catalogItem.stores` |
| FR-709 | Nothing disappears from view | **done** |
| FR-710 | Additional lists for occasions | **done** — lists are per domain |
| FR-712 | Adjustable categories | **done** |
| FR-713 | Quantities and units | **done** — `units.ts` |
| FR-715 | Item details incl. photo | **done** — `readItemDetails` / `hasDetails`; the list asks one boolean and draws one dot, the rest waits for a tap |
| FR-716 | Frequently bought quick access | **done** — `rhythm.ts` |
| FR-718 | Voice, barcode, photo, dictation | **done** — `capture`; a barcode resolves against the family's own catalogue only, never a product database |
| FR-719 | Location reminder, evaluated on device | **done** — `storesNearby` takes a location and returns store ids; no coordinate reaches an operation or the server |
| FR-720 | Who shops; others see the status | **done** |
| FR-722 | Offline in the store | **by design** |
| FR-723 | Price note and running total | **done** — `runningTotal` in cents, trolley separated from list, unpriced count returned so the screen can say "roughly" honestly |
| FR-726 | Offers and flyers, off by default | **by design** — the feature does not exist, so it is off |
| FR-728 | Checked-off items go to history | **done** |
| FR-729 | Replenishment rhythm learned | **done** — `rhythm.ts` |
| FR-730 | No stock levels (binding negative) | **by design** |
| FR-744 | The list inbox has a named responsible | **done** — `inbox.ts` |

## §8 School and kids logistics

FR-801 states this is not a separate module. Sixteen unreferenced entries, and
almost all of them are that statement being true.

| | | status |
|---|---|---|
| FR-802 | Timetables with A/B week alternation | **done** — `weekLabel` in `timetable.ts`, anchored on a school-named week and Monday-aligned |
| FR-803 | Substitution plans via ingestion | **backend** |
| FR-804 | Homework → child-owned tasks | **primitive** |
| FR-806 | Report cards as documents | **primitive** |
| FR-808 | School events → events | **primitive** |
| FR-809 | Daycare menu and closures → calendar | **primitive** |
| FR-810 | Bring-along lists | **done** — `packing-list` template |
| FR-811 | Care times → recurring events | **primitive** |
| FR-812 | School-holiday calendar via ICS | **backend** |
| FR-813 | Holiday care: deadlines and packing lists | **primitive** |
| FR-814 | School route and carpool, reusing FR-214 | **primitive** — inherits FR-214's gap |
| FR-815 | Club and training schedules | **primitive** |
| FR-816 | Courses with cancellation deadlines | **primitive** — `documents.ts` notice deadlines |
| FR-817 | Pickup authorizations via guest link | **primitive** |
| FR-818 | Waste calendar via ICS | **backend** |
| FR-819 | Outside messages collected in the inbox | **done** |

## §9 Health and food information

| | | status |
|---|---|---|
| FR-902 | Doctor appointments with preparation | **primitive** — event + lead-time tasks |
| FR-903 | Well-child checkups with statutory windows | **done** — `WELL_CHILD_CHECKS` (U1–U9, J1) with a closing-window state |
| FR-904 | Vaccinations and boosters, due logic | **done** — `VACCINATION_SCHEDULE` + `preventiveSchedule` |
| FR-905 | Medication plans as protocols | **done** |
| FR-906 | Growth measurements over time | **done** — `measurementSeries`, trend read from the last two points only |
| FR-907 | Sick notes as tasks with contact shortcuts | **primitive** |
| FR-908 | Allergy pass and emergency information | **done** — allergies on the person in `health.ts`, with generous substring matching |
| FR-910 | Prescriptions and reorders as deadline tasks | **primitive** |
| FR-911 | Emergency plan, exportable | **done** — `paper.ts` emergency binder |
| FR-912 | Therapy appointments as sub-calendar | **primitive** |
| FR-914 | Acknowledgement or measurement instances | **done** — `ProtocolKind` carries both |
| FR-925 | Same object for braces, pet drops, plants | **done** — the protocol is deliberately generic |

## §10 Documents and knowledge

| | | status |
|---|---|---|
| FR-1004 | Warranties and receipts | **primitive** — `document` |
| FR-1005 | Information bank (sizes, blood types) | **primitive** |
| FR-1006 | Contact directory | **done** — `contact` |
| FR-1008 | Scan with automatic categorization | **backend** |
| FR-1013 | Wish lists via guest link | **primitive** — `collection` + `guestLink` |

## §11 Ingestion

| | | status |
|---|---|---|
| FR-1101 | Capture by voice | **done** — `inbox.ts` |
| FR-1102 | Capture by photo | **backend** |
| FR-1104 | Screenshot import | **platform** |
| FR-1105 | Forwarding from messengers | **platform** |
| FR-1108 | Recurring events suggested from behaviour | **done** — `suggestRecurrences`; three occurrences minimum, every gap must agree, dismissal sticks |
| FR-1109 | External source imports | **backend** |
| FR-1110 | Templates and reuse of everything | **done** — `templates.ts` |
| FR-1111 | Bulk editing | **done** — `planBulkChange` / `bulkPayload`; names what it will not touch and why |
| FR-1112 | Import, export, backup | **done** — `backup.ts` |

## §12 Devices and access

| | | status |
|---|---|---|
| FR-1201 | iOS and Android app | **platform** — no device build produced |
| FR-1202 | Kitchen kiosk mode | **done** |
| FR-1203 | Web with the identical feature set | **done** — boots in Chromium |
| FR-1204 | Widgets | **platform** — needs an extension target |
| FR-1209 | Voice-assistant query | **parked** — OPEN-02 |
| FR-1210 | Wearable companion | **parked** — OPEN-02 |
| FR-1211 | Dark mode and font size | **partial** — dark mode follows the device (`useColorScheme` drives the theme, asserted in the browser suite); no font-size control of the app's own, so it relies on the platform's |
| FR-1303 | Location-based reminders | **parked** — OPEN-02 |

## §14 Privacy and compliance

| | | status |
|---|---|---|
| FR-1401 | Privacy policy in-app, versioned | **done** — `legal.ts` + `LegalScreen`, readable before joining anything; browser-tested |
| FR-1402 | Imprint in-app | **done** — `imprint()`, same screen, unfinished sections named rather than hidden |
| FR-1404 | Disclosure of which data flows where | **done** — `DATA_FLOWS`, its own tab |
| FR-1406 | Granular consent at first start | **done** — `consent`, `compliance.ts` |
| FR-1413 | Rectification: all fields editable | **by design** — every field is an operation |
| FR-1416 | Objection to individual processings | **done** — `OBJECTABLE_PROCESSINGS` / `mayProcess`, read inside `learningAllowed` so the objection has an effect rather than a record |
| FR-1418 | Encryption in transit and at rest | **platform** — TLS and disk are deployment concerns |
| FR-1419 | Access log | **done** — `accessLog` in `people.ts` |
| FR-1420 | Remote sign-out of lost devices | **done** — the client now calls `DELETE /devices/{id}`, matching the server; the contract mismatch is fixed |
| FR-1421 | Ability to notify all users of a breach | **organizational** |

## Principles, security, obligations, store, contract, architecture

| | | status |
|---|---|---|
| P-03 | What the system can know, it does not ask | **by design** |
| P-06 | Comments live on the object | **done** — `comment` |
| SEC-02 | Second factor for sensitive areas | **done** — `needsSecondFactor` in `people.ts` |
| SEC-03 | Guest links scoped, expiring, revocable | **done** — `clampGuestLinkDays`, revoke |
| SEC-04 | Encryption in transit and at rest | **platform** |
| SEC-05 | Access log for sensitive areas | **done** — `accessLog`, same mechanism as FR-1419 |
| SEC-06 | A channel to reach all users | **organizational** |
| OBL-01 | Record of processing activities | **done** — `docs/legal/records-of-processing.md` |
| OBL-02 | Data protection impact assessment | **done** — `docs/legal/dpia.md` |
| OBL-06 | Breach reporting within 72 hours | **organizational** |
| STO-01, STO-02, STO-04, STO-05 | Store obligations | **organizational** |
| CON-01 … CON-04 | Trader status, withdrawal, accessibility | **organizational** |
| ARC-01 | Free and ad-free in the baseline | **by design** |
| ARC-02 | No analytics, tracking SDKs or advertising | **by design** — verified: the app has no such dependency |
| ARC-03 | Hosting in the EU | **organizational** |
| ARC-04 | Health module switchable, own consent | **done** — consent gating |
| ARC-05 | AI at an EU provider via the backend | **backend** + **organizational** — `config/family.php` states the contractual conditions |
| ARC-06 | No public content, no stranger sharing | **by design** |

---

## What this changes

The number that matters is not 154. It is **2 absent plus 2 half-built**.

The two that are absent are absent for a reason no schedule fixes: FR-503 wants
a recipe pulled out of a social video, and FR-532 wants voice control at the
hob. One needs an AI service, the other a speech capability. Everything else in
the specification either exists or is waiting on a server, a device or a
signature.

The two **partial** rows are FR-601 (the placement flow exists; the pointer-drag
gesture does not, deliberately) and FR-1211 (dark mode follows the device; there
is no font-size control of the app's own).

Which means the specification is very nearly answered, and the project's real
risk has moved somewhere this table does not measure: the ten **backend** rows
are PHP whose own suite now runs green but whose transports have never spoken to
a real provider, the eight **platform** rows need a
device and a store account, and the twelve **organizational** rows need
signatures. None of those is closed by writing more application code.

**How these counts are produced.** Not by hand. This file is parsed row by row —
the grouped STO and CON rows expanded to their individual identifiers — and the
totals above come from that count. Two corrections were needed to get here: the
first summary was estimated by eye and wrong in four rows, and the second
re-checked only the rows it had just edited, leaving fifteen entries claiming
**missing** about code that had been in the repository for days. A traceability
table nobody re-verifies is a table that drifts, and it drifts pessimistically —
which is worse than drifting the other way, because it sends people to build
what is already there.
