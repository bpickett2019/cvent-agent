/** Cooperative pause/cancel checks. No browser, model, or network. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRunControlStore, RunCancelledError } from "./src/run/control";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean) {
  checks += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}`);
  if (!ok) failures += 1;
}

const root = await mkdtemp(join(tmpdir(), "emeraldx-control-"));
const id = "3f2b6a10-9c4d-4e21-b8f7-0a1c2d3e4f56";
const controls = new FileRunControlStore(root);
try {
  const initial = await controls.initialize(id);
  check("control begins runnable", !initial.paused && !initial.cancelRequested);
  await controls.setBrowser(id, {
    provider: "steel",
    providerSessionId: "steel-session",
    viewerUrl: "https://steel.dev/view/session",
  });
  check("live viewer is durable", (await controls.get(id)).viewerUrl === "https://steel.dev/view/session");

  await controls.pause(id);
  let released = false;
  const waiting = controls.waitUntilRunnable(id, 10).then(() => { released = true; });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
  check("pause blocks the action gate", !released);
  await controls.resume(id);
  await waiting;
  check("resume releases the action gate", released);

  await controls.pause(id);
  const cancelled = controls.waitUntilRunnable(id, 10).then(
    () => false,
    (error) => error instanceof RunCancelledError
  );
  await controls.requestCancel(id);
  check("cancel interrupts a paused gate", await cancelled);
  await controls.clearBrowser(id);
  check("viewer URL is removed after browser release", (await controls.get(id)).viewerUrl === null);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? `ALL CONTROL CHECKS PASSED (${checks} checks)` : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
