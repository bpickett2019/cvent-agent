import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DockerSteelWorkspaceRuntime, FileSteelWorkspaceManager, loadGoldenSessionContext } from "../src/workspace/manager";

const ROOT = resolve(import.meta.dirname, "..");
const EVENT_ID = "e712e34c-6117-4d13-bf4c-8ed54cf2b495";
const EVENT_NAME = "(C+D) Medtrade Testing Clone 2";
const CODE = "HERMESQA260901";
const DESCRIPTION = "";
const CAPACITY = 1;
const runLabel = process.argv.includes("--second-run") ? "run2" : "run1";

void (async () => {
  const manager = new FileSteelWorkspaceManager(resolve(ROOT, ".workspaces"), new DockerSteelWorkspaceRuntime({ sessionContextPath: resolve(ROOT, "session.json"), timeoutMs: 120_000 }));
  const workspace = await manager.create({ name: `Bounded voucher acceptance ${runLabel}`, jobId: `bounded-voucher-${runLabel}`, eventId: EVENT_ID, access: "mutation" });
  const sessionContext = await loadGoldenSessionContext(resolve(ROOT, "session.json"));
  const sessionResponse = await fetch(`${workspace.apiUrl}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persistProfile: false, timeout: 10_800_000, headless: true, debugConfig: { interactive: true, systemCursor: true }, sessionContext }) });
  if (!sessionResponse.ok) throw new Error(`Steel mutation session failed: ${sessionResponse.status}`);
  await manager.recordActivity(workspace.id, { type: "acceptance_started", message: `Reconciling voucher ${CODE} on the authorized clone` });
  let browser;
  try {
    browser = await connectWithBoundedRetry(workspace.apiUrl!);
    const page = browser.contexts()[0].pages()[0];
    const listUrl = `https://app.cvent.com/Subscribers/Events2/RegistrationOption/EventVouchersGrid/Index/?evtstub=${EVENT_ID}`;
    await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1_000);
    await guard(page);
    const before = await vouchers(page);
    const matches = before.filter((row) => row.Code === CODE);
    if (matches.length > 1) throw new Error(`CONFLICT: ${matches.length} vouchers use ${CODE}`);
    if (matches.length === 1) {
      const row = matches[0];
      const exact = row.Description === DESCRIPTION && Number(row.Capacity) === CAPACITY;
      if (!exact) throw new Error(`CONFLICT: voucher ${CODE} exists with different description/capacity`);
      const receipt = { run: runLabel, status: "already-correct", creates: 0, saves: 0, id: row.Id, code: row.Code, description: row.Description, capacity: Number(row.Capacity), used: Number(row.Used), deletePerformed: false, publishPerformed: false, eventId: EVENT_ID };
      await saveReceipt(receipt); console.log(JSON.stringify(receipt)); return;
    }
    await page.goto(`https://app.cvent.com/subscribers/events2/RegistrationOption/AddVouchers?evtstub=${EVENT_ID}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await guard(page);
    await page.locator("#Vouchers_Code_1").fill(CODE);
    if (DESCRIPTION) await page.locator("#Vouchers_Description_1").fill(DESCRIPTION);
    await page.locator("#Vouchers_Capacity_1").fill(String(CAPACITY));
    await guard(page);
    await page.locator("button#Save").click();
    await page.waitForURL((url) => url.toString().includes("EventVouchersGrid"), { timeout: 60_000 });
    await guard(page);
    const after = (await vouchers(page)).filter((row) => row.Code === CODE);
    if (after.length !== 1) throw new Error(`FAIL: expected one ${CODE} after Save, found ${after.length}`);
    const row = after[0];
    if (row.Description !== DESCRIPTION || Number(row.Capacity) !== CAPACITY) throw new Error("FAIL: independent voucher read-back differs");
    const receipt = { run: runLabel, status: "created", creates: 1, saves: 1, id: row.Id, code: row.Code, description: row.Description, capacity: Number(row.Capacity), used: Number(row.Used), deletePerformed: false, publishPerformed: false, eventId: EVENT_ID };
    await saveReceipt(receipt); console.log(JSON.stringify(receipt));
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await manager.release(workspace.id);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

async function connectWithBoundedRetry(apiUrl: string) {
  const endpoint = apiUrl.replace(/^http/, "ws") + "/";
  let last: unknown;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try { return await chromium.connectOverCDP(endpoint); }
    catch (error) { last = error; if (attempt < 10) await new Promise((resolve) => setTimeout(resolve, 1_000)); }
  }
  throw last;
}
async function guard(page: import("playwright").Page) {
  if (page.url().toLowerCase().includes("login")) throw new Error("BLOCKED: authentication wall");
  if (!page.url().toLowerCase().includes(EVENT_ID)) throw new Error(`BLOCKED: wrong event URL ${page.url()}`);
  const body = await page.locator("body").innerText(); const html = await page.content();
  if (!body.includes(EVENT_NAME) && !html.includes(EVENT_NAME)) throw new Error("BLOCKED: exact authorized event name missing");
  if (await page.getByText(/Publish|Go Live|Delete All/i).count()) { /* presence is allowed; invocation is not */ }
}
async function vouchers(page: import("playwright").Page): Promise<any[]> { return JSON.parse(await page.locator("textarea#Vouchers-1").inputValue()); }
async function saveReceipt(receipt: object) { await writeFile(resolve(ROOT, ".runs", `bounded-voucher-${runLabel}.json`), JSON.stringify(receipt, null, 2), { mode: 0o600 }); }
