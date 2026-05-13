import { expect, test } from "@playwright/test";

test("target page loads", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/.+/);
});
