import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";

type SyncItem = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
};

async function enterMission(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Far from Earth/ })).toBeVisible();
  await page.getByRole("link", { name: "Enter mission control", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Commander Alex Rivera" })).toBeVisible();
  await expect(page.locator(".loading-panel")).toHaveCount(0);
}

test("runs the judge flow through alerts, offline check-in, and idempotent sync", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const postedSyncItems: SyncItem[][] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/sync")) {
      const body = request.postDataJSON() as { items: SyncItem[] };
      postedSyncItems.push(body.items);
    }
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await enterMission(page);
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
    .filter({ hasText: "Amber alert" });
  await expect(sleepAlert.first()).toBeVisible();
  await expect(sleepAlert.first()).toContainText("sleep");
  await sleepAlert.first().locator("summary.alert-row").click();

  const protocolPanel = page.locator(".protocol-panel");
  await expect(protocolPanel).toContainText("UNVERIFIED DRAFT");
  await expect(protocolPanel).toContainText("Sleep disruption");
  await expect(protocolPanel).toContainText("Decision support only, not medical advice.");
  await expect(sleepAlert.first()).toContainText("Why flagged");

  await page.clock.fastForward(20_000);
  await expect(caption).toContainText("STEP 5 / 9");
  await page.clock.fastForward(20_000);
  await expect(caption).toContainText("STEP 6 / 9");
  await page.clock.fastForward(20_000);
  await expect(caption).toContainText("STEP 7 / 9");
  const bloodPressureAlert = page.locator("details.alert-entry").filter({ hasText: "Mission day 44" })
    .filter({ hasText: "Red alert" });
  await expect(bloodPressureAlert.first()).toBeVisible();
  await bloodPressureAlert.first().locator("summary.alert-row").click();
  await expect(protocolPanel).toContainText("escalate tier");
  await expect(protocolPanel).toContainText("No self-treatment medication guidance is provided.");
  await expect(protocolPanel).not.toContainText("Medication category");

  await page.clock.fastForward(20_000);
  await expect(caption).toContainText("STEP 8 / 9");
  await expect(page.getByTestId("mission-status")).toContainText("Ground link lost");
  await expect(page.getByTestId("mission-status").locator(".sync-readout strong")).toHaveText("2");
  await page.clock.fastForward(20_000);
  await expect(caption).toContainText("STEP 9 / 9");
  await page.clock.fastForward(1_000);
  await expect(page.getByTestId("mission-status").locator(".sync-readout strong")).toHaveText("0");
  await page.clock.fastForward(25_000);
  await expect(caption).toContainText("DEMO COMPLETE");

  const linkButton = page.getByRole("button", { name: "Toggle mission communications link" });
  const syncCountBeforeCheckin = postedSyncItems.length;
  await linkButton.click();
  await expect(linkButton).toContainText("Offline");
  await page.getByRole("button", { name: "Check-in", exact: true }).click();
  await page.getByRole("textbox", { name: "Notes" }).fill("E2E offline check-in");
  await page.getByRole("button", { name: "Save check-in", exact: true }).click();
  await expect(page.getByTestId("mission-status").locator(".sync-readout strong")).toHaveText("1");
  await linkButton.click();
  await page.clock.fastForward(1_000);
  await expect(page.getByTestId("mission-status").locator(".sync-readout strong")).toHaveText("0");

  const manualSyncItems = postedSyncItems.slice(syncCountBeforeCheckin).flat();
  const checkin = manualSyncItems.find((item) =>
    item.kind === "checkin" && item.payload.notes === "E2E offline check-in");
  if (!checkin) throw new Error("The offline check-in was not included in the sync request.");
  const duplicateRetry = await page.request.post("http://127.0.0.1:3311/api/sync", {
    data: { items: [checkin] },
  });
  expect(duplicateRetry.ok()).toBe(true);
  expect(await duplicateRetry.json()).toEqual({
    outcomes: [{ id: checkin.id, status: "already_processed" }],
  });

  const databasePath = process.env.DATABASE_PATH;
  if (!databasePath) throw new Error("The e2e database path was not configured.");
  const db = new DatabaseSync(databasePath);
  const checkinCount = db.prepare("SELECT COUNT(*) AS count FROM checkins WHERE notes = ?")
    .get("E2E offline check-in") as { count: number };
  const syncRecordCount = db.prepare("SELECT COUNT(*) AS count FROM sync_queue WHERE id = ?")
    .get(checkin.id) as { count: number };
  db.close();
  expect(checkinCount.count).toBe(1);
  expect(syncRecordCount.count).toBe(1);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
