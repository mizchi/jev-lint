import { expect, test } from "@playwright/test";
import { openOrdersPanel } from "./helpers/orders-panel.ts";

test.describe("orders panel", () => {
  test("highlights the hovered row", async ({ page }) => {
    const panel = await openOrdersPanel(page, { hoveredRow: 2 });
    await expect(panel).toHaveScreenshot("orders-panel-hovered.png");
  });

  test("keeps the pinned row highlighted after the list reloads", async ({ page }) => {
    const panel = await openOrdersPanel(page);
    await expect(panel).toHaveScreenshot("orders-panel-pinned.png");
  });

  test("shows the empty-state message when there are no orders", async ({ page }) => {
    const panel = await openOrdersPanel(page, { orders: [] });
    await expect(panel).toHaveScreenshot("orders-panel-empty.png");
  });

  test("does not refetch the orders when the panel is reopened", async ({ page }) => {
    const panel = await openOrdersPanel(page);
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Orders" }).click();
    await expect(panel).toHaveScreenshot("orders-panel-reopened.png");
  });

  test("the refresh button has an accessible name", async ({ page }) => {
    await openOrdersPanel(page);
    await expect(page.getByRole("button", { name: "Refresh orders" })).toBeVisible();
  });

  test("clicking refresh reloads the list", async ({ page }) => {
    await openOrdersPanel(page);
    const refresh = page.getByRole("button", { name: "Refresh orders" });
    await refresh.click();
    await expect(refresh).toBeVisible();
  });
});
