import { describe, expect, it } from "vitest";
import { normalizeEmail, validateSignup } from "./validate-signup";

const good = { email: "Pat@Example.com", password: "correct-horse-battery", username: "pat" };

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Pat@Example.COM ")).toBe("pat@example.com");
  });
});

describe("validateSignup", () => {
  it("accepts a well-formed signup", () => {
    expect(validateSignup(good)).toEqual({ ok: true });
  });

  it("rejects an email without an @", () => {
    const result = validateSignup({ ...good, email: "pat.example.com" });
    expect(result).toEqual({ ok: false, field: "email", error: "email must have a local part and a domain" });
  });

  it("normalizes the email before checking it", () => {
    expect(validateSignup({ ...good, email: "  PAT@EXAMPLE.COM " })).toEqual({ ok: true });
  });
});
