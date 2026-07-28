import { describe, expect, it } from "vitest";
import {
  celsiusToFahrenheit,
  convertOven,
  fahrenheitToCelsius,
  readOvenTemperature,
} from "../src/index.js";

/**
 * Convection is not a unit, it is a different oven (FR-533). The twenty-degree
 * rule of thumb is what a person at the hob needs; the code treats it as a rule
 * of thumb, not a promise.
 */
describe("oven temperatures (FR-533)", () => {
  it("converts between conventional and convection", () => {
    expect(convertOven({ celsius: 200, mode: "conventional" }, "convection")).toEqual({
      celsius: 180,
      mode: "convection",
    });
    expect(convertOven({ celsius: 180, mode: "convection" }, "conventional")).toEqual({
      celsius: 200,
      mode: "conventional",
    });
  });

  it("leaves a temperature alone when it is already in that mode", () => {
    const already = { celsius: 200, mode: "conventional" } as const;

    expect(convertOven(already, "conventional")).toBe(already);
  });

  /** No oven dial is finer than five degrees, so neither is the answer. */
  it("rounds to something a dial can be set to", () => {
    expect(convertOven({ celsius: 213, mode: "conventional" }, "convection").celsius).toBe(195);
  });

  it("converts Fahrenheit both ways", () => {
    expect(celsiusToFahrenheit(180)).toBe(356);
    expect(fahrenheitToCelsius(350)).toBe(177);
  });

  it("finds a temperature in a step, and notices when it is a fan oven", () => {
    expect(readOvenTemperature("Bake at 200 °C for 25 minutes")).toEqual({
      celsius: 200,
      mode: "conventional",
    });
    expect(readOvenTemperature("Bei 180°C Umluft backen")).toEqual({
      celsius: 180,
      mode: "convection",
    });
    expect(readOvenTemperature("Bake at 350 F")).toEqual({ celsius: 177, mode: "conventional" });
  });

  /** Guessing at a temperature that is not there would be worse than nothing. */
  it("returns nothing when a step names no temperature", () => {
    expect(readOvenTemperature("Simmer for 20 minutes")).toBeUndefined();
  });
});
