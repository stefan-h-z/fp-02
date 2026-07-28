/**
 * The device session (SPEC §4.2–4.4).
 *
 * The product's central adoption promise is that a person signs in at most once
 * per device and then never again, so this file has one job: make the session
 * outlive everything — app restarts, updates, a week in a drawer. It is stored in
 * the same local database as the family's data, because a session that survives
 * while the data does not (or the reverse) leaves the app in a state nobody can
 * reason about.
 *
 * There is no password here and nothing that expires on its own.
 */
import type { StateStore } from "@fam/storage";
import type { DeviceSession } from "@fam/api";

const META_TOKEN = "session.token";
const META_FAMILY = "session.familyId";
const META_DEVICE = "session.deviceId";
const META_PERSON = "session.personId";
const META_KIOSK = "session.kiosk";

export async function loadSession(store: StateStore): Promise<DeviceSession | undefined> {
  const token = await store.getMeta(META_TOKEN);
  const familyId = await store.getMeta(META_FAMILY);
  const deviceId = await store.getMeta(META_DEVICE);
  if (token === undefined || familyId === undefined || deviceId === undefined) return undefined;

  const personId = await store.getMeta(META_PERSON);
  return {
    token,
    familyId,
    deviceId,
    // A kitchen tablet has no person: it acts as the household (FR-116).
    personId: personId === undefined || personId.length === 0 ? null : personId,
    kiosk: (await store.getMeta(META_KIOSK)) === "true",
  };
}

export async function saveSession(store: StateStore, session: DeviceSession): Promise<void> {
  await store.setMeta(META_TOKEN, session.token);
  await store.setMeta(META_FAMILY, session.familyId);
  await store.setMeta(META_DEVICE, session.deviceId);
  await store.setMeta(META_PERSON, session.personId ?? "");
  await store.setMeta(META_KIOSK, session.kiosk ? "true" : "false");
}

/**
 * Signing out is the only way a session ends, and it is deliberately rare — the
 * documented reason family apps fail is the second adult being logged out and
 * never coming back (SPEC §4.2). The family's data is left in place: a device
 * signed out by mistake must not take the shopping list with it.
 */
export async function clearSession(store: StateStore): Promise<void> {
  for (const key of [META_TOKEN, META_FAMILY, META_DEVICE, META_PERSON, META_KIOSK]) {
    await store.setMeta(key, "");
  }
}

export function hasSession(session: DeviceSession | undefined): session is DeviceSession {
  return session !== undefined && session.token.length > 0;
}
