# Family App — Implementation Plan

**Status:** v1.0 · 2026-07-28
**Repository:** `stefan-h-z/fp-02`
**Basis:** [`SPEC.md`](SPEC.md) — all FR/SC/phase references below point there.

This plan turns the specification into an executable engineering program: technology
stack, repository layout, the sync architecture (the single biggest build), backend
module design, cross-cutting engineering practices, and a full work-package breakdown
for all four phases.

---

## 1. Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| Client framework | **React Native + Expo**, one codebase for iOS, Android, Web (`react-native-web`) | SPEC §2.2 single-codebase decision; UI kit is RN+Web already |
| Routing | Expo Router | File-based, works across native and web |
| UI components | **`@cp/ui` + `@cp/tokens`** from `cp-testt1-09`, consumed as versioned packages via GitHub Packages | Decision log; §2.1. New *primitive* components go through that repo's spec-kit process; app-level composites live here |
| Client state/persistence | **SQLite everywhere**: `expo-sqlite` (iOS/Android), `wa-sqlite` on OPFS (web) behind one storage interface | Offline-first on all platforms (FR-1214); relational queries for lists/calendar |
| Sync | **Custom op-log sync engine** (own TypeScript packages, see §3) | Only design that delivers the spec's tiered conflict model (FR-1215) exactly, stays on MySQL/Laravel, no third-party sync service |
| Realtime wake-up | Laravel **Reverb** (Pusher protocol), channel per family | Already in the backend platform |
| Backend | New app module **`app-modules/family`** in `backend-php-01` (Laravel 12, PHP 8.4, MySQL 8 / SQLite dev, Redis, Horizon) | SPEC §2.1; module pattern proven by `app-modules/demo` |
| Auth | Platform OAuth2 (Passport): magic link / OTP first start → long-lived device token; no passwords | FR-112…114; platform already ships magic-link + OTP grants |
| Push | FCM + APNs via platform notification layer | Platform capability |
| AI | Backend **AI gateway** with provider interface; **primary candidate: Mistral AI** (EU) — chat/vision for extraction, Voxtral for speech | AI-01/02; EU company, no third-country transfer issue |
| Calendar sync | Server-side connector workers: Google Calendar API, Microsoft Graph, CalDAV (incl. iCloud) | FR-207 two-way sync is mandatory |
| File storage | Platform S3-compatible storage (photos, documents, protocol attachments) | Platform capability; SEC-04 encryption at rest |
| Monorepo tooling | pnpm workspaces + Turborepo (mirrors `cp-testt1-09` conventions) | Team consistency |
| Testing | Vitest (TS packages), Pest (backend), Playwright (web e2e), Maestro (native e2e), fast-check (property tests for sync) | §5.3 |
| CI | GitHub Actions, hard-zero tsc/eslint baselines (as in `cp-testt1-09`), backend pipeline already exists | §5.4 |

**Version alignment constraint:** `@cp/ui` currently targets React 18.3 /
`react-native-web` 0.19 / Tamagui 1.118. The Expo SDK for the app must be chosen to
match the UI kit's React/RN line (check `cp-testt1-09/apps/mobile-storybook` as the
reference host); upgrading React is a coordinated change across both repos (WP-0.2).

---

## 2. Repositories & Code Layout

Work spans three repos; per-repo development happens on the designated feature
branches.

### 2.1 `fp-02` (this repo) — the product

