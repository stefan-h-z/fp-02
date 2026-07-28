/**
 * That a change is *visible*, not merely recorded.
 *
 * Every other test in this directory asserts that a tap reached the family's
 * state, which is the half that syncs. This file asserts the other half: that
 * the screen in front of the person repaints. The two can come apart — a store
 * that mutates its snapshot in place satisfies every state assertion while
 * showing the person nothing — and when they do, the product is broken in the
 * one place a test suite full of green ticks would not look.
 *
 * The supermarket is the reason (FR-731): offline, a tick is confirmed by
 * nothing except the screen changing.
 */
import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { EntityTypes } from "@fam/domain";
import { addItem } from "../src/commands.js";
import { ShoppingScreen } from "../src/screens/ShoppingScreen.js";
import { RoutineScreen } from "../src/screens/RoutineScreen.js";
import { mount, openFamily, type Harness } from "./harness.js";

const LIST = "list-groceries";
const TASK = "task-morning-routine";

async function withList(): Promise<Harness> {
  const harness = await openFamily();
  await harness.mutate((b) => {
    b.create(EntityTypes.shoppingList, LIST, { name: "Groceries", domain: "food" });
  });
  return harness;
}

describe("a local change repaints the screen (SPEC FR-731, FR-1214)", () => {
  it("shows an item added while the screen is open", async () => {
    const harness = await withList();

    mount(harness, <ShoppingScreen listId={LIST} />);
    expect(screen.queryByText("Milk")).toBeNull();

    await addItem(harness.mutate, { listId: LIST, name: "Milk" });

    // Offline, nothing else will tell the person the milk went on the list.
    await waitFor(() => expect(screen.getByText("Milk")).toBeTruthy());
  });

  /**
   * The progress line is what a child reads to know the tick counted. It is
   * derived from the task's own field, so it only moves if the screen re-reads
   * the state — which makes it the honest probe for a repaint.
   */
  it("advances the routine's progress when a step is ticked", async () => {
    const harness = await openFamily();
    await harness.mutate((b) => {
      b.create(EntityTypes.task, TASK, {
        title: "Morning",
        ownerId: "person-kid",
        subtasks: [
          { id: "s1", title: "Brush teeth", icon: "toothbrush", done: false },
          { id: "s2", title: "Get dressed", icon: "shirt", done: false },
        ],
      });
    });

    mount(harness, <RoutineScreen taskId={TASK} />);
    expect(progressNow()).toBe(0);

    fireEvent.press(screen.getByTestId("routine-step-s1"));

    await waitFor(() => expect(progressNow()).toBe(50));
  });
});

/** The progress bar publishes its value for assistive technology; so can we. */
function progressNow(): number | undefined {
  const bar = screen.getByTestId("routine-progress");
  const value = bar.props["accessibilityValue"] as { now?: number } | undefined;
  return value?.now;
}
