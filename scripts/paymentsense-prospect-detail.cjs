const { chromium } = require("@playwright/test");

function getArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function clean(value) {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function valueAfter(lines, label) {
  const index = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase());
  return index >= 0 ? clean(lines[index + 1]) : null;
}

async function text(locator) {
  const count = await locator.count();
  if (count === 0) return null;
  return clean(await locator.first().innerText().catch(() => null));
}

async function main() {
  const prospectId = getArg("prospect-id");
  if (!prospectId) throw new Error("--prospect-id is required");

  const authState = getArg("auth") ?? "playwright/.auth/paymentsense.json";
  const targetUrl = `https://sales.paymentsense.com/prospect/${encodeURIComponent(prospectId)}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: authState });
    const page = await context.newPage();

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#businessNameHeader").waitFor({ timeout: 30000 });

    const bodyText = await page.locator("body").innerText();
    const lines = bodyText.split(/\r?\n/).map(clean).filter(Boolean);
    const addressLines = await page.locator("ps-address .address-label").evaluateAll((nodes) =>
      nodes.map((node) => node.textContent?.replace(/\s+/g, " ").trim()).filter(Boolean)
    );

    const detail = {
      extractorVersion: 2,
      prospectId,
      businessName: await text(page.locator("#businessNameHeader")),
      sourceUrl: page.url(),
      channel: await text(page.locator("#channel")) ?? valueAfter(lines, "Channel:"),
      origin: await text(page.locator("#originDescription")) ?? valueAfter(lines, "Origin:"),
      createdOn: await text(page.locator("#createdDate")) ?? valueAfter(lines, "Created:"),
      hasPaymentsenseCustomerMatch: (await page.locator("#conflictWarningMessage").count()) > 0,
      address: {
        line1: addressLines[0] ?? null,
        line2: addressLines.length > 5 ? addressLines.slice(1, -4).join(", ") : null,
        town: addressLines.at(-4) ?? null,
        county: addressLines.at(-3) ?? null,
        postcode: addressLines.at(-2) ?? null,
        country: addressLines.at(-1) ?? null
      },
      contact: {
        name: await text(page.locator("#name-0")),
        phone: await text(page.locator("#phoneNumber-0")),
        email: await text(page.locator("#email-0"))
      }
    };

    console.log(JSON.stringify(detail));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