```
apps/
  app/                 Expo app: iOS + Android + Web + kiosk mode (one target)
    app/               expo-router routes (feature-sliced: food/, calendar/, ...)
    kiosk/             kiosk operating mode (household session, person prompt)
packages/
  domain/              Pure TS: entity schemas (zod), operation definitions,
                       reducers (op → state), validation, staples rhythm engine,
                       suggestion scoring — JSX-free, platform-free, fully unit-tested
  sync/                Op-log engine: outbox, HLC clock, push/pull protocol client,
                       conflict detection/resolution objects, snapshot bootstrap
  storage/             Storage interface + adapters: expo-sqlite, wa-sqlite/OPFS,
                       in-memory (tests); schema migrations for the local DB
  api/                 Typed REST client for the family module (OpenAPI-generated),
                       auth/device-token handling, Reverb subscription helper
  i18n/                de/en message catalogs, locale-aware date/unit formatting
  config/              Shared tsconfig/eslint presets (mirroring @cp conventions)
e2e/                   Playwright (web) + Maestro (native) suites
SPEC.md  PLAN.md
```

Dependency rule: `apps/app → {api, sync, storage, domain, i18n, @cp/ui}`;
`sync → {domain, storage}`; `domain` depends on nothing.

### 2.2 `backend-php-01` — module `app-modules/family`

Follows the `demo` module pattern (`src/{Models,Http,…}`, `routes/`,
`database/migrations/`, `tests/`):

```
app-modules/family/
  src/
    Models/            Eloquent read models (materialized state) + FamilyOp
    Http/              Controllers: sync, auth/devices, files, exports, guest links
    Sync/              Op validation, authorization, materializer, conflict detector,
                       per-family sequence allocation
    AI/                Gateway interface + MistralProvider + job pipeline
                       (transcribe, extract, parse, suggest)
    Calendar/          Connector workers (Google, Graph, CalDAV), mapping tables,
                       loop-safety (external UID + etag)
    Notifications/     Budget/digest scheduler, role addressing, protocol pushes
    Compliance/        Consent records, export (Art. 15/20), erasure/anonymization,
                       retention jobs (OBL-07)
  routes/  database/migrations/  tests/
```

### 2.3 `cp-testt1-09` — publishing only

Add a release workflow that builds and publishes `@cp/ui`, `@cp/tokens`,
`@cp/typescript-config`, `@cp/eslint-config` to **GitHub Packages** (scoped registry,
version tags). No component changes in this plan; new primitives the app needs are
separate spec-kit features in that repo (per its constitution).

---

## 3. Sync Architecture (core build)

### 3.1 Model

- Every mutation is an **operation**: `{opId (UUIDv7), deviceId, familyId, entityType,
  entityId, kind, payload, hlc, baseVersions?, schemaVersion}`. `hlc` is a hybrid
  logical clock timestamp; `baseVersions` carries the per-field versions the client
  saw for Tier-2 fields.
- **Client:** SQLite holds the materialized state + an **outbox** of unpushed ops.
  Ops apply optimistically through the shared reducers in `packages/domain` (same
  code that the server-side materializer mirrors). Drafts survive restarts (FR-1217).
- **Server:** `family_ops` table with a **per-family monotonically increasing `seq`**.
  Push validates + authorizes each op, assigns `seq`, materializes into relational
  read models (used by exports, digests, calendar connectors, web-independent
  consumers). Pull streams ops after a cursor.
- **Protocol:**
  - `POST /api/v1/sync/push` `{deviceId, ops[]}` → `{applied[], conflicts[], rejected[]}` — idempotent by `opId`.
  - `GET /api/v1/sync/pull?cursor=<seq>` → `{ops[], nextCursor}`.
  - `GET /api/v1/sync/snapshot` → materialized state + cursor (new-device bootstrap;
    avoids replaying years of ops).
  - Reverb event on the family channel says "new seq available" — a wake-up only;
    the pull is the source of truth.

### 3.2 Conflict tiers (FR-1215)

- **Tier 1 — commutative by construction:** check-offs (idempotent set-flag), adds,
  comment appends, empty reports. These ops never conflict; concurrent duplicates
  collapse (FR-1219).
- **Tier 2 — versioned fields:** event start/end, protocol ack/skip, task ownership,
  document edits. Each field carries a version; a push whose `baseVersions` are stale
  against an actually *divergent* value is **not applied** — the server stores a
  `Conflict` object (both sides + authors + timestamps) and notifies. The client
  renders the resolution UI (§15.2); the resolution is itself an op referencing the
  conflict. Same-value concurrent writes (both parents ack the same dose) resolve
  automatically: earlier `hlc` wins, later lands in history flagged (SPEC §12.2
  acceptance 2).
