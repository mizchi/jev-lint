import { randomUUID } from "node:crypto";
import type { Order, Invoice, Customer, Shipment } from "../model.ts";

export function createOrder(customerId: string, lines: Order["lines"]): Order {
  return { id: randomUUID(), customerId, lines, status: "draft", createdAt: new Date() };
}

export function makeInvoice(orderId: string, totalCents: number): Invoice {
  return { id: randomUUID(), orderId, totalCents, paid: false, issuedAt: new Date() };
}

export function newCustomer(email: string, name: string): Customer {
  return { id: randomUUID(), email, name, createdAt: new Date() };
}

export function buildShipment(orderId: string, address: Shipment["address"]): Shipment {
  return { id: randomUUID(), orderId, address, dispatchedAt: null };
}
