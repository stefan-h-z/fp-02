# Implementation status

Position of every work package in [`PLAN.md`](../PLAN.md) §6.

Legend: **done** — implemented and covered by tests that run in CI ·
**partial** — the logic exists and is tested, a named part is missing ·
**backend** — implemented in `backend-php-01`, not executable here (see below) ·
**platform** — needs a native capability or a store/provider account.

`pnpm check-types` and `pnpm lint` are hard-zero; `expo export --platform web`
bundles the app.

The sync core has been through an adversarial review that reproduced sixteen
defects with failing tests — three of them losing data — all since fixed and
pinned by regressions in `packages/sync/test/robustness.test.ts`. Replica
convergence itself survived the attack.

## Phase 0 — Foundation

| WP | Status | Where |
|---|---|---|
| 0.1 Repo bootstrap | done | workspace, CI gates, package layout |
| 0.2 UI-kit publishing | partial | publish workflow committed in `cp-testt1-09`; the packages have not been pushed to GitHub Packages yet, which is a tag push and a token (`docs/operations.md`) |
| 0.3 Backend module skeleton | backend | `app-modules/family` |
| 0.4 Domain core | done | ids, HLC, operations, field tiers, reducer, state |
| 0.5 Sync engine | done | protocol, client, reference server |
| 0.6 Conflict tiers | done | tier registry, conflict records, resolution that travels to every device; 5 property tests over randomized interleavings |
| 0.7 Storage adapters | partial | `StateStore` seam, in-memory and SQL implementations with 22 equivalence tests; the app opens the native SQLite driver on iOS/Android. wa-sqlite on OPFS needs the single-writer SharedWorker (PLAN §3.3), so the web build still runs in memory rather than pretending to persist |
| 0.8 Auth & family lifecycle | done | join by invitation, create a family, redeem a recovery code; the session persists in the local database and the shell boots straight into the family. Endpoints are in the backend module and unexercised |
| 0.9 Push plumbing | backend | `notifications.ts` decides what to send; delivery is the platform's |
| 0.10 Legal baseline | done | access and portability bundles, erasure planning, consent gating, learning gates, retention |
| 0.11 Phase-0 exit test | done | three devices, offline, lossless sync, snapshot bootstrap |

## Phase 1 — Food loop

| WP | Status | Where |
|---|---|---|
| 1.1 Shopping list core | done | one list per domain, store as a multi-valued item attribute, runtime grouping, global check-off, wishes, in-store questions |
| 1.2 Staples engine | done | median rhythm, confidence, reported-beats-predicted, absence windows, dismissal damping, bounded ranking |
| 1.3 AI gateway + voice inbox | partial | multi-item voice parsing in both languages and inbox triage are done and tested; the provider call is server-side by design (AI-01) |
| 1.4 Recipes: structure & cooking | done | structured ingredients, unit normalization, scaling, per-person ratings, cook mode with parallel timers. Display-stays-on is a native capability (`expo-keep-awake`), left as a named TODO |
| 1.5 Recipes: import pipeline | done | extraction from embedded structured data and ingredient parsing incl. fractions, ranges, German shorthand; duplicate detection. Fetching is backend |
| 1.6 Meal plan | done | who eats, who cooks, non-recipe entries, needs derived rather than stored |
| 1.7 Decision relief | done | explainable scoring, re-roll, emergency dishes, plan adherence |
| 1.8 Notifications v1 | done | budget with bundling, protocol exemption, opt-in quiet hours, role routing, owner escalation |
| 1.9 Kiosk UX, my-day, widgets | partial | kiosk identity rule, my-day and the focus view are built and tested; home-screen widgets need a native extension (platform) |
| 1.10 Onboarding v1 | done | two questions, area-first entry, recovery-code step. The code itself arrives from the server, which needs WP-0.8's join flow |
| 1.11 Store prep, closed test | platform | Play closed testing with real testers over 14 days |
| 1.12 Phase-1 exit test | done | the whole weekly loop offline with two people ticking off at once |

## Phase 2 — Coordination