- **History (FR-1218)** is derived from the op-log per object — no separate write path.

### 3.3 Web specifics

`wa-sqlite` on OPFS; a SharedWorker owns the single writer (multiple tabs); a service
worker provides the offline app shell. This is the least mature corner of the stack —
de-risked by an early spike (WP-0.7) with a fallback decision point (IndexedDB-backed
absurd-sql style storage) documented there.

### 3.4 Schema evolution

Ops carry `schemaVersion`; local DB has migrations; the server accepts N−1 clients
(additive-only op payload changes between adjacent versions; breaking changes require
a forced-update gate — used sparingly).

---

## 4. Backend Module Design

- **Auth & devices (FR-112…123):** first start = platform magic link/OTP → issue a
  long-lived device token bound to a `Device` row (revocable, FR-122). Family
  creation mints the hashed **recovery code** (FR-120). QR join = signed short-lived
  invite token carrying name + role (FR-118). Kiosk devices get a household-scoped
  token; person disambiguation is client-side per FR-116. Guest links (FR-108) =
  scoped signed URLs with expiry, rendered by the web client without auth.
- **AI gateway (AI-01…05):** queue-based jobs (`Horizon`): `TranscribeVoice` (audio
  deleted after transcription per OBL-07), `ExtractFromImage/Pdf`, `ParseItems`,
  `ParseRecipe`, `SuggestWeek`. Provider interface with a `MistralProvider` first
  implementation; provider output always lands as *suggestions/inbox items*, never as
  direct state (AI-05). Week suggestion is hybrid: deterministic candidate scoring in
  `packages/domain` (rotation, season, effort, calendar fit — explainable, FR-619),
  LLM only for parsing/labeling — keeps suggestions cheap, fast, and justifiable.
- **Calendar connectors (FR-207/208):** per-account connector rows with OAuth tokens;
  Google via watch channels + sync tokens, Microsoft via Graph subscriptions + delta,
  CalDAV/iCloud via ctag/sync-token polling (app-specific passwords). External UID +
  etag mapping guarantees loop-safety and dedup (SC-010); external edits enter the
  op-log as server-originated ops; divergence on critical fields becomes a Tier-2
  conflict.
- **Notifications (FR-1301…1311):** the module computes; the platform delivers
  (FCM/APNs). Scheduler enforces the per-person budget (default 5, protocol
  reminders exempt) and opt-in quiet hours with wake-flag override; overflow goes to
  the morning/evening digest.
- **Compliance (SPEC §17):** consent records with policy version; export bundles
  (JSON + human-readable); erasure = authorship anonymization + personal-data
  deletion per FR-1417a; retention jobs (5-year op/rhythm horizon, OBL-07); breach
  broadcast channel (SEC-06). Health-module data lives in separately keyed tables so
  module-off truly means "no health data exists" (FR-901).

---

## 5. Cross-Cutting Engineering

### 5.1 i18n
English source strings, German catalog maintained with equal care; template content
(standard tasks, categories, meal types) localizes too (SPEC §2.4). Enforced by a CI
check: no hard-coded user-facing strings.

### 5.2 Feature areas
Per-family enabled areas (P-07 / FR-125) are a config flag evaluated client- and
server-side; the health module additionally gates on consent (FR-901).

### 5.3 Testing strategy
- **Property tests (fast-check)** on the sync engine: op commutativity for Tier 1,
  convergence of N clients under random op interleaving + partitions, idempotent
  replay. This is the highest-value test investment in the project.
- **Simulation harness:** 3 virtual clients + server in-process, scripted scenarios
  from the SPEC acceptance flows (double-ack, offline shopping, plan→list).
