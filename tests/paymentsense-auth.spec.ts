import { expect, test } from "@playwright/test";
import path from "node:path";

const authFile = path.join(process.cwd(), "playwright", ".auth", "paymentsense.json");
const targetUrl = process.env.PAYMENTSENSE_URL ?? "https://search.paymentsense.com/";

test("authenticate to Paymentsense Search", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign in" }).click();

  console.log("");
  console.log("Complete the sign-in flow in the opened browser window.");
  console.log("This setup will continue once the app is no longer on the landing sign-in page.");
  console.log("");

  await expect(page.getByRole("heading", { name: "Sign in to search" })).toBeHidden({
    timeout: 5 * 60 * 1000
  });

  await page.context().storageState({ path: authFile });
});
