import { beforeEach, describe, expect, it } from "vitest";
import { EntityTypes, readBoolean, readString } from "@fam/domain";
import { MemoryStateStore } from "@fam/storage";
import { ReferenceServer, SyncClient } from "@fam/sync";

const FAMILY = "fam-1";

interface Device {
  readonly client: SyncClient;
  readonly store: MemoryStateStore;
}

let server: ReferenceServer;
let clock: number;

function tick(): number {
  clock += 1000;
  return clock;
}

async function device(deviceId: string, actorId: string | null = null): Promise<Device> {
  const store = new MemoryStateStore();
  const client = new SyncClient({ familyId: FAMILY, deviceId, store, transport: server, now: tick });
  await client.open();
  client.setActor(actorId);
  return { client, store };
}

beforeEach(() => {
  clock = 1_700_000_000_000;
  server = new ReferenceServer({ families: [FAMILY] });
});

describe("offline first", () => {
  it("shows a change immediately, before anything is sent (SPEC FR-1214)", async () => {
    const { client } = await device("phone-a");

    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "item-1", { name: "Milk", checked: false }));

    expect(readString(client.state().get(EntityTypes.shoppingItem, "item-1"), "name")).toBe("Milk");
    expect(client.hasUnsyncedWork()).toBe(true);
    expect(server.opsOf(FAMILY)).toHaveLength(0);
  });

  it("survives a restart with unsent work intact (FR-1217)", async () => {
    const { client, store } = await device("phone-a");
    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "item-1", { name: "Milk" }));

    const restarted = new SyncClient({ familyId: FAMILY, deviceId: "phone-a", store, transport: server, now: tick });
    await restarted.open();

    expect(restarted.unsyncedCount()).toBe(1);
    expect(readString(restarted.state().get(EntityTypes.shoppingItem, "item-1"), "name")).toBe("Milk");
  });

  it("reports what is still unsent, so the family can see it (FR-1216)", async () => {
    const { client } = await device("phone-a");
    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "item-1", { name: "Milk" }));
    expect(client.unsyncedCount()).toBe(1);

    await client.sync();

    expect(client.unsyncedCount()).toBe(0);
    expect(client.hasUnsyncedWork()).toBe(false);
  });

  it("carries work across a device that was offline for a while", async () => {
    const a = await device("phone-a");
    const b = await device("phone-b");

    await a.client.mutate((x) => x.create(EntityTypes.shoppingItem, "item-1", { name: "Milk", checked: false }));
    await a.client.sync();
    await b.client.sync();

    expect(readString(b.client.state().get(EntityTypes.shoppingItem, "item-1"), "name")).toBe("Milk");
  });
});

describe("bootstrap", () => {
  it("brings a new device up from a snapshot rather than the whole log", async () => {
    const a = await device("phone-a");
    for (let i = 0; i < 20; i += 1) {
      await a.client.mutate((b) => b.create(EntityTypes.shoppingItem, "item-" + i, { name: "Item " + i }));
    }
    await a.client.sync();

    const fresh = await device("tablet-kitchen");
    await fresh.client.bootstrap();

    expect(fresh.client.state().all(EntityTypes.shoppingItem)).toHaveLength(20);
    // Nothing left to pull: the snapshot already carried the cursor.
    expect((await fresh.client.pull()).pulled).toBe(0);
  });

  it("keeps working after bootstrap, sending its own changes", async () => {
    const a = await device("phone-a");
    await a.client.mutate((b) => b.create(EntityTypes.shoppingItem, "item-1", { name: "Milk" }));
    await a.client.sync();

    const fresh = await device("tablet-kitchen");
    await fresh.client.bootstrap();
    await fresh.client.mutate((b) => b.set(EntityTypes.shoppingItem, "item-1", { checked: true }));
    await fresh.client.sync();
    await a.client.sync();

    expect(readBoolean(a.client.state().get(EntityTypes.shoppingItem, "item-1"), "checked")).toBe(true);
  });
});

describe("idempotency", () => {
  it("does not duplicate operations when a push is retried", async () => {
    const { client, store } = await device("phone-a");
    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "item-1", { name: "Milk" }));

    const ops = await store.outbox();
    await server.push({ familyId: FAMILY, deviceId: "phone-a", ops });
    await server.push({ familyId: FAMILY, deviceId: "phone-a", ops });

    expect(server.opsOf(FAMILY)).toHaveLength(1);
  });

  it("rejects an operation that claims another family", async () => {
    const { client, store } = await device("phone-a");
    await client.mutate((b) => b.create(EntityTypes.shoppingItem, "item-1", { name: "Milk" }));
    const [op] = await store.outbox();

    const response = await server.push({
      familyId: FAMILY,
      deviceId: "phone-a",
      ops: [{ ...op!, familyId: "fam-other" }],
    });

    expect(response.rejected[0]?.reason).toBe("not-authorized");
    expect(server.opsOf(FAMILY)).toHaveLength(0);
  });
});

