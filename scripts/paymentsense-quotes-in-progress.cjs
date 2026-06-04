const { chromium } = require("@playwright/test");

function getArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function getFlag(name) {
  return process.argv.includes(`--${name}`);
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

async function waitFor(condition, timeoutMs, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(message);
}

function quoteUrl(prospectId, quoteId) {
  return prospectId && quoteId
    ? `https://quote.paymentsense.com/prospect/${encodeURIComponent(prospectId)}/quote/${encodeURIComponent(quoteId)}`
    : null;
}

function prospectUrl(prospectId) {
  return prospectId
    ? `https://sales.paymentsense.com/prospect/${encodeURIComponent(prospectId)}`
    : null;
}

async function extractProspectDetail(context, prospectId) {
  const page = await context.newPage();
  try {
    await page.goto(prospectUrl(prospectId), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator("#businessNameHeader").waitFor({ timeout: 30000 });

    const bodyText = await page.locator("body").innerText();
    const lines = bodyText.split(/\r?\n/).map(clean).filter(Boolean);
    const addressLines = await page.locator("ps-address .address-label").evaluateAll((nodes) =>
      nodes.map((node) => node.textContent?.replace(/\s+/g, " ").trim()).filter(Boolean)
    );

    return {
      extractorVersion: 1,
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
  } finally {
    await page.close();
  }
}

async function main() {
  const authState = getArg("auth") ?? "playwright/.auth/paymentsense.json";
  const includeProspectDetails = getFlag("include-prospect-details");
  const maxProspectDetails = Number(getArg("max-prospect-details") ?? "0");
  const targetUrl = "https://sales.paymentsense.com/";
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ storageState: authState });
    const page = await context.newPage();

    let initialRequestPayload = null;
    let initialResponsePayload = null;
    const quoteResponses = [];

    page.on("request", (request) => {
      if (!initialRequestPayload && request.url().includes("/api/funnel/search-quotes/v2")) {
        initialRequestPayload = JSON.parse(request.postData() ?? "{}");
      }
    });

    page.on("response", async (response) => {
      if (!initialResponsePayload && response.url().includes("/api/funnel/search-quotes/v2")) {
        initialResponsePayload = await response.json().catch(() => null);
        if (initialResponsePayload) quoteResponses.push(initialResponsePayload);
      } else if (response.url().includes("/api/funnel/search-quotes/v2")) {
        const payload = await response.json().catch(() => null);
        if (payload) quoteResponses.push(payload);
      }
    });

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator("#mat-expansion-panel-header-2").click();
    await waitFor(
      () => initialRequestPayload && initialResponsePayload?.QuoteInProgress,
      60000,
      "Could not read Quotes in Progress from Paymentsense Sales."
    );

    if (!initialRequestPayload || !initialResponsePayload?.QuoteInProgress) {
      throw new Error("Could not read Quotes in Progress from Paymentsense Sales.");
    }

    const allQuotes = [];
    let stage = initialResponsePayload.QuoteInProgress;
    allQuotes.push(...(stage.results ?? []));

    while (stage.nextPageToken) {
      const responseCount = quoteResponses.length;
      const loadMore = page.getByRole("button", { name: "Load more" });
      await loadMore.waitFor({ state: "visible", timeout: 30000 }).catch(() => null);
      if ((await loadMore.count()) === 0) break;
      await loadMore.click();
      await waitFor(
        () => quoteResponses.length > responseCount,
        60000,
        "Timed out while loading more Quotes in Progress."
      );

      stage = quoteResponses.at(-1)?.QuoteInProgress;
      if (!stage) break;
      allQuotes.push(...(stage?.results ?? []));
    }

    const uniqueQuotes = Array.from(new Map(allQuotes.map((quote) => [quote.id, quote])).values());
    const prospectDetails = [];
    if (includeProspectDetails) {
      const prospectIds = Array.from(new Set(uniqueQuotes.map((quote) => quote.prospectId).filter(Boolean)));
      const take = maxProspectDetails > 0 ? prospectIds.slice(0, maxProspectDetails) : prospectIds;
      for (const prospectId of take) {
        prospectDetails.push(await extractProspectDetail(context, prospectId));
      }
    }

    console.log(JSON.stringify({
      extractorVersion: 1,
      sourceUrl: targetUrl,
      extractedAt: new Date().toISOString(),
      stage: "QuoteInProgress",
      totalCount: initialResponsePayload.QuoteInProgress.totalCount ?? uniqueQuotes.length,
      resultCount: uniqueQuotes.length,
      quotes: uniqueQuotes.map((quote) => ({
        ...quote,
        quoteUrl: quoteUrl(quote.prospectId, quote.id),
        prospectUrl: prospectUrl(quote.prospectId)
      })),
      prospectDetails
    }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
