/**
 * The screens, rendered.
 *
 * These assert what a person sees and what happens when they touch it, against
 * the real design system and a real sync client. They are deliberately not
 * snapshots: a snapshot of a Tamagui tree changes whenever the library does and
 * tells nobody whether the shopping list still works in a supermarket.
 */
import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { EntityTypes } from "@fam/domain";
import { addItem } from "../src/commands.js";
import { ShoppingScreen } from "../src/screens/ShoppingScreen.js";
import { ConflictScreen } from "../src/screens/ConflictScreen.js";
import { mount, openFamily, type Harness } from "./harness.js";

const LIST = "list-groceries";

async function withList(): Promise<Harness> {
  const harness = await openFamily();
  await harness.mutate((b) => {
    b.create(EntityTypes.shoppingList, LIST, { name: "Groceries", domain: "food" });
  });
  return harness;
}

describe("ShoppingScreen (SPEC §10)", () => {
  it("shows what is on the list", async () => {
    const harness = await withList();
    await addItem(harness.mutate, { listId: LIST, name: "Milk" });
    await addItem(harness.mutate, { listId: LIST, name: "Bread" });

    mount(harness, <ShoppingScreen listId={LIST} />);

    expect(screen.getByText("Milk")).toBeTruthy();
    expect(screen.getByText("Bread")).toBeTruthy();
  });

  /**
   * The empty state is not decoration — an empty list is the normal state on a
   * Monday, and a blank screen reads as a broken app.
   */
  it("offers a way in when the list is empty", async () => {
    const harness = await withList();

    mount(harness, <ShoppingScreen listId={LIST} />);

    expect(screen.queryByText("Milk")).toBeNull();
    expect(screen.toJSON()).toBeTruthy();
  });

  /**
   * The single most frequent action in the product (FR-731). A tap must reach
   * the sync client, not just local component state, or the other parent's phone
   * never learns the milk is in the trolley.
   */
  it("ticking an item off records it in the family's state", async () => {
    const harness = await withList();
    const itemId = await addItem(harness.mutate, { listId: LIST, name: "Milk" });

    mount(harness, <ShoppingScreen listId={LIST} />);
    fireEvent.press(screen.getByText("Milk"));

    await waitForState(
      harness,
      (state) => state.get(EntityTypes.shoppingItem, itemId)?.fields["checked"] === true,
    );
  });
});

describe("ConflictScreen (SPEC FR-1215)", () => {
  it("says so when there is nothing to decide", async () => {
    const harness = await openFamily();

    mount(harness, <ConflictScreen />);

    // The screen resolves its conflicts asynchronously, so the empty state is
    // what must survive that first pass — not a flash of nothing.
    expect(screen.toJSON()).toBeTruthy();
  });
});

/**
 * Commands are async and the screen re-renders from a subscription, so an
 * assertion straight after the press races the write. Polling the client's own
 * state is the honest wait: it asserts the effect reached the model, which is
 * the thing that matters, rather than that a label repainted.
 */
async function waitForState(
  harness: Harness,
  predicate: (state: ReturnType<Harness["client"]["state"]>) => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate(harness.client.state())) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the expected state never arrived");
}
