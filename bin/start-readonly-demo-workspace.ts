import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { DockerSteelWorkspaceRuntime, FileSteelWorkspaceManager, scopedSessionContextPath, seedScopedSessionContext } from "../src/workspace/manager";

const ROOT = resolve(import.meta.dirname, "..");
const EVENT_ID = "e712e34c-6117-4d13-bf4c-8ed54cf2b495";
const EVENT_NAME = "(C+D) Medtrade Testing Clone 2";
const IMAGE = "ghcr.io/steel-dev/steel-browser@sha256:21cf2a5785aa9478d0f7933c04bce96ca79f3d7a93d9824ea184800d29d3cd02";
const SESSION_BASE = resolve(ROOT, "session.json");
const jobId = `demo-readonly-${randomUUID()}`;
const authScopeId = jobId;
const URL = `https://app.cvent.com/subscribers/events2/Details/EventDetails/Index/View?evtStub=${EVENT_ID}`;

void (async () => {
  await seedScopedSessionContext(SESSION_BASE, authScopeId);
  const manager = new FileSteelWorkspaceManager(
    resolve(ROOT, ".workspaces"),
    new DockerSteelWorkspaceRuntime({ image: IMAGE, timeoutMs: 120_000, sessionContextPath: (workspace) => scopedSessionContextPath(SESSION_BASE, workspace.authScopeId) }),
  );
  const workspace = await manager.create({
    name: "Demo read-only agent · Exact event preflight",
    jobId,
    authScopeId,
    eventId: EVENT_ID,
    access: "readOnly",
    initialUrl: URL,
    assignment: "Read exact authorized event details and remain visible for Run Monitor",
  });
  if (!workspace.apiUrl) throw new Error("workspace API is unavailable");
  const browser = await chromium.connectOverCDP(workspace.apiUrl.replace(/^http/, "ws") + "/");
  try {
    const page = browser.contexts()[0]?.pages()[0];
    if (!page) throw new Error("workspace has no page");
    await page.waitForURL((value) => value.toString().toLowerCase().includes(EVENT_ID.toLowerCase()), { timeout: 60_000 });
    await page.waitForFunction((expected) => document.body?.innerText.includes(String(expected)), EVENT_NAME, { timeout: 60_000 });
    await manager.recordActivity(workspace.id, { type: "read_only_verified", message: "Exact authorized event name and UUID verified; no mutation performed" });
  } finally {
    await browser.close().catch(() => undefined);
  }
  console.log(JSON.stringify({ status: "READY", workspaceId: workspace.id, viewerUrl: workspace.viewerUrl, eventId: EVENT_ID, taskStatus: "VERIFIED", workspaceStatus: "READY", mutationPerformed: false }));
})().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
