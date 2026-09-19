import { describe, expect, it } from "vitest";
import { renderOrderSummary, formatReceipt, type OrderView } from "./order-summary.ts";
import { parseRows } from "./test-utils/html.ts";

const order: OrderView = {
  id: "ord_42",
  currency: "EUR",
  items: [
    { sku: "SKU-3", name: "Desk lamp", priceCents: 4500, qty: 1 },
    { sku: "SKU-1", name: "Notebook", priceCents: 900, qty: 3 },
    { sku: "SKU-2", name: "Pen", priceCents: 250, qty: 10 },
  ],
  discountCents: 0,
  shippingCents: 499,
};

describe("renderOrderSummary", () => {
  it("renders the error state when the request fails", () => {
    const html = renderOrderSummary({ state: "error", error: new Error("timeout") });
    expect(html).toMatchSnapshot();
  });

  it("sorts line items by price, cheapest first", () => {
    const html = renderOrderSummary({ state: "ready", order });
    expect(html).toMatchInlineSnapshot(`
      "<section class="order-summary" data-order="ord_42">
        <table>
          <thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
          <tbody>
            <tr data-sku="SKU-2"><td>Pen</td><td>10</td><td>€2.50</td></tr>
            <tr data-sku="SKU-1"><td>Notebook</td><td>3</td><td>€9.00</td></tr>
            <tr data-sku="SKU-3"><td>Desk lamp</td><td>1</td><td>€45.00</td></tr>
          </tbody>
        </table>
        <dl class="totals">
          <dt>Shipping</dt><dd>€4.99</dd>
          <dt>Total</dt><dd>€101.69</dd>
        </dl>
      </section>"
    `);
  });

  it("hides the discount row when no discount applies", () => {
    const html = renderOrderSummary({ state: "ready", order });
    expect(html).toMatchSnapshot();
  });

  it("matches the snapshot for a three-item order", () => {
    const html = renderOrderSummary({ state: "ready", order });
    expect(html).toMatchSnapshot();
  });

  it("renders", () => {
    expect(renderOrderSummary({ state: "loading" })).toMatchSnapshot();
  });

  it("shows the error message when the request fails", () => {
    const html = renderOrderSummary({ state: "error", error: new Error("timeout") });
    expect(html).toContain("Something went wrong");
    expect(html).toMatchSnapshot();
  });

  it("orders the rows by unit price ascending", () => {
    const html = renderOrderSummary({ state: "ready", order });
    const rows = parseRows(html);
    expect(rows.map((r) => r.sku)).toEqual(["SKU-2", "SKU-1", "SKU-3"]);
    expect(html).toMatchSnapshot();
  });

  it("renders an empty-cart message when there are no items", () => {
    const html = renderOrderSummary({ state: "ready", order: { ...order, items: [] } });
    expect(html).toMatchInlineSnapshot(`"<p class="empty">Your cart is empty</p>"`);
  });

  it("includes the discount row when a discount applies", () => {
    const html = renderOrderSummary({
      state: "ready",
      order: { ...order, discountCents: 1000 },
    });
    expect(parseRows(html, ".totals").map((r) => r.label)).toContain("Discount");
  });
});

describe("formatReceipt", () => {
  it("formats the total in the customer's currency", () => {
    const receipt = formatReceipt({ ...order, currency: "JPY" });
    expect(receipt).toMatchSnapshot();
  });

  it("renders the receipt for a single-item order", () => {
    const receipt = formatReceipt({ ...order, items: order.items.slice(0, 1) });
    expect(receipt).toMatchSnapshot();
  });

  it("prints amounts with two decimals for EUR", () => {
    const receipt = formatReceipt(order);
    expect(receipt).toMatch(/Total\s+€101\.69/);
  });
});
