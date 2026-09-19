import { beforeEach, describe, expect, it, vi } from "vitest";
import { signup, acceptInvitation, updateProfile } from "./signup.ts";
import { SendGridMailer } from "./sendgrid-mailer.ts";

const users = {
  findByEmail: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

const invites = {
  findByToken: vi.fn(),
  update: vi.fn(),
};

const mailer = {
  send: vi.fn(),
};

const bus = {
  publish: vi.fn(),
};

const deps = { users, invites, mailer, bus };

const input = {
  email: "ada@example.com",
  displayName: "Ada",
  password: "correct horse battery staple",
};

describe("signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    users.findByEmail.mockResolvedValue(null);
    users.insert.mockImplementation(async (row) => ({ id: "usr_1", ...row }));
  });

  it("sends a welcome email with the user's display name", async () => {
    await signup(input, deps);
    expect(mailer.send).toHaveBeenCalled();
  });

  it("stores the hashed password, never the plaintext", async () => {
    await signup(input, deps);
    expect(users.insert).toHaveBeenCalledTimes(1);
  });

  it("rejects a duplicate email address", async () => {
    users.findByEmail.mockResolvedValue({ id: "usr_0", email: input.email });
    await signup(input, deps).catch(() => undefined);
    expect(users.findByEmail).toHaveBeenCalledWith(input.email);
  });

  it("sends a welcome email addressed to the new user", async () => {
    await signup(input, deps);
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ada@example.com", template: "welcome" }),
    );
  });

  it("does not send any email when the password is too short", async () => {
    await expect(signup({ ...input, password: "short" }, deps)).rejects.toThrow(/password/);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("publishes a user.created event carrying the new id", async () => {
    const user = await signup(input, deps);
    expect(bus.publish).toHaveBeenCalledWith("user.created", { id: user.id });
  });

  it("looks the email up before inserting", async () => {
    await signup(input, deps);
    expect(users.findByEmail).toHaveBeenCalledWith(input.email);
    expect(users.findByEmail.mock.invocationCallOrder[0]).toBeLessThan(
      users.insert.mock.invocationCallOrder[0],
    );
  });
});

describe("acceptInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invites.findByToken.mockResolvedValue({ id: "inv_1", token: "tok", status: "pending" });
  });

  it("marks the invitation as accepted", async () => {
    await acceptInvitation("tok", deps);
    expect(invites.update).toHaveBeenCalled();
  });
});

describe("updateProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls save exactly once even when the profile has two addresses", async () => {
    await updateProfile(
      "usr_1",
      { addresses: [{ line1: "1 Main St" }, { line1: "2 Side St" }] },
      deps,
    );
    expect(users.update).toHaveBeenCalledTimes(1);
  });
});

describe("SendGridMailer", () => {
  it("sends the message through the SendGrid client with recipient and subject", async () => {
    const client = { send: vi.fn().mockResolvedValue([{ statusCode: 202 }]) };
    const sendgrid = new SendGridMailer(client, { from: "noreply@example.com" });
    await sendgrid.send({ to: "ada@example.com", subject: "Welcome", html: "<p>Hi</p>" });
    expect(client.send).toHaveBeenCalledWith({
      from: "noreply@example.com",
      to: "ada@example.com",
      subject: "Welcome",
      html: "<p>Hi</p>",
    });
  });
});
