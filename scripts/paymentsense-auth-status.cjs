const { chromium } = require("@playwright/test");

function getArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const authState = getArg("auth") ?? "playwright/.auth/paymentsense.json";
  const targetUrl = "https://search.paymentsense.com/";

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: authState });
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2000);

    const unauthenticated = await page.getByRole("heading", { name: "Sign in to search" }).isVisible().catch(() => false);
    console.log(JSON.stringify({
      authenticated: !unauthenticated,
      url: page.url(),
      title: await page.title()
    }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
