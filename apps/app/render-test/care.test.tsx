/**
 * The two screens a child and a carer touch (SPEC §12, §13).
 *
 * The routine is the one screen in the product operated by someone who cannot
 * read, and the protocol screen is the one where a mistaken tap has a physical
 * consequence. Both are asserted through the sync client rather than through
 * component state: the whole point of the double-dose rule is that the *other*
 * parent's phone already knows.
 */
import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { EntityTypes } from "@fam/domain";
import { ProtocolScreen } from "../src/screens/ProtocolScreen.js";
import { RoutineScreen } from "../src/screens/RoutineScreen.js";
import { mount, openFamily, waitForState, NOW, type Harness } from "./harness.js";

const HOUR_MS = 60 * 60 * 1000;
const TASK = "task-morning-routine";
const PROTOCOL = "proto-antibiotic";

async function withRoutine(): Promise<Harness> {
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
  return harness;
}

describe("RoutineScreen (SPEC §12.2, FR-1206)", () => {
  it("shows the steps and how far along the child is", async () => {
    const harness = await withRoutine();

    mount(harness, <RoutineScreen taskId={TASK} />);

    expect(screen.getByText("Brush teeth")).toBeTruthy();
    expect(screen.getByText("Get dressed")).toBeTruthy();
    expect(screen.getByTestId("routine-progress")).toBeTruthy();
  });

  /**
   * A four-year-old tapping their own step is the feature (FR-1207), and it has
   * to reach the family's state — the parent's phone is what shows that the
   * morning is going to plan.
   */
  it("records the child's own tick", async () => {
    const harness = await withRoutine();

    mount(harness, <RoutineScreen taskId={TASK} />);
    fireEvent.press(screen.getByTestId("routine-step-s1"));

    await waitForState(harness, (state) => stepDone(state, "s1"));
  });

  /**
   * Completing every step must NOT close the task: a child's task carries an
   * approval gate (FR-312), and silently closing it would take the parent's
   * look-over away.
   */
  it("does not close the task when the last step is ticked", async () => {
    const harness = await withRoutine();

    mount(harness, <RoutineScreen taskId={TASK} />);

    // `waitFor` rather than polling the client, and the difference matters here.
    // A step writes the whole `subtasks` array as the array that *render* saw,
    // so the second tap is only safe once the screen has re-rendered with the
    // first tick in it. Polling the client would see the write land and press
    // again too early, and the second write — still built from the untouched
    // list — would silently undo the first. `waitFor` flushes the re-render,
    // which is what a child tapping, seeing the tick, and tapping again does.
    fireEvent.press(screen.getByTestId("routine-step-s1"));
    await waitFor(() => expect(stepDone(harness.client.state(), "s1")).toBe(true));

    fireEvent.press(screen.getByTestId("routine-step-s2"));
    await waitFor(() => expect(stepDone(harness.client.state(), "s2")).toBe(true));

    expect(stepDone(harness.client.state(), "s1")).toBe(true);
    expect(harness.client.state().get(EntityTypes.task, TASK)?.fields["completedAt"]).toBeUndefined();
  });
});

describe("ProtocolScreen (SPEC §13.2)", () => {
  async function withProtocol(): Promise<Harness> {
    const harness = await openFamily();
    await harness.mutate((b) => {
      b.create(EntityTypes.protocol, PROTOCOL, {
        personId: "person-kid",
        label: "Antibiotic",
        kind: "acknowledgement",
        startsAt: NOW - HOUR_MS,
        endsAt: NOW + 5 * 24 * HOUR_MS,
        frequencyKind: "every-n-hours",
        frequencyValue: 8,
        instruction: "5 ml with food",
      });
    });
    return harness;
  }

  it("shows the instruction with the doses, where it cannot be missed", async () => {
    const harness = await withProtocol();

    mount(harness, <ProtocolScreen protocolId={PROTOCOL} />);

    expect(screen.getByText("5 ml with food")).toBeTruthy();
  });

  /**
   * The scenario the module exists for (SPEC §13.2): one parent acknowledges a
   * dose, and the record has to be in the family's state — not this device's —
   * or the other parent gives it a second time.
   */
  it("records who gave the dose, in the family's state", async () => {
    const harness = await withProtocol();

    mount(harness, <ProtocolScreen protocolId={PROTOCOL} />);
    const acknowledge = screen.getAllByTestId(/^ack-/)[0];
    expect(acknowledge).toBeTruthy();
    fireEvent.press(acknowledge!);

    await waitForState(harness, (state) =>
      state
        .all(EntityTypes.protocolInstance)
        .some((instance) => instance.fields["state"] === "acknowledged"),
    );
  });
});

/** Reads one step's tick out of the whole-array field the task stores. */
function stepDone(state: ReturnType<Harness["client"]["state"]>, stepId: string): boolean {
  const subtasks = state.get(EntityTypes.task, TASK)?.fields["subtasks"];
  if (!Array.isArray(subtasks)) return false;
  return subtasks.some(
    (step) =>
      typeof step === "object" &&
      step !== null &&
      (step as { id?: string }).id === stepId &&
      (step as { done?: boolean }).done === true,
  );
}
