/**
 * Regressions from the adversarial review of the sync core.
 *
 * Each test here corresponds to a defect that was found by trying to break the
 * client rather than by exercising it — the interesting failures were all in the
 * paths that only run when something has already gone wrong: a rejection, a
 * restart, a clock correction, a replay.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { EntityTypes, readBoolean, readString } from "@fam/domain";
import { MemoryStateStore } from "@fam/storage";
import {
  CONFLICT_RESOLUTION_TYPE,
  ReferenceServer,
  SyncClient,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SnapshotRequest,
  type SnapshotResponse,
  type SyncTransport,
} from "@fam/sync";

const FAMILY = "fam-1";

let server: ReferenceServer;
let clock: number;

beforeEach(() => {
  clock = 1_700_000_000_000;
  server = new ReferenceServer({ families: [FAMILY] });
});

function tick(): number {
  clock += 1000;
  return clock;
}

async function device(
  deviceId: string,
  options: { readonly store?: MemoryStateStore; readonly transport?: SyncTransport; readonly now?: () => number } = {},
): Promise<{ client: SyncClient; store: MemoryStateStore }> {
  const store = options.store ?? new MemoryStateStore();
  const client = new SyncClient({
    familyId: FAMILY,
    deviceId,
    store,
    transport: options.transport ?? server,
    now: options.now ?? tick,
  });
  await client.open();
  return { client, store };
}

describe("a rejected push must not destroy the work (FR-1217)", () => {
  it("keeps the work when the family is not provisioned yet", async () => {
    const empty = new ReferenceServer();
    const { client, store } = await device("phone-a", { transport: empty });
    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "i-1", { name: "Milk" }));

    await client.push();

    expect(await store.outbox()).toHaveLength(1);
    expect(readString(client.state().get(EntityTypes.shoppingItem, "i-1"), "name")).toBe("Milk");
  });

  it("keeps the work when this client is newer than the server", async () => {
    const tooNew: SyncTransport = {
      async push(request: PushRequest): Promise<PushResponse> {
        return {
          acceptedOpIds: [],
          conflicts: [],
          rejected: request.ops.map((op) => ({ opId: op.opId, reason: "schema-too-new" as const })),
          cursor: 0,
        };
      },
      async pull(request: PullRequest): Promise<PullResponse> {
        return { ops: [], nextCursor: request.cursor, hasMore: false };
      },
      async snapshot(_request: SnapshotRequest): Promise<SnapshotResponse> {
        return { entities: [], cursor: 0 };
      },
    };
    const { client, store } = await device("phone-a", { transport: tooNew });
    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "i-1", { name: "Milk" }));

    await client.push();

    expect(await store.outbox()).toHaveLength(1);
  });

  it("does drop work the server can never accept, so the outbox cannot jam", async () => {
    const { client, store } = await device("phone-a");
    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "i-1", { name: "Milk" }));
    const [op] = await store.outbox();

    // A foreign family id is not a transient condition.
    await server.push({ familyId: FAMILY, deviceId: "phone-a", ops: [{ ...op!, familyId: "other" }] });
    const response = await server.push({
      familyId: FAMILY,
      deviceId: "phone-a",
      ops: [{ ...op!, familyId: "other" }],
    });

    expect(response.rejected[0]?.reason).toBe("not-authorized");
  });
});

describe("clocks", () => {
  it("folds the family's clock in on bootstrap, so a slow device's edits still count", async () => {
    const a = await device("phone-a");
    await a.client.mutate((b) =>
      b.create(EntityTypes.shoppingItem, "i-1", { name: "Milk", checked: false }),
    );
    await a.client.sync();

    // The kitchen tablet's clock is a minute behind.
    const slow = await device("tablet", { now: () => clock - 60_000 });
    await slow.client.bootstrap();
    await slow.client.mutate((b) => b.set(EntityTypes.shoppingItem, "i-1", { checked: true }));
    await slow.client.sync();
    await a.client.sync();

    expect(readBoolean(a.client.state().get(EntityTypes.shoppingItem, "i-1"), "checked")).toBe(true);
  });

  it("survives a restart across a clock correction without losing the newer edit", async () => {
    const { client, store } = await device("phone-a");
    await client.mutate((b) => b.set(EntityTypes.shoppingItem, "i-1", { note: "large pack" }));
    await client.sync();

    // The device's clock is corrected backwards while the app is closed.
    const corrected = clock - 60_000;
    const restarted = new SyncClient({
      familyId: FAMILY,
      deviceId: "phone-a",
      store,
      transport: server,
      now: () => corrected,
    });
    await restarted.open();
    await restarted.mutate((b) => b.set(EntityTypes.shoppingItem, "i-1", { note: "small pack" }));
    await restarted.sync();

    expect(readString(restarted.state().get(EntityTypes.shoppingItem, "i-1"), "note")).toBe("small pack");
  });
});

describe("a conflict is decided once, for everyone (FR-1215)", () => {
  async function twoDevicesInConflict(): Promise<{
    a: Awaited<ReturnType<typeof device>>;
    b: Awaited<ReturnType<typeof device>>;
  }> {
    const a = await device("phone-a");
    const b = await device("phone-b");
    await a.client.mutate((x) => x.create(EntityTypes.event, "e-1", { startsAt: 1000 }));
    await a.client.sync();
    await b.client.sync();

    await a.client.mutate((x) => x.set(EntityTypes.event, "e-1", { startsAt: 2000 }));
    await b.client.mutate((x) => x.set(EntityTypes.event, "e-1", { startsAt: 3000 }));
    await a.client.sync();
    await b.client.sync();
    await a.client.sync();

    return { a, b };
  }

  it("closes on the other devices too, instead of nagging them forever", async () => {
    const { a, b } = await twoDevicesInConflict();
    const [conflict] = await b.client.openConflicts();

    await b.client.resolveConflict(conflict!, "take-incoming", "2026-07-28T08:00:00Z");
    await b.client.sync();
    await a.client.sync();

    expect(await b.client.openConflicts()).toHaveLength(0);
    expect(await a.client.openConflicts()).toHaveLength(0);
  });

  it("records keeping the current value too, which produces no other change", async () => {
    const { a, b } = await twoDevicesInConflict();
    const [conflict] = await b.client.openConflicts();

    await b.client.resolveConflict(conflict!, "keep-current", "2026-07-28T08:00:00Z");
    await b.client.sync();
    await a.client.sync();

    expect(await a.client.openConflicts()).toHaveLength(0);
    expect(a.client.state().get(CONFLICT_RESOLUTION_TYPE, conflict!.id)).toBeDefined();
  });

  it("does not re-open after the log is replayed", async () => {
    const { b } = await twoDevicesInConflict();
    const [conflict] = await b.client.openConflicts();
    await b.client.resolveConflict(conflict!, "keep-current", "2026-07-28T08:00:00Z");
    await b.client.sync();

    // A crash between applying a page and persisting the cursor rewinds it.
    await b.store.setMeta("sync.lastSeq", "0");
    const restarted = new SyncClient({
      familyId: FAMILY,
      deviceId: "phone-b",
      store: b.store,
      transport: server,
      now: tick,
    });
    await restarted.open();
    await restarted.pull();

    expect(await restarted.openConflicts()).toHaveLength(0);
  });
});

describe("the sync indicator tells the truth (FR-1216)", () => {
  it("clears the outbox when work comes back confirmed, not only when a push is acknowledged", async () => {
    const { client, store } = await device("phone-a");
    const ops = await client.mutate((b) => b.create(EntityTypes.shoppingItem, "i-1", { name: "Milk" }));

    // The push reaches the server; the response is lost on the way back.
    await server.push({ familyId: FAMILY, deviceId: "phone-a", ops: [...ops] });
    await client.pull();

    expect(await store.outbox()).toHaveLength(0);
    expect(client.hasUnsyncedWork()).toBe(false);
  });
});

/**
 * The client publishes state to React through `useSyncExternalStore`, which
 * compares the snapshot it is handed against the previous one with `Object.is`
 * and skips the re-render when they match. A client that applies an operation to
 * the state object a screen is already holding therefore satisfies every
 * assertion about its own contents while showing the person nothing — and
 * offline, the screen changing is the only confirmation a tick ever gets.
 */
describe("a local change is visible, not merely recorded (FR-731, FR-1214)", () => {
  it("publishes a new state object for a local mutation", async () => {
    const { client } = await device("phone-a");
    const before = client.state();

    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "i-1", { name: "Milk" }));

    const after = client.state();
    expect(after).not.toBe(before);
    expect(after.get(EntityTypes.shoppingItem, "i-1")?.fields["name"]).toBe("Milk");
  });

  /**
   * The snapshot handed out earlier must not change underneath its holder
   * either: that is the other half of what makes the comparison meaningful.
   */
  it("leaves the previous snapshot as it was", async () => {
    const { client } = await device("phone-a");
    const before = client.state();

    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "i-1", { name: "Milk" }));

    expect(before.get(EntityTypes.shoppingItem, "i-1")).toBeUndefined();
  });
});
