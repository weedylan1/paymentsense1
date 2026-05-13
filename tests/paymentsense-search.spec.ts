import { expect, test } from "@playwright/test";

const targetUrl = process.env.PAYMENTSENSE_URL ?? "https://search.paymentsense.com/";
const searchTerm = process.env.PAYMENTSENSE_SEARCH_TERM ?? "zzzzzz-codex-no-results";

test.use({ storageState: "playwright/.auth/paymentsense.json" });

test("can enter a search term in Paymentsense Search", async ({ page }) => {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

  const searchInput = page.getByPlaceholder("Search...");
  await expect(searchInput).toBeVisible();

  await searchInput.fill(searchTerm);
  await page.keyboard.press("Enter");

  await expect(searchInput).toHaveValue(searchTerm);
});
