/**
 * The app shell.
 *
 * Everything the product needs exactly one of is created here and nowhere else:
 * the local database, the sync client on top of it, and the design system's
 * theme. Screens below this point never construct any of them.
 *
 * The client is opened before the first screen renders, because a screen that
 * paints an empty list while the local database is still loading is how a family
 * concludes the app lost their shopping list.
 */
import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Slot } from "expo-router";
import { TamaguiProvider, Theme } from "@tamagui/core";
import { tamaguiConfig } from "@cp/tokens";
import { Alert, Spinner } from "@cp/ui";
import { SyncClient } from "@fam/sync";
import type { StateStore } from "@fam/storage";
import { AuthClient, HttpSyncTransport, type DeviceSession } from "@fam/api";
import { AppProvider } from "../src/runtime.js";
import { registerAppIcons } from "../src/icons.js";
import { openLocalStore } from "../src/storage.js";
import { hasSession, loadSession, saveSession } from "../src/session.js";
import { JoinScreen } from "../src/screens/JoinScreen.js";

type TamaguiProviderConfig = NonNullable<ComponentProps<typeof TamaguiProvider>["config"]>;

/**
 * Where the backend lives. A missing value is not an error: the app is
 * offline-first, so it works against the local store until a family is joined
 * and the address is known.
 */
const API_BASE_URL = process.env["EXPO_PUBLIC_API_URL"] ?? "http://localhost:8000";

// Glyphs must be registered before anything renders, or the first paint shows
// placeholders (see src/icons.ts).
registerAppIcons();

interface Ready {
  readonly store: StateStore;
  readonly client: SyncClient | undefined;
}

export default function RootLayout(): ReactNode {
  const [ready, setReady] = useState<Ready | undefined>(undefined);
  const [actorId, setActorId] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | undefined>(undefined);
  const [auth] = useState(() => new AuthClient({ baseUrl: API_BASE_URL }));

  const clientFor = useCallback(
    (store: StateStore, session: DeviceSession): SyncClient =>
      new SyncClient({
        familyId: session.familyId,
        deviceId: session.deviceId,
        store,
        transport: new HttpSyncTransport({ baseUrl: API_BASE_URL, token: () => session.token }),
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const boot = async (): Promise<void> => {
      const store = await openLocalStore();
      const session = await loadSession(store);

      if (!hasSession(session)) {
        if (!cancelled) setReady({ store, client: undefined });
        return;
      }

      const client = clientFor(store, session);
      await client.open();
      if (cancelled) return;

      setActorId(session.personId);
      setReady({ store, client });
      // A first sync is best-effort: the app is fully usable without it.
      void client.sync().catch(() => undefined);
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [clientFor]);

  const onJoined = useCallback(
    async (session: DeviceSession, code?: string): Promise<void> => {
      if (ready === undefined) return;
      await saveSession(ready.store, session);

      const client = clientFor(ready.store, session);
      await client.open();
      // A device that has just joined holds nothing, so it takes the server's
      // materialized snapshot rather than replaying the family's whole history.
      await client.bootstrap().catch(() => undefined);

      setActorId(session.personId);
      setRecoveryCode(code);
      setReady({ store: ready.store, client });
    },
    [ready, clientFor],
  );

  return (
    // The cast is an artefact of consuming the design system through a link to
    // a sibling checkout: two copies of @tamagui/web are installed, so their
    // config types are structurally identical but nominally distinct. It goes
    // away once @cp/tokens is installed from the registry (docs/status.md).
    <TamaguiProvider config={tamaguiConfig as unknown as TamaguiProviderConfig} defaultTheme="light">
      <Theme name="light">
        {ready === undefined ? (
          <Spinner />
        ) : ready.client === undefined ? (
          <AppProvider client={unjoinedClient(ready.store)} actorId={null} setActorId={setActorId}>
            <JoinScreen auth={auth} onJoined={(session, code) => void onJoined(session, code)} />
          </AppProvider>
        ) : (
          <AppProvider client={ready.client} actorId={actorId} setActorId={setActorId}>
            {recoveryCode === undefined ? null : (
              <Alert
                variant="warning"
                label={recoveryCode}
                hint="Write this down. It cannot be shown again."
              />
            )}
            <Slot />
          </AppProvider>
        )}
      </Theme>
    </TamaguiProvider>
  );
}

/**
 * The join screen needs the runtime's translator, and the runtime needs a client.
 * Rather than make the client optional everywhere — a null check in every screen
 * for the sake of one — the pre-join state gets a client wired to nothing. It is
 * never synced and no screen reads from it.
 */
function unjoinedClient(store: StateStore): SyncClient {
  const refuse = (): never => {
    throw new Error("not joined");
  };

  return new SyncClient({
    familyId: "unjoined",
    deviceId: "unjoined",
    store,
    transport: { push: refuse, pull: refuse, snapshot: refuse },
  });
}
