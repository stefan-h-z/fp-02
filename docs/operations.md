# Getting this running

The steps that cannot be done from a repository, in the order they have to
happen. Each one is here because something in the code depends on it and would
otherwise fail in a way that is hard to diagnose from the error alone.

## 1. Publish the design system

The app depends on `@cp/ui` and `@cp/tokens`. Until they are published, the app's
manifest points at a checkout of `cp-testt1-09` beside this repository, which
works on a developer machine and not in CI.

```bash
# in cp-testt1-09, once the version is right
git tag v0.3.0 && git push origin v0.3.0     # triggers .github/workflows/publish.yml
```

Then, in this repository, replace the two `link:` entries in
`apps/app/package.json` with the published versions and drop
`continue-on-error` from the `app` job in `.github/workflows/ci.yml`. A
`.npmrc` pointing `@cp` at `npm.pkg.github.com` is already committed; every
machine and CI run needs a token with `read:packages`.

## 2. Bring up the backend module

The family module lives in `backend-php-01/app-modules/family`. It has never
been executed — this environment cannot fetch Composer packages — so the first
run is also the first test run.

```bash
# in backend-php-01
composer install
php artisan migrate
php artisan app:create family        # registers the app row and its OAuth client
php artisan test --testsuite=Modules
```

Expect the first `php artisan test` to surface real failures. The module's own
report lists what was reasoned about rather than verified: `JsonResource`
unwrapping, `upsert()` against the composite primary key, `HasUuids` behaviour
on Laravel 12, and the sequence allocation under genuine MySQL concurrency.

Point the app at it with `EXPO_PUBLIC_API_URL`.

## 3. Choose and connect the AI provider

All AI processing is server-side against an EU-hosted provider (SPEC AI-01,
AI-02), with Mistral as the first implementation. Nothing in the client calls a
provider directly, so this is a backend configuration step — but note the
contractual part is not optional: the provider agreement must exclude training
on family data (SPEC AI-03, OBL-03).

## 4. Before the stores

These are the ones that bite late.

- **Apple:** declare DSA trader status even as a non-trader. Non-declaration
  removes the app from all EU storefronts. If the declaration classifies you as
  a trader, your address becomes public on the product page — decide what
  address that is before you file.
- **Google Play:** a closed test with a two-digit number of testers over 14 days
  is required before first release. Start recruiting during Phase 1, not at the
  end of it. Developer verification is separately required.
- **Health module:** clarify with Google whether the health category forces an
  organization account *before* Phase 3 ships, not after.
- **Kids programmes:** the app is positioned for adults (SPEC STO-06). Store
  listing, screenshots and marketing must not address children, or the
  classification changes and with it the rules.

## 5. The paperwork that is not code

Required before publication, and not satisfiable by anything in this repository:
the record of processing activities (Art. 30), the data protection impact
assessment (Art. 35 — health data plus children plus behavioural derivation
makes it very likely required), processor agreements with hosting, push, the AI
provider and mail (Art. 28), the third-country transfer review (push runs
through Apple and Google), documented technical measures (Art. 32), a 72-hour
breach process, and the deletion concept whose retention periods are already
implemented in code (SPEC OBL-07: five years for histories, audio deleted at
transcription).

Have this reviewed professionally. The app processes special-category data about
children, which is the strictest tier there is.
