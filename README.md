# Family App

An app for running a family's everyday life, specified in [`SPEC.md`](SPEC.md) and
planned in [`PLAN.md`](PLAN.md). This file describes what exists in the repository
today and how to work with it.

The product's thesis, in one line: every recurring thing in family life has a
visible owner, and the anticipating is done by the system rather than by a person.

## What is here

```
packages/
  domain/    Pure product logic. No I/O, no UI, no framework.
  sync/      The offline-first sync engine: protocol, client, reference server.
  storage/   One StateStore seam; in-memory, SQL, and per-platform drivers.
  api/       HTTP transport to the backend, plus the passwordless auth client.
  i18n/      German and English catalogs and locale-aware formatting.
apps/
  app/       Commands and selectors, the nine screens bound to them, and the shell.
e2e/         The SPEC's acceptance scenarios as a multi-device simulation.
```

Everything the product decides lives in `packages/domain`. That is deliberate: the
hard parts of this app are rules (when is a staple due, whose appointment clashes
with whose, may this dose be given twice), and rules that live in pure functions
can be asserted against the specification.

## Running it

```bash
pnpm install
pnpm check-types   # tsc, hard zero
pnpm lint          # eslint, hard zero
pnpm test          # vitest
pnpm --filter @fam/app export:web    # bundles the app
```

All gates are expected to be clean at every commit. CI splits them: the `core`
job covers everything that does not need the design system and gates the branch;
the `app` job needs `@cp/ui` from the registry and is non-blocking until those
packages are published (`docs/operations.md`).

## How the architecture holds together

**Everything is an operation.** Nothing mutates state except by appending an
operation to the family's log (`packages/domain/src/ops.ts`). Offline-first
(SPEC FR-1214) and per-object history (FR-1218) then fall out of the architecture
instead of being features somebody has to remember to maintain.

**The server orders, the client overlays.** A device's unsent work is an overlay
on the server-ordered log, so reads are instant offline and confirmed state is
byte-identical on every device. Because confirmed operations are only ever applied
in server order, two devices that have pulled to the same cursor also agree on
which divergences are conflicts.

**Two tiers of merge.** Check-offs, additions and set membership merge silently —
ticking an item off twice in a shop is not an event worth a dialog. A short list of
fields where a silent overwrite would be a real-world failure (an appointment
moved, a dose acknowledged, a task's owner changed) never overwrites: a genuine
divergence becomes a visible conflict. The list is in
`packages/domain/src/fields.ts` and is deliberately short.

**Derive rather than store.** Planned shopping needs are computed from the week
plan and the recipes every time the list is read, so "plan changed means list
changed" is true on every device without a follow-up write. Protocol instances are
computed from the protocol definition, so a five-day course costs a handful of
fields rather than twenty-five rows. Only what a human actually did is stored.

## Verification

The specification's acceptance scenarios are executable. `e2e/acceptance.test.ts`
builds a real family — two adult phones and a kitchen tablet — with a network that
can be cut, and runs the scenarios from SPEC §5, §9, §10.2 and §12.2 plus the
Phase 0 and Phase 1 exit criteria against it.

Convergence is established by property tests rather than examples:
`packages/sync/test/convergence.test.ts` generates randomized multi-device
interleavings and asserts that every device ends up holding exactly the server's
state, that accepted work appears in the log exactly once, that the state is a pure
function of the ordered log, that replay is idempotent, and that a device which
stayed offline throughout catches up correctly.

## What is not here yet

Stated plainly, because a half-built thing described as finished is worse than one
described accurately:

- **Rendered proof of the screens.** Ten screens exist — join, today, my day,
  shopping, week plan, cook mode, a child's routine, protocol, conflict resolution
  and settings — and `pnpm --filter @fam/app export:web` bundles the whole chain.
  They typecheck against the design system's real prop types but are not
  render-tested.
- **A running backend.** The family module for the Laravel platform lives in
  `backend-php-01` and has never been executed: this environment cannot fetch
  Composer packages. `packages/sync/src/reference-server.ts` is the executable
  specification it implements, so the contract is pinned even though the
  implementation is not yet exercised.
- **External calendar sync and the AI provider.** Both are backend work by design
  (SPEC FR-207, AI-01). The conflict semantics a connector must respect are
  already tested here.
- **Store submission and the compliance paperwork.** Organizational steps —
  see `docs/operations.md`.

See `docs/status.md` for the work-package-by-work-package position, and
`docs/operations.md` for the steps that have to happen outside a repository
before any of this reaches a family.
