# Design handoff — redesigning this app's interface

For a designer picking this up cold. It says what the product is, where the
levers are, what is immovable and why, and how to see your own work. It does not
say what the redesign should look like — that is your half.

---

## 0. You are being handed two repositories

| | |
|---|---|
| **`fp-02`** | the family app: 12 screens, the domain logic, the sync engine |
| **`cp-testt1-09`** | the design system `@cp/ui` (58 components) and `@cp/tokens` |

The app owns no styling of its own. Every visual decision lives in the design
system, and the design system has a written constitution
(`.specify/memory/constitution.md`) that binds what may change and how. A
redesign is therefore mostly a change to `cp-testt1-09`, and only secondarily to
the screens.

The app consumes the design system through a **link to a sibling checkout**, not
a published package. Both repositories have to be present and on the same branch.

---

## 1. What the product is

A household coordination app for families: calendar, tasks, meal planning,
shopping, a light health module. Offline-first, no ads, no analytics, German and
English.

The four people it has to work for are not variations of one another:

- **An adult on a phone**, usually while doing something else.
- **An adult at a kitchen tablet** that is permanently on, permanently signed in
  as the household, mounted on a wall and read from two metres away (FR-116,
  FR-1202).
- **A child who cannot read yet.** The routine screen is navigated entirely by
  picture (FR-103, FR-1206). Symbols there are not decoration; they are the
  interface.
- **A parent in a supermarket**, one hand on the trolley, in a dead zone with no
  signal.

If a design decision is good for the first and bad for any of the other three,
it is the wrong decision. Most of the constraints below are that sentence in
specific form.

---

## 2. Three places a redesign can happen

Ordered by leverage per unit of risk. Pick deliberately; say which you are in.

### Tier A — semantic tokens and typography
**Files:** `cp-testt1-09/packages/tokens/src/semantic/{light,dark}-theme.ts`,
`primitives/{colors,typography,spacing,radius,shadows}.ts`, `typography/roles.ts`

Roughly 90 semantic aliases (`textPrimary`, `surfaceRaised`, `borderFocus`,
`interactiveHover`, …) sit between 7 colour scales and every component. Changing
them restyles all 58 components at once and breaks no test, because nothing
asserts a colour value.

**This is where a redesign should start, and possibly end.** The system is
already coherent; what it lacks is a point of view.

### Tier B — component internals
**Files:** `cp-testt1-09/packages/ui/src/<Component>/`

Changing how a Button or a List row is built. Governed by the constitution
(§3 below) and by `docs/component-template.md`, which every component follows and
which a new one must follow. Higher effort, and each component carries its own
variant tests.

### Tier C — screen composition
**Files:** `fp-02/apps/app/src/screens/*.tsx`

Which components a screen uses and in what order. Highest churn: 79 `testID`s
live here and 19 of them are load-bearing in the browser suite. Change one and
tests fail — which is a feature, but budget for it.

---

## 3. What is immovable

### From the design system's constitution
These are not preferences. Breaking one is a constitution amendment, which is a
separate conversation with its own process.

- **Three token tiers, no skipping.** Components consume *semantic* tokens.
  Primitives may be referenced by name only where a dimension is intrinsic to a
  component's identity. Raw values in component code are forbidden.
- **Dark mode is a token swap.** No conditional logic in components. If a design
  needs a component to behave differently in dark, it needs a token, not a branch.
- **Border radius 6–10 px**, applied consistently.
- **Typography is Geist or Inter.**
- **Shadows are multi-layered, extremely subtle, and always combined with a
  border stroke.** A shadow alone is not an accepted elevation treatment.
- **`children` as a free-form slot is forbidden.** Components take content
  through named slots (`leading` / `trailing` / `label` / `hint`) or through
  their own sub-components. A mock that puts arbitrary content inside a Card
  cannot be built as drawn.
- Every component exports its Props interface and a `ComponentMeta`.

### From the product specification
These look like taste and are requirements.

- **No progress bars, no "profile 60 % complete"** (FR-129). A family is not a
  form to finish. Completion meters, onboarding checklists and streak counters
  are all excluded by this one.
- **Symbols carry meaning for pre-readers** (FR-103, FR-1206). On the routine and
  kids' screens an icon is not a label's companion — it is the label.
- **Fuzziness over false precision** (P-08). The app may say "probably"; it may
  never show a number it does not have. A confident-looking figure is a design
  bug here.
- **Learning and suggestion features are switchable off** (FR-1417), and the
  design must survive them being off — no layout that collapses without its
  recommendation strip.
- **Private events show busy/free only** (FR-203). A private appointment renders
  as an occupied block with no title, in every view.
- **Offline is the normal case in a shop** (FR-722). Loading states and empty
  states are not edge cases; they are Tuesday.

---

## 4. Read this before you choose a palette

**Light and dark currently paint identically in the web build.** Not because the
palette is wrong — because nothing consumes it.

