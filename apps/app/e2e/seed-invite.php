<?php

declare(strict_types=1);

/*
 * Seeds one family and one invitation, and prints what the browser run needs.
 *
 * Run through `php artisan tinker --execute` from the backend checkout, so the
 * models, the app context and the token hashing are the real ones rather than
 * SQL written twice. An invitation is single-use, so this runs per e2e run
 * rather than once.
 *
 * The family it creates is the state a joiner walks into: an adult already
 * there, and an invitation addressed to somebody by name — which is what makes
 * FR-118 (the joiner fills in nothing) testable at all.
 */

use App\Domain\Apps\Models\PlatformApp;
use Laravel\Passport\Client as OAuthClient;
use Modules\Family\Models\Family;
use Modules\Family\Models\FamilyInvite;
use Modules\Family\Models\FamilyMembership;
use Modules\Family\Models\FamilyPerson;
use Modules\Family\Models\FamilyRole;
use Modules\Family\Support\DeviceToken;

$app = PlatformApp::query()->where('slug', 'family')->firstOrFail();

$family = Family::query()->create([
    'app_id' => $app->id,
    'name' => 'Müller',
    'locale' => 'de',
]);

$adult = FamilyPerson::query()->create([
    'app_id' => $app->id,
    'family_id' => $family->id,
    'name' => 'Anna',
]);

FamilyMembership::query()->create([
    'app_id' => $app->id,
    'family_id' => $family->id,
    'person_id' => $adult->id,
    'role' => FamilyRole::Adult->value,
]);

// Random rather than fixed: two runs must not race for the same single-use row.
$token = DeviceToken::generate();

FamilyInvite::query()->create([
    'app_id' => $app->id,
    'family_id' => $family->id,
    'created_by_person_id' => $adult->id,
    'name' => 'Ben',
    'role' => FamilyRole::Adult->value,
    'token_hash' => DeviceToken::hash($token),
    'expires_at' => now()->addDay(),
]);

/*
 * The OAuth client this app belongs to. A family device holds this module's own
 * token rather than a platform one, so the client id has to travel in
 * `X-Client-Id` — and it is baked into the browser bundle at build time. Printing
 * it here lets the runner check the bundle it is about to serve was built
 * against this database rather than a previous one; without that check a stale
 * bundle fails at the join step with an `app_context_missing` that names
 * everything except the actual cause.
 */
$client = OAuthClient::query()->where('app_id', $app->id)->first()
    ?? OAuthClient::query()->first();

// Parsed by e2e/run.mjs. One key per line, nothing else on it.
echo "E2E_INVITE_TOKEN={$token}\n";
echo "E2E_FAMILY_ID={$family->id}\n";
echo 'E2E_CLIENT_ID=' . ($client?->getKey() ?? '') . "\n";
