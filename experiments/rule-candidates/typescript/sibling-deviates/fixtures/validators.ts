import type { ValidationError } from "../model.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{6,14}$/;

export function fail(field: string, message: string): ValidationError {
  return { field, message, code: `invalid_${field}` };
}

export function validateEmail(value: string): ValidationError | null {
  return EMAIL.test(value) ? null : fail("email", "must be an email address");
}

export function validatePhone(value: string): ValidationError | null {
  return E164.test(value) ? null : fail("phone", "must be in E.164 form");
}

export function validateName(value: string): ValidationError | null {
  const trimmed = value.trim();
  if (trimmed.length < 1) return fail("name", "must not be empty");
  if (trimmed.length > 120) return fail("name", "must be at most 120 characters");
  return null;
}

export function validatePostcode(value: string): ValidationError | null {
  return /^[A-Z0-9 -]{3,10}$/i.test(value) ? null : fail("postcode", "must be 3 to 10 characters");
}

export function validateCountry(value: string): ValidationError | null {
  return /^[A-Z]{2}$/.test(value) ? null : fail("country", "must be an ISO 3166-1 alpha-2 code");
}
