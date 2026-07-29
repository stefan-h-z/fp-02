/**
 * What a shopping item carries besides its name (SPEC §10.1).
 *
 * The geofence tests are written from the privacy direction as much as the
 * behaviour one: the function takes a location and returns store ids, and there
 * is no path by which a coordinate reaches an operation.
 */
import { describe, expect, it } from "vitest";
import {
  capture,
  detailSummary,
  distanceMetres,
  EntityTypes,
  FamilyState,
  applyOperation,
  emptyEntity,
  formatPrice,
  hasDetails,
  HlcClock,
  lastKnownPrice,
  makeOperation,
  newId,
  readGeofences,
  readItemDetails,
  readPrice,
  resolveBarcode,
  runningTotal,
  storesNearby,
  type PricedLine,
  type Value,
} from "../src/index.js";

const FAMILY = "fam-1";
const clock = new HlcClock({ deviceId: "device-a", now: () => 1_700_000_000_000 });

function put(state: FamilyState, type: string, id: string, fields: Record<string, Value>): void {
  state.put(
    applyOperation(
      emptyEntity(type, id, FAMILY),
      makeOperation({
        opId: newId(),
        familyId: FAMILY,
        deviceId: "device-a",
        actorId: "person-mum",
        entityType: type,
        entityId: id,
        kind: "entity.create",
        payload: fields,
        hlc: clock.next(),
      }),
    ).entity,
  );
}

function shop(): FamilyState {
  const state = new FamilyState();
  put(state, EntityTypes.shoppingItem, "item-milk", {
    name: "Milk",
    brand: "Weihenstephan",
    size: "1 l",
    note: "the one in the glass bottle",
    photoUrl: "file://milk.jpg",
    priceCents: 149,
  });
  put(state, EntityTypes.shoppingItem, "item-bread", { name: "Bread" });
  put(state, EntityTypes.catalogItem, "cat-milk", {
    key: "milk",
    name: "Milk",
    barcode: "4001234567890",
    lastPriceCents: 139,
  });
  put(state, EntityTypes.store, "store-rewe", {
    name: "REWE",
    latitude: 48.137,
    longitude: 11.575,
    radiusMetres: 200,
  });
  put(state, EntityTypes.store, "store-dm", {
    name: "dm",
    latitude: 48.2,
    longitude: 11.7,
  });
  put(state, EntityTypes.store, "store-online", { name: "Online" });
  return state;
}

describe("item details (FR-715)", () => {
  it("reads every detail field", () => {
    const details = readItemDetails(shop(), "item-milk");

    expect(details.brand).toBe("Weihenstephan");
    expect(details.size).toBe("1 l");
    expect(details.note).toBe("the one in the glass bottle");
    expect(details.photoUrl).toBe("file://milk.jpg");
  });

  /**
   * The whole of "without cluttering the list": one boolean, one dot. If this
   * ever returned true for an item with nothing on it, every line would grow a
   * marker and the marker would stop meaning anything.
   */
  it("marks a line only when there is something behind it", () => {
    expect(hasDetails(readItemDetails(shop(), "item-milk"))).toBe(true);
    expect(hasDetails(readItemDetails(shop(), "item-bread"))).toBe(false);
  });

  it("summarises the parts that decide which packet to pick up, and not the note", () => {
    const summary = detailSummary(readItemDetails(shop(), "item-milk"));

    expect(summary).toBe("Weihenstephan, 1 l");
    expect(summary).not.toContain("glass bottle");
  });
});

describe("capture (FR-718)", () => {
  it("trusts what a person typed and doubts what a machine heard", () => {
    expect(capture(shop(), { method: "typed", text: "Butter" })?.needsConfirmation).toBe(false);
    expect(capture(shop(), { method: "voice", text: "Butter" })?.needsConfirmation).toBe(true);
  });

  /**
   * A barcode is resolved against this family's own catalogue and nowhere else.
   * A product-database lookup would send a record of what a household buys to a
   * third party to save typing one word.
   */
  it("names a barcode the family has scanned before, without asking anybody", () => {
    const scanned = capture(shop(), { method: "barcode", barcode: "4001234567890" });

    expect(scanned?.name).toBe("Milk");
    expect(scanned?.needsConfirmation).toBe(false);
    expect(scanned?.barcode).toBe("4001234567890");
  });

  it("keeps an unknown code and asks for a name", () => {
    const scanned = capture(shop(), { method: "barcode", barcode: "9999999999999" });

    expect(scanned?.name).toBe("");
    expect(scanned?.barcode).toBe("9999999999999");
    expect(scanned?.needsConfirmation).toBe(true);
  });

  it("keeps the photo and waits for a person to say what is in it", () => {
    const shot = capture(shop(), { method: "photo", photoUrl: "file://shelf.jpg" });

    expect(shot?.photoUrl).toBe("file://shelf.jpg");
    expect(shot?.needsConfirmation).toBe(true);
  });

  it("captures nothing from an empty capture", () => {
    expect(capture(shop(), { method: "typed", text: "   " })).toBeUndefined();
    expect(capture(shop(), { method: "barcode", barcode: "" })).toBeUndefined();
    expect(capture(shop(), { method: "photo" })).toBeUndefined();
  });

  it("resolves a barcode on its own too", () => {
    expect(resolveBarcode(shop(), "4001234567890")).toBe("Milk");
    expect(resolveBarcode(shop(), "nope")).toBeUndefined();
  });
});

