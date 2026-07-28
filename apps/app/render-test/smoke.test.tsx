import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { TamaguiProvider, Theme } from "@tamagui/core";
import { tamaguiConfig } from "@cp/tokens";
import { Text } from "@cp/ui";

describe("harness", () => {
  it("renders a design-system primitive", () => {
    render(
      <TamaguiProvider config={tamaguiConfig as never} defaultTheme="light">
        <Theme name="light">
          <Text role="body">hello</Text>
        </Theme>
      </TamaguiProvider>,
    );
    expect(screen.getByText("hello")).toBeTruthy();
  });
});
