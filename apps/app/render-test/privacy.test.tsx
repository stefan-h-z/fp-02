/**
 * The two screens with legal weight (SPEC §4.3, §14).
 *
 * Settings is where a person exercises Art. 15 and Art. 17 rights, and join is
 * where a household is created without anyone inventing a password. Both are
 * asserted for what they must *not* do as much as what they do: erasure never
 * runs without a confirmation, and no field on the join screen asks for a
 * password.
 */
import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AuthClient, type DeviceSession } from "@fam/api";
import { EntityTypes } from "@fam/domain";
import { JoinScreen } from "../src/screens/JoinScreen.js";
import { SettingsScreen } from "../src/screens/SettingsScreen.js";
import { mount, openFamily, type Harness } from "./harness.js";

async function withSomeData(): Promise<Harness> {
  const harness = await openFamily();
  await harness.mutate((b) => {
    b.create(EntityTypes.person, "person-mum", { name: "Anna" });
    b.create(EntityTypes.shoppingList, "list-groceries", { name: "Groceries", domain: "food" });
    b.create(EntityTypes.shoppingItem, "item-milk", {
      listId: "list-groceries",
      name: "Milk",
      addedBy: "person-mum",
    });
  });
  return harness;
}

describe("SettingsScreen (SPEC §14, FR-1414)", () => {
  /**
   * Art. 15 is a right to a copy, not to a promise of one, so the bundle has to
   * be produced on the device and shown — not described.
   */
  it("produces the export bundle on the spot", async () => {
    const harness = await withSomeData();

    mount(harness, <SettingsScreen personId="person-mum" />);
    fireEvent.press(screen.getByTestId("privacy-export"));

    await waitFor(() => expect(screen.getByTestId("privacy-export-json-input")).toBeTruthy());
    const bundle = screen.getByTestId("privacy-export-json-input").props["value"] as string;
    expect(bundle).toContain("Milk");
  });

  /**
   * The destructive path must cost a second, deliberate act. A single tap that
   * erases a person is a bug regardless of how clearly it is labelled.
   */
  it("does not erase anything on the first tap", async () => {
    const harness = await withSomeData();

    mount(harness, <SettingsScreen personId="person-mum" />);
    fireEvent.press(screen.getByTestId("privacy-delete"));

    expect(screen.getByTestId("privacy-delete-confirm")).toBeTruthy();
    expect(harness.client.state().get(EntityTypes.person, "person-mum")?.deleted).toBeFalsy();
  });
});

describe("JoinScreen (SPEC §4.3, FR-118)", () => {
  /** Never reached: every test here stops before a request would be sent. */
  const auth = new AuthClient({
    baseUrl: "https://example.invalid",
    fetchImpl: () => Promise.reject(new Error("the join tests must not reach the network")),
  });

  const onJoined = (_session: DeviceSession): void => undefined;

  it("offers the three ways in, link first", async () => {
    const harness = await openFamily();

    mount(harness, <JoinScreen auth={auth} onJoined={onJoined} />);

    expect(screen.getByTestId("join-invite")).toBeTruthy();
    expect(screen.getByTestId("join-create")).toBeTruthy();
    expect(screen.getByTestId("join-recover")).toBeTruthy();
  });

  /**
   * The adoption promise in one assertion (SPEC §4.2): there is no password on
   * this screen, so there is none to forget and none to lock the second adult
   * out with.
   */
  it("asks for no password anywhere", async () => {
    const harness = await openFamily();

    mount(harness, <JoinScreen auth={auth} onJoined={onJoined} />);
    fireEvent.press(screen.getByTestId("join-create"));

    expect(screen.getByTestId("family-name")).toBeTruthy();
    expect(screen.getByTestId("person-name")).toBeTruthy();
    expect(screen.queryByTestId("password")).toBeNull();
    expect(screen.queryByText(/[Pp]asswort|[Pp]assword/)).toBeNull();
  });

  /** An invitation link opens straight into redeeming it, with nothing to type. */
  it("starts on the invitation step when opened from a link", async () => {
    const harness = await openFamily();

    mount(harness, <JoinScreen auth={auth} onJoined={onJoined} inviteToken="tok-123" />);

    expect(screen.getByTestId("invite-token-input").props["value"]).toBe("tok-123");
  });
});
