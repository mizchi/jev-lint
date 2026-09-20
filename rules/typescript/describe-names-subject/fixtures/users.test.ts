import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryUserRepository, UserRepository } from "../src/user_repository";
import { deleteUser, deactivateUser, validateEmail, normalizeEmail, parseDuration } from "../src/users";
import { requestReset, completeReset } from "../src/password";

let repo: UserRepository;
beforeEach(async () => {
  repo = new InMemoryUserRepository();
  await repo.create({ id: "u1", email: "a@b.co", status: "active" });
});

describe("deleteUser", () => {
  it("marks the user inactive", async () => {
    await deactivateUser(repo, "u1");
    expect((await repo.get("u1"))?.status).toBe("inactive");
  });

  it("keeps the row for auditing", async () => {
    await deactivateUser(repo, "u1");
    expect(await repo.get("u1")).toBeDefined();
  });

  it("is idempotent", async () => {
    await deactivateUser(repo, "u1");
    await deactivateUser(repo, "u1");
    expect((await repo.get("u1"))?.status).toBe("inactive");
  });
});

describe("validateEmail", () => {
  it("lowercases the domain", () => {
    expect(normalizeEmail("Bob@Example.COM")).toBe("Bob@example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  a@b.co ")).toBe("a@b.co");
  });

  it("leaves the local part's case alone", () => {
    expect(normalizeEmail("Bob@example.com")).toBe("Bob@example.com");
  });
});

describe("UserRepository", () => {
  describe("findByEmail", () => {
    it("matches case-insensitively on the domain", async () => {
      expect(await repo.findByEmail("a@B.CO")).toMatchObject({ id: "u1" });
    });

    it("returns null when nobody matches", async () => {
      expect(await repo.findByEmail("zz@b.co")).toBeNull();
    });
  });

  describe("create", () => {
    it("rejects a duplicate email", async () => {
      await expect(repo.create({ id: "u2", email: "a@b.co", status: "active" })).rejects.toThrow(/exists/);
    });
  });
});

describe("password reset", () => {
  it("issues a token that completes the reset once", async () => {
    const token = await requestReset(repo, "a@b.co");
    await completeReset(repo, token, "new-pass-1");
    await expect(completeReset(repo, token, "new-pass-2")).rejects.toThrow(/used/);
  });

  it("does not reveal whether the email exists", async () => {
    await expect(requestReset(repo, "nobody@b.co")).resolves.toBeTypeOf("string");
  });
});

describe.each([
  ["1s", 1000],
  ["2m", 120_000],
  ["1h30m", 5_400_000],
])("parseDuration(%s)", (input, expected) => {
  it(`gives ${expected} ms`, () => {
    expect(parseDuration(input)).toBe(expected);
  });
});

describe("deleteUser removes the row", () => {
  it("returns true when a user was removed", async () => {
    expect(await deleteUser(repo, "u1")).toBe(true);
    expect(await repo.get("u1")).toBeNull();
  });

  it("returns false for an unknown id", async () => {
    expect(await deleteUser(repo, "nope")).toBe(false);
  });

  it("validateEmail still accepts the removed address", () => {
    expect(validateEmail("a@b.co")).toBe(true);
  });
});
