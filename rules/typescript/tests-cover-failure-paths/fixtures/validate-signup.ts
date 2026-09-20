export interface SignupInput {
  email: string;
  password: string;
  username: string;
}

export type Validation = { ok: true } | { ok: false; field: keyof SignupInput; error: string };

const RESERVED_USERNAMES = new Set(["admin", "root", "support", "system"]);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateSignup(input: SignupInput): Validation {
  const email = normalizeEmail(input.email);
  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    return { ok: false, field: "email", error: "email must have a local part and a domain" };
  }
  if (input.password.length < 12) {
    return { ok: false, field: "password", error: "password must be at least 12 characters" };
  }
  if (RESERVED_USERNAMES.has(input.username.toLowerCase())) {
    return { ok: false, field: "username", error: `username ${input.username} is reserved` };
  }
  return { ok: true };
}