Measured in the running app: the theme variables are present and correct
(`--background` is `#FFFFFF` under a light device, `#030712` under a dark one),
and the class on the tree switches as it should. But `tamaguiConfig.getCSS()`
returns eight variable blocks and zero style rules — there is no
`color: var(--…)` in it at all — so sampling every element on a screen finds 0
of 32 painting differently between the themes. The rules that would consume the
variables are emitted by Tamagui's optimizing compiler, and no compiler runs in
this pipeline.

Consequences for you:

- **Colour work cannot be evaluated in the app until this is fixed**, and the fix
  is an engineering task: wire the Tamagui compiler into the Metro build. It is a
  change to how the design system is packaged for every consumer.
- Verify whether Storybook is affected before treating it as the source of visual
  truth. It uses no Tamagui Vite plugin either, so it may have the same gap.
- If colour is central to the brief, say so and this gets scheduled first.

---

## 5. The surfaces

Twelve screens in `fp-02/apps/app/src/screens/`. What each is *for* — which is
what a redesign has to preserve.

| Screen | Its job | What breaks if the design is wrong |
|---|---|---|
| `TodayScreen` | the household's day; the kitchen tablet's home | read from two metres, or it is not a kiosk |
| `MyDayScreen` | the same day narrowed to one person | if "mine" shows someone else's afternoon it is worse than useless |
| `WeekPlanScreen` | meal planning, who cooks, the recipe collection | the plan-to-list loop is the product's spine |
| `ShoppingScreen` | the list, in a shop, one-handed | tap targets and contrast under fluorescent light |
| `CookModeScreen` | a recipe at the hob, hands doughy | screen stays awake; steps legible at arm's length |
| `RoutineScreen` | a child's morning, by picture | the one screen operated by someone who cannot read |
| `ProtocolScreen` | medication doses | a mistaken tap has a physical consequence |
| `ConflictScreen` | two devices disagreed | must explain, not just report |
| `SettingsScreen` | privacy, export, erasure, the learning switch | legal obligations rendered as controls |
| `LegalScreen` | policy, imprint, data flows | readable **before** joining, offline |
| `JoinScreen` | the way in | first impression; also the only screen a stranger sees |
| `OnboardingScreen` | who is in this family | no empty state, no progress bar |

Plus `CalendarScreen` (day / month / agenda / per-person timeline).

---

## 6. Where things are

```
cp-testt1-09/
  packages/tokens/src/
    primitives/     colors, spacing, radius, shadows, sizes, typography, mechanics
    semantic/       light-theme.ts, dark-theme.ts        ← Tier A lives here
    components/     button, card, input scoped overrides
    typography/roles.ts
  packages/ui/src/<Component>/                            ← 58 components
  docs/component-template.md                              ← read before touching Tier B
  docs/design-reviews/                                    ← two prior reviews
  .specify/memory/constitution.md                         ← the binding rules
  apps/storybook/                                         ← 48 story files

fp-02/
  apps/app/src/screens/                                   ← Tier C
  apps/app/render-test/                                   ← 45 render tests
  apps/app/e2e/                                           ← 18 browser steps
  packages/i18n/src/index.ts                              ← every user-facing string
  docs/status.md                                          ← what is built, what is not
  SPEC.md                                                 ← the requirements, numbered
```

---

## 7. How to see your work

- **Storybook** — `cp-testt1-09`, port 6006. 48 story files. The honest view of
  the components, and unaffected by the web theme gap.
- **The app in a browser** — `pnpm --filter @fam/app export:web`, then
  `pnpm --filter @fam/app test:e2e` boots a backend, seeds a family, and drives
  Chromium through 18 steps.
- **Three test layers** — 864 logic tests (Vitest), 45 render tests (jest-expo),
  18 browser steps (Playwright). `pnpm check-types` and `pnpm lint` are hard-zero.

A redesign is done when all four are green and the screens still say what they
said before.

---

## 8. What to hand back

Whatever form suits you, but these questions need answers:

1. **Which tier** (§2) the work sits in, and why.
2. **Token values**, if Tier A — as a diff against
   `semantic/light-theme.ts` and `dark-theme.ts`, both of them, since dark mode
   is a swap and cannot be derived.
3. **Any constitution rule the design needs bent**, named explicitly, with what
   it buys. Better to raise it than to hand over a mock that cannot be built.
4. **What happens at the edges**: empty, loading, offline, error, and a list of
   200 items. These are most of the app's real life.
5. **Contrast evidence** for text on every surface token you introduce. The
   existing scales are WCAG AA throughout; a redesign should not quietly lose that.

## 9. Questions this handoff cannot answer

- Is this a **re-skin** (Tier A, days) or a **re-think** (Tier C, weeks)?
- Is there a brand to match, or is the navy in `primitives/colors.ts` the brand?
- Does the kitchen-tablet mode get its own visual treatment, or is it the phone
  layout at a larger scale? The spec requires it to work; it does not say how it
  should look, and that is a real design decision nobody has made yet.
