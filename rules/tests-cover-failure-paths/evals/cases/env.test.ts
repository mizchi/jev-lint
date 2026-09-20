import { describe, expect, it } from "vitest";
import { envFlag, optionalEnv, requireEnv } from "./env";

describe("optionalEnv", () => {
  it("returns the variable when it is set", () => {
    expect(optionalEnv("REGION", "us-east-1", { REGION: "eu-west-1" })).toBe("eu-west-1");
  });

  it("falls back when the variable is unset or empty", () => {
    expect(optionalEnv("REGION", "us-east-1", {})).toBe("us-east-1");
    expect(optionalEnv("REGION", "us-east-1", { REGION: "" })).toBe("us-east-1");
  });
});

describe("envFlag", () => {
  it("treats 1, true and yes as on, case-insensitively", () => {
    expect(envFlag("DEBUG", { DEBUG: "TRUE" })).toBe(true);
    expect(envFlag("DEBUG", { DEBUG: "yes" })).toBe(true);
  });

  it("treats anything else, including unset, as off", () => {
    expect(envFlag("DEBUG", {})).toBe(false);
    expect(envFlag("DEBUG", { DEBUG: "0" })).toBe(false);
  });
});
