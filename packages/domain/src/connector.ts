/**
 * Deciding what a calendar connector should do (SPEC FR-207).
 *
 * The transport belongs to the backend — OAuth, watch channels, delta tokens.
 * What lives here is the decision that makes two-way sync survivable: given what
 * the family has and what the external calendar has, what should be written
 * where, and what must not be written at all.
 *
 * The failure everyone hits is the echo. The app writes an event out; the
 * provider notifies a change; the app reads it back and writes it out again. So
 * every mapping remembers a fingerprint of what was last exchanged, and a change
 * matching that fingerprint is not a change — it is the app hearing itself.
 */
import type { IcsEvent } from "./ics.js";

export type SyncDirection = "read-only" | "two-way";

/** What the app remembers about one event's life in an external calendar. */
export interface ExternalLink {
  readonly localEventId: string;
  readonly accountId: string;
  readonly externalUid: string;
  /** Fingerprint of the version last exchanged, in either direction. */
  readonly fingerprint: string;
  readonly lastSyncedAt: number;
}

export interface LocalEventShape {
  readonly id: string;
  readonly title: string;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly allDay: boolean;
  readonly cancelled: boolean;
  /** When the family last changed it, for deciding which side moved. */
  readonly updatedAt: number;
}

export interface ReconcileInput {
  readonly accountId: string;
  readonly direction: SyncDirection;
  readonly local: readonly LocalEventShape[];
  readonly remote: readonly IcsEvent[];
  readonly links: readonly ExternalLink[];
  /** The moment this reconciliation is for. */
  readonly now: number;
}

export interface ReconcilePlan {
  /** External events the family has never seen. */
  readonly importCreate: readonly IcsEvent[];
  /** External events that genuinely moved since the app last saw them. */
  readonly importUpdate: readonly { readonly localEventId: string; readonly event: IcsEvent }[];
  /** External events that disappeared — the local copy should follow. */
  readonly importDelete: readonly string[];
  /** Family events the external calendar does not have yet. */
  readonly exportCreate: readonly LocalEventShape[];
  readonly exportUpdate: readonly { readonly externalUid: string; readonly event: LocalEventShape }[];
  /** Both sides moved the same event: a person decides, never the connector. */
  readonly conflicts: readonly {
    readonly localEventId: string;
    readonly externalUid: string;
    readonly local: LocalEventShape;
    readonly remote: IcsEvent;
  }[];
  /** Mappings to store after the plan is carried out. */
  readonly links: readonly ExternalLink[];
  /** Changes recognised as this app's own echo and deliberately ignored. */
  readonly echoesIgnored: number;
}

/**
 * A fingerprint covers exactly the fields the connector exchanges. Anything else
 * — the family's who-brings-whom, a comment thread — is invisible to the
 * external calendar and must not make an event look changed.
 */
export function fingerprintRemote(event: IcsEvent): string {
  return [event.summary, event.startsAt, event.endsAt, event.allDay, event.cancelled].join("|");
}

export function fingerprintLocal(event: LocalEventShape): string {
  return [event.title, event.startsAt, event.endsAt, event.allDay, event.cancelled].join("|");
}

export function reconcile(input: ReconcileInput): ReconcilePlan {
  const linkByUid = new Map(input.links.map((link) => [link.externalUid, link]));
  const linkByLocal = new Map(input.links.map((link) => [link.localEventId, link]));
  const localById = new Map(input.local.map((event) => [event.id, event]));
  const remoteByUid = new Map(input.remote.map((event) => [event.uid, event]));

  const importCreate: IcsEvent[] = [];
  const importUpdate: { localEventId: string; event: IcsEvent }[] = [];
  const importDelete: string[] = [];
  const exportCreate: LocalEventShape[] = [];
  const exportUpdate: { externalUid: string; event: LocalEventShape }[] = [];
  const conflicts: {
    localEventId: string;
    externalUid: string;
    local: LocalEventShape;
    remote: IcsEvent;
  }[] = [];
  const links: ExternalLink[] = [];
  let echoesIgnored = 0;

  for (const remote of input.remote) {
    const link = linkByUid.get(remote.uid);
    const remotePrint = fingerprintRemote(remote);

    if (link === undefined) {
      importCreate.push(remote);
      continue;
    }

    const local = localById.get(link.localEventId);
    if (local === undefined) {
      // The family deleted their copy. Under read-only that means re-importing
      // it; under two-way it means the deletion should travel outwards, which
      // the caller does by not offering the event here.
      if (input.direction === "read-only") importCreate.push(remote);
      continue;
    }

    const localPrint = fingerprintLocal(local);
    const remoteMoved = remotePrint !== link.fingerprint;
    const localMoved = localPrint !== link.fingerprint;

    if (!remoteMoved && !localMoved) {
      links.push(link);
      continue;
    }
    if (remoteMoved && !localMoved) {
      importUpdate.push({ localEventId: link.localEventId, event: remote });
      links.push({ ...link, fingerprint: remotePrint, lastSyncedAt: input.now });
      continue;
    }
    if (!remoteMoved && localMoved) {
      if (input.direction === "two-way") {
        exportUpdate.push({ externalUid: remote.uid, event: local });
        links.push({ ...link, fingerprint: localPrint, lastSyncedAt: input.now });
      } else {
        links.push(link);
      }
      continue;
    }

    // Both moved. If they moved to the same place it is a convergence, not a
    // conflict — which happens routinely when a change echoes back.
    if (remotePrint === localPrint) {
      echoesIgnored += 1;
      links.push({ ...link, fingerprint: remotePrint, lastSyncedAt: input.now });
      continue;
    }

    conflicts.push({ localEventId: link.localEventId, externalUid: remote.uid, local, remote });
    links.push(link);
  }

  for (const local of input.local) {
    const link = linkByLocal.get(local.id);
    if (link === undefined) {
      if (input.direction === "two-way") exportCreate.push(local);
      continue;
    }
    if (!remoteByUid.has(link.externalUid)) {
      // The external calendar dropped it. Removing the family's copy is the
      // honest reading of a mirror; the alternative silently accumulates events
      // nobody can see on the other side.
      importDelete.push(link.localEventId);
    }
  }

  return {
    importCreate,
    importUpdate,
    importDelete,
    exportCreate,
    exportUpdate,
    conflicts,
    links,
    echoesIgnored,
  };
}

/** The mapping to store once an exported event has an external identity. */
export function linkFor(
  local: LocalEventShape,
  accountId: string,
  externalUid: string,
  now: number,
): ExternalLink {
  return {
    localEventId: local.id,
    accountId,
    externalUid,
    fingerprint: fingerprintLocal(local),
    lastSyncedAt: now,
  };
}
