#!/usr/bin/env node

import { hostname } from "node:os";
import { resolve } from "node:path";
import { shutdownLangfuse } from "../src/agent/telemetry";
import { AssetStore, sharePointAssetPaths } from "../src/assets/store";
import { LocalPlaywrightProvider, SteelProvider, type BrowserProvider } from "../src/browser/driver";
import { CventApi } from "../src/cvent/api";
import { FileJobQueue } from "../src/queue/jobQueue";
import {
  RUN_EVENT_JOB_KIND,
  RunEventJobOutput,
  RunEventJobPayload,
  type RunEventJobOutput as RunOutput,
  type RunEventJobPayload as RunPayload,
} from "../src/queue/runJob";
import { FileRunControlStore, RunCancelledError } from "../src/run/control";
import { FileRunStore } from "../src/run/fileStore";
import { runEvent } from "../src/run/orchestrator";
import { loadCapturedSession, message, parseArgs, requiredEnv } from "./shared";

const HELP = `Usage: npx tsx bin/worker.ts [--once] [--local] [--headed]

Options:
  --queue-dir <dir>  Durable queue state (default: .queue)
  --run-dir <dir>    Durable run state (default: .runs)
  --asset-dir <dir>  Uploaded image state (default: .assets)
  --session <file>   Captured Cvent session (default: session.json)
  --poll-ms <ms>     Empty-queue polling interval (default: 2000)
  --once             Claim at most one job and exit
  --local            Use local Playwright instead of Steel.dev
  --headed           Show local Playwright browser
`;

async function main(): Promise<void> {
  loadLocalEnvironment();
  const args = parseArgs(process.argv.slice(2), {
    values: ["queue-dir", "run-dir", "asset-dir", "session", "poll-ms"],
    flags: ["once", "local", "headed", "help"],
  });
  if (args.flags.has("help")) {
    console.log(HELP);
    return;
  }

  const queueRoot = resolve(args.values.get("queue-dir") ?? process.env.EMERALDX_QUEUE_DIR ?? ".queue");
  const queue = new FileJobQueue<RunPayload, RunOutput>(queueRoot);
  const controls = new FileRunControlStore(resolve(queueRoot, "controls"));
  const workerId = `${hostname()}-${process.pid}`;
  const pollMs = positiveNumber(args.values.get("poll-ms"), 2_000, "--poll-ms");

  do {
    const job = await queue.claim({ workerId, leaseMs: 30 * 60_000, kinds: [RUN_EVENT_JOB_KIND] });
    if (!job) {
      if (args.flags.has("once")) return;
      await delay(pollMs);
      continue;
    }

    await controls.initialize(job.id);
    let heartbeatError: Error | null = null;
    const heartbeat = setInterval(() => {
      void queue.heartbeat(job.id, workerId, 30 * 60_000).catch((error) => {
        heartbeatError = error instanceof Error ? error : new Error(String(error));
      });
    }, 60_000);
    heartbeat.unref();

    try {
      const payload = RunEventJobPayload.parse(job.payload);
      const output = await executeRun(payload, args, controls, job.id);
      if (heartbeatError) throw heartbeatError;
      await queue.complete(job.id, workerId, RunEventJobOutput.parse(output));
      console.log(`Job ${job.id} completed with run status ${output.status}.`);
    } catch (error) {
      const detail = message(error);
      if (error instanceof RunCancelledError) {
        await queue.cancel(job.id, workerId);
        console.error(`Job ${job.id} cancelled by operator.`);
      } else {
        const failed = await queue.fail(job.id, workerId, detail, {
          retryDelayMs: Math.min(60_000, 5_000 * 2 ** Math.max(0, job.attempts - 1)),
        });
        console.error(`Job ${job.id} ${failed.status === "queued" ? "will retry" : "failed"}: ${detail}`);
      }
    } finally {
      clearInterval(heartbeat);
      await controls.clearBrowser(job.id).catch(() => {});
      await shutdownLangfuse();
    }
  } while (!args.flags.has("once"));
}

async function executeRun(
  payload: RunPayload,
  args: ReturnType<typeof parseArgs>,
  controls: FileRunControlStore,
  jobId: string
): Promise<RunOutput> {
  const sharePointPaths = sharePointAssetPaths(payload.spec);
  if (sharePointPaths.length) {
    throw new Error(
      `run has ${sharePointPaths.length} SharePoint image(s), but no Microsoft Graph resolver is configured`
    );
  }
  const assetPaths = await new AssetStore(resolve(args.values.get("asset-dir") ?? process.env.EMERALDX_ASSET_DIR ?? ".assets")).resolveSpec(payload.spec);
  const sessionContext = await loadCapturedSession(args.values.get("session") ?? "session.json");
  const browserProvider: BrowserProvider = args.flags.has("local")
    ? new LocalPlaywrightProvider({ headless: !args.flags.has("headed"), sessionContext })
    : new SteelProvider({
        apiKey: requiredEnv("STEEL_API_KEY"),
        baseUrl: process.env.STEEL_BASE_URL?.trim() || undefined,
        sessionContext,
      });
  const api = new CventApi({
    clientId: requiredEnv("CVENT_CLIENT_ID"),
    clientSecret: requiredEnv("CVENT_CLIENT_SECRET"),
    baseUrl: process.env.CVENT_API_BASE_URL?.trim() || undefined,
  });
  const store = new FileRunStore(resolve(args.values.get("run-dir") ?? process.env.EMERALDX_RUN_DIR ?? ".runs"), payload.spec, (runId) => {
    process.env.EMERALDX_RUN_ID = runId;
  });
  process.env.EMERALDX_OPERATOR = payload.operator.email;

  const result = await runEvent({
    spec: payload.spec,
    operator: payload.operator,
    store,
    api,
    browserProvider,
    denyList: {
      selectors: csvEnv("EMERALDX_DENY_SELECTORS"),
      urlPatterns: csvEnv("EMERALDX_DENY_URL_PATTERNS"),
    },
    assetPaths,
    executionControl: { waitUntilRunnable: () => controls.waitUntilRunnable(jobId) },
    onBrowserConnected: (details) => controls.setBrowser(jobId, details).then(() => {}),
    costCeilingUsd: numberEnv("EMERALDX_COST_CEILING_USD", 30),
    costAlertUsd: numberEnv("EMERALDX_COST_ALERT_USD", 20),
  });
  return {
    runId: result.runId,
    eventId: result.eventId,
    status: result.status,
    triageSummary: result.triageSummary,
  };
}

function loadLocalEnvironment(): void {
  try {
    process.loadEnvFile(resolve(".env"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function csvEnv(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

function numberEnv(name: string, fallback: number): number {
  const source = process.env[name]?.trim();
  if (!source) return fallback;
  const value = Number(source);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

function positiveNumber(source: string | undefined, fallback: number, name: string): number {
  if (!source) return fallback;
  const value = Number(source);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

main().catch((error) => {
  console.error(`worker failed: ${message(error)}`);
  process.exitCode = 1;
});
