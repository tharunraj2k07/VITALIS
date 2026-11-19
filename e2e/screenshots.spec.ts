import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("captures the observatory story and mission views @screenshots", async ({ page }) => {
  const screenshotDirectory = resolve("docs", "screenshots");
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Far from Earth/ })).toBeVisible();
  await expect(page.locator(".story-hero")).toBeVisible();
  await page.screenshot({ path: resolve(screenshotDirectory, "story-hero.png"), animations: "disabled" });

  await page.getByRole("link", { name: "Enter mission control", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Commander Alex Rivera" })).toBeVisible();
  await expect(page.locator(".loading-panel")).toHaveCount(0);
  await page.screenshot({ path: resolve(screenshotDirectory, "overview.png"), animations: "disabled" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(screenshotDirectory, "mobile-overview.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Run demo mission", exact: true }).first().click();
  const caption = page.locator(".demo-caption");
  await expect(caption).toContainText("STEP 1 / 9");
  await page.clock.fastForward(15_000);
  await expect(caption).toContainText("STEP 2 / 9");
  await page.clock.fastForward(20_000);
  await expect(caption).toContainText("STEP 3 / 9");
  await page.clock.fastForward(20_000);
  await expect(caption).toContainText("STEP 4 / 9");

  const sleepAlert = page.locator("details.alert-entry").filter({ hasText: "Mission day 26" })
    .filter({ hasText: "Amber alert" }).first();
  await expect(sleepAlert).toBeVisible();
  await sleepAlert.locator("summary.alert-row").click();
  const protocolPanel = page.locator(".protocol-panel");
  await expect(protocolPanel).toContainText("UNVERIFIED DRAFT");
  await expect(protocolPanel).toContainText("Decision support only, not medical advice.");
  await page.screenshot({ path: resolve(screenshotDirectory, "alerts.png"), animations: "disabled" });
  await page.addStyleTag({ content: ".alert-layout{grid-template-columns:1fr!important}.alert-list{display:none!important}.protocol-panel{position:static}" });
  await protocolPanel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(screenshotDirectory, "protocol.png"), animations: "disabled" });

  await page.clock.fastForward(20_000);
  await expect(caption).toContainText("STEP 5 / 9");
  await page.clock.fastForward(20_000);
  await expect(caption).toContainText("STEP 6 / 9");
  await page.clock.fastForward(20_000);
  await expect(caption).toContainText("STEP 7 / 9");
  await page.clock.fastForward(20_000);
  await expect(caption).toContainText("STEP 8 / 9");
  await expect(page.getByTestId("mission-status")).toContainText("Ground link lost");
  await expect(page.getByTestId("mission-status").locator(".sync-readout strong")).toHaveText("2");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.locator(".readiness-orbit")).toBeVisible();
  await page.screenshot({ path: resolve(screenshotDirectory, "offline.png"), animations: "disabled" });
  expect(consoleErrors).toEqual([]);
});
