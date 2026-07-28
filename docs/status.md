# Implementation status

Position of every work package in [`PLAN.md`](../PLAN.md) §6.

**This tracks the plan, not the specification, and the two are not the same
thing.** A work package can be finished while requirements it was meant to serve
are still absent. [`traceability.md`](traceability.md) tracks the other axis —
all 363 numbered requirements in `SPEC.md` — and its headline is that 2 are
absent outright and 2 are half-built, both of the absent pair needing a service
this repository cannot provide. Read it before treating a row below as a
statement about the product.

Legend: **done** — implemented and covered by tests that run in CI ·
**partial** — the logic exists and is tested, a named part is missing ·
**backend** — implemented in `backend-php-01`, whose own suite now runs here ·
**platform** — needs a native capability or a store/provider account.

`pnpm check-types` and `pnpm lint` are hard-zero; `expo export --platform web`
bundles the app. Tests run in three layers: 852 under Vitest, 45 render tests
under jest-expo (`pnpm --filter @fam/app test:render`), and 18 steps in real
Chromium against the real Laravel backend (`pnpm --filter @fam/app test:e2e`).

The sync core has been through an adversarial review that reproduced sixteen
defects with failing tests — three of them losing data — all since fixed and
pinned by regressions in `packages/sync/test/robustness.test.ts`. Replica
convergence itself survived the attack.

The render harness then found three more that no state assertion could reach,
because all three were about what a person *sees*: every icon silently rejected
at registration, local changes never repainting the screen, and two routine
glyph names that resolved to nothing. The pattern is worth naming — each failed
into a placeholder or a no-op rather than an error, which is exactly the class of
defect a green suite hides.

## Phase 0 — Foundation

| WP | Status | Where |
|---|---|---|
| 0.1 Repo bootstrap | done | workspace, CI gates, package layout |
| 0.2 UI-kit publishing | partial | publish workflow committed in `cp-testt1-09`; the packages have not been pushed to GitHub Packages yet, which is a tag push and a token (`docs/operations.md`) |
| 0.3 Backend module skeleton | backend | `app-modules/family` |
| 0.4 Domain core | done | ids, HLC, operations, field tiers, reducer, state |
| 0.5 Sync engine | done | protocol, client, reference server |
| 0.6 Conflict tiers | done | tier registry, conflict records, resolution that travels to every device; 5 property tests over randomized interleavings |
| 0.7 Storage adapters | done | `StateStore` seam with three implementations — in-memory, SQL and IndexedDB — run through one equivalence suite; phones open the native SQLite driver, the browser opens IndexedDB, and four further tests assert that a reload keeps entities, meta, history and the unsent outbox. The wa-sqlite/OPFS route is deliberately not the one shipped (PLAN §3.3 fallback; see below) |
| 0.8 Auth & family lifecycle | done | join by invitation, create a family, redeem a recovery code; the session persists in the local database and the shell boots straight into the family. Endpoints are in the backend module and unexercised |
| 0.9 Push plumbing | backend | `notifications.ts` decides what to send; `src/Notifications` in the module plans, budgets and delivers, scheduled every minute. Unexecuted |
| 0.10 Legal baseline | done | access and portability bundles, erasure planning, consent gating, learning gates, retention |
| 0.11 Phase-0 exit test | done | three devices, offline, lossless sync, snapshot bootstrap |

## Phase 1 — Food loop

| WP | Status | Where |
|---|---|---|
| 1.1 Shopping list core | done | one list per domain, store as a multi-valued item attribute, runtime grouping, global check-off, wishes, in-store questions |
| 1.2 Staples engine | done | median rhythm, confidence, reported-beats-predicted, absence windows, dismissal damping, bounded ranking |
| 1.3 AI gateway + voice inbox | partial | multi-item voice parsing in both languages and inbox triage are done and tested here; the provider call is server-side by design (AI-01) and now exists as `src/AI` — provider-agnostic, defaulting to a fake so a missing key degrades to "no AI". Unexecuted |
| 1.4 Recipes: structure & cooking | done | structured ingredients, unit normalization, scaling, per-person ratings, cook mode with parallel timers, and the display held awake for as long as cook mode is open (`expo-keep-awake`, FR-527) |
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
| 2.2 Google + Microsoft two-way sync | partial | iCalendar in and out, and the reconciliation that decides what a connector does — echo suppression, both-sides-moved raised for a human, external deletion propagating inward — are built and tested here (SC-010 in the acceptance suite). The OAuth flows and provider APIs now exist in `src/Calendar/Connectors`, polled every minute. Unexecuted, and live credentials are an ops step |
| 2.3 CalDAV/iCloud + ICS | partial | same; the CalDAV and ICS-subscription connectors are in the module and the published read-only feed (FR-208) is served from `routes/public.php`, the URL itself being the credential. Unexecuted |
| 2.4 Calendar intelligence | done | conflict detection including travel, care gaps, free slots, lead-time preparation |
| 2.5 Tasks core | done | both recurrence modes, absence-aware rotation, delegation requiring acceptance, lead stages, blockers, owner escalation, symbolic stars |
| 2.6 Mental load deck | done | distribution including planning work, unassigned cards, load spikes, meeting agenda, polls — no score anywhere |
| 2.7 Routines & kids views | done | icon routine a child ticks off themselves on the shared device, visual timer, approval gate kept |
| 2.8 Global search | done | one field across events, tasks, recipes, documents, contacts, collections and people, with the gift-visibility rule applied inside |
| 2.9 Phase-2 exit test | done | round trip without duplicates, plus a search reaching three areas at once |

