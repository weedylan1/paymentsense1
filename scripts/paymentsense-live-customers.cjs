const { chromium } = require("@playwright/test");

function getArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function clean(value) {
  return value?.replace(/\s+/g, " ").trim() || null;
}

async function text(locator) {
  const count = await locator.count();
  if (count === 0) return null;
  return clean(await locator.first().innerText().catch(() => null));
}

async function main() {
  const query = getArg("query") ?? "";
  const authState = getArg("auth") ?? "playwright/.auth/paymentsense.json";
  const targetUrl = `https://search.paymentsense.com/?query=${encodeURIComponent(query)}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: authState });
    const page = await context.newPage();

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("Search...").waitFor({ timeout: 30000 });

    const customersTab = page.locator("#searchLabelCustomers").or(page.getByText("Customers").first());
    await customersTab.click();
    await page.locator("#location-customer-list_mat-table").waitFor({ timeout: 30000 });

    const rows = [];
    const rowLocators = page.locator("mat-row[id^='location-customer-link-']");
    const count = await rowLocators.count();

    for (let index = 0; index < count; index += 1) {
      const row = rowLocators.nth(index);
      rows.push({
        customerRef: await text(row.locator("#location-customer-list_customer-ref_content")),
        entity: await text(row.locator("#location-customer-list_company-name_content")),
        mid: await text(row.locator("#location-customer-list_location-id_content")),
        tradingName: await text(row.locator("#location-customer-list_trading-name_content")),
        tradingAddress: await text(row.locator("#location-customer-list_trading-address_content")),
        tradingPostcode: await text(row.locator("#location-customer-list_trading-post-code_content")),
        startDate: await text(row.locator("#location-customer-list_start-date_content")),
        status: await text(row.locator("#location-customer-list_status_content")),
        sourceUrl: page.url()
      });
    }

    console.log(JSON.stringify({
      query,
      searchUrl: targetUrl,
      extractedAt: new Date().toISOString(),
      rows
    }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
