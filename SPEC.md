# Family App — Product & Functional Specification

**Working title:** Family App (working title: `fp-02` — naming explicitly open)
**Status:** Draft v0.1 · 2026-07-28
**Repository:** `stefan-h-z/fp-02`
**Source:** Translated and formalized from the German feature catalog
"Funktionskatalog Familien-App" plus the decisions recorded in §19.
**Project language:** English. All committed artifacts (specs, code, comments, commit
messages) are English; user-facing strings ship localized in **German and English**
from launch (§2.4).

---

## 1. Overview & Vision

### 1.1 The core

**If only one thing works, it is this:** every recurring thing in family life has a
visible owner — and the anticipating is done by the system, not by a person.

**The success test:** at the end of a week, nobody had to keep the list in their head.
Not: "the app was used a lot."

**The daily loop everything depends on:** Plan → List → Shopping → Cooking. This is the
only loop that truly runs every single day. If it is not friction-free, no other chapter
helps.

### 1.2 Feature admission criterion (governance rule)

A capability enters (or stays in) this spec only if it passes all five questions:

1. **Does its state arise as a by-product of normal use** — or does someone have to
   maintain it? State that must be maintained and that nobody needs immediately dies
   within two weeks.
2. **Does it change who has to keep something in their head?** If not, it is decoration.
3. **Is it needed at least weekly** — or is it indispensable in a rare emergency?
   Everything in between is out.
4. **Does it work when only one person in the family uses the app?** Otherwise it
   depends on adoption that does not exist.
5. **Does it create new work for the person who already does everything?** Then it is
   counterproductive, no matter how useful it sounds.

### 1.3 Non-goals (binding exclusions)

Deliberate, permanent refusals. No requirement in this spec may contradict them.

- **No messenger and no chat channel** — a second message channel adds load instead of
  removing it. Comments attach to objects (events, tasks, list items), never to a channel.
- **No social network, no photo feed, no family album.**
- **No fairness score, no points ranking, no competition between adults** — it invites
  score-keeping and worsens the exact problem the app is meant to solve.
- **No location tracking of family members.**
- **No finance management** — no budgets, no allowance, no expense splitting.
- **No inventory, lending, or possession management.**
- **Not a medical device**: no dose calculation, no diagnostics, no therapy
  recommendations.
- **No nutrition steering**: no calorie targets, no diet features, no judging of food.
- **No replacement for school/daycare portals** — the app reads from them, never writes
  to them, and does not re-implement them.
- **No complete model of the household** — fuzziness is acceptable; a wrong number is not.
- **No screen-time or device management** — operating systems do this better.

### 1.4 Guiding principles

- **P-01** Every piece of information is captured exactly once and available everywhere.
- **P-02** Every task has an owner — nothing sits in an anonymous pool.
- **P-03** What the system can know by itself, it does not ask.
- **P-04** Capturing must never take longer than the note on the fridge.
- **P-05** Changes propagate automatically: plan changed means list changed means
  staples state changed.
- **P-06** The app does not replace communication; it structures it. Comments live on
  the object.
- **P-07** Reducible: each family enables only the areas it needs.
- **P-08** Fuzziness over false precision: the app may say "probably", never a wrong number.
- **P-09** The system does the anticipating; anticipation is a system service, never a
  human's task.

---

## 2. Product Context & Platform Strategy

### 2.1 Ecosystem

- **This repository (`fp-02`)** holds the app and all product-specific functionality
  (client code, and the definition of the product's API/domain behavior).
- **Backend:** implemented as an app module of the multi-app platform
  `stefan-h-z/backend-php-01` (Laravel; OAuth2 via Passport, push via FCM/APNs, realtime
  via Reverb, S3-compatible file storage, EU-hostable). The platform provides auth,
  storage, queues, push, realtime, and observability; this product's module provides the
  family-domain API, the sync protocol endpoint, and the AI-processing gateway.
- **UI:** built from the component library in `stefan-h-z/cp-testt1-09` (Tamagui-based,
  React Native + Web).

### 2.2 Platforms — one codebase

One React Native / Expo codebase renders all targets:

- **Smartphone app** (iOS + Android) — the primary personal device.
- **Kitchen tablet / kiosk mode** — an operating mode of the tablet app: permanently
  signed in as the household, person is only selected where it matters (§4, FR-116).
- **Web** — full product in the browser, same feature set, same offline-first guarantees
  (§15).

There is exactly one feature state across platforms; platform-specific divergence
requires an explicit spec note.

### 2.3 Scale & distribution

- Designed for a public App Store / Play Store release by a private individual,
  targeting **hundreds up to a few thousand families** (fits the backend platform's
  single-VPS, <10k-users sizing).
- **Baseline posture:** free of charge, no advertising, no third-party analytics or
  tracking SDKs, hosting in the EU (§17.6).
- **Monetization is deliberately kept open**: the spec carries a conditional block of
  commercial obligations (§17.5) that activates if paid features are ever introduced.
  Nothing in the architecture may make later monetization impossible, and nothing in
  the baseline may presume it.

### 2.4 Localization

The UI ships in **German and English from launch**. German is the primary market
language; carrying English from day 1 forces a clean localization architecture (no
hard-coded strings, locale-aware dates/units). Committed source strings are English;
German is a first-class translation maintained with the same care (template content —
standard tasks, categories, meal types — localizes too).

---

## 3. Release Phases

All chapters below are fully specified; phases define the implementation order, not the
depth of specification. Every FR carries an implicit phase from this table unless
individually overridden with a `Phase:` note.

| Phase | Content | Exit criterion |
|---|---|---|
| **0 — Foundation** | Family & persons, roles, joining, passwordless auth & devices, recovery, multi-family tenancy (§4); offline-first sync engine incl. tiered conflicts (§15.2); push plumbing; legal baseline: privacy policy, minimal consent, account deletion (§17) | Two adults + one child on three devices (two phones, one tablet in kiosk mode) join one family without any password or email, work offline, sync without loss, receive push. No visible product yet — deliberately. |
| **1 — Food loop** | Recipes (§8), meal plan (§9), shopping & staples (§10); area-based onboarding (§4.5); kiosk mode UX; core notifications incl. budget & quiet hours (§16); widgets & my-day basics (§15) | A family runs the full weekly loop plan → list → shop → cook end-to-end, including offline check-off in the store by two people simultaneously. |
| **2 — Coordination** | Calendar incl. **mandatory two-way sync** (§5), tasks & ownership (§6), mental load & fairness (§7), routines & kids views (§15), global search (§15) | The family calendar mirrors the parents' existing external calendars in both directions; every recurring responsibility has a named owner visible in the distribution overview. |
| **3 — Periphery & ingestion** | External sources via generic ingestion (§11), health module (§12, opt-in), documents & collections (§13), capture & automation incl. family email address (§14), print/paper fallback, voice-assistant query, wearables, geofenced reminders (all §15/§16, see OPEN-02) | An ingested photo of a parent letter becomes a deadline task; a treatment protocol runs to completion and exports; the emergency paper output prints. |

---

## 4. People, Family Structure & Access

*Catalog chapter 1 + 1.1. FR-1xx.*

### 4.1 Structure

- **FR-101** Family members have a profile with name, color, and avatar.
- **FR-102** Roles: **Adult**, **Teen**, **Child**, **Guest** (grandparent, babysitter,
  childminder). There is no permission system beyond these roles (deliberate omission,
  §4.6).
- **FR-103** Age-dependent views: picture-based view for preschool children, reduced
  view for school children (see FR-1206).
- **FR-104** **Separated parent** is a dedicated role with a restricted scope: the
  member sees and edits only the objects shared with them (child-related calendars,
  tasks, protocols), never the whole family space.
- **FR-105** **A person can be a member of multiple families.** Family = tenant/space;
  every domain object belongs to exactly one family. A person's identity (device,
  account) is family-independent.
- **FR-106** **Linked child profiles:** the same child existing in two families
  (separated households) can be linked so that objects explicitly shared for that child
  (protocols, pickup authorizations, appointments) can be made visible across the link.
  Nothing is shared by default.
