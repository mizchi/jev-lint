// Corpus file.
// CLEAN (module-name-describes-contents): the file is called
// `shipping` and every public item is about shipping. Someone looking for this
// logic would look here.

export interface Address {
  country: string;
  postalCode: string;
}

export function shippingCostCents(weightGrams: number, destination: Address): number {
  const base = destination.country === "JP" ? 500 : 2500;
  return base + Math.ceil(weightGrams / 500) * 100;
}

export function isDeliverable(destination: Address): boolean {
  return destination.country !== "" && destination.postalCode.length >= 3;
}

export function estimatedDeliveryDays(destination: Address): number {
  return destination.country === "JP" ? 2 : 9;
}
