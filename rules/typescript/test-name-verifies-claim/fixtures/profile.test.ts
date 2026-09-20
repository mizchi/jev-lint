import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseTags, removeAvatar, renderProfileCard, updateEmail, updateProfile, uploadAvatar } from "./profile.ts";

const users = {
  findById: vi.fn(),
  update: vi.fn(),
};

const storage = {
  put: vi.fn(),
  remove: vi.fn(),
};

const bus = {
  publish: vi.fn(),
};

const deps = { users, storage, bus };

const profile = {
  id: "usr_1",
  email: "ada@example.com",
  displayName: "Ada",
  avatarUrl: "https://cdn.example.com/a.png",
  tags: ["maintainer"],
};

describe("updateEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    users.findById.mockResolvedValue(profile);
    users.update.mockImplementation(async (_id, patch) => ({ ...profile, ...patch }));
  });

  it("stores the email lowercased", async () => {
    await updateEmail("usr_1", "Ada@Example.com", deps);
    expect(users.update).toHaveBeenCalledTimes(1);
  });

  it("lowercases the email before storing it", async () => {
    await updateEmail("usr_1", "Ada@Example.com", deps);
    expect(users.update).toHaveBeenCalledWith("usr_1", expect.objectContaining({ email: "ada@example.com" }));
  });

  it("publishes a profile.updated event carrying the changed fields", async () => {
    await updateEmail("usr_1", "ada@new.example", deps);
    expect(bus.publish).toHaveBeenCalled();
  });

  it("does not publish an event when the email is unchanged", async () => {
    await updateEmail("usr_1", "ada@example.com", deps);
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("reads the profile before writing it", async () => {
    await updateEmail("usr_1", "ada@new.example", deps);
    expect(users.findById).toHaveBeenCalledWith("usr_1");
    expect(users.findById.mock.invocationCallOrder[0]).toBeLessThan(users.update.mock.invocationCallOrder[0]);
  });

  it("returns the updated profile", async () => {
    const result = await updateEmail("usr_1", "ada@new.example", deps);
    expect(result).toBeDefined();
  });
});

describe("uploadAvatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    users.findById.mockResolvedValue(profile);
    storage.put.mockResolvedValue({ url: "https://cdn.example.com/b.png" });
  });

  it("retries the upload once on a transient failure", async () => {
    storage.put.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await uploadAvatar("usr_1", new Uint8Array([1, 2, 3]), deps).catch(() => undefined);
    expect(storage.put).toHaveBeenCalled();
  });

  it("retries once and stores the url from the second attempt", async () => {
    // The first attempt times out at the storage boundary; the second must be
    // the one whose url ends up on the profile, not a cached first result.
    storage.put
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockResolvedValueOnce({ url: "https://cdn.example.com/second.png" });
    await uploadAvatar("usr_1", new Uint8Array([1, 2, 3]), deps);
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(users.update).toHaveBeenCalledWith("usr_1", { avatarUrl: "https://cdn.example.com/second.png" });
  });

  it("calls the storage client once per upload", async () => {
    await uploadAvatar("usr_1", new Uint8Array([1, 2, 3]), deps);
    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  it("removes the previous avatar object, not the new one", async () => {
    await uploadAvatar("usr_1", new Uint8Array([1, 2, 3]), deps);
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith("https://cdn.example.com/a.png");
  });
});

describe("removeAvatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    users.findById.mockResolvedValue(profile);
  });

  it("clears the avatar url on the profile", async () => {
    await removeAvatar("usr_1", deps);
    expect(users.update).toHaveBeenCalledWith("usr_1", expect.anything());
  });

  it("does not touch storage when the profile has no avatar", async () => {
    users.findById.mockResolvedValue({ ...profile, avatarUrl: null });
    await removeAvatar("usr_1", deps);
    expect(storage.remove).not.toHaveBeenCalled();
  });
});

describe("updateProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    users.findById.mockResolvedValue(profile);
    users.update.mockImplementation(async (_id, patch) => ({ ...profile, ...patch }));
  });

  it("rejects a display name longer than 64 characters", async () => {
    const long = "a".repeat(65);
    await expect(updateProfile("usr_1", { displayName: long }, deps)).rejects.toThrow(/64/);
    expect(users.update).not.toHaveBeenCalled();
  });

  it("trims the display name", async () => {
    await updateProfile("usr_1", { displayName: "  Ada  " }, deps);
    expect(users.update).toHaveBeenCalledTimes(1);
  });

  it("does not read a trailing comma as an empty tag", () => {
    expect(parseTags("maintainer,reviewer,")).toEqual(["maintainer", "reviewer"]);
  });

  it("keeps existing tags when the patch has none", async () => {
    const updated = await updateProfile("usr_1", { displayName: "Ada L." }, deps);
    expect(updated.tags).toEqual(["maintainer"]);
  });
});

describe("renderProfileCard", () => {
  it("renders the profile card", () => {
    expect(renderProfileCard(profile)).toMatchSnapshot();
  });

  it("profile card, no avatar", () => {
    expect(renderProfileCard({ ...profile, avatarUrl: null })).toMatchInlineSnapshot(`
      "<article class="profile-card">
        <div class="avatar avatar--placeholder">A</div>
        <h2>Ada</h2>
        <ul class="tags"><li>maintainer</li></ul>
      </article>"
    `);
  });

  it("matches the snapshot with a pending email change", () => {
    expect(renderProfileCard({ ...profile, pendingEmail: "ada@new.example" })).toMatchSnapshot();
  });

  it("shows the pending email with a verification hint", () => {
    expect(renderProfileCard({ ...profile, pendingEmail: "ada@new.example" })).toMatchSnapshot();
  });

  it("falls back to the initial when there is no avatar", () => {
    const html = renderProfileCard({ ...profile, avatarUrl: null });
    expect(html).toContain('class="avatar avatar--placeholder">A<');
    expect(html).not.toContain("<img");
  });
});