- **FR-107** Extended circle: godparents, neighbors, carpool partners exist as
  lightweight contacts (§13, FR-1006) and can be granted guest access (FR-108); they
  are not members.
- **FR-108** **Guest access** is a link with an expiry date and a topic-limited scope
  (e.g. "this week's protocol instances", "the pickup schedule") — no account, no
  installation required. Lifetime is chosen at creation: **default 7 days, maximum
  90 days**; links expire silently, and extending means issuing a new link. There are
  no non-expiring links.
- **FR-109** Pets exist as care-receivers ("persons" without access) with tasks
  (feeding, vet, walking) and protocols (FR-925).
- **FR-110** **Absence status** (business trip, shift, hospital) per person with a date
  range; while absent, the person's rotating/recurring tasks are automatically
  redistributed (accepting owner per FR-310) and their staple clocks pause (FR-733).
- **FR-111** **Emergency access:** a designated second adult can, in an emergency,
  access everything needed to keep daily life running — including otherwise private
  areas. Activation is explicit, logged (SEC-05), and visible to all adults.

### 4.2 Authentication

**Guiding rule: sign in at most once per device, then never again.** Every repeated
login is an adoption risk — the documented reason family apps fail is not missing
functionality but the second adult forgetting their login and never coming back.

- **FR-112** No passwords. First start: one-time code or magic link, then a long-lived
  device token. **The device is the identity** — a phone belongs to one human.
- **FR-113** Passkey or the device's biometrics are supported as an alternative
  first-start mechanism.
- **FR-114** Sessions do not expire. Sign-out happens only explicitly on the device or
  remotely (FR-122).
- **FR-115** **Children have no account**: profile selection by tapping the avatar; no
  password, no email address.
- **FR-116** **Shared device (kitchen tablet):** permanently signed in as the
  *household*; the acting person is asked only where it is semantically required
  Person disambiguation (avatar tap) is required exactly for: acknowledging or
  measuring a protocol instance (FR-917), completing a task with an owner or an
  approval workflow (FR-312), voting/veto (FR-406, FR-612), and per-person ratings and
  notes (FR-519). Everything else — checking off list items, viewing plans, adding
  entries — acts anonymously as the household.
- **FR-117** A **second factor** is required only for sensitive areas (documents §13,
  health §12 administration), never for everyday flows. Mechanism: the device's
  biometrics (Face ID / fingerprint) where available; on devices without biometrics
  (kitchen tablet, web) an app-defined PIN per adult. No TOTP, no additional passwords.

### 4.3 Joining

- **FR-118** No registration for joiners: one adult creates the family; everyone else
  joins via QR code or link. The invitation already contains name and role — the joiner
  fills in nothing. Joining without an email address is possible wherever legally
  permissible (guardian consent, FR-1409, is collected from the inviting adult for
  children).

### 4.4 Recovery

- **FR-119** **The family is the recovery mechanism:** a lost or new device is approved
  by another adult of the family.
- **FR-120** At family creation a **one-time recovery code** is generated (print it /
  write it down — it is the fallback when no second adult is available). Redeeming it
  approves a new device; redemption invalidates the code and issues a new one.
- **FR-121** If an email address is on file, a **magic-link fallback** to that address
  additionally works.
- **FR-122** Devices can be signed out remotely by any adult of the family.
- **FR-123** There is no central password reset, because there are no passwords.

### 4.5 Onboarding

- **FR-124** No feature tour, no empty app after first start. First question: who is in
  the family. Second: which area hurts the most right now.
- **FR-125** Only one area is enabled at the beginning; further areas appear when they
  are needed (P-07).
- **FR-126** Prefill instead of empty state: standard tasks, product categories,
  typical lists.
- **FR-127** Import instead of typing: subscribe to existing calendars, take over
  existing lists.
- **FR-128** **Two-adult negotiation onboarding** for the mental-load deck (§7): the
  responsibility distribution is set up *together*, not configured by one person and
  presented to the other.
- **FR-129** No progress bar, no "profile 60 % complete".
- **FR-130** Child onboarding is separate and playful; for preschool children it is set
  up by a parent.

### 4.6 Deliberate omissions

No role/permission management beyond the role field; no password rules, expiry, or
password recovery; no mandatory email verification; no social logins; no consent
cascades at first start (the consent dialog is minimal because the baseline processes
nothing optional — §17.2).

---

## 5. Calendar & Appointments

*Catalog chapter 2. FR-2xx. Phase 2.*

- **FR-201** Shared family calendar; color per person.
- **FR-202** Multiple sub-calendars (children, club, carpool, grandparents) with
  filters.
- **FR-203** Private events exist alongside shared ones; private events show only
  busy/free to others.
- **FR-204** All-day, timed, and multi-day events.
- **FR-205** Recurring events with exceptions (single-instance edits).
- **FR-206** Views: day, week, month, agenda, and a per-person timeline.
- **FR-207** **Two-way synchronization with Google Calendar, Apple (iCloud), Outlook,
  and generic CalDAV is a mandatory core requirement of this phase.** Changes made in
  external calendars appear in the app and vice versa; sync must be loop-safe and
  duplicate-free (SC-010). Per external account, the user chooses which external
  calendars map into which sub-calendars and whether the mapping is read-only or
  two-way.
- **FR-208** External calendars can additionally be subscribed read-only via ICS; the
  family calendar can publish read-only ICS feeds (scoped, revocable URLs).
- **FR-209** **Responsibility per event:** who brings, who picks up, who is fallback —
  named persons, visible in every view.
- **FR-210** Travel time and buffer are attached to events and considered in conflict
  and gap detection.
- **FR-211** Conflict detection: two events, one responsible parent → visible warning.
- **FR-212** **Care-gap detection:** school holidays, bridge days, movable holidays,
  daycare closure days are matched against care responsibilities; uncovered days are
  surfaced weeks ahead (system anticipation, P-09).
- **FR-213** Lead-time tasks attach to events (buy gift, pack sports bag, sign form)
  and become due relative to the event.
