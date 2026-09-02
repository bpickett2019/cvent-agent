import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSteelWorkspaceManager, loadGoldenSessionContext, type SteelWorkspaceRuntime } from "./src/workspace/manager";

const root = await mkdtemp(join(tmpdir(), "cvent-workspaces-"));
const starts: string[] = [];
const stops: string[] = [];
const refreshes: string[] = [];
const runtime: SteelWorkspaceRuntime = {
  start: async (workspace) => {
    starts.push(workspace.id);
    return { containerId: `container-${workspace.id}`, providerSessionId: `session-${workspace.id}`, apiUrl: `http://127.0.0.1:${3300 + starts.length}`, viewerUrl: `http://127.0.0.1:${3300 + starts.length}/v1/sessions/debug` };
  },
  stop: async (workspace) => { stops.push(workspace.id); },
  refreshAuthentication: async (workspace) => { refreshes.push(workspace.id); return { providerSessionId: `refreshed-${workspace.id}` }; },
};
const manager = new FileSteelWorkspaceManager(root, runtime, () => new Date("2026-09-01T12:00:00.000Z"));
const eventA = "e712e34c-6117-4d13-bf4c-8ed54cf2b495";
const goldenPath = join(root, "session.json");
await writeFile(goldenPath, JSON.stringify({ cookies: [{ name: "session", value: "opaque", domain: ".example.com", path: "/" }], localStorage: { token: "opaque-storage" }, localStorageOrigin: "https://example.com", userAgent: "Stable Golden UA" }), { mode: 0o600 });
await chmod(goldenPath, 0o600);
const golden = await loadGoldenSessionContext(goldenPath);
assert.equal(golden?.cookies.length, 1);
assert.deepEqual(golden?.localStorage, { "https://example.com": { token: "opaque-storage" } });
assert.equal(golden?.userAgent, "Stable Golden UA");
const capRoot = await mkdtemp(join(tmpdir(), "cvent-workspace-cap-"));
const capped = new FileSteelWorkspaceManager(capRoot, runtime, () => new Date("2026-09-01T12:00:00.000Z"));
for (let index = 0; index < 6; index += 1) await capped.create({ name: `agent-${index}`, jobId: `job-cap-${index}`, eventId: `event-cap-${index}`, access: "readOnly" });
await assert.rejects(capped.create({ name: "agent-7", jobId: "job-cap-7", eventId: "event-cap-7", access: "readOnly" }), /workspace limit of 6/i);
await rm(capRoot, { recursive: true, force: true });
starts.length = 0;
stops.length = 0;

try {
  const first = await manager.create({ name: "registration worker", jobId: "job-a", eventId: eventA, access: "mutation" });
  assert.equal(first.status, "ready");
  assert.equal(first.ownerJobId, "job-a");
  assert.equal(first.apiUrl, "http://127.0.0.1:3301");
  assert.equal(first.providerSessionId, `session-${first.id}`);
  assert.equal(first.activity[0]?.type, "workspace_started");
  const reported = await manager.recordActivity(first.id, { type: "task_progress", message: "Configuring registration types" });
  assert.equal(reported.activity.at(-1)?.message, "Configuring registration types");
  const taken = await manager.takeOver(first.id);
  assert.equal(taken.controller, "user");
  const returned = await manager.returnToAgent(first.id);
  assert.equal(returned.controller, "agent");

  await assert.rejects(
    manager.create({ name: "site worker", jobId: "job-b", eventId: eventA, access: "mutation" }),
    /mutation workspace already owns event/i
  );

  const reader = await manager.create({ name: "verification worker", jobId: "job-c", eventId: eventA, access: "readOnly", initialUrl: `https://app.cvent.com/events?evtstub=${eventA}`, assignment: "Verify registration state" });
  assert.equal(reader.initialUrl, `https://app.cvent.com/events?evtstub=${eventA}`);
  assert.equal(reader.assignment, "Verify registration state");
  const refreshed = await manager.refreshAuthentication(reader.id);
  assert.equal(refreshed.providerSessionId, `refreshed-${reader.id}`);
  assert.equal(refreshed.activity.at(-1)?.type, "authentication_refreshed");
  assert.equal(reader.status, "ready");
  assert.notEqual(reader.id, first.id);

  const otherEvent = await manager.create({ name: "other event worker", jobId: "job-d", eventId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", access: "mutation" });
  assert.equal(otherEvent.status, "ready");

  const reloaded = new FileSteelWorkspaceManager(root, runtime, () => new Date("2026-09-01T12:01:00.000Z"));
  assert.equal((await reloaded.list()).filter((workspace) => workspace.status === "ready").length, 3);

  await manager.release(first.id);
  assert.equal(stops.includes(first.id), true);
  const replacement = await manager.create({ name: "site worker", jobId: "job-b", eventId: eventA, access: "mutation" });
  assert.equal(replacement.status, "ready");

  assert.equal((await manager.get(replacement.id))?.viewerUrl?.includes("/v1/sessions/debug"), true);
  const reaper = new FileSteelWorkspaceManager(root, runtime, () => new Date("2026-09-01T16:30:00.000Z"));
  const reaped = await reaper.reapExpired(3 * 60 * 60 * 1_000);
  assert.equal(reaped.length, 3);
  assert.equal((await reaper.list()).filter((workspace) => workspace.status === "ready").length, 0);
  console.log("workspace manager smoke passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