describe("conflicts", () => {
  it("merges two people ticking the same item off, with no dialog (FR-1219)", async () => {
    const a = await device("phone-a");
    const b = await device("phone-b");
    await a.client.mutate((x) => x.create(EntityTypes.shoppingItem, "item-1", { name: "Milk", checked: false }));
    await a.client.sync();
    await b.client.sync();

    await a.client.mutate((x) => x.set(EntityTypes.shoppingItem, "item-1", { checked: true }));
    await b.client.mutate((x) => x.set(EntityTypes.shoppingItem, "item-1", { checked: true }));
    await a.client.sync();
    await b.client.sync();
    await a.client.sync();

    expect(await a.client.openConflicts()).toHaveLength(0);
    expect(readBoolean(a.client.state().get(EntityTypes.shoppingItem, "item-1"), "checked")).toBe(true);
    expect(readBoolean(b.client.state().get(EntityTypes.shoppingItem, "item-1"), "checked")).toBe(true);
  });

  it("surfaces a real divergence on a critical field instead of overwriting (FR-1215)", async () => {
    const a = await device("phone-a", "person-mum");
    const b = await device("phone-b", "person-dad");
    await a.client.mutate((x) =>
      x.create(EntityTypes.event, "event-1", { title: "Swimming", startsAt: "2026-08-01T09:00:00Z" }),
    );
    await a.client.sync();
    await b.client.sync();

    await a.client.mutate((x) => x.set(EntityTypes.event, "event-1", { startsAt: "2026-08-01T10:00:00Z" }));
    await b.client.mutate((x) => x.set(EntityTypes.event, "event-1", { startsAt: "2026-08-01T14:00:00Z" }));
    await a.client.sync();
    await b.client.sync();

    const conflicts = await b.client.openConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      field: "startsAt",
      currentValue: "2026-08-01T10:00:00Z",
      incomingValue: "2026-08-01T14:00:00Z",
      currentActorId: "person-mum",
      incomingActorId: "person-dad",
    });
  });

  it("gives every device the same conflict id, so it is shown once (not once per device)", async () => {
    const a = await device("phone-a");
    const b = await device("phone-b");
    await a.client.mutate((x) => x.create(EntityTypes.event, "event-1", { startsAt: "2026-08-01T09:00:00Z" }));
    await a.client.sync();
    await b.client.sync();

    await a.client.mutate((x) => x.set(EntityTypes.event, "event-1", { startsAt: "2026-08-01T10:00:00Z" }));
    await b.client.mutate((x) => x.set(EntityTypes.event, "event-1", { startsAt: "2026-08-01T14:00:00Z" }));
    await a.client.sync();
    await b.client.sync();
    await a.client.sync();

    const fromA = await a.client.openConflicts();
    const fromB = await b.client.openConflicts();

    expect(fromA.map((c) => c.id)).toEqual(fromB.map((c) => c.id));
  });

  it("applies the chosen side when a human resolves the conflict", async () => {
    const a = await device("phone-a");
    const b = await device("phone-b");
    await a.client.mutate((x) => x.create(EntityTypes.event, "event-1", { startsAt: "2026-08-01T09:00:00Z" }));
    await a.client.sync();
    await b.client.sync();

    await a.client.mutate((x) => x.set(EntityTypes.event, "event-1", { startsAt: "2026-08-01T10:00:00Z" }));
    await b.client.mutate((x) => x.set(EntityTypes.event, "event-1", { startsAt: "2026-08-01T14:00:00Z" }));
    await a.client.sync();
    await b.client.sync();

    const [conflict] = await b.client.openConflicts();
    await b.client.resolveConflict(conflict!, "take-incoming", "2026-07-28T08:00:00Z");
    await b.client.sync();
    await a.client.sync();

    expect(readString(a.client.state().get(EntityTypes.event, "event-1"), "startsAt")).toBe("2026-08-01T14:00:00Z");
    expect(await b.client.openConflicts()).toHaveLength(0);
  });

  it("keeps the current value and closes the conflict when the family decides so", async () => {
    const a = await device("phone-a");
    const b = await device("phone-b");
    await a.client.mutate((x) => x.create(EntityTypes.event, "event-1", { startsAt: "2026-08-01T09:00:00Z" }));
    await a.client.sync();
    await b.client.sync();

    await a.client.mutate((x) => x.set(EntityTypes.event, "event-1", { startsAt: "2026-08-01T10:00:00Z" }));
    await b.client.mutate((x) => x.set(EntityTypes.event, "event-1", { startsAt: "2026-08-01T14:00:00Z" }));
    await a.client.sync();
    await b.client.sync();

    const [conflict] = await b.client.openConflicts();
    await b.client.resolveConflict(conflict!, "keep-current", "2026-07-28T08:00:00Z");
    await b.client.sync();

    expect(readString(b.client.state().get(EntityTypes.event, "event-1"), "startsAt")).toBe("2026-08-01T10:00:00Z");
    expect(await b.client.openConflicts()).toHaveLength(0);
  });
});

describe("history", () => {
  it("keeps who changed what on the object itself (FR-1218)", async () => {
    const a = await device("phone-a", "person-mum");
    await a.client.mutate((x) => x.create(EntityTypes.task, "task-1", { title: "Bins", ownerId: "person-mum" }));
    await a.client.sync();

    const b = await device("phone-b", "person-dad");
    await b.client.bootstrap();
    await b.client.mutate((x) => x.set(EntityTypes.task, "task-1", { ownerId: "person-dad" }));
    await b.client.sync();
    await a.client.sync();

    const history = await a.client.history(EntityTypes.task, "task-1");

    expect(history).toHaveLength(2);
    expect(history.map((op) => op.actorId)).toEqual(["person-mum", "person-dad"]);
  });
});
