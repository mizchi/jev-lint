import type { Cart } from "./cart.ts";
import { chargeCard } from "./payments.ts";
import type { Session } from "./session.ts";

export class EmptyCartError extends Error {
  constructor() {
    super("nothing to check out");
  }
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("checkout needs a signed-in user");
  }
}

export interface Receipt {
  email: string;
  chargeId: string;
  totalCents: number;
}

export async function checkout(session: Session, cart: Cart): Promise<Receipt> {
  if (cart.items.length === 0) throw new EmptyCartError();
  if (!session.user) throw new UnauthenticatedError();
  const totalCents = cart.items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const email = session.user.email;
  const charge = await chargeCard(session.user.paymentMethodId, totalCents);
  return { email, chargeId: charge.id, totalCents };
}
