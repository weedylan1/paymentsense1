import "dotenv/config";
import { chromium } from "@playwright/test";

const targetUrl = process.env.PAYMENTSENSE_URL ?? "https://search.paymentsense.com/";
const searchTerm = process.env.PAYMENTSENSE_SEARCH_TERM ?? "zzzzzz-codex-no-results";

const browser = await chromium.launch({
  headless: process.env.HEADLESS !== "false"
});

try {
  const context = await browser.newContext({
    storageState: "playwright/.auth/paymentsense.json"
  });
  const page = await context.newPage();

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Search...").waitFor();

  await page.getByPlaceholder("Search...").fill(searchTerm);
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(750);

  const acceptedValue = await page.getByPlaceholder("Search...").inputValue();

  console.log(`Opened ${targetUrl}`);
  console.log(`Search term entered: ${searchTerm}`);
  console.log(`Search input value: ${acceptedValue}`);
} finally {
  await browser.close();
}
