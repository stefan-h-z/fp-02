/**
 * The things a shopping item carries besides its name (SPEC §10.1).
 *
 * All four features here share one constraint, and it is the reason they live
 * apart from `shopping.ts`: none of them may slow the list down. A shopping list
 * is read one-handed, in a shop, by somebody holding a child. Details, capture,
 * prices and geofences are all *second* screens — the list view asks each of
 * these functions a yes/no question ("is there more to see?") and shows a dot,
 * and only a tap opens the rest.
 *
 * - FR-715 brand / variety / size / note / photo, without cluttering the line
 * - FR-718 what a capture method produces, and what still needs a human
 * - FR-719 geofencing evaluated here, on the device, with no location leaving it
 * - FR-723 price notes and a running total that is a note aid, not accounting
 */
import { EntityTypes, readOptionalNumber, readOptionalString, readString } from "./schema.js";
import type { FamilyState } from "./state.js";

// ── Item details (FR-715) ─────────────────────────────────────────────────

export interface ItemDetails {
  readonly brand: string;
  readonly variety: string;
  readonly size: string;
  readonly note: string;
  /** A photo of the shelf, or of the packet that was right last time. */
  readonly photoUrl: string;
}

export function readItemDetails(state: FamilyState, itemId: string): ItemDetails {
  const item = state.get(EntityTypes.shoppingItem, itemId);

  return {
    brand: readString(item, "brand"),
    variety: readString(item, "variety"),
    size: readString(item, "size"),
    note: readString(item, "note"),
    photoUrl: readString(item, "photoUrl"),
  };
}

/**
 * Whether the line should show a "there is more here" marker.
 *
 * This is the whole of FR-715's "without cluttering the list": the list asks one
 * boolean and draws one dot. Everything else waits for a tap.
 */
export function hasDetails(details: ItemDetails): boolean {
  return (
    details.brand.length > 0 ||
    details.variety.length > 0 ||
    details.size.length > 0 ||
    details.note.length > 0 ||
    details.photoUrl.length > 0
  );
}

/**
 * The details worth putting on the line itself when there is room — brand and
 * size, in that order, because those are the two that decide which packet to
 * pick up. A note is a sentence and belongs on the detail screen.
 */
export function detailSummary(details: ItemDetails): string {
  return [details.brand, details.variety, details.size].filter((part) => part.length > 0).join(", ");
}

// ── Capture (FR-718) ──────────────────────────────────────────────────────

export type CaptureMethod = "typed" | "voice" | "barcode" | "photo";

export interface CapturedShoppingItem {
  readonly name: string;
  readonly method: CaptureMethod;
  /** Set only by barcode, and kept so the same packet is recognised next time. */
  readonly barcode: string | undefined;
  readonly photoUrl: string | undefined;
  /**
   * Whether a person still has to look at this before it is a real line.
   *
   * Anything a machine guessed needs confirming; anything a person typed does
   * not. A barcode that resolved against the family's own history is the one
   * machine result that does not need confirming, because the family named that
   * product themselves the last time they scanned it.
   */
  readonly needsConfirmation: boolean;
}

/**
 * A barcode is only ever resolved locally, against what this family has bought
 * before. There is no product database call here and there is not meant to be
 * one: a lookup would send a record of what a household buys to a third party
 * for the sake of saving one typed word.
 */
export function resolveBarcode(state: FamilyState, barcode: string): string | undefined {
  const code = barcode.trim();
  if (code.length === 0) return undefined;

  const match = state
    .all(EntityTypes.catalogItem)
    .find((item) => readString(item, "barcode") === code);

  const name = match === undefined ? "" : readString(match, "name");
  return name.length > 0 ? name : undefined;
}

export function capture(
  state: FamilyState,
  input: { readonly method: CaptureMethod; readonly text?: string; readonly barcode?: string; readonly photoUrl?: string },
): CapturedShoppingItem | undefined {
  if (input.method === "barcode") {
    const code = (input.barcode ?? "").trim();
    if (code.length === 0) return undefined;

    const known = resolveBarcode(state, code);
    return {
      name: known ?? "",
      method: "barcode",
      barcode: code,
      photoUrl: undefined,
      // An unknown code has no name to confirm — it needs one typed.
      needsConfirmation: known === undefined,
    };
  }

  if (input.method === "photo") {
    const photoUrl = (input.photoUrl ?? "").trim();
    if (photoUrl.length === 0) return undefined;

    return {
      name: (input.text ?? "").trim(),
      method: "photo",
      barcode: undefined,
      photoUrl,
      needsConfirmation: true,
    };
  }

  const name = (input.text ?? "").trim();
  if (name.length === 0) return undefined;

  return {
    name,
    method: input.method,
    barcode: undefined,
    photoUrl: undefined,
    // Dictation mishears; a person typing does not need to confirm themselves.
    needsConfirmation: input.method === "voice",
  };
}

// ── Location reminders (FR-719, Phase 3, non-binding OPEN-02) ─────────────

export interface StoreGeofence {
  readonly storeId: string;
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
  /** Metres. A supermarket car park is bigger than a corner shop's doorway. */
  readonly radiusMetres: number;
}

export interface DeviceLocation {
  readonly latitude: number;
  readonly longitude: number;
  /** Metres of uncertainty the platform reported, if it said. */
  readonly accuracyMetres?: number;
}