- Unit tests for `domain` (rhythm engine calibration FR-737/738, merge rules FR-714).
- Backend: Pest feature tests per endpoint + connector contract tests with recorded
  fixtures.
- E2E: Playwright (web, incl. offline via network interception), Maestro (native
  happy paths). E2E covers each phase's exit criterion.
- SC-001…012 each get an executable check or a scripted manual protocol, tracked in
  `e2e/success-criteria.md`.

### 5.4 CI/CD
`fp-02`: GitHub Actions — install, hard-zero `tsc --noEmit` + eslint, Vitest,
Playwright (web build), EAS build on tags. `backend-php-01`: existing pipeline gains
the module's Pest suite. `cp-testt1-09`: new publish workflow (§2.3).

---

## 6. Work Packages — all phases

Sizing: **S** ≤ 2 days · **M** ≤ 1 week · **L** ≤ 3 weeks. Dependencies in brackets.
Each WP's acceptance is the referenced FRs plus listed extras.

### Phase 0 — Foundation

| WP | Content | Size | Deps |
|---|---|---|---|
| **0.1 Repo bootstrap** | pnpm/turbo workspace, Expo app skeleton (iOS/Android/Web boot), `config`, `i18n` scaffold w/ de+en, CI hard-zero gates | M | — |
| **0.2 UI-kit publishing** | Release workflow in `cp-testt1-09` → GitHub Packages; consume `@cp/ui`/`@cp/tokens` in the app; version-alignment check (React/RN line) | S | 0.1 |
| **0.3 Backend module skeleton** | `app-modules/family` per demo pattern: routes, base migrations, Pest setup, module registration | S | — |
| **0.4 Domain core** | Entity schemas + op definitions + reducers for Phase-0/1 entities (Family, Membership, Device, list/recipe/plan cores); zod validation | M | 0.1 |
| **0.5 Sync engine v1** | Outbox, HLC, push/pull/snapshot protocol both sides, per-family seq, materializer, Reverb wake; in-memory + expo-sqlite adapters | **L** | 0.3, 0.4 |
| **0.6 Conflict tiers** | Tier-2 field versioning, Conflict objects, resolution ops, per-object history; property-test suite + simulation harness | **L** | 0.5 |
| **0.7 Web storage spike → adapter** | wa-sqlite/OPFS adapter, SharedWorker writer, service-worker shell; go/no-go on fallback documented | M | 0.5 |
| **0.8 Auth & family lifecycle** | Magic link/OTP → device token, family creation + recovery code, QR join w/ prefilled role, kiosk household session, remote sign-out, device list | **L** | 0.3, 0.5 |
| **0.9 Push plumbing** | FCM/APNs registration per device, test notification path, Reverb channel auth | S | 0.8 |
| **0.10 Legal baseline** | Privacy policy/imprint screens (versioned), consent records, in-app account deletion, export stub (FR-1401…1415 baseline) | M | 0.8 |
| **0.11 Phase-0 exit test** | Scripted: 2 adults + 1 child, 3 devices incl. kiosk, no password/email, offline edits, lossless sync, push received (SPEC §3 exit) | S | all |

### Phase 1 — Food loop

