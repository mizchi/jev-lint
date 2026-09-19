// Corpus file.

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
  if (destination.country === "JP" && destination.postalCode.startsWith("1")) return 0;
  return destination.country === "JP" ? 2 : 9;
}

export function isDeliverableToday(destination: Address): boolean {
  return isDeliverable(destination) && estimatedDeliveryDays(destination) === 0;
}