export function readGeofences(state: FamilyState): readonly StoreGeofence[] {
  return state
    .all(EntityTypes.store)
    .map((store) => ({
      storeId: store.id,
      label: readString(store, "name"),
      latitude: Number(store.fields["latitude"] ?? Number.NaN),
      longitude: Number(store.fields["longitude"] ?? Number.NaN),
      radiusMetres: readOptionalNumber(store, "radiusMetres") ?? 250,
    }))
    .filter(
      (fence) => Number.isFinite(fence.latitude) && Number.isFinite(fence.longitude),
    );
}

/**
 * Metres between two coordinates, by the haversine formula.
 *
 * Written out rather than imported because it is eight lines and a dependency
 * that sees a family's coordinates is a dependency worth not having.
 */
export function distanceMetres(a: DeviceLocation, b: { readonly latitude: number; readonly longitude: number }): number {
  const earthRadius = 6_371_000;
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface NearbyStore {
  readonly storeId: string;
  readonly label: string;
  readonly distanceMetres: number;
  /** How many open lines are waiting at this store right now. */
  readonly openCount: number;
}

/**
 * Which store the device is standing at, and whether that is worth saying.
 *
 * The whole computation happens here, in the client, from a location the caller
 * already has: no coordinate is written to an operation, sent to the server, or
 * kept after this function returns. That is not an implementation detail — it is
 * SPEC §1.3's non-goal, and the reason the signature takes a location instead of
 * reading one.
 *
 * A reminder with nothing to buy is a notification a family will switch off, so
 * a fence with no open lines is not "nearby" as far as this function is
 * concerned.
 */
export function storesNearby(
  location: DeviceLocation,
  fences: readonly StoreGeofence[],
  openLinesByStore: ReadonlyMap<string, number>,
): readonly NearbyStore[] {
  const slop = location.accuracyMetres ?? 0;

  return fences
    .map((fence) => ({
      storeId: fence.storeId,
      label: fence.label,
      distanceMetres: distanceMetres(location, fence),
      openCount: openLinesByStore.get(fence.storeId) ?? 0,
      radiusMetres: fence.radiusMetres,
    }))
    // A location the platform is unsure about counts as inside if it could be.
    .filter((candidate) => candidate.distanceMetres - slop <= candidate.radiusMetres)
    .filter((candidate) => candidate.openCount > 0)
    .sort((a, b) => a.distanceMetres - b.distanceMetres)
    .map(({ storeId, label, distanceMetres: metres, openCount }) => ({
      storeId,
      label,
      distanceMetres: metres,
      openCount,
    }));
}

// ── Prices and running total (FR-723) ─────────────────────────────────────

export interface PricedLine {
  readonly itemId: string;
  readonly name: string;
  /** Minor units (cents), because a float total of a shop drifts by a cent. */
  readonly priceCents: number | undefined;
  readonly quantity: number;
  readonly checked: boolean;
}

export interface RunningTotal {
  /** What is already in the trolley. */
  readonly spentCents: number;
  /** What is priced and still on the list. */
  readonly remainingCents: number;
  readonly totalCents: number;
  /** Lines nobody has priced — the reason the total is an estimate. */
  readonly unpricedCount: number;
}

export function readPrice(state: FamilyState, itemId: string): number | undefined {
  return readOptionalNumber(state.get(EntityTypes.shoppingItem, itemId), "priceCents");
}

/** The last price the family noted for this item, offered as a default. */
export function lastKnownPrice(state: FamilyState, itemKey: string): number | undefined {
  const catalogItem = state
    .all(EntityTypes.catalogItem)
    .find((item) => (readOptionalString(item, "key") ?? item.id) === itemKey);

  return readOptionalNumber(catalogItem, "lastPriceCents");
}

/**
 * A running total while shopping.
 *
 * Deliberately not finance management (SPEC §1.3 non-goal): nothing is
 * categorised, nothing accumulates across trips, and no budget is enforced.
 * It answers one question at the till — "roughly how much is this?" — and the
 * unpriced count is returned beside the number so the UI can say *roughly*
 * honestly instead of showing a total that looks exact.
 */
export function runningTotal(lines: readonly PricedLine[]): RunningTotal {
  let spentCents = 0;
  let remainingCents = 0;
  let unpricedCount = 0;

  for (const line of lines) {
    if (line.priceCents === undefined) {
      if (!line.checked) unpricedCount += 1;
      continue;
    }

    // Not rounded to a whole number of items. Half the food shop is sold by
    // weight, so 2.6 kg at 1.00 is 2.60 and not 3.00 — rounding the quantity
    // rather than the money made the till total wrong for everything on a
    // scale. A missing or nonsensical quantity still counts as one, because a
    // line on the list means somebody wants the thing.
    const quantity = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1;
    const amount = line.priceCents * quantity;

    if (line.checked) spentCents += amount;
    else remainingCents += amount;
  }

  // Rounded once, at the end: rounding each line would drift by a cent per item.
  const spent = Math.round(spentCents);
  const remaining = Math.round(remainingCents);

  return { spentCents: spent, remainingCents: remaining, totalCents: spent + remaining, unpricedCount };
}

/** "12,40 €" — the only place in this module that knows about a currency. */
export function formatPrice(cents: number, locale = "de-DE", currency = "EUR"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
