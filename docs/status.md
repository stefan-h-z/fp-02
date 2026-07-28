# Implementation status

Position of every work package in [`PLAN.md`](../PLAN.md) §6, as of 2026-07-28.

Legend: **done** — implemented and covered by tests that run in CI ·
**partial** — the logic exists and is tested, a named part is missing ·
**open** — not started · **external** — cannot be completed from a code
repository (store submission, live provider accounts).

422 tests across 20 files; `pnpm check-types` and `pnpm lint` are hard-zero.

The sync core has been through an adversarial review that reproduced sixteen
defects with failing tests — three of them losing data — all since fixed and
pinned by regressions in `packages/sync/test/robustness.test.ts`. Replica
convergence itself survived the attack: the property tests' central claim held.

## Phase 0 — Foundation

| WP | Status | Where |
|---|---|---|
| 0.1 Repo bootstrap | done | workspace, CI gates, package layout |
| 0.2 UI-kit publishing | partial | publish workflow added in `cp-testt1-09/.github/workflows/publish.yml`; the packages have not been published to GitHub Packages yet (needs a tag push and a token) |
| 0.3 Backend module skeleton | see `backend-php-01` | delivered in that repository |
| 0.4 Domain core | done | `packages/domain`: ids, HLC, operations, field tiers, reducer, state |
| 0.5 Sync engine | done | `packages/sync`: protocol, client, reference server |
| 0.6 Conflict tiers | done | tier registry, conflict records, resolution; 5 property tests over randomized interleavings |
| 0.7 Storage adapters | partial | `StateStore` seam, in-memory and SQL implementations with 22 equivalence tests, better-sqlite3 driver exercised in CI. The expo-sqlite and wa-sqlite/OPFS drivers are written against structural interfaces and are unexercised — they need a device and a browser |
| 0.8 Auth & family lifecycle | partial | client side in `packages/api/src/auth.ts` (create, invite, redeem, recovery code, device revocation, guest links with the 7/90-day bounds); the endpoints live in the backend module |
| 0.9 Push plumbing | open (backend) | delivery is platform work; `packages/domain/src/notifications.ts` decides what should be sent |
| 0.10 Legal baseline | done | `packages/domain/src/compliance.ts`: access and portability bundles, erasure planning, consent gating, learning gates, retention cutoff |
| 0.11 Phase-0 exit test | done | `e2e/acceptance.test.ts` — three devices, offline, lossless sync, snapshot bootstrap |

## Phase 1 — Food loop

| WP | Status | Where |
|---|---|---|
| 1.1 Shopping list core | done | `shopping.ts`: one list per domain, store as a multi-valued item attribute, runtime-switchable grouping, global check-off, wishes, in-store questions |
| 1.2 Staples engine | done | `rhythm.ts`: median interval, confidence, reported-beats-predicted, absence pausing, dismissal damping, bounded ranking |
| 1.3 AI gateway + voice inbox | partial | `inbox.ts` parses multi-item spoken sentences in German and English and routes anything unclear to the inbox; the provider call itself is server-side (SPEC AI-01) and belongs to the backend |
| 1.4 Recipes: structure & cooking | partial | ingredients, unit normalization, scaling, ratings and refusals are modelled and used by the planner and suggester; cook mode is a screen |
| 1.5 Recipes: import pipeline | open (backend) | scraping and extraction are server-side per AI-01 |
| 1.6 Meal plan | done | `plan.ts` + `commands.ts`: who eats, who cooks, non-recipe entries, and needs derived rather than stored |
| 1.7 Decision relief | done | `suggest.ts`: explainable scoring, re-roll, emergency dishes, plan adherence |
| 1.8 Notifications v1 | done | `notifications.ts`: budget with bundling, protocol exemption, opt-in quiet hours, role routing, owner escalation |
| 1.9 Kiosk UX, widgets, my-day | partial | `selectors.ts` decides what each surface shows and the kiosk identity rule is tested; the today screen renders it, widgets do not exist |
| 1.10 Onboarding v1 | partial | the flow's decisions (area enablement, recovery code, invite carrying name and role) exist in `api` and `i18n`; the screens do not |
| 1.11 Store prep, closed test | external | Play closed testing with real testers over 14 days |
| 1.12 Phase-1 exit test | done | `e2e/acceptance.test.ts` — the whole weekly loop offline with two people ticking off at once |

