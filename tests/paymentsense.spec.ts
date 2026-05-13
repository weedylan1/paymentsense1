import { expect, test } from "@playwright/test";

const targetUrl = process.env.PAYMENTSENSE_URL ?? "https://search.paymentsense.com/";

test.use({ storageState: "playwright/.auth/paymentsense.json" });

test("opens Paymentsense Search with saved authentication", async ({ page }) => {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle(/Search/i);
  await expect(page.getByRole("heading", { name: "Sign in to search" })).toBeHidden();
});