- **FR-214** Carpool rotation with a schedule and reminders.
- **FR-215** Free-slot search across selected participants ("find an evening that works
  for all").
- **FR-216** Appointment requests to other family members ("Can you do Thursday?") with
  accept/decline.
- **FR-217** A comment thread per event replaces any separate chat (non-goal §1.3).
- **FR-218** Attachments per event (invitation, directions, parent letter).
- **FR-219** Countdown display for children ("3 more sleeps", FR-1206).
- **FR-220** Travel times across time zones are handled correctly.
- **FR-221** History per event: who moved which event when (see §15.2 conflict rules).

**Acceptance — external sync (critical flow):**
1. **Given** a connected Google account with two-way mapping, **When** a partner moves
   an event in Google Calendar, **Then** the change appears in the family calendar
   within the sync interval, responsibility fields are preserved, and no duplicate is
   created.
2. **Given** the same event edited offline in the app and moved in Google in the same
   window, **When** sync runs, **Then** the event time counts as a critical field and a
   visible conflict resolution is offered (§15.2), never a silent overwrite.

---

## 6. Tasks & Ownership

*Catalog chapter 3. FR-3xx. Phase 2.*

- **FR-301** Every task has **exactly one owner** (P-02).
- **FR-302** **Ownership spans all three phases** — noticing, planning, executing — not
  just execution. The task object records the owner for the whole; "noticing" is
  system work wherever possible (P-09).
- **FR-303** **Definition of Done** per task: a short, once-negotiated description of
  what "done" means; shown at completion.
- **FR-304** Due dates, time windows, and "someday" tasks (no date) are supported.
- **FR-305** Recurrence either by fixed schedule **or** by interval since last
  completion — both first-class.
- **FR-306** Rotation between persons (weekly, monthly) with a visible rotation plan.
- **FR-307** Subtasks / checklists inside a task.
- **FR-308** Dependencies between tasks (blocked-by).
- **FR-309** Effort estimate / duration field for realistic day planning.
- **FR-310** **Delegation requires acceptance** — no silent reassignment. Declined
  delegation returns to the delegating owner.
- **FR-311** Task handover on absence or sickness (driven by FR-110).
- **FR-312** Approval workflow for children's tasks: child marks done, a parent
  confirms.
- **FR-313** Optional photo proof on completion.
- **FR-314** Escalation for overdue tasks goes **to the owner**, not to the person who
  noticed or reminded (FR-1307).
- **FR-315** Templates: task packs (moving, school enrollment, trip preparation,
  sick-week).
- **FR-316** Task library / card deck of all recurring family responsibilities (shared
  with the mental-load deck, §7).
- **FR-317** Standard task suggestions by child age.
- **FR-318** "Blocker" flag: task cannot be done because X is missing; X links to a
  list item, contact, or other task.
- **FR-319** Area/location as a task **attribute** (room, garden, car, basement) — not
  a management area of its own.
- **FR-320** **Very long intervals** (yearly, multi-year: maintenance, winter service,
  vehicle inspection, tire change) with dedicated reminder logic — a yearly task needs
  weeks of lead time, not a push on the due date (FR-1302).
- **FR-321** Deadline tasks with escalating lead stages (the opportunity expires if
  nothing happens).
- **FR-322** Repair/tradesperson tasks can reference a contact from §13 (FR-1006).
- **FR-323** **Reward as an attribute** of children's tasks (stars) — not a separate
  system, and never applied to adults (non-goal §1.3). Stars are **purely symbolic**: a
  per-child tally display, no redemption logic, no reward catalog — whether and what
  stars "buy" is negotiated by the parents outside the app.
- **FR-324** Packing lists and tradition preparations exist as reusable checklist
  templates.
- **FR-325** History — who completed what when — lives as a log on the object, not as
  an analytics module.

---

## 7. Mental Load & Fairness

*Catalog chapter 4. FR-4xx. Phase 2.*

- **FR-401** Explicit distribution of **all recurring responsibilities** via the card
  deck, set up by two adults together (FR-128).
- **FR-402** Invisible work is made visible: thinking and planning duties are
  first-class objects (cards/tasks), not footnotes of execution tasks.
- **FR-403** Distribution overview by person, category, and period.
- **FR-404** The overview distinguishes everyday tasks from project tasks.
- **FR-405** Recurring negotiation appointment ("family meeting") with an
  auto-prepared agenda: new cards, disputed cards, load spikes, unplaced
  responsibilities.
- **FR-406** Votes and polls as a decision tool ("Where to go on holiday?").
- **FR-407** Renegotiation of individual cards, with history.
- **FR-408** **Load-spike warning:** one person has disproportionately much in the
  coming week → surfaced to the adults (never as a score).
- **FR-409** Automatically anticipated work (staples, care gaps, checkup deadlines) is
  a *system service* — it never creates a "remember X" task for a human (P-09).
- **FR-410** Cognitive relief through **suggestions instead of questions** ("dental
  checkup due — book an appointment?").
- **FR-411** Completion history serves as a conversation basis — deliberately without
  points, ranking, or fairness score (non-goal §1.3).

---

## 8. Recipes

*Catalog chapter 5. FR-5xx. Phase 1.*

**Ownership in the food loop (applies to §8–§10):** Meal planning is the domain with
the strongest documented unequal distribution. The ownership model of §6 applies here
explicitly, split by phase: **noticing** is taken over by the system as far as possible
(§9.2, §10.2); **planning** — fixing the week and generating the list, where the real
work sits — has a **planning owner per week, rotatable** (FR-615); **executing** has an
owner per meal (FR-608) and per shopping trip (FR-720). The list inbox additionally has
a named responsible (FR-744).

### 8.1 Capture & import

- **FR-501** Import by URL with web scraping; source link retained (FR-522).
- **FR-502** **Import from photo**: cookbook page, handwritten recipe card, newspaper
  clipping (AI extraction, §16A).
- **FR-503** Import from social video (TikTok, Instagram, YouTube) via AI extraction.
- **FR-504** Import from PDF.
- **FR-505** Import by pasting text ("typed from memory").
- **FR-506** Share target: share a recipe from the browser or a messenger straight into
  the app.
- **FR-507** Manual entry with structured ingredient fields.
- **FR-508** AI parsing of unstructured ingredient lists into quantity / unit /
  ingredient / note.
- **FR-509** Duplicate detection on import.
- **FR-510** Advertising and storytelling ballast is stripped automatically on import.
- **FR-511** Bulk import and migration from other apps.

### 8.2 Structure & organization

- **FR-512** Structured ingredients: quantity, unit, ingredient, preparation note
  ("finely chopped").
- **FR-513** Unit normalization (tbsp/tsp/ml/g/pinch) so quantities stay aggregatable
  (FR-714).
- **FR-514** Portion scaling with sensible rounding.
- **FR-515** Categories, tags, cuisine, season, effort level, occasion.
- **FR-516** Full-text search and search by single ingredient.
- **FR-517** "What can I cook with what's here" search (fed by reported/known staples
  state — best effort, never claiming stock knowledge, FR-743).
- **FR-518** Exclusion search ("without nuts", "without oven") — couples to allergy
  data when the health module is active (FR-908).
- **FR-519** Rating and notes **per family member** ("kid won't eat this", "too spicy").
- **FR-520** Own result photo alongside the press photo.
- **FR-521** Modifications and versioning ("we always use half the chili").
- **FR-522** Source attribution and link to the original.
- **FR-523** Collections / own cookbooks.
- **FR-524** Recipes are fully available offline (§15.2).
- **FR-525** Sharing recipes with other families; export.
- **FR-526** Heritage recipes archive (grandparents' family recipes, with a photo of
  the original card).

### 8.3 Cooking

- **FR-527** Cook mode with the display kept permanently on.
- **FR-528** Step-by-step view with large type.
- **FR-529** Timers started directly from a cooking step; multiple in parallel.
- **FR-530** Check off ingredients while cooking.
- **FR-531** Schedule across multiple dishes so everything is ready at the same time.
- **FR-532** Voice control during cooking (hands are doughy).
- **FR-533** Unit and temperature conversion; convection vs. conventional oven.
- **FR-534** Nutrition facts optional and informational only — never a diet feature
  (non-goal §1.3).
- **FR-535** Kids' cook mode: simple recipes, picture-based steps.
- **FR-536** Post-cooking note ("10 minutes shorter next time").

---

## 9. Meal Plan

*Catalog chapter 6. FR-6xx. Phase 1.*

### 9.1 Planning

- **FR-601** Week plan with drag & drop from the recipe collection.
- **FR-602** Meal types: breakfast, lunch, dinner, snack, meal-prep.
- **FR-603** **Who eats** — per meal and person, instead of a blanket household size;
  drives portion scaling and list quantities.
- **FR-604** Non-recipe entries: daycare lunch, school canteen, workplace canteen,
  eating out, delivery, leftovers.
- **FR-605** **Plan leftovers** ("cook once, eat twice") as first-class entries linked
  to the originating meal.
- **FR-606** Recurring patterns (Friday pizza, meat-free Monday, Sunday roast).
- **FR-607** Plan templates and reuse of entire past weeks.
- **FR-608** **Who cooks** — responsibility per meal; direct mental-load linkage (§7).
- **FR-609** Preparation tasks with lead time: defrost, soak, start dough, marinate —
  generated as reminders at the right time (P-09).
- **FR-610** Coupling to the family calendar: on training days the planner and
  suggester only offer ≤20-minute dishes.
- **FR-611** Rotation logic: "when did we last have this", enforce variety.
- **FR-612** Wish day for children, voting, veto right.
- **FR-613** Seasonality is considered.
- **FR-614** Balance across the week rather than per meal (informational, never a
  nutrition judgment — non-goal §1.3).
- **FR-615** **Planning owner per week, rotatable** — the person who fixes the week and
  triggers list generation; visible on the plan.

### 9.2 Decision relief

- **FR-616** Automatic week suggestion from staples state, preferences, season, effort,
  and calendar.
- **FR-617** Re-roll single days without losing the rest.
- **FR-618** "What do we cook tonight?" quick suggestion with three options instead of
  an endless catalog.
- **FR-619** Suggestions come with reasons ("uses up the rest of the ground beef, takes
  20 minutes").
- **FR-620** Learning from ratings and from what was actually cooked (subject to the
  learning switch, FR-1417/LRN).
- **FR-621** Detect when a plan repeatedly isn't followed and adapt suggestions.
- **FR-622** Emergency list: three dishes that always work from the pantry.

**Acceptance — plan propagates to list (critical flow):**
1. **Given** a planned week with two recipes containing onions, **When** the planning
   owner confirms the week, **Then** the shopping list contains one merged onion line
   (FR-714) with the summed quantity, and removing one recipe from the plan adjusts the
   line automatically (P-05).

---

## 10. Shopping & Staples

*Catalog chapter 7. FR-7xx. Phase 1.*

### 10.1 The list

**List model (deliberate decision):**

- **FR-701** **One big list per domain**, not per store: groceries in one list; DIY
  store and pharmacy as separate domain lists. The separation criterion is the domain,
  never the store.
- **FR-702** **Store is an attribute of the item, not a list** — and multi-valued: the
  same item is available in several stores and is bought wherever convenient.
- **FR-703** Default group "available everywhere" for anything needing no assignment —
  assignment is the exception, not a duty. Store assignment only where it carries real
  information (store brands, specialties).
- **FR-704** **Runtime-switchable grouping:** by store while planning, by product
  group/aisle while in the store.
- **FR-705** Filter view "I'm at X right now" — items of that store plus everything
  unassigned.
- **FR-706** Product group (global) and aisle order (per store branch) are two
  different things.
- **FR-707** Checking off is global: bought is bought, independent of grouping.
- **FR-708** Store assignment is learned from history ("where did we buy this last") —
  as a suggestion, never a rule.
- **FR-709** Nothing disappears from view: the complete list is always reachable.
- **FR-710** Additional lists only for occasions with clearly separate shopping
  (vacation shop, bulk shop).
- **FR-711** Real-time synchronization; simultaneous check-off by two people in the
  store (idempotent — checked twice stays checked, FR-1219).
- **FR-712** Categories / product groups, individually adjustable.
- **FR-713** Quantities and units.
- **FR-714** **Merging of identical ingredients** from multiple recipes (3× onion = one
  line, quantities summed via FR-513).
- **FR-715** Item details: brand, variety, size, note, photo — without cluttering the
  list.
- **FR-716** Frequently bought items as quick access, learned from history.
- **FR-717** Templates: weekly shop, barbecue, vacation shop, sickness stock.
- **FR-718** Input by voice, barcode scan, photo, or dictation.
- **FR-719** Location-based reminder when passing the store — geofencing evaluated
  locally on the device, no location leaves it (non-goal §1.3). *Phase 3, non-binding
  (OPEN-02).*
- **FR-720** **Who shops** — take over the list; others see the status.
- **FR-721** In-store question attached to a single item ("out of stock — alternative?")
  answered by whoever is reachable; answer lands on the item, not in a chat.
- **FR-722** Offline capability in the store (a dead zone in the supermarket is the
  normal case, §15.2).
- **FR-723** Price note and running total during shopping (a note aid — not finance
  management, non-goal §1.3).
- **FR-724** Non-food domains: drugstore, DIY, stationery (FR-701).
- **FR-725** Children may add wishes; parents approve.
- **FR-726** Offers and flyers are optional and clearly switchable off; **off by
  default** (FR-1417).
- **FR-727** Paper fallback: share the list as text or print it. *Phase 3.*
- **FR-728** Checked-off items move to a history, not into the void.
- **FR-729** Replenishment rhythm is learned ("milk every 5 days") — the bridge into
  §10.2.
- **FR-744** The list inbox has a **named responsible**: who triages voice-captured
  items, who decides on in-store questions. Without this, list upkeep silently lands on
  one person again.

### 10.2 Staples — without inventory

**Fundamental decision:** there is no stock, no quantities, no stocktaking, and no
pantry view. "Stock" is not an object of its own but a property of the shopping list.
This removes the double bookkeeping that classic pantry management fails on in practice.

- **FR-730** The system maintains **no** stock levels, quantities, storage locations,
  or inventory objects (binding negative requirement).

**Three building blocks:**

- **FR-731** **Learned purchase rhythm** (invisible, runs without any doing): the only
  data source is when an item was checked off on the list; from this a **median**
  interval per item (median, so bulk purchases don't skew it).
- **FR-732** Derived state instead of a number: *unremarkable* → *probably due soon*.
  Shown only once there are enough data points; while nothing is known, nothing is
  claimed (P-08).
- **FR-733** Absence status (FR-110) pauses the clocks — vacation consumes nothing.
- **FR-734** **Empty report** — the single structured input: exactly one piece of
  information, "is empty" / "running low", captured in the moment with one gesture,
  no quantity, no category. **Reported beats estimated** — it overrides any prediction.
- **FR-735** **Voice inbox** — the unstructured input: one button, one sentence in
  passing ("milk's gone, pasta almost, the peppers need using"). Free-form, multiple
  items per sentence, AI sorts afterwards. **No questions at the moment of speaking** —
  anything uncertain lands in the inbox (FR-1113) and is swiped through in seconds on
  the next list open.
- **FR-736** "Needs using up" reports are not a stock topic — they generate a meal-plan
  suggestion for the coming days (FR-616/618).

**The actual mechanism:**

- **FR-737** Building blocks 1 and 2 are estimator and measurement of the same
  quantity: every empty report is simultaneously input *and* correction — the delta
  between predicted and reported due date calibrates the interval. The system improves
  with use and needs ever fewer reports.

**Self-healing:**

- **FR-738** Every purchase resets the item's state — a missed event never corrupts
  anything permanently. A declined suggestion ("not due yet") lengthens the interval;
  a too-late detection shortens it. **There is no state that would ever need manual
  repair.**

**Presentation:**

- **FR-739** No area of its own, no inventory screen, nothing to maintain. Inside the
  shopping list, two sections: **Reported** (hard facts) and **Probably due**
  (suggestions). Tapping a suggestion accepts it; swiping dismisses it; both train the
  model.
- **FR-740** Reasoning available on demand ("last bought 6 days ago, usually every 5").
- **FR-741** **All items participate equally.** No pre-selection, no candidate list:
  every item that was ever on the list takes part — groceries, drugstore, household
  consumables. The limitation emerges **from the data, not from a list**: items with a
  regular pattern reach suggestion confidence by themselves; items without one never
  do; one-off purchases disappear on their own.
- **FR-742** The suggestion display is bounded, not the item set: sorted by prediction
  confidence and degree of overdueness; only the top suggestions visible, the rest
  behind an expander. A dismissed suggestion disappears for its estimated remaining
  run-time; an item dismissed repeatedly becomes quieter, not more insistent.
- **FR-743** Deliberate omissions: no quantities, no storage locations, no stocktaking,
  no best-before dates (partially covered by "needs using up" reports), no waste
  statistics, no "do we still have this?" check while cooking — the app simply doesn't
  know, and doesn't pretend to (P-08).

**Relation to §7:** anticipating ("we'll need coffee again soon") is exactly the
invisible thinking work that otherwise permanently sticks to one person. Here the
system does it — as a system service, not as anyone's task (P-09).

**Acceptance — staples loop (critical flow):**
1. **Given** an item checked off roughly every 7 days for 5 weeks, **When** 7 days pass
   since the last purchase, **Then** the item appears under "Probably due" with an
   explanation available on demand.
2. **Given** a suggestion is dismissed, **When** the list is reopened the next day,
   **Then** the item is not shown and its interval estimate has lengthened.
3. **Given** a voice note "milk's gone, and something for Saturday", **When** the AI
   parses it, **Then** "milk" lands in **Reported** and the unclear remainder lands in
   the inbox — with zero questions asked at capture time.

---

## 11. External Sources: School, Daycare, Club, Municipality

*Catalog chapter 8. FR-8xx. Phase 3.*

**Approach (deliberate decision):** school portals and daycare apps generally have no
public APIs. This chapter is fulfilled entirely through the **generic ingestion
mechanisms** of §14 — ICS subscriptions, the family email address, photo/PDF import
with AI extraction, and the share target. There are **no portal-specific connectors**
and **no write-back** (non-goal §1.3).

- **FR-801** Everything ingested here becomes **events, tasks, or deadlines — it is
  never a data type of its own** (binding constraint).
- **FR-802** Timetables, including A/B week alternation, as recurring events.
- **FR-803** Substitution-plan changes arrive via ingestion (photo/mail) and update the
  affected day.
- **FR-804** Homework with due dates → tasks (child-owned, FR-312).
- **FR-805** Exam and study planning with backward planning: study blocks are laid out
  from the exam date backwards.
- **FR-806** Report cards and grades are stored as documents (§13), not modeled as a
  grade book (non-goal: no portal re-implementation).
- **FR-807** Parent letters and forms carry a return deadline and a completion status.
- **FR-808** School events (parent evenings, consultations, festivals) → events with
  responsibility (FR-209).
- **FR-809** Daycare menu, closure days → calendar; sick/absence reporting remains a
  *task with contact shortcut* — the app never writes into portals.
- **FR-810** Bring-along lists (forest day, gym bag, cake for the festival) →
  lead-time tasks on the event (FR-213).
- **FR-811** Care times, after-school care, edge-time and emergency care → recurring
  events feeding care-gap detection (FR-212).
- **FR-812** The state's school-holiday calendar and movable holidays via public ICS.
- **FR-813** Holiday care and camps: registration deadlines (FR-321) and packing lists
  (FR-324).
- **FR-814** School route and carpool coordination reuse FR-214.
- **FR-815** Club and training schedules, competitions, tournaments → sub-calendar.
- **FR-816** Music school, tutoring, courses with dates and **cancellation deadlines**
  (FR-321).
- **FR-817** Pickup authorizations are documented and shareable externally via guest
  link (FR-108).
- **FR-818** Municipal waste and bulky-waste calendars via ICS.
- **FR-819** Messages from outside are collected centrally in the inbox (FR-1113)
  instead of living in five apps.

---

## 12. Health & Care (opt-in module)

*Catalog chapter 9 + 9.1. FR-9xx. Phase 3.*

- **FR-901** The health module is **off by default**, activated per family by an adult
  with a **separate, explicit consent** (Art. 9 GDPR, FR-1407). Without activation, no
  health data exists anywhere in the system. The module can be disabled again;
  disabling offers deletion of all module data. Module data is separately deletable and
  separately exportable.

### 12.1 Care management

- **FR-902** Doctor appointments with preparation and follow-up (questions to ask,
  documents to bring — lead-time tasks, FR-213).
- **FR-903** Well-child checkups (U-Untersuchungen) and preventive care with statutory
  windows and reminders — surfaced weeks ahead (P-09).
- **FR-904** Vaccinations and boosters with due logic.
- **FR-905** Medication plans and reminders are realized as protocols (§12.2).
- **FR-906** Illness-course documentation (symptoms, fever curve via measurement
  protocols).
- **FR-907** Sick notes to daycare, school, employer: prepared as tasks with contact
  shortcuts — never automated writing into external systems.
- **FR-908** Allergy pass and emergency information — coupled to recipes and meal
  plan: exclusion search (FR-518) and plan warnings honor stored allergies.
- **FR-909** Dentist, orthodontics, and optician intervals (FR-320 long-interval logic).
- **FR-910** Prescriptions, referrals, reorders as deadline tasks.
- **FR-911** Emergency plan: contacts, powers of attorney, points of contact —
  exportable into the emergency binder (FR-1009).
- **FR-912** Therapy and support appointments as sub-calendar with responsibility.

### 12.2 Treatment & measurement protocols

**A dedicated object type — neither event nor task.** A protocol is a time-boxed,
high-frequency series with acknowledgement: eye drops 5×/day for 5 days, medication
every 8 hours, temperature every 4 hours, exercises 3×/day for 3 weeks. Why not a
recurring event or task: it would spawn 25 instances that make calendar and task list
unusable; it has a defined end and disappears fully by itself; it needs acknowledgement
with immediate visibility, not ownership negotiation; a missed instance means something
different from a task left undone.

- **FR-913** Definition: affected person (or pet), label, period with start and end,
  frequency (n× daily, every n hours, fixed times, meal-dependent), the instruction
  **verbatim as prescribed** plus a photo of the leaflet or prescription.
- **FR-914** Instance type: **acknowledgement** (check) or **measurement** (capture a
  value: temperature, weight, blood pressure).
- **FR-915** **The app never calculates doses** — it only mirrors what was prescribed
  (non-goal §1.3).
- **FR-916** Push goes to **all responsible adults**, not to one person.
- **FR-917** **Acknowledgement is immediately visible to everyone** — including *who*
  and *exactly when* — preventing the double dose when both parents are on duty.
- **FR-918** The reminder repeats until acknowledged or consciously skipped.
- **FR-919** Explicit "skipped" with a note, instead of silent disappearance.
- **FR-920** Missed-dose rule per protocol: the series either shifts or stays fixed —
  configured at creation.
- **FR-921** Night rest is honored: not every protocol may wake anyone at 3 a.m.;
  wake-capable is an explicit per-protocol flag.
- **FR-922** Time math is precise: for "every 8 hours", the actual time of the last
  dose counts, not the schedule.
- **FR-923** **Delegation to the outside:** single instances can be delegated to
  daycare, school, grandma, or the babysitter via a scoped guest link (FR-108) —
  without granting access to anything else; their confirmation flows back into the
  protocol.
- **FR-924** Protocols expire automatically — no manual cleanup. The record remains as
  documentation (measurements as a curve, doses as a list), is exportable for the
  doctor's visit, and is reusable as a template next time.
- **FR-925** The same object type serves non-medical uses: wearing braces, drops for
  pets, watering plants during vacation cover, aftercare, time-boxed exercise plans.
  Non-medical protocols work without the health module being active
  (they contain no Art. 9 data). *Phase: the protocol engine ships with the health
  module; non-medical templates included.*

**Acceptance — double-dose prevention (critical flow):**
1. **Given** both parents received the 8 p.m. push for a child's antibiotic, **When**
   parent A acknowledges on their phone, **Then** parent B's device shows the instance
   as done (with "A, 20:03") within 2 seconds while online, and the reminder stops on
   both devices.
2. **Given** both parents acknowledge the same instance within the offline window,
   **When** sync merges, **Then** the instance shows the earlier acknowledgement as
   authoritative and the later one in the history — flagged visibly, since protocol
   acknowledgement is a critical field (§15.2).

---

## 13. Knowledge, Documents & Collections

*Catalog chapter 10. FR-10xx. Phase 3.*

- **FR-1001** Document storage with categories and full-text search; gated by the
  second factor (FR-117).
- **FR-1002** IDs, passports, certificates with expiry dates and reminders (FR-320).
- **FR-1003** Insurance policies and contracts with term and notice period → deadline
  tasks (FR-321).
- **FR-1004** Warranties and purchase receipts (documentation only — no inventory,
  non-goal §1.3).
- **FR-1005** Information bank: clothing sizes, blood types, insurance numbers.
- **FR-1006** Contact directory: doctors, tradespeople, babysitters, school, neighbors.
- **FR-1007** Family knowledge ("how the heating works", "where the spare key is").
- **FR-1008** Scan function with automatic categorization (AI, §16A).
- **FR-1009** Emergency binder as export (FR-911, FR-1118).
- **FR-1010** Contacts of the children's friends including parent contact.
- **FR-1011** **Collections — a dedicated object type without due dates**: something
  that is gathered and searched when needed; neither event nor task.
- **FR-1012** Gift ideas collected year-round, per person; hidden from the person
  concerned.
- **FR-1013** Wish lists, viewable by externals via guest link (FR-108).
- **FR-1014** Outing ideas filterable by weather, age, duration, distance.

---

## 14. Capture, Inbox & Automation

*Catalog chapter 11. FR-11xx. Phase 3 (inbox core ships in Phase 1 with the voice
inbox, FR-735/FR-1113).*

- **FR-1101** Capture by voice (FR-735 and general).
- **FR-1102** Capture by photo (parent letter, notice, invitation, note, receipt).
- **FR-1103** **Email forwarding to a per-family address** (e.g. auto-generated
  `family-xyz@…`): inbound mail lands in the inbox; AI extracts dates, deadlines,
  persons. *Binding, Phase 3.*
- **FR-1104** Screenshot import.
- **FR-1105** Forwarding from messengers via share target.
- **FR-1106** Automatic recognition of date, place, person, and deadline from
  unstructured text (AI, §16A).
- **FR-1107** Rule-based automation ("parent-letter mails always create a task with a
  deadline").
- **FR-1108** Recurring events are suggested from observed behavior (subject to the
  learning switch, LRN).
- **FR-1109** Import of external sources: school portal exports, holidays, waste
  calendar (via §11 mechanisms).
- **FR-1110** Templates and reuse of everything.
- **FR-1111** Bulk editing.
- **FR-1112** Import, export, backup (see below).

### 14.1 Inbox

- **FR-1113** The **inbox** is the target object for everything captured but not yet
  assigned. One place instead of one question: unclear input never blocks the moment of
  capture (P-04).
- **FR-1114** Swipe-through triage in seconds, each entry carrying a suggested most
  likely assignment.
- **FR-1115** A visible counter, so the inbox cannot silently grow.

### 14.2 Backup & restore

- **FR-1116** Automatic, regular backups without user action.
- **FR-1117** Restore of an earlier state — a real restore, not just a raw-data export.
- **FR-1118** Paper emergency output of the critical content: today's events, active
  protocol instances, emergency contacts. *Phase 3.*

---

## 15. Views, Devices, Offline & Sync

*Catalog chapter 12 + 12.1. FR-12xx.*

### 15.1 Views & devices

- **FR-1201** Smartphone app (iOS + Android). *Phase 0/1.*
- **FR-1202** Wall-tablet / kiosk mode for the kitchen (FR-116). *Phase 1.*
- **FR-1203** Web access with the identical feature set. *Phase 0/1.*
- **FR-1204** Widgets: today, week, shopping list, next task, today's meal. *Phase 1+.*
- **FR-1205** Person-specific "What concerns me today" view. *Phase 1.*
- **FR-1206** Kids' view with symbols instead of text (FR-103). *Phase 2.*
- **FR-1207** Routines as an icon sequence for self-check-off, visual timer, focus
  mode. Reminders for device-less children run via the kiosk device or the caring
  adult (FR-1310) — a child routine must never require a smartphone. *Phase 2.*
- **FR-1208** Printable week overview and shopping list. *Phase 3 (with FR-727).*
- **FR-1209** Voice-assistant query (shopping list, today's plan). *Phase 3,
  non-binding (OPEN-02).*
- **FR-1210** Wearable companion (shopping list, next task on the wrist). *Phase 3,
  non-binding (OPEN-02).*
- **FR-1211** Dark mode, adjustable font size, accessibility; if monetization is ever
  activated, WCAG 2.1 AA / EN 301 549 become binding (CON-04). *Continuous.*
- **FR-1212** Focus view: only the next three things. *Phase 2.*
- **FR-1213** **Global search across all areas** — one field for events, tasks,
  recipes, documents, contacts, and collections. *Phase 2.*

### 15.2 Synchronization, offline, and conflicts

A kitchen tablet, two phones, and a dead zone in the supermarket are the normal case,
not the edge case. **All platforms — including web — are fully offline-first**: a local
store on every client, background synchronization, and visible conflict handling.

- **FR-1214** Full offline use of every enabled area with later synchronization; the
  web client achieves this with a local database and service worker.
- **FR-1215** **Tiered conflict model:**
  - *Tier 1 — auto-merge:* commutative/idempotent operations (checking off, adding
    items, appending comments, empty reports) merge silently; checked twice stays
    checked.
  - *Tier 2 — visible resolution:* critical fields (event start/end, protocol
    acknowledgements and skip states, task ownership, document edits) never silently
    overwrite. On true concurrent divergence, both versions are shown and one person
    decides; the object history records both sides.
- **FR-1216** Sync-status display: what has not been transmitted yet is visible.
- **FR-1217** No data loss through app restart or connection loss mid-entry; drafts
  survive locally.
- **FR-1218** Every domain object carries a per-object history (who changed what when)
  — surfaced as a log on the object, not as an analytics module (FR-325, FR-221).
- **FR-1219** Check-off operations are idempotent across devices.

---

## 16. Notifications & Reminders

*Catalog chapter 13. FR-13xx. Phase 1 core; refinement continuous.*

- **FR-1301** Reminders configurable per person and per object.
- **FR-1302** Multi-stage lead warnings (days/weeks ahead for long-lead items, FR-320).
- **FR-1303** Location-based reminders. *Phase 3, non-binding (OPEN-02; FR-719).*
- **FR-1304** Quiet hours and bundling instead of constant fire. Quiet hours are a
  **pure opt-in setting** — there is no default quiet window; when enabled (per family
  or per person), only protocols flagged wake-capable (FR-921) may break through, and
  suppressed notifications are delivered bundled when the window ends.
- **FR-1305** Morning briefing and evening close per person.
- **FR-1306** Weekly preview and weekly review as digests.
- **FR-1307** Escalation of overdue tasks to the **owner** (FR-314).
- **FR-1308** Silent notifications for information without required action.
- **FR-1309** **Notification budget:** a deliberate daily cap per person on
  action-requiring pushes; anything beyond it is bundled into the morning/evening
  digest (FR-1305). **Default: 5 per day**, adjustable per person. Protocol reminders
  (§12.2) are exempt from the budget — they are the reason the app is trusted.
- **FR-1310** **Reaching children without their own device:** reminders route to the
  shared kitchen device or appear as a task for the caring adult.
- **FR-1311** Notifications can address a **role** instead of a person ("whoever is at
  home right now" — derived from presence signals the family provides voluntarily,
  never from location tracking).

---

## 16A. Cross-cutting: AI Processing

- **AI-01** All AI processing (voice parsing, photo/PDF extraction, recipe parsing,
  suggestions) runs **server-side** in the backend module — clients never talk to an AI
  provider directly.
- **AI-02** The AI provider is **EU-hosted** and swappable behind one backend
  interface; provider choice is a plan/ops decision, not baked into the product.
- **AI-03** Family data is **never used to train** provider models; this is a binding
  contractual requirement on the provider (DPA, OBL-03).
- **AI-04** AI-assisted processing is labeled as such in the UI, especially for voice
  and photo input (FR-1405).
- **AI-05** Uncertain AI output never blocks capture and never asks in the moment — it
  lands in the inbox (FR-735, FR-1113).
- **AI-06 (LRN)** The behavioral **learning functions** (purchase rhythm FR-731,
  suggestion learning FR-620, store assignment FR-708, behavior-derived suggestions
  FR-1108) are a core contract feature, **on by default**, transparently explained in
  the privacy policy, and **switchable off per family**; switching off deletes the
  learned patterns. **Child profiles are fully excluded from any analysis or
  learning** (FR-1417).

## 16B. Cross-cutting: Security

- **SEC-01** Long-lived device tokens are individually revocable (FR-122); every
  active device is listed per person.
- **SEC-02** Second factor exclusively for sensitive areas (FR-117).
- **SEC-03** Guest links are scoped, expiring, and revocable (FR-108).
- **SEC-04** Encryption in transit and at rest — mandatory for §12 and §13 data.
- **SEC-05** Access log for sensitive areas and for emergency access (FR-111).
- **SEC-06** A channel exists to reach all users (for data-breach notification,
  FR-1421).

---

## 17. Legal & Privacy

*Catalog chapter 14. Not legal advice — to be professionally reviewed before release,
especially regarding health data and children's data.*

### 17.1 Classification

The GDPR household exemption (Art. 2(2)(c)) ends the moment the app is publicly in a
store; from then on the GDPR applies fully — also to a private individual, also free of
charge. The app processes **special categories under Art. 9** (health data, §12) and
**children's data** — the strictest tier. The staples function (§10.2) derives behavior
patterns from usage; that is profiling and is justified as contract performance with an
off-switch (AI-06). The controller is the natural person who publishes — personally.

### 17.2 In-app functions (binding FRs)

**Transparency**
- **FR-1401** Privacy policy reachable from inside the app, versioned, in plain
  language.
- **FR-1402** Provider identification / imprint reachable in-app.
- **FR-1403** Support contact (required by Apple anyway).
- **FR-1404** Disclosure of which data flows where (push service, hosting, AI
  processing).
- **FR-1405** Labeling of AI-assisted processing (AI-04).

**Consent**
- **FR-1406** Consent dialog at first start **only** for what is not required for
  contract performance; granular, individually refusable, refusing as easy as
  agreeing. Because the baseline processes nothing optional (no analytics, no ads),
  this dialog is minimal by design.
- **FR-1407** **Separate, explicit consent for health data** at health-module
  activation (FR-901).
- **FR-1408** Every consent is revocable at any time; revocation as easy as granting.
- **FR-1409** Guardian consent for children (under 16 in Germany), collected from the
  inviting adult (FR-118).
- **FR-1410** Provability: what was consented to, when, in which policy version.

**Data-subject rights as usable features**
- **FR-1411** Access (Art. 15): complete copy of one's own data, self-service.
- **FR-1412** Data export (Art. 20): machine-readable, structured format.
- **FR-1413** Rectification (Art. 16): all fields editable.
- **FR-1414** Erasure (Art. 17): per person, per area, whole account.
- **FR-1415** **Account deletion directly in the app** (mandated by Apple and Google;
  for Google additionally a path outside the app).
- **FR-1416** Objection against individual processings.

**The special case of shared data**
- **FR-1417a** Family data has multiple data subjects: a shared event does not belong
  to one person. A member's exit or erasure must not destroy the family: authorship
  marks are anonymized instead of objects deleted; erasure of the **last adult**
  deletes the family completely; children's data is individually removable without
  touching the rest; deactivation exists as an alternative to final erasure.

**Privacy-friendly defaults (Art. 25)**
- **FR-1417** Everything optional is off by default; child profiles carry no analysis
  or evaluation whatsoever; visibility defaults narrow, not wide; fine-grained
  visibility per object and person; children see only what is meant for them; no
  location tracking as a standard function; local processing wherever possible.

**Security (legal anchor for §16B)**
- **FR-1418** Encryption in transit and at rest (SEC-04).
- **FR-1419** Access log (SEC-05).
- **FR-1420** Remote sign-out of lost devices (FR-122).
- **FR-1421** Ability to notify all users of a data breach (SEC-06).

### 17.3 Obligations outside the app (OBL)

- **OBL-01** Record of processing activities (Art. 30) — the small-provider exemption
  does not apply with special categories.
- **OBL-02** Data protection impact assessment (Art. 35) — very likely required
  (health + children + behavior derivation).
- **OBL-03** Processor agreements (Art. 28) with hosting, push, AI provider, error
  reporting, mail dispatch.
- **OBL-04** Third-country transfer review (Art. 44 ff.) — push technically runs via
  Apple/Google.
- **OBL-05** Documented technical and organizational measures (Art. 32).
- **OBL-06** Breach reporting process within 72 hours (Art. 33/34).
- **OBL-07** Deletion concept with retention periods. Defaults: **voice recordings are
  deleted immediately after transcription/parsing** (only the text remains); **object
  histories and purchase-rhythm raw data (check-off timestamps) are retained for
  5 years** — deliberately long, to support yearly/multi-year task patterns (FR-320)
  and seasonality (FR-613); the justification is documented in the deletion concept.
  All retained data falls under the erasure rights of FR-1413/1414 at any time.
- **OBL-08** Documented assessment whether a DPO is required (probably not at this
  scale, but reasoned).

### 17.4 Store hurdles (STO)

- **STO-01** Apple: DSA trader status must be declared (even as a non-trader);
  non-declaration means removal from all EU storefronts. If classified as a trader,
  address/phone/email become public — a real issue with a private address.
- **STO-02** Support URL with reachable contact data (Apple requirement).
- **STO-03** Google Play, personal account: ID and address verification internally;
  before first release a closed test with a two-digit number of testers over 14 days —
  organizationally nontrivial, planned for during Phase 1.
- **STO-04** Google developer verification (from Sept 2026, rolling out per country)
  must be completed.
- **STO-05** Clarify up front whether the health module triggers Google's
  organization-account requirement for health categories; if it does, the health
  module's store positioning (or account form) must be adjusted before Phase 3 ships.
- **STO-06** **Kids-category guardrails:** the app targets adults; children are
  profiles inside a family account. Store listing, screenshots, and marketing never
  address children; child-facing UI exists only behind the family context. Design
  choices are reviewed against the stores' family-program classification criteria so
  the app is not pulled into the kids programs unintentionally.

### 17.5 Conditional block: if monetization is ever activated (CON)

- **CON-01** Trader/entrepreneur status, imprint duties, tax obligations.
- **CON-02** Right of withdrawal handling for digital purchases.
- **CON-03** Reassessment of STO-01 trader classification.
- **CON-04** Accessibility per BFSG: EN 301 549 / WCAG 2.1 AA becomes binding
  (FR-1211); the micro-provider services exemption is narrow and must not be relied on.

### 17.6 Risk reduction through architecture (binding)

- **ARC-01** Free of charge and ad-free in the baseline (until CON activates).
- **ARC-02** **No analytics, no tracking SDKs, no third-party advertising** — almost
  the entire consent apparatus disappears because only what is technically necessary is
  processed.
- **ARC-03** Hosting in the EU.
- **ARC-04** Health module as a switchable area with its own consent (FR-901).
- **ARC-05** AI processing at an EU provider via the backend (AI-01/02).
- **ARC-06** No public content, no sharing between strangers (family-to-family recipe
  sharing, FR-525, is explicit and directed).
- **ARC-07** Data minimalism as an architectural decision: what is not stored need not
  be disclosed, exported, deleted, or reported.

---

## 18. Data Model (key entities)

All domain entities are scoped to exactly one **Family**. Identity entities (Person,
Device) are family-independent and connected via Membership.

| Entity | Purpose / key attributes |
|---|---|
| **Person** | Global identity; name, contact (optional email); owns Devices. |
| **Family** | Tenant/space; settings (enabled areas, learning switch, quiet hours, budget); recovery-code state. |
| **Membership** | Person↔Family with role (adult/teen/child/separated-parent), color, avatar, absence status. |
| **ChildLink** | Links the same child's profiles across two families; per-object-type sharing flags. |
| **Device** | Long-lived token, platform, kiosk flag, last-seen; revocable. |
| **GuestLink** | Scope definition, expiry, revocation; no Person required. |
| **Event** | Calendar entry; recurrence, sub-calendar, responsibility (bring/pickup/fallback), travel buffer, attachments, comments, external-sync identity (per-provider UID for loop-safe two-way sync). |
| **Task** | Single owner, DoD, due/window/someday, recurrence (schedule or interval-since-done), rotation, subtasks, dependencies, effort, blocker link, area attribute, reward attribute (child tasks), photo proof. |
| **ResponsibilityCard** | Mental-load deck entry: recurring responsibility incl. noticing/planning; owner, category, negotiation history. |
| **Recipe** | Structured ingredients, steps, tags, per-member ratings/notes, versions, source, photos, collections. |
| **MealSlot** | Day × meal type; recipe or non-recipe entry, who-eats set, who-cooks, leftover link. |
| **WeekPlan** | Planning owner (rotatable), state, template origin. |
| **ShoppingList** | Per domain; sections; realtime state. |
| **ShoppingItem** | Name (canonical), quantity/unit, multi-valued store attribute, product group, details, wish/approval state, in-store question thread, price note. |
| **ItemRhythm** | Per canonical item: check-off timestamps, median interval, confidence, paused-by-absence; derived state only. |
| **EmptyReport** | Item, reported-at, kind (empty / running low / needs-using-up). |
| **Protocol** | §12.2 definition; instances with ack/measurement, skip records, delegation links. |
| **Document** | Category, full text index, expiry, second-factor gate. |
| **Contact** | Directory entry; referenced by tasks/events. |
| **Collection / CollectionItem** | Gift ideas, wish lists, outing ideas; visibility rules. |
| **InboxItem** | Raw capture (voice/photo/mail/share), AI suggestion, triage state, counter. |
| **HistoryEntry** | Per-object log line (who/what/when, both sides of resolved conflicts). |
| **Consent** | Person, subject (e.g. health), policy version, granted/revoked timestamps. |

Sync model requirements (implementation detail belongs to the plan, not this spec):
every mutation is an operation with client id + logical timestamp; Tier-1 operations
are commutative by construction; Tier-2 fields carry version vectors sufficient to
detect true concurrency (FR-1215).

---

## 19. Decisions Log

Decisions taken with the product owner during spec creation (2026-07-28):

1. Full-catalog spec, one `SPEC.md` at repo root, English, hybrid chapter+FR format.
2. Phases 0–3 with a foundation-only Phase 0; food loop first.
3. One RN/Expo codebase for iOS/Android/Web; kiosk = tablet mode. Backend as a module
   of `backend-php-01`; UI from `cp-testt1-09`.
4. Public store release; hundreds to a few thousand families; monetization kept open
   (conditional CON block).
5. Multi-family membership; separated households = two families + ChildLink.
6. AI server-side via backend against an EU-hosted, swappable provider.
7. Two-way calendar sync is mandatory (Phase 2 core).
8. Full offline-first on all platforms including web.
9. Tiered conflict model (auto-merge trivial, visible resolution for critical fields).
10. Health = opt-in, disableable module with separate Art. 9 consent.
11. Adult-targeted store positioning with kids-category guardrails.
12. External sources via generic ingestion only; no portal connectors, no write-back.
13. Recovery: family approval + one-time recovery code + magic-link fallback if email
    on file.
14. Per-family inbound email address: binding, Phase 3.
15. Learning features: core contract feature, on by default, per-family off-switch
    that deletes learned patterns; children excluded entirely.
16. Periphery (voice assistants, wearables, geofenced reminders, print fallback):
    Phase 3; voice/wearable/geofence non-binding (OPEN-02); print binding in Phase 3.
17. Neutral working title; naming open.
18. UI languages: German + English from launch (§2.4).
19. Guest links: default 7 days, maximum 90; no non-expiring links (FR-108).
20. Kiosk person disambiguation only where identity matters (FR-116).
21. Second factor: device biometrics with app-PIN fallback (FR-117).
22. Child-task stars purely symbolic; meaning negotiated outside the app (FR-323).
23. No default quiet hours — quiet hours are opt-in (FR-1304).
24. Notification budget default 5/day; protocol reminders exempt (FR-1309).
25. Retention: voice audio deleted after transcription; histories and rhythm raw data
    5 years (OBL-07).

## 20. Success Criteria

- **SC-001** A second adult can join the family from QR scan to a usable app in under
  2 minutes, without entering an email address or creating a password.
- **SC-002** Zero forced re-authentications over 90 days of normal use per device.
- **SC-003** Adding an item to the shopping list (voice or text) takes ≤ 5 seconds
  from intent to done — not slower than the note on the fridge (P-04).
- **SC-004** Confirming a week plan updates the shopping list automatically in < 1 s
  locally; removing a planned recipe adjusts merged quantities without user action.
- **SC-005** The full weekly loop (plan → list → shop → cook) is executable with the
  network disabled the entire time; reconnecting syncs everything without loss and
  without silent overwrites.
- **SC-006** After 8 weeks of normal use, at least 70 % of regularly bought staples
  appear under "Probably due" *before* a human reports them empty (measured against
  empty reports).
- **SC-007** A protocol acknowledgement is visible on all online family devices within
  2 seconds; the double-dose scenario (both parents give medicine) is prevented in
  every online case and surfaced visibly in every offline-merge case.
- **SC-008** The daily push volume per person never exceeds the configured budget;
  quiet hours are never violated by non-wake-flagged notifications.
- **SC-009** No critical field (event time, acknowledgement, ownership) is ever
  silently overwritten — every concurrent divergence produces a visible resolution.
- **SC-010** External calendar round-trip (app → Google → app) completes without
  duplicates and within 5 minutes.
- **SC-011** Every recurring responsibility in the deck has a named owner; the
  distribution overview shows an empty "anonymous pool" (P-02).
- **SC-012** The success test of §1.1, operationalized: in a pilot family after two
  weeks, the weekly check-in question "did you have to keep the list in your head this
  week?" is answered "no" by the primary organizer.

## 21. Assumptions & Open Decisions

**Assumptions**
- The backend platform (`backend-php-01`) provides auth, push, realtime, storage, and
  EU hosting as specified in its own SPEC.md; this product adds a domain module there.
- The UI library (`cp-testt1-09`) covers the component needs; genuinely new components
  follow that repo's spec-kit process.
- Families are assumed to be German-market first (GDPR, German school system
  vocabulary in templates); UI ships German + English (§2.4).
- The staple-rhythm mechanism needs no historical seed data; it self-trains (FR-741).

**Open decisions**

All content decisions are resolved (§19). Two items are deliberately parked, not
blocking:

- **OPEN-02** Periphery prioritization (voice assistants, wearables, geofenced
  reminders) was explicitly left without preference — parked as Phase 3 non-binding;
  revisit at Phase 3 planning.
- **OPEN-03** Working title / final product name.

---

## Appendix A — Traceability: catalog → spec

| Catalog section | Spec location |
|---|---|
| 0.1 The core | §1.1 |
| 0.2 Admission criterion | §1.2 |
| 0.3 Non-goals | §1.3 |
| 1 People & structure | §4.1 (FR-101…111) |
| 1.1 Onboarding & authentication | §4.2–4.6 (FR-112…130) |
| 2 Calendar & appointments | §5 (FR-201…221) |
| 3 Tasks & responsibility | §6 (FR-301…325) |
| 4 Mental load & fairness | §7 (FR-401…411) |
| Food-loop ownership preamble | §8 intro; FR-615, FR-608, FR-720, FR-744 |
| 5.1 Recipe capture & import | §8.1 (FR-501…511) |
| 5.2 Recipe structure & organization | §8.2 (FR-512…526) |
| 5.3 Cooking | §8.3 (FR-527…536) |
| 6.1 Meal-plan planning | §9.1 (FR-601…615) |
| 6.2 Decision relief | §9.2 (FR-616…622) |
| 7.1 Shopping list | §10.1 (FR-701…729, FR-744) |
| 7.2 Staples without inventory | §10.2 (FR-730…743) |
| 7.3 Known weaknesses of existing apps | Informative input; addressed by FR-730/739/741 (pantry burden), FR-714/715 (detail vs. speed), FR-501+714 (recipes↔list), P-05/SC-004 (plan→list propagation) |
| 8 External sources | §11 (FR-801…819) |
| 9 Health & prevention | §12.1 (FR-901…912) |
| 9.1 Treatment & measurement protocols | §12.2 (FR-913…925) |
| 10 Knowledge, documents & collections | §13 (FR-1001…1014) |
| 11 Capture & automation | §14 (FR-1101…1118) |
| 12 Views, output & devices | §15.1 (FR-1201…1213) |
| 12.1 Sync, offline, conflicts | §15.2 (FR-1214…1219) |
| 13 Notifications & reminders | §16 (FR-1301…1311) |
| 14.1 Legal classification | §17.1 |
| 14.2 In-app legal functions | §17.2 (FR-1401…1421) |
| 14.3 Duties outside the app | §17.3 (OBL-01…08) |
| 14.4 Store hurdles | §17.4 (STO-01…06); monetization → §17.5 (CON) |
| 14.5 Risk reduction via architecture | §17.6 (ARC-01…07); AI → §16A |
| 15 Cross-cutting principles | §1.4 (P-01…P-09) |