describe("location reminders (FR-719)", () => {
  it("ignores a store nobody gave coordinates", () => {
    expect(readGeofences(shop()).map((fence) => fence.storeId)).toEqual([
      "store-dm",
      "store-rewe",
    ]);
  });

  it("defaults a radius when a store has none, because a car park is not a point", () => {
    expect(readGeofences(shop()).find((f) => f.storeId === "store-dm")?.radiusMetres).toBe(250);
  });

  it("measures a real distance", () => {
    // Marienplatz to roughly a kilometre north.
    const metres = distanceMetres(
      { latitude: 48.137, longitude: 11.575 },
      { latitude: 48.146, longitude: 11.575 },
    );

    expect(metres).toBeGreaterThan(950);
    expect(metres).toBeLessThan(1050);
  });

  const fences = () => readGeofences(shop());

  it("says which store the device is standing at", () => {
    const nearby = storesNearby(
      { latitude: 48.1371, longitude: 11.5751 },
      fences(),
      new Map([["store-rewe", 4]]),
    );

    expect(nearby.map((store) => store.storeId)).toEqual(["store-rewe"]);
    expect(nearby[0]?.openCount).toBe(4);
  });

  /**
   * A reminder with nothing to buy is a notification a family switches off, and
   * once they switch it off they lose the ones that would have helped.
   */
  it("stays quiet at a store with nothing open", () => {
    expect(storesNearby({ latitude: 48.1371, longitude: 11.5751 }, fences(), new Map())).toEqual([]);
  });

  it("stays quiet when the device is nowhere near", () => {
    const nearby = storesNearby(
      { latitude: 52.52, longitude: 13.405 },
      fences(),
      new Map([["store-rewe", 4]]),
    );

    expect(nearby).toEqual([]);
  });

  it("gives a fuzzy fix the benefit of the doubt", () => {
    const location = { latitude: 48.1395, longitude: 11.575 };
    const open = new Map([["store-rewe", 1]]);

    expect(storesNearby(location, fences(), open)).toEqual([]);
    expect(storesNearby({ ...location, accuracyMetres: 150 }, fences(), open)).toHaveLength(1);
  });
});

describe("running total (FR-723)", () => {
  const lines: readonly PricedLine[] = [
    { itemId: "a", name: "Milk", priceCents: 149, quantity: 2, checked: true },
    { itemId: "b", name: "Bread", priceCents: 299, quantity: 1, checked: false },
    { itemId: "c", name: "Apples", priceCents: undefined, quantity: 1, checked: false },
  ];

  it("separates the trolley from the list", () => {
    const total = runningTotal(lines);

    expect(total.spentCents).toBe(298);
    expect(total.remainingCents).toBe(299);
    expect(total.totalCents).toBe(597);
  });

  /**
   * The total is returned beside the count of what nobody priced, so the screen
   * can say "roughly" honestly rather than showing a number that looks exact.
   */
  /**
   * Half a food shop is sold by weight. Rounding the quantity to a whole number
   * of items — which this did — made the till total wrong for everything on a
   * scale: 2.6 kg at 1.00 came out as 3.00.
   */
  it("prices a weighed quantity as weighed, not as a count", () => {
    const apples = [{ itemId: "a", name: "Apples", priceCents: 100, quantity: 2.6, checked: false }];

    expect(runningTotal(apples).totalCents).toBe(260);
  });

  it("counts a line with no quantity as one, because somebody wants the thing", () => {
    const line = [{ itemId: "a", name: "Milk", priceCents: 149, quantity: 0, checked: false }];

    expect(runningTotal(line).totalCents).toBe(149);
  });

  it("says how much of the list it could not price", () => {
    expect(runningTotal(lines).unpricedCount).toBe(1);
  });

  it("does not count an unpriced item somebody already bought as missing", () => {
    const bought = [{ itemId: "c", name: "Apples", priceCents: undefined, quantity: 1, checked: true }];

    expect(runningTotal(bought).unpricedCount).toBe(0);
  });

  it("is zero for an empty trolley rather than undefined", () => {
    expect(runningTotal([])).toEqual({
      spentCents: 0,
      remainingCents: 0,
      totalCents: 0,
      unpricedCount: 0,
    });
  });

  it("reads a price off an item and off the catalogue", () => {
    expect(readPrice(shop(), "item-milk")).toBe(149);
    expect(readPrice(shop(), "item-bread")).toBeUndefined();
    expect(lastKnownPrice(shop(), "milk")).toBe(139);
    expect(lastKnownPrice(shop(), "nope")).toBeUndefined();
  });

  it("formats money the way the receipt does", () => {
    expect(formatPrice(597).replace(/ /g, " ")).toBe("5,97 €");
  });
});
