import { chromium } from "playwright";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DockerSteelWorkspaceRuntime,
  FileSteelWorkspaceManager,
  scopedSessionContextPath,
  seedScopedSessionContext,
  type SteelWorkspace,
} from "../src/workspace/manager";

const ROOT = resolve(import.meta.dirname, "..");
const EVENT_ID = "e712e34c-6117-4d13-bf4c-8ed54cf2b495";
const EVENT_NAME = "(C+D) Medtrade Testing Clone 2";
const IMAGE = "ghcr.io/steel-dev/steel-browser@sha256:21cf2a5785aa9478d0f7933c04bce96ca79f3d7a93d9824ea184800d29d3cd02";
const SESSION_BASE = resolve(ROOT, "session.json");
const WORKSPACE_ROOT = resolve(ROOT, ".workspaces-three-job-acceptance");
const RECEIPT = resolve(ROOT, ".runs", "three-job-readonly-acceptance.json");
const URL = `https://app.cvent.com/subscribers/events2/Details/EventDetails/Index/View?evtStub=${EVENT_ID}`;
const jobIds = ["three-job-a", "three-job-b", "three-job-c"];

void (async () => {
  for (const jobId of jobIds) await seedScopedSessionContext(SESSION_BASE, jobId);
  const manager = new FileSteelWorkspaceManager(
    WORKSPACE_ROOT,
    new DockerSteelWorkspaceRuntime({
      image: IMAGE,
      timeoutMs: 120_000,
      sessionContextPath: (workspace) => scopedSessionContextPath(SESSION_BASE, workspace.authScopeId),
    }),
  );
  const workspaces: SteelWorkspace[] = [];
  try {
    for (const jobId of jobIds) {
      workspaces.push(await manager.create({
        name: `Read-only preflight ${jobId}`,
        jobId,
        authScopeId: jobId,
        eventId: EVENT_ID,
        access: "readOnly",
        initialUrl: URL,
        assignment: "Read exact authorized event details without mutation",
      }));
    }
    const results = await Promise.all(workspaces.map(async (workspace) => {
      if (!workspace.apiUrl || !workspace.providerSessionId || !workspace.containerId) throw new Error(`workspace ${workspace.id} is incomplete`);
      const browser = await chromium.connectOverCDP(workspace.apiUrl.replace(/^http/, "ws") + "/");
      try {
        const page = browser.contexts()[0]?.pages()[0];
        if (!page) throw new Error(`workspace ${workspace.id} has no page`);
        await page.waitForURL((value) => value.toString().toLowerCase().includes(EVENT_ID.toLowerCase()), { timeout: 60_000 });
        await page.waitForFunction((expected) => document.body?.innerText.includes(String(expected)), EVENT_NAME, { timeout: 60_000 });
        const title = await page.title();
        const currentUrl = page.url();
        if (!currentUrl.toLowerCase().includes(EVENT_ID.toLowerCase())) throw new Error(`workspace ${workspace.id} left the exact event`);
        return {
          jobId: workspace.ownerJobId,
          workspaceId: workspace.id,
          containerId: workspace.containerId,
          providerSessionId: workspace.providerSessionId,
          apiUrl: workspace.apiUrl,
          currentUrl,
          title,
          eventNameVisible: true,
          taskStatus: "VERIFIED",
          workspaceStatus: "READY",
        };
      } finally {
        await browser.close().catch(() => undefined);
      }
    }));
    if (new Set(results.map((value) => value.containerId)).size !== 3) throw new Error("containers are not isolated");
    if (new Set(results.map((value) => value.providerSessionId)).size !== 3) throw new Error("provider sessions are not isolated");
    if (new Set(results.map((value) => value.apiUrl)).size !== 3) throw new Error("workspace APIs are not isolated");
    for (const workspace of workspaces) await manager.release(workspace.id);
    for (const result of results) {
      const released = await manager.get(result.workspaceId);
      if (released?.status !== "released") throw new Error(`workspace ${result.workspaceId} was not released`);
      result.workspaceStatus = "RELEASED";
    }
    const receipt = {
      status: "PASS",
      eventId: EVENT_ID,
      eventName: EVENT_NAME,
      jobs: results,
      jobCount: results.length,
      mutationPerformed: false,
      deletePerformed: false,
      publishPerformed: false,
      communicationPerformed: false,
      attendeeAccessPerformed: false,
      checkedAt: new Date().toISOString(),
    };
    await mkdir(resolve(ROOT, ".runs"), { recursive: true, mode: 0o700 });
    await writeFile(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    await chmod(RECEIPT, 0o600);
    console.log(JSON.stringify({ status: receipt.status, jobCount: receipt.jobCount, isolatedContainers: 3, exactEventReads: 3, mutationPerformed: false }));
  } finally {
    for (const workspace of workspaces) await manager.release(workspace.id).catch(() => undefined);
  }
})().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