## Phase 3 — Periphery and ingestion

| WP | Status | Where |
|---|---|---|
| 3.1 Ingestion pipeline | partial | triage, rules and intent extraction are done here; the capture transports and the AI call are in `src/AI` and `src/Mail`. Unexecuted |
| 3.2 Family email address | backend | `src/Mail` plus the HMAC-verified webhook in `routes/public.php`; an empty signing secret refuses everything rather than accepting everything. Unexecuted, and the inbound provider is an ops step |
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

**The backend runs, in this container.** `composer install --prefer-source`
installs it: the organisation's egress policy refuses GitHub's dist zipballs
(403 on `api.github.com/.../zipball`), but git clone is allowed, and
`composer config --global use-github-api false` keeps Composer off the API path
it would otherwise insist on. One package, `phpstan/phpstan`, has no `source` in
the lock at all and is therefore excluded with `--no-dev`; nothing else is.
`php artisan migrate` created the schema, including both family migrations, and
`php artisan serve` answers. Setup is written down in `docs/running-locally.md`.

The Pest suite has still not been run — it is a dev dependency behind the same
phpstan wall — so "runs" here means the routes, the migrations and the join and
sync paths were exercised over HTTP, not that the module's own tests passed.

**What running it found.** The two halves had been written against different
contracts, and every one of these was invisible to a suite that mocks the
server:

| | client sent | server expects |
|---|---|---|
| app context | nothing | `X-Client-Id` on every request |
| device token | `Authorization: Bearer` | `X-Family-Device-Token` |
| create family | `familyName` | `name`, plus a platform token |
| redeem invite | `inviteToken` | `token` |
| redeem recovery | `familyId` + `recoveryCode` | `code` alone |
| pull, snapshot | POST | GET |
| every response | flat | wrapped in `data` |

`invites/inspect` did not exist server-side at all, though FR-118 requires it —
the joiner is shown the name and role the inviter chose. It is now implemented,
and reading an invitation deliberately does not spend it.

**The backend's own test suite now runs: 241 tests, 951 assertions, green.**
It had never been executed — `composer install` fails on `phpstan/phpstan`,
which exists only as a dist zipball from a host the egress policy refuses, and
that one package took Pest down with it. `tools/make-test-manifest.php` in the
backend repo generates a manifest without `larastan`, which is the only thing
that needs phpstan, and everything installs.

The first run found one real defect: the GDPR export handed back `FamilyRole`
enum instances where Art. 20 asks for something machine-readable. Fixed.

One test was added, for the rate-limiter defect that the browser run surfaced
earlier. Making it mean anything took three attempts: the suite runs on the
array cache store, so `throttleWithRedis()` is never reached and a version that
drove the endpoint twice passed with the defect deliberately reinstated. The
kept version asserts the value handed to the limiter, and was confirmed to fail
with the defect restored before being trusted.

`packages/sync/src/reference-server.ts` remains the behaviour the sync half must
reproduce, and the acceptance suite runs the real client against it.

**Three transports are backend work by design**, not omissions: the AI provider
call (SPEC AI-01 puts it server-side), the calendar providers' OAuth APIs, and
inbound mail. All three are now written — `src/AI`, `src/Calendar/Connectors`,
`src/Mail`. They are covered by the suite only as far as their decisions go; the
transports themselves have never spoken to a real provider, because that needs
credentials rather than code. In each case the *decisions* those transports must
respect are implemented and tested, which is what makes them reviewable at all.

What they still need from the outside world is credentials and a contract, not
code: an AI provider whose processor agreement commits in writing to EU hosting,
no training on family data and no retention of voice uploads (AI-02, AI-03,
OBL-07 — `config/family.php` states this where an operator will see it), OAuth
client registrations for Google and Microsoft, and an inbound-mail provider.

**One thing needs a native capability**: home-screen widgets, which need a
platform extension target rather than a dependency. Cook mode no longer belongs
on this list — `expo-keep-awake` holds the display on for as long as that screen
is mounted (FR-527), and releases it on unmount.

**The screens now render under test, thinly.** The earlier note here was right
about the cause — React Native's Flow syntax needs a Babel transform Vitest does
not provide — and right about the shape of the fix: it is a jest preset.
`apps/app/jest.config.cjs` runs `jest-expo` over `apps/app/render-test/` only,
so Vitest keeps everything else and the two runners never see each other's
files. `pnpm --filter @fam/app test:render`.