## Phase 2 — Coordination

| WP | Status | Where |
|---|---|---|
| 2.1 Calendar core | done | `calendar.ts`: recurrence with per-instance exceptions, responsibility fields, travel buffers |
| 2.2 Google + Microsoft two-way sync | open (backend) | connector workers; the conflict semantics they must respect are tested here |
| 2.3 CalDAV/iCloud + ICS | open (backend) | same |
| 2.4 Calendar intelligence | done | conflict detection including travel, care-gap detection, free-slot search, lead-time preparation |
| 2.5 Tasks core | done | `tasks.ts`: both recurrence modes, absence-aware rotation, delegation requiring acceptance, lead stages, blockers, owner escalation, symbolic stars |
| 2.6 Mental load deck | done | `mentalload.ts`: distribution including planning work, unassigned cards, load spikes, meeting agenda, polls — and no score anywhere |
| 2.7 Routines & kids views | partial | age-appropriate view selection is a screen concern; the underlying task and approval model is done |
| 2.8 Global search | partial | document search is implemented; search across every entity type needs the SQLite FTS index |
| 2.9 Phase-2 exit test | partial | the calendar conflict scenario is in the acceptance suite; the external-mirror scenario needs a connector |

## Phase 3 — Periphery and ingestion

| WP | Status | Where |
|---|---|---|
| 3.1 Ingestion pipeline | partial | `inbox.ts` triage, rules and intent extraction are done; capture transports and AI extraction are backend |
| 3.2 Family email address | open (backend) | inbound mail infrastructure |
| 3.3 External-source templates | open | seed content rather than logic |
| 3.4 Documents & knowledge | done | `documents.ts`: expiry and notice deadlines with real lead times, full-text search, contacts, emergency binder |
| 3.5 Health module + protocols | done | `protocols.ts` + consent gating in `compliance.ts`; both double-dose scenarios are in the acceptance suite |
| 3.6 Collections | done | `documents.ts`: no due dates, gift entries hidden from their recipient, outing filtering |
| 3.7 Backup/restore, paper output | partial | the emergency binder is built; rendering and file I/O are open |
| 3.8 Compliance completion | partial | the in-app rights are implemented and tested; the ROPA and DPIA documents are writing, not code |
| 3.9 Store launch | external | DSA declaration, support URL, health-category clarification |
| 3.10 Periphery | parked | SPEC OPEN-02 — deliberately not started |
| 3.11 Phase-3 exit test | partial | the protocol cycle is covered; the ingestion and print scenarios need the missing transports |

## The two structural gaps

**Screens.** Five screens exist — today, shopping, week plan, protocol and
conflict resolution — bound to the tested command and selector layer and
typechecked against the real prop types of `@cp/ui` (three API mismatches
surfaced that way and were fixed). The Expo shell is wired and
`pnpm --filter @fam/app export:web` completes, so the whole chain bundles. What
is still missing: the screens are not render-tested, the shell opens an
in-memory store rather than the platform SQLite driver, and there is no join
flow yet, so the client starts unauthenticated and local-only. The remaining
screens follow the same shape: read a selector, render it, call a command.

Two consequences worth stating. The design-system packages are currently
declared as a `link:` to a checkout of `cp-testt1-09` beside this repository,
which installs locally but not in CI — the link must be replaced by the
published `@cp/ui` and `@cp/tokens` versions once WP-0.2's release workflow has
run. And the logic tests deliberately import the modules they test rather than
the app's barrel, because pulling React Native into a Node test run is both slow
and pointless.

**The backend.** The family module for the Laravel platform lives in
`backend-php-01`. Its dependencies could not be installed in this environment (the
sandbox's GitHub token is scoped to the session's repositories, so Composer cannot
fetch vendor archives), which means the PHP code there has not been executed.
`packages/sync/src/reference-server.ts` is the behaviour it must reproduce, and
the acceptance suite runs the real client against it — so the contract is pinned
even though the implementation of it is not yet exercised.
