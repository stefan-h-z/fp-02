/**
 * Mounting a screen the way the shell does.
 *
 * A screen is only meaningful inside three things: the design system's theme,
 * the app runtime (client, translator, acting person), and a family that already
 * has some data in it. Assembling those per test file would drift, and a render
 * test that mounts a screen differently from the shell is testing an arrangement
 * nobody ships.
 *
 * The client is a real `SyncClient` against the reference server, not a mock —
 * the same pair the acceptance suite uses. Screens read through selectors and
 * write through commands, so a fake client would test the fake.
 */
import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react-native";
import { TamaguiProvider, Theme } from "@tamagui/core";
import { tamaguiConfig } from "@cp/tokens";
import { EntityTypes } from "@fam/domain";
import { MemoryStateStore } from "@fam/storage";
import { ReferenceServer, SyncClient } from "@fam/sync";
import { AppProvider } from "../src/runtime.js";
import { registerAppIcons } from "../src/icons.js";

export const FAMILY = "fam-1";
export const NOW = Date.parse("2026-07-28T08:00:00Z");

export interface Harness {
  readonly client: SyncClient;
  readonly server: ReferenceServer;
  readonly mutate: SyncClient["mutate"];
}

/** A family with one adult, ready to be given whatever the test needs. */
export async function openFamily(options: { readonly deviceId?: string } = {}): Promise<Harness> {
  registerAppIcons();

  let clock = 1_700_000_000_000;
  const server = new ReferenceServer({ families: [FAMILY] });
  const client = new SyncClient({
    familyId: FAMILY,
    deviceId: options.deviceId ?? "mum-phone",
    store: new MemoryStateStore(),
    transport: server,
    now: () => (clock += 1000),
  });

  await client.open();
  client.setActor("person-mum");
  await client.mutate((b) => {
    b.create(EntityTypes.family, FAMILY, { name: "Müller", learningEnabled: true });
  });

  return { client, server, mutate: (describe) => client.mutate(describe) };
}

/**
 * `now` is fixed rather than `Date.now`, because several screens decide what to
 * show from the current time and a test that drifts with the wall clock fails on
 * a Tuesday.
 */
export function mount(harness: Harness, screen: ReactElement): RenderResult {
  return render(
    <TamaguiProvider config={tamaguiConfig as never} defaultTheme="light">
      <Theme name="light">
        <AppProvider
          client={harness.client}
          actorId="person-mum"
          setActorId={() => undefined}
          now={() => NOW}
        >
          {screen as ReactNode}
        </AppProvider>
      </Theme>
    </TamaguiProvider>,
  );
}