It earned its place immediately. The first thing it caught was that **every one
of the app's sixteen icons was silently rejected at registration**: `registerIcons`
accepts a glyph only when `typeof glyph === "function"`, lucide ships `forwardRef`
objects, and `IconComponent` is a bare call signature that a `forwardRef` object
structurally satisfies — so the compiler was content, each name was skipped one
at a time behind a dev warning nobody was reading, and the pill, the utensils and
the whole of a child's routine rendered as placeholders. `icons.ts` now wraps
each glyph in a plain function, and `render-test/icons.test.tsx` fails without
that wrapper.

It then earned its place a second time, and more seriously. `repaint.test.tsx`
asks the question the rest of the suite could not — does the person *see* the
change — and the answer was no: `SyncClient.mutate` applied operations to the
state object screens were already holding, so `useSyncExternalStore` compared
snapshots by identity, found them equal, and skipped every re-render. Adding an
item showed nothing; ticking a routine step left the progress at zero. It came
right only when a pull replaced the state wholesale, so on a connection it read
as lag and offline as a dead app — in the product's most frequent interaction
(FR-731). `mutate` now applies onto a clone and swaps the reference, and both
`repaint.test.tsx` and two new cases in `packages/sync/test/robustness.test.ts`
fail without it.

Coverage is now 28 tests across all ten screens: the shopping list, conflicts,
icon registration, the week plan, cook mode, the routine, protocols, today, my
day, settings and join. They assert what a person sees and what a tap reaches —
scaling a recipe to eight eaters, a note taken at the hob, a dose
acknowledgement landing in the family's state, mum's focus view not showing
dad's afternoon, erasure refusing to run on a single tap, and no password field
anywhere in the join flow.

One product edge is documented by `care.test.tsx` rather than fixed: a routine
step writes the whole `subtasks` array as the array *render* saw, so two taps
inside one frame would have the second undo the first. A child taps, sees the
tick, then taps again, so the repaint in between is what makes the sequence
safe — which is true of the product and now written down where it will be
found.

**The web build persists through IndexedDB, not wa-sqlite.** This is the
fallback PLAN §3.3 named for WP-0.7, and it was taken on the merits rather than
as a retreat: OPFS access handles are exclusive, so a second tab does not queue
behind the first, it fails — which is why that route needs a SharedWorker owning
one connection for the whole origin. IndexedDB transactions are already atomic
across tabs, so the shipped arrangement has one fewer moving part. The cost is
that `IndexedDbStateStore` implements the seam directly instead of reusing
`SqlStateStore`, which is why it is in the equivalence suite. The wa-sqlite
driver stays in the tree behind the same interface should the SQL route ever be
worth the worker.

**The design system's theme colours are not in the web export.** Dark mode is
wired and verified — the browser suite emulates a dark device and asserts the
tree comes out marked `t_dark` — but the CSS custom properties behind those
classes (`--t-color` and friends) come out empty from `expo export`, so both
themes currently paint the same colours. Tamagui normally emits that CSS from a
compiler plugin the Metro export does not run. It is a packaging question about
how `@cp/ui` is consumed on web rather than anything in this app, and it is why
the browser test asserts the theme class rather than a rendered colour: the
assertion should fail when *this* code breaks, not when the design system's
build does.

**The browser layer found three defects nothing else could.** They are worth
naming individually, because each was invisible to a suite that was otherwise
green.

`process.env["EXPO_PUBLIC_…"]` never reached the bundle. Expo's Babel transform
inlines those variables by rewriting *member expressions*, and does not
recognise the bracket form — so every web build ever produced here silently used
the fallback API URL and no OAuth client id at all. Nothing but a browser
talking to a real server could have shown it.

Nothing ever wrote the `family` entity. The server relays operations and authors
none, so an entity no device creates is an entity that never exists — and every
family-scoped setting reads it and finds nothing. The learning switch was
permanently disabled for every real family. It is now written on join, after the
snapshot, idempotently.

`List.Item` fires `onPress` only when it is also `pressable`. A row without it
looks tappable and does nothing. The render test passed regardless, because
`fireEvent.press` invokes the handler either way — a false green that only a
real click could expose.

The harness itself was the fourth: it served whatever `dist` happened to exist,
so two fixes in a row were tested against a bundle that predated them. It now
rebuilds when the baked-in client id does not match the running backend, or when
any source file is newer than the bundle.

**The design system is consumed through a link** to a checkout beside this
repository, which installs locally but not in CI — hence the split CI, whose
`app` job is non-blocking until the packages are published.

**The routine glyphs are drawn, and two more were missing entirely.** lucide has
no toothbrush — its nearest offer is a painter's brush — so `toothbrush` and
`hairbrush` are now hand-drawn in `apps/app/src/glyphs.tsx`, to lucide's own
conventions (24×24, stroked, round caps, stroke width from the render site) so
they sit beside the rest without looking borrowed.

Writing the test that proves they draw turned up a separate defect of the same
silent family as the icon-registration one: `routineIcon` returned `shoe` and
`droplet`, while the app registers `shoes` and `bath`. Both fell through to the
placeholder-plus-development-warning path, so a child's *shoes* and *wash* steps
were grey boxes on the one screen that is navigated by picture alone (FR-1206).
`render-test/routine-icons.test.tsx` now holds the mapping table and the
registry to each other, and does the same for every glyph the screens name as a
literal.
