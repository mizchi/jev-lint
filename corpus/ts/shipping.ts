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
  if (destination.country === "JP" && destination.postalCode.startsWith("1")) return 0;
  return destination.country === "JP" ? 2 : 9;
}

// CLEAN: the near-miss that set this rule's cutoff.
//
// This function was written as a throwaway to exercise review mode, and it came
// back at 0.69 against a cutoff of 0.61 -- a false positive on the first code
// outside the corpus the pack had ever seen. It is in the corpus permanently
// now, because a corpus that does not contain the hardest clean case it has
// actually met is a corpus that will keep producing that false positive.
//
// The name describes the computation: zero estimated days means today.
export function isDeliverableToday(destination: Address): boolean {
  return isDeliverable(destination) && estimatedDeliveryDays(destination) === 0;
}
