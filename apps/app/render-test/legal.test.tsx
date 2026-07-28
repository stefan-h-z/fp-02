/**
 * The three texts, on screen (FR-1401, FR-1402, FR-1404).
 *
 * The domain tests assert the documents are complete and honest about what is
 * missing. These assert the other half of the obligation: that a person can
 * actually read them — without an account, which is why the screen takes no
 * props and needs no session.
 */
import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { DATA_FLOWS } from "@fam/domain";
import { LegalScreen } from "../src/screens/LegalScreen.js";
import { mount, openFamily } from "./harness.js";

describe("LegalScreen", () => {
  it("opens on the privacy policy and shows its version", async () => {
    const harness = await openFamily();

    mount(harness, <LegalScreen />);

    // The German catalog is the default, so the German document is what renders.
    expect(screen.getByText(/Fassung .* gültig ab/)).toBeTruthy();
    expect(screen.getByText("Wer verantwortlich ist")).toBeTruthy();
  });

  /**
   * The one assertion that would fail silently if the screen quietly rendered a
   * finished-looking document: the reader is told which parts are still open.
   */
  it("says out loud that the document is unfinished", async () => {
    const harness = await openFamily();

    mount(harness, <LegalScreen />);

    expect(screen.getByTestId("legal-privacy-incomplete")).toBeTruthy();
  });

  it("reaches the provider identification", async () => {
    const harness = await openFamily();

    mount(harness, <LegalScreen />);
    fireEvent.press(screen.getByTestId("legal-tab-provider"));

    expect(screen.getByText("Anschrift: «to be completed by the operator»")).toBeTruthy();
  });

  /**
   * FR-1404. Every recipient the system can send data to has to be on this
   * list, so the test counts rather than sampling — a new connector added
   * without disclosing it fails here.
   */
  it("lists every recipient data can reach", async () => {
    const harness = await openFamily();

    mount(harness, <LegalScreen />);
    fireEvent.press(screen.getByTestId("legal-tab-flows"));

    for (const flow of DATA_FLOWS) {
      expect(screen.getByText(flow.recipient)).toBeTruthy();
    }
  });
});
