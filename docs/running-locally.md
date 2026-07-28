# Running the whole thing

The app, the backend and a real browser, all from one machine. Everything here
has been executed; where a step exists only because of this environment's egress
policy, that is said rather than hidden.

## Once

### The backend

```bash
cd ../backend-php-01

# Composer cannot use GitHub's dist archives here: the egress policy answers 403
# to api.github.com/.../zipball. Cloning is allowed, so install from source and
# keep Composer off the API path it would otherwise insist on.
composer config --global use-github-api false
COMPOSER_ALLOW_SUPERUSER=1 composer install --prefer-source --no-dev

cp .env.example .env
# sqlite needs an absolute path and a file to exist
sed -i 's|^DB_CONNECTION=.*|DB_CONNECTION=sqlite|' .env
sed -i "s|^DB_DATABASE=.*|DB_DATABASE=$PWD/database/database.sqlite|" .env
# the app talks to a local Redis that has no password; the sample env assumes one
sed -i 's|^REDIS_PASSWORD=.*|REDIS_PASSWORD=null|' .env
touch database/database.sqlite

redis-server --daemonize yes --save '' --appendonly no
php artisan key:generate --force
php artisan passport:keys --force      # OAuth signing keys; without them: "Invalid key supplied"
php artisan migrate --force
php artisan app:create family --name="Family App"   # prints the client id
```

`--no-dev` here is about one package. `phpstan/phpstan` is published only as a
dist zipball from `api.github.com`, which the egress policy refuses, and it has
no `source` entry either — so `--prefer-source` cannot reach it and the whole
install fails on that one name. Its git mirror is not a way around it: the
phpstan repository carries every phar it has ever released and the clone runs
past a gigabyte before finishing.

Only `larastan` depends on it, and static analysis is not worth being unable to
run the tests. So the dev environment comes from a generated manifest that drops
exactly that one dependency:

```bash
php tools/make-test-manifest.php          # composer.json minus larastan
COMPOSER=composer-test.json COMPOSER_ALLOW_SUPERUSER=1 composer install
./vendor/bin/pest                          # 241 tests
```

Generated rather than committed, so it cannot drift from `composer.json` — a
second hand-maintained manifest would quietly stop matching the first, and the
tests would then run against dependencies nobody ships. Both it and its lock
file are gitignored.

The suite runs on SQLite in memory and the array cache store, which matters for
one thing: `throttleWithRedis()` is never reached there, so a rate-limiter
defect that only appears under Redis cannot be reproduced by driving an endpoint
twice. `tests/Feature/Platform/RateLimitTest.php` asserts the limiter's return
value instead, and says why in place.

`app:create` prints a client id. Every family endpoint needs it: the platform
reads which app a request belongs to from the access token's OAuth client, and a
family device holds this module's own token rather than a platform one — so the
client id travels in `X-Client-Id` instead. Without it every call answers
`app_context_missing`.

### The app

```bash
cd ../fp-02
pnpm install
EXPO_PUBLIC_API_URL=http://127.0.0.1:8000 \
EXPO_PUBLIC_CLIENT_ID=<the client id app:create printed> \
  pnpm --filter @fam/app export:web
```

Both variables are baked into the bundle at build time, so a change to either
means building again.

## Every time

```bash
cd ../backend-php-01 && php artisan serve --host=127.0.0.1 --port=8000
```

Then, in the app:

```bash
pnpm --filter @fam/app test:e2e     # boots the static server, drives Chromium
```

`e2e/run.mjs` serves `dist/`, seeds a family and a single-use invitation through
the module's real models, and runs every `*.e2e.mjs` harness against it. It
starts the backend itself if nothing answers on :8000; point `E2E_API_URL` at a
running one to reuse it, and set `E2E_HEADED=1` to watch.

## The three layers, and why all three exist

| | what it can say | what it cannot |
|---|---|---|
| `pnpm test` (Vitest) | the rules are right | nothing renders |
| `test:render` (jest-expo) | the screens work | the bundle is never built |
| `test:e2e` (Chromium) | it runs | slow, and needs the backend |

Each layer has caught defects the one above it could not see. The browser layer
found two that were invisible everywhere else: a second copy of React coming in
through the linked design system, which killed the page on first paint, and
`globalThis.fetch` stored unbound — legal in Node, an "Illegal invocation" in a
browser, and so the web build could not reach the backend at all while showing
the person a friendly "check your connection".

## Known rough edges

- **The browser's redeem call is refused with `rate_limited`, and I could not
  explain it.** This is the one step of `test:e2e` that does not pass. What is
  ruled out: the same request with the same headers succeeds from `curl`
  (201 Created, a device issued); `inspect` succeeds from the browser moments
  earlier on the same origin; the per-IP `auth` limiter was raised to 1000/min
  and confirmed live via `config()`; Redis was flushed immediately before the
  run; the client quota and `api` limiters are 600/min and 300/min. So a
  two-request run is refused by a limiter with a thousand-request budget, and
  something about the ordering or keying is doing it. Everything downstream of
  redeeming — the session surviving a reload, a first sync — is therefore
  unverified in the browser.

  It is a local-loop problem, not a product one: redemption works over HTTP and
  the app's own code path is exercised by the render tests. Worth an hour with
  fresh eyes rather than another guess.
- **Creating a family from the browser is not wired.** That one endpoint is
  guarded by the platform's `auth:api` + `verified.email`, which needs a
  magic-link round trip the app does not implement yet. The browser test joins
  by invitation instead — which is the path everyone except the very first adult
  takes anyway.
- **Nothing here is production configuration.** SQLite, a passwordless Redis and
  `artisan serve` are a development stack.
