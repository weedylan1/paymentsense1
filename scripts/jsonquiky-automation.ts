import "dotenv/config";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const targetUrl = process.env.TARGET_URL ?? "https://jester.click/jsonquiky/";
const outputDir = path.join(process.cwd(), "automation-output");
const outputPath = path.join(outputDir, "jsonquiky-export.json");

const importedJson = {
  tracks: [
    {
      pathUri: "https://jester.click/audio/automation-one.mp3",
      fileName: "automation-one.mp3",
      isInstrumental: false
    },
    {
      pathUri: "https://jester.click/audio/automation-two.mp3",
      fileName: "automation-two.mp3",
      isInstrumental: true
    }
  ]
};

const editedJson = {
  tracks: [
    {
      pathUri: "https://jester.click/audio/edited-track.mp3",
      fileName: "edited-track.mp3",
      isInstrumental: true
    },
    importedJson.tracks[1]
  ]
};

const browser = await chromium.launch({
  headless: process.env.HEADLESS !== "false"
});

try {
  const page = await browser.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

  await page.locator('input[type="file"]').setInputFiles({
    name: "jsonquiky-tracks.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importedJson, null, 2))
  });

  const liveOutput = page.locator("pre").last();
  await liveOutput.waitFor();

  await page.getByRole("button", { name: "Grid" }).click();
  await page.getByText("tracks(2)").waitFor();

  await page.getByRole("button", { name: "Raw" }).click();
  await page.locator("textarea").fill(JSON.stringify(editedJson, null, 2));

  await page.getByRole("button", { name: "Form" }).click();
  await page.locator('input[value="edited-track.mp3"]').waitFor();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;

  await mkdir(outputDir, { recursive: true });
  const downloadedPath = await download.path();
  if (downloadedPath) {
    await download.saveAs(outputPath);
  } else {
    await writeFile(outputPath, await liveOutput.textContent() ?? "", "utf8");
  }

  console.log(`Automated ${targetUrl}`);
  console.log(`Export saved to ${outputPath}`);
} finally {
  await browser.close();
}
