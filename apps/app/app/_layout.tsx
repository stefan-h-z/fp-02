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
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Slot } from "expo-router";
import { TamaguiProvider, Theme } from "@tamagui/core";
import { tamaguiConfig } from "@cp/tokens";
import { SyncClient } from "@fam/sync";
import { MemoryStateStore } from "@fam/storage";
import { HttpSyncTransport } from "@fam/api";
import { AppProvider } from "../src/runtime.js";
import { registerAppIcons } from "../src/icons.js";

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

export default function RootLayout(): ReactNode {
  const [client, setClient] = useState<SyncClient | undefined>(undefined);
  const [actorId, setActorId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const open = async (): Promise<void> => {
      // TODO(WP-0.8): the device session comes from the join flow; until that
      // screen exists the shell opens an unauthenticated local-only client, and
      // the in-memory store stands in for the platform SQLite driver.
      const store = new MemoryStateStore();
      const transport = new HttpSyncTransport({
        baseUrl: API_BASE_URL,
        token: () => undefined,
      });
      const next = new SyncClient({
        familyId: "local",
        deviceId: "this-device",
        store,
        transport,
      });
      await next.open();
      if (!cancelled) setClient(next);
    };

    void open();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    // The cast is an artefact of consuming the design system through a link to
    // a sibling checkout: two copies of @tamagui/web are installed, so their
    // config types are structurally identical but nominally distinct. It goes
    // away once @cp/tokens is installed from the registry (docs/status.md).
    <TamaguiProvider config={tamaguiConfig as unknown as TamaguiProviderConfig} defaultTheme="light">
      <Theme name="light">
        {client === undefined ? null : (
          <AppProvider client={client} actorId={actorId} setActorId={setActorId}>
            <Slot />
          </AppProvider>
        )}
      </Theme>
    </TamaguiProvider>
  );
}
