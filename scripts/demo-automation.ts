import "dotenv/config";
import { chromium } from "@playwright/test";

const targetUrl = process.env.TARGET_URL ?? "https://example.com";

const browser = await chromium.launch({
  headless: process.env.HEADLESS !== "false"
});

try {
  const page = await browser.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

  console.log(`Title: ${await page.title()}`);
  console.log(`URL: ${page.url()}`);

  const firstHeading = await page.locator("h1").first().textContent().catch(() => null);
  if (firstHeading) {
    console.log(`First heading: ${firstHeading.trim()}`);
  }
} finally {
  await browser.close();
}
