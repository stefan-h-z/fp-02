/**
 * The family simulation harness.
 *
 * The SPEC's acceptance scenarios are all about several devices, a network that
 * comes and goes, and two people doing something at the same time. None of that
 * can be shown with a single client, so the harness builds a real family: phones
 * for the adults, a kitchen tablet acting as the household, and a reference
 * server between them. `goOffline()` is the interesting part — it is what makes
 * "the supermarket has no signal" a testable condition rather than a hope.
 */
import { EntityTypes, type Operation } from "@fam/domain";
import { MemoryStateStore } from "@fam/storage";
import {
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

export const FAMILY_ID = "fam-mueller";

/** A transport that can be cut, the way a supermarket basement cuts one. */
class SwitchableTransport implements SyncTransport {
  online = true;

  constructor(private readonly inner: SyncTransport) {}

  private guard(): void {
    if (!this.online) throw new Error("offline");
  }

  async push(request: PushRequest): Promise<PushResponse> {
    this.guard();
    return this.inner.push(request);
  }

  async pull(request: PullRequest): Promise<PullResponse> {
    this.guard();
    return this.inner.pull(request);
  }

  async snapshot(request: SnapshotRequest): Promise<SnapshotResponse> {
    this.guard();
    return this.inner.snapshot(request);
  }
}

export class SimulatedDevice {
  constructor(
    readonly name: string,
    readonly client: SyncClient,
    private readonly transport: SwitchableTransport,
  ) {}

  goOffline(): void {
    this.transport.online = false;
  }

  goOnline(): void {
    this.transport.online = true;
  }

  /** Sync, tolerating being offline — which is what the app itself does. */
  async trySync(): Promise<boolean> {
    try {
      await this.client.sync();
      return true;
    } catch {
      return false;
    }
  }

  async mutate(describe: Parameters<SyncClient["mutate"]>[0]): Promise<readonly Operation[]> {
    return this.client.mutate(describe);
  }
}

export class FamilySimulation {
  readonly server = new ReferenceServer({ families: [FAMILY_ID] });
  readonly devices = new Map<string, SimulatedDevice>();
  private wall = Date.parse("2026-07-28T07:00:00Z");

  /** Time advances a little on every stamp, so orderings are deterministic. */
  private tick = (): number => {
    this.wall += 1000;
    return this.wall;
  };

  now(): number {
    return this.wall;
  }

  advance(ms: number): void {
    this.wall += ms;
  }

  async addDevice(name: string, actorId: string | null): Promise<SimulatedDevice> {
    const transport = new SwitchableTransport(this.server);
    const client = new SyncClient({
      familyId: FAMILY_ID,
      deviceId: name,
      store: new MemoryStateStore(),
      transport,
      now: this.tick,
    });
    await client.open();
    client.setActor(actorId);

    const device = new SimulatedDevice(name, client, transport);
    this.devices.set(name, device);
    return device;
  }

  device(name: string): SimulatedDevice {
    const device = this.devices.get(name);
    if (device === undefined) throw new Error("no such device: " + name);
    return device;
  }

  /** Everyone online, everyone synced, until nothing is in flight. */
  async settle(): Promise<void> {
    for (const device of this.devices.values()) device.goOnline();
    for (let round = 0; round < 3; round += 1) {
      for (const device of this.devices.values()) await device.client.sync();
    }
  }

  /**
   * A family with the three devices the SPEC's Phase 0 exit criterion names:
   * two adult phones and a permanently signed-in kitchen tablet.
   */
  static async household(): Promise<FamilySimulation> {
    const simulation = new FamilySimulation();
    const mum = await simulation.addDevice("phone-mum", "person-mum");
    await simulation.addDevice("phone-dad", "person-dad");
    // The tablet acts as the household: no person until one is needed (FR-116).
    await simulation.addDevice("tablet-kitchen", null);

    await mum.mutate((b) => {
      b.create(EntityTypes.family, FAMILY_ID, { name: "Müller", learningEnabled: true });
      b.create(EntityTypes.person, "person-mum", { name: "Mum", color: "#7c3aed" });
      b.create(EntityTypes.person, "person-dad", { name: "Dad", color: "#0891b2" });
      b.create(EntityTypes.person, "person-kid", { name: "Kid", color: "#f59e0b" });
      b.create(EntityTypes.membership, "m-mum", { personId: "person-mum", role: "adult" });
      b.create(EntityTypes.membership, "m-dad", { personId: "person-dad", role: "adult" });
      b.create(EntityTypes.membership, "m-kid", { personId: "person-kid", role: "child" });
      b.create(EntityTypes.shoppingList, "list-groceries", { domain: "groceries", name: "Groceries" });
    });
    await simulation.settle();

    return simulation;
  }
}