| WP | Content | Size | Deps |
|---|---|---|---|
| **1.1 Shopping list core** | Domain-list per FR-701…717: items, multi-store attribute, grouping switch, merge (FR-714), realtime check-off, templates, quick access | **L** | 0.6 |
| **1.2 Staples engine** | Rhythm learning (median, confidence), empty reports, calibration + self-healing, Reported/Probably-due sections, explain-on-demand (FR-729…743) — pure functions in `domain`, UI in app | **L** | 1.1 |
| **1.3 AI gateway + voice inbox** | Backend gateway + Mistral adapter; voice capture → transcribe → parse → inbox triage UI (FR-735, FR-1113…1115, AI-01…05); audio deletion (OBL-07) | **L** | 0.5, 0.9 |
| **1.4 Recipes: structure & cooking** | Recipe entity UI, structured ingredients, scaling, search incl. exclusions, ratings per member, cook mode + timers (FR-512…536 excl. voice control) | **L** | 0.6 |
| **1.5 Recipes: import pipeline** | URL scraper, photo/PDF extraction via gateway, paste, share target, dedup, ballast stripping (FR-501…511) | **L** | 1.3, 1.4 |
| **1.6 Meal plan** | Week plan, meal types, who-eats/who-cooks, non-recipe entries, leftovers, patterns/templates, planning owner, plan→list propagation (FR-601…615, SC-004) | **L** | 1.1, 1.4 |
| **1.7 Decision relief** | Deterministic week/day suggesters with reasons, re-roll, emergency list, learning hooks behind LRN switch (FR-616…622) | M | 1.2, 1.6 |
| **1.8 Notifications v1** | Budget (default 5), digests, per-object reminders, kiosk routing for device-less members (FR-1301…1311 core) | M | 0.9 |
| **1.9 Kiosk UX + widgets + my-day** | Kiosk person-prompt rules (FR-116), home widgets (list, today's meal), "what concerns me today" (FR-1204/1205) | M | 1.1, 1.6 |
| **1.10 Onboarding v1** | Two-question start, area-based progressive disclosure, prefill, list import (FR-124…127) | M | 1.1 |
| **1.11 Store prep + closed test** | Play closed test (STO-03: 12+ testers, 14 days), DSA declaration groundwork (STO-01), TestFlight; feedback loop | M | 1.1–1.10 |
| **1.12 Phase-1 exit test** | Full weekly loop offline incl. two-person store run (SPEC §3 exit, SC-003…006) | S | all |

### Phase 2 — Coordination

| WP | Content | Size | Deps |
|---|---|---|---|
| **2.1 Calendar core** | Events, recurrence + exceptions, sub-calendars, views, responsibility fields, comments/attachments, countdown (FR-201…206, 209, 217…221) | **L** | 0.6 |
| **2.2 Google + Microsoft two-way sync** | Connector framework, OAuth flows, watch/delta subscriptions, UID/etag mapping, loop-safety, Tier-2 divergence (FR-207, SC-010) | **L** | 2.1 |
| **2.3 CalDAV/iCloud sync + ICS in/out** | CalDAV polling connector, iCloud app-specific passwords, ICS subscribe + published feeds (FR-207/208) | **L** | 2.2 |
| **2.4 Calendar intelligence** | Conflict detection, travel buffer, care-gap detection, lead-time tasks, free-slot search, appointment requests, carpool rotation (FR-210…216) | **L** | 2.1, 2.5 |
| **2.5 Tasks core** | Owner model, DoD, recurrence both modes, rotation, subtasks, dependencies, delegation w/ accept, child approval + stars, blockers, long intervals (FR-301…325) | **L** | 0.6 |
| **2.6 Mental load deck** | Responsibility cards, two-adult negotiation onboarding, distribution overview, family meeting agenda, polls, load-spike warning (FR-401…411, FR-128) | **L** | 2.5 |
| **2.7 Routines & kids views** | Icon routines, visual timer, focus mode, symbol view, reduced views (FR-103, 1206, 1207, 1212) | M | 2.5 |
| **2.8 Global search** | Local SQLite FTS across all entities (FR-1213) | M | 2.1, 2.5 |
| **2.9 Phase-2 exit test** | External-calendar mirror scenario + fully-owned responsibility deck (SPEC §3 exit, SC-009…011) | S | all |

### Phase 3 — Periphery & ingestion

| WP | Content | Size | Deps |
|---|---|---|---|
| **3.1 Ingestion pipeline** | Photo/screenshot/share-target capture → AI extraction (date/place/person/deadline) → inbox → event/task/deadline creation; rule automation (FR-1101…1111, §11 flows) | **L** | 1.3 |
| **3.2 Family email address** | Inbound mail (provider inbound webhook, e.g. Postmark/SES inbound), per-family address, mail → ingestion pipeline (FR-1103) | M | 3.1 |
| **3.3 External-source templates** | A/B timetables, holiday/waste ICS presets, bring-along/exam backward planning, cancellation deadlines (FR-801…819) | M | 3.1, 2.4 |
| **3.4 Documents & knowledge** | Document storage + scan + categorization, expiry reminders, info bank, contacts, second-factor gate (biometrics/PIN) (FR-1001…1010, FR-117) | **L** | 0.10 |
| **3.5 Health module + protocols** | Opt-in consent flow, separately keyed storage, protocol engine (frequencies, ack/measurement, night rest, missed-dose rules), all-adults push, external delegation via guest link, auto-expiry + export (FR-901…925, SC-007) | **L** | 2.5, 0.9 |
| **3.6 Collections** | Gift ideas, wish lists (guest-viewable), outing ideas (FR-1011…1014) | M | 3.4 |
| **3.7 Backup & restore + paper output** | Automated backups, point-in-time restore, printable week/list, paper emergency output (FR-1116…1118, FR-727/1208) | M | 0.5 |
| **3.8 Compliance completion** | Full Art. 15/20 export, erasure flows incl. shared-data rules, retention jobs, DPIA + ROPA documents, breach broadcast (FR-1411…1421, OBL-01…08) | **L** | 3.4, 3.5 |
| **3.9 Store launch** | DSA trader declaration, support URL, Google health-category clarification (STO-05), kids-guardrail review (STO-06), production release | M | 3.8 |
| **3.10 Periphery (non-binding, OPEN-02)** | Geofenced reminders, voice-assistant query, wearables — pull in only after 3.9 by explicit decision | — | 3.9 |
| **3.11 Phase-3 exit test** | Parent-letter-photo → deadline task; protocol full cycle + export; emergency print (SPEC §3 exit, SC-007/012) | S | all |

**Critical path:** 0.4 → 0.5 → 0.6 → 1.1 → 1.2/1.6 → Phase-1 exit. Parallel tracks:
backend module (0.3/0.8) and UI-kit publishing (0.2) alongside sync; within Phase 1,
recipes (1.4/1.5) parallel to list/staples (1.1/1.2); within Phase 2, calendar track
(2.1–2.4) parallel to tasks track (2.5–2.7).

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Custom sync engine underestimated | Delays everything | It is *the* Phase-0 deliverable with property/simulation tests before any feature ships on it; scope strictly to the spec's two tiers, no generic CRDT ambitions |
| wa-sqlite/OPFS maturity (web offline) | Web offline-first at risk | Dedicated early spike (WP-0.7) with documented fallback; web can ship read-mostly offline first if needed — decision point, not drift |
| CalDAV/iCloud flakiness | FR-207 quality | Connector contract tests with recorded fixtures; iCloud last in sequence (2.3 after 2.2 learnings); surface sync health per account in settings |
| React/Expo version drift vs `@cp/ui` | Build breakage | Version-alignment check in CI (WP-0.2); upgrades are coordinated cross-repo changes |
| Mistral extraction quality (German handwriting, messy letters) | Ingestion UX | Provider interface makes A/B against a second provider cheap; everything AI lands in the inbox as a suggestion, so failures cost a swipe, not trust (AI-05) |
| Play closed-test logistics (STO-03) | Launch delay | Start recruiting the 12+ testers during Phase 1, not at its end (WP-1.11) |
| Solo-maintainer legal load (DPIA, ROPA) | Launch blocker | Templates drafted incrementally per phase in WP-3.8, not big-bang; professional review budgeted before 3.9 |

## 8. Definition of Done (per work package)

Code + tests green under hard-zero CI · relevant FR acceptance scenarios pass ·
strings localized de+en · no new console warnings · SPEC updated if a decision
changed (decisions log) · demo-able on all three platforms unless explicitly
platform-scoped.