| WP | Status | Where |
|---|---|---|
| 2.1 Calendar core | done | recurrence with per-instance exceptions, responsibility fields, travel buffers |
| 2.2 Google + Microsoft two-way sync | partial | iCalendar in and out, and the reconciliation that decides what a connector does — echo suppression, both-sides-moved raised for a human, external deletion propagating inward — are built and tested here (SC-010 in the acceptance suite). OAuth and the provider APIs are backend |
| 2.3 CalDAV/iCloud + ICS | partial | same; the published read-only feed is implemented |
| 2.4 Calendar intelligence | done | conflict detection including travel, care gaps, free slots, lead-time preparation |
| 2.5 Tasks core | done | both recurrence modes, absence-aware rotation, delegation requiring acceptance, lead stages, blockers, owner escalation, symbolic stars |
| 2.6 Mental load deck | done | distribution including planning work, unassigned cards, load spikes, meeting agenda, polls — no score anywhere |
| 2.7 Routines & kids views | done | icon routine a child ticks off themselves on the shared device, visual timer, approval gate kept |
| 2.8 Global search | done | one field across events, tasks, recipes, documents, contacts, collections and people, with the gift-visibility rule applied inside |
| 2.9 Phase-2 exit test | done | round trip without duplicates, plus a search reaching three areas at once |

## Phase 3 — Periphery and ingestion

| WP | Status | Where |
|---|---|---|
| 3.1 Ingestion pipeline | partial | triage, rules and intent extraction are done; capture transports and the AI call are backend |
| 3.2 Family email address | backend | inbound mail infrastructure |
| 3.3 External-source templates | done | product groups, task library, age-banded suggestions, task packs, packing and shopping templates |
| 3.4 Documents & knowledge | done | expiry and notice deadlines with real lead times, full-text search, contacts, emergency binder |
| 3.5 Health module + protocols | done | protocol engine and consent gating; both double-dose scenarios in the acceptance suite |
| 3.6 Collections | done | no due dates, gifts hidden from their recipient, outing filtering |
| 3.7 Backup/restore, paper output | done | versioned backup with a real restore and an integrity summary shown first; printable emergency, week and shopping sheets |
| 3.8 Compliance completion | done | in-app rights implemented and tested; the record of processing, impact assessment and deletion concept drafted in `docs/legal/` |
| 3.9 Store launch | platform | DSA declaration, support URL, health-category clarification |
| 3.10 Periphery | parked | SPEC OPEN-02 — deliberately not started |
| 3.11 Phase-3 exit test | partial | the protocol cycle and the printed sheet are covered; ingestion end-to-end needs the transports |

## What genuinely remains

**The backend has never run.** `composer install` cannot fetch package archives
in this environment, so every PHP file is unexecuted and its Pest tests will run
for the first time in CI. `packages/sync/src/reference-server.ts` is the
behaviour the sync half must reproduce, and the acceptance suite runs the real
client against it — the contract is pinned even though the implementation of it
is not yet exercised.

**Three transports are backend work by design**, not omissions: the AI provider
call (SPEC AI-01 puts it server-side), the calendar providers' OAuth APIs, and
inbound mail. In each case the *decisions* those transports must respect are
implemented and tested here.

**Two things need a native capability**: home-screen widgets and keeping the
display awake in cook mode. Both are named TODOs rather than stubs.

**The screens are not render-tested.** Attempted and abandoned deliberately:
rendering React Native components under Vitest needs React Native's Flow syntax
put through a Babel transform, which an alias to `react-native-web` does not
achieve — it is a jest-preset-shaped problem, not a config line. The screens do
typecheck against the design system's real prop types, and `expo export` proves
they bundle. A proper render harness is a follow-up worth doing.

**The web build does not persist yet.** wa-sqlite on OPFS needs a SharedWorker
to enforce a single writer across tabs; until that is wired the browser runs in
memory, which is stated in `apps/app/src/storage.ts` rather than hidden.

**The design system is consumed through a link** to a checkout beside this
repository, which installs locally but not in CI — hence the split CI, whose
`app` job is non-blocking until the packages are published.

**Two routine glyphs are stand-ins.** The app registers the icons it needs
through the design system's own `registerIcons` extension point
(`apps/app/src/icons.ts`), so nothing renders a placeholder — but lucide has no
toothbrush or hairbrush, and a routine icon a four-year-old cannot recognise is
worse than a generic one. Those two need real artwork before the kids' view
ships (FR-1206).
