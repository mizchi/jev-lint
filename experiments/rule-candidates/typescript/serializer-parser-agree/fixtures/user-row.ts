export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
}

export function toUserRow(user: User): UserRow {
  return {
    id: user.id,
    email: user.email.toLowerCase(),
    display_name: user.displayName,
    created_at: user.createdAt.toISOString(),
  };
}

export function fromUserRow(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.displayName),
    createdAt: new Date(String(row.created_at)),
  };
}

export interface Address {
  street: { line1: string; line2?: string };
  city: string;
  postalCode: string;
  country: string;
}

export function toAddressRow(address: Address): Record<string, unknown> {
  return {
    street_line1: address.street.line1,
    street_line2: address.street.line2 ?? null,
    city: address.city,
    postal_code: address.postalCode,
    country_code: address.country.toUpperCase(),
  };
}

export function fromAddressRow(row: Record<string, unknown>): Address {
  return {
    street: {
      line1: String(row.street_line1),
      line2: row.street_line2 == null ? undefined : String(row.street_line2),
    },
    city: String(row.city),
    postalCode: String(row.postal_code),
    country: String(row.country_code),
  };
}
