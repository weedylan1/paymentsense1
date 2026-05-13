import { expect, test } from "@playwright/test";
import path from "node:path";

const jsonQuikyUrl = "https://jester.click/jsonquiky/";

test("imports, edits, switches modes, and exports JSON Quiky data", async ({ page }) => {
  await page.goto(jsonQuikyUrl, { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle("JSON Quiky");

  await page.locator('input[type="file"]').setInputFiles(
    path.join(process.cwd(), "tests", "fixtures", "jsonquiky-tracks.json")
  );

  const liveOutput = page.locator("pre").last();
  await expect(liveOutput).toContainText("automation-one.mp3");
  await expect(liveOutput).toContainText("automation-two.mp3");

  await page.getByRole("button", { name: "Grid" }).click();
  await expect(page.getByText("SELECT LIST:")).toBeVisible();
  await expect(page.getByText("tracks(2)")).toBeVisible();

  await page.getByRole("button", { name: "Raw" }).click();
  const rawEditor = page.locator("textarea");
  await expect(rawEditor).toContainText("automation-one.mp3");

  const updatedJson = JSON.stringify(
    {
      tracks: [
        {
          pathUri: "https://jester.click/audio/edited-track.mp3",
          fileName: "edited-track.mp3",
          isInstrumental: true
        },
        {
          pathUri: "https://jester.click/audio/automation-two.mp3",
          fileName: "automation-two.mp3",
          isInstrumental: true
        }
      ]
    },
    null,
    2
  );

  await rawEditor.fill(updatedJson);
  await expect(liveOutput).toContainText("edited-track.mp3");

  await page.getByRole("button", { name: "Form" }).click();
  await expect(page.locator('input[value="edited-track.mp3"]')).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.json$/);
});
