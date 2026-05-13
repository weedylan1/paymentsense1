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

    const prospectsTab = page.locator("#searchLabelProspects").or(page.getByText("Prospects").first());
    await prospectsTab.click();
    await page.locator("#prospect-list_mat-table").waitFor({ timeout: 30000 });

    const rows = [];
    const rowLocators = page.locator("mat-row[id^='prospect-link-']");
    const count = await rowLocators.count();

    for (let index = 0; index < count; index += 1) {
      const row = rowLocators.nth(index);
      rows.push({
        prospectId: await text(row.locator("#prospect-list_prospect-id_content")),
        businessName: await text(row.locator("#prospect-list_business-name_content")),
        contactName: await text(row.locator("#prospect-list_contact-name_content")),
        contactEmail: await text(row.locator("#prospect-list_primary-contact_link")),
        createdOn: await text(row.locator("#prospect-list_created-date_content")),
        ownerName: await text(row.locator("#prospect-list_owner_content")),
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
