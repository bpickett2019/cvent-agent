/** Durable job queue checks. No browser, model, or network. */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileJobQueue } from "./src/queue/jobQueue";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const root = await mkdtemp(join(tmpdir(), "emeraldx-queue-"));
let now = new Date("2027-01-01T00:00:00.000Z");
const queue = new FileJobQueue<{ value: number }, { done: boolean }>(root, () => now);

try {
  console.log("\n[1] Enqueue and idempotency");
  const first = await queue.enqueue({ kind: "event.run", idempotencyKey: "request-1", payload: { value: 1 } });
  const duplicate = await queue.enqueue({ kind: "event.run", idempotencyKey: "request-1", payload: { value: 999 } });
  check("same idempotency key returns existing job", duplicate.id === first.id);
  check("duplicate does not replace payload", duplicate.payload.value === 1);
  check("job starts queued", first.status === "queued");

  console.log("\n[2] Paused jobs are not claimed");
  const prePaused = await queue.enqueue({ kind: "event.run", idempotencyKey: "paused", payload: { value: 99 } });
  await queue.pause(prePaused.id);
  const skippedPaused = await queue.claim({ workerId: "worker-a", leaseMs: 2_000 });
  check("paused job is skipped in favor of queued work", skippedPaused?.id === first.id);
  await queue.resume(prePaused.id);

  console.log("\n[3] Lease ownership and completion");
  const claimed = skippedPaused;({ workerId: "worker-a", leaseMs: 2_000 });
  check("worker claims queued job", claimed?.id === first.id && claimed.status === "running");
  check("claim increments attempts", claimed?.attempts === 1);
  let staleWorkerRejected = false;
  try {
    await queue.complete(first.id, "worker-b", { done: true });
  } catch {
    staleWorkerRejected = true;
  }
  check("non-owner cannot complete job", staleWorkerRejected);
  const completed = await queue.complete(first.id, "worker-a", { done: true });
  check("lease owner completes job", completed.status === "succeeded" && completed.output?.done === true);

  // Complete the resumed job so it does not precede the retry fixture.
  const resumedClaim = await queue.claim({ workerId: "worker-a", leaseMs: 2_000 });
  check("resumed job becomes claimable", resumedClaim?.id === prePaused.id);
  await queue.complete(prePaused.id, "worker-a", { done: true });

  console.log("\n[4] Retry and terminal failure");
  const retryJob = await queue.enqueue({
    kind: "event.run",
    idempotencyKey: "request-2",
    payload: { value: 2 },
    maxAttempts: 2,
  });
  await queue.claim({ workerId: "worker-a", leaseMs: 2_000 });
  const retrying = await queue.fail(retryJob.id, "worker-a", "temporary failure", { retryDelayMs: 1_000 });
  check("first failure returns job to queue", retrying.status === "queued");
  check("retry is delayed", (await queue.claim({ workerId: "worker-a", leaseMs: 2_000 })) === null);
  now = new Date("2027-01-01T00:00:01.000Z");
  await queue.claim({ workerId: "worker-a", leaseMs: 2_000 });
  const failed = await queue.fail(retryJob.id, "worker-a", "permanent failure");
  check("max attempts makes failure terminal", failed.status === "failed" && failed.attempts === 2);

  console.log("\n[5] Expired lease recovery");
  const leased = await queue.enqueue({ kind: "event.run", idempotencyKey: "request-3", payload: { value: 3 } });
  await queue.claim({ workerId: "worker-dead", leaseMs: 1_000 });
  now = new Date("2027-01-01T00:00:02.001Z");
  const recovered = await queue.claim({ workerId: "worker-new", leaseMs: 1_000 });
  check("expired job is reclaimed", recovered?.id === leased.id && recovered.attempts === 2);
  await queue.complete(leased.id, "worker-new", { done: true });

  console.log("\n[6] Durable and private state");
  const reloaded = new FileJobQueue<{ value: number }, { done: boolean }>(root, () => now);
  check("new queue instance reads completed state", (await reloaded.get(first.id))?.status === "succeeded");
  const state = await readFile(join(root, "jobs.json"), "utf8");
  check("queue state is valid JSON", JSON.parse(state).version === 1);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? `ALL QUEUE CHECKS PASSED (${checks} checks)` : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
