#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { shutdownLangfuse } from "../src/agent/telemetry";
import { CventApi } from "../src/cvent/api";
import { LocalPlaywrightProvider, SteelProvider, type BrowserProvider } from "../src/browser/driver";
import { executionOrder, plan } from "../src/planner/plan";
import { FileRunStore } from "../src/run/fileStore";
import { runEvent } from "../src/run/orchestrator";
import { EventSpec, type EventSpec as EventSpecType } from "../src/spec/eventSpec";
import { loadCapturedSession, message, parseArgs, requiredEnv } from "./shared";

const HELP = `Usage:
  npx tsx bin/run.ts --spec <file> [--session <file>] [--local] [--headed]
  npx tsx bin/run.ts --resume <runId> [--session <file>] [--local] [--headed]
  npx tsx bin/run.ts --dry-run --spec <file>

Options:
  --run-dir <dir>          Durable run files (default: .runs)
  --operator-id <id>       Operator id (default: EMERALDX_OPERATOR)
  --operator-email <email> Operator email (default: EMERALDX_OPERATOR)
  --help                   Show this help
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), {
    values: ["spec", "session", "resume", "run-dir", "operator-id", "operator-email"],
    flags: ["dry-run", "local", "headed", "help"],
  });
  if (args.flags.has("help")) {
    console.log(HELP);
    return;
  }

  const resumeRunId = args.values.get("resume");
  const specPath = args.values.get("spec");
  const dryRun = args.flags.has("dry-run");
  if (resumeRunId && dryRun) throw new Error("--resume cannot be combined with --dry-run");
  if (!resumeRunId && !specPath) throw new Error("--spec is required unless --resume is used");

  const runRoot = resolve(args.values.get("run-dir") ?? ".runs");
  let spec: EventSpecType;
  let store: FileRunStore;

  if (resumeRunId) {
    store = new FileRunStore(runRoot);
    spec = specPath ? await loadSpec(specPath) : await store.loadSpec(resumeRunId);
    process.env.EMERALDX_RUN_ID = resumeRunId;
  } else {
    spec = await loadSpec(specPath!);
    store = new FileRunStore(runRoot, spec, (runId) => {
      process.env.EMERALDX_RUN_ID = runId;
      console.log(`Run id: ${runId}`);
    });
  }

  if (dryRun) {
    const eventPlan = plan(spec);
    console.log(`Plan only — ${eventPlan.tasks.length} tasks, no side effects.`);
    console.log(JSON.stringify({ ...eventPlan, tasks: executionOrder(eventPlan) }, null, 2));
    return;
  }

  const sessionPath = args.values.get("session") ?? "session.json";
  const sessionContext = await loadCapturedSession(sessionPath);
  const browserProvider: BrowserProvider = args.flags.has("local")
    ? new LocalPlaywrightProvider({
        headless: !args.flags.has("headed"),
        sessionContext,
      })
    : new SteelProvider({
        apiKey: requiredEnv("STEEL_API_KEY"),
        baseUrl: process.env.STEEL_BASE_URL?.trim() || undefined,
        sessionContext,
      });

  const operator = process.env.EMERALDX_OPERATOR?.trim();
  const operatorEmail = args.values.get("operator-email") ?? operator;
  const operatorId = args.values.get("operator-id") ?? operator;
  if (!operatorEmail || !operatorId) {
    throw new Error("operator identity is required via --operator-id/--operator-email or EMERALDX_OPERATOR");
  }
  process.env.EMERALDX_OPERATOR = operatorEmail;

  const api = new CventApi({
    clientId: requiredEnv("CVENT_CLIENT_ID"),
    clientSecret: requiredEnv("CVENT_CLIENT_SECRET"),
    baseUrl: process.env.CVENT_API_BASE_URL?.trim() || undefined,
  });

  const result = await runEvent({
    spec,
    operator: { id: operatorId, email: operatorEmail },
    store,
    api,
    browserProvider,
    denyList: {
      selectors: csvEnv("EMERALDX_DENY_SELECTORS"),
      urlPatterns: csvEnv("EMERALDX_DENY_URL_PATTERNS"),
    },
    costCeilingUsd: numberEnv("EMERALDX_COST_CEILING_USD", 30),
    costAlertUsd: numberEnv("EMERALDX_COST_ALERT_USD", 20),
    resumeRunId,
  });

  console.log("\nTriage summary:");
  console.log(result.triageSummary);
  console.log("\nVerification report:");
  console.log(result.report ? JSON.stringify(result.report, null, 2) : "No verification report was produced.");
  console.log(`\nRun status: ${result.status} (event ${result.eventId ?? "not created"}, cost $${result.totalCost.toFixed(2)})`);
  if (result.status === "halted") process.exitCode = 1;
}

async function loadSpec(path: string): Promise<EventSpecType> {
  const absolute = resolve(path);
  let source: string;
  try {
    source = await readFile(absolute, "utf8");
  } catch (error) {
    throw new Error(`could not read spec ${absolute}: ${message(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`spec ${absolute} is not valid JSON: ${message(error)}`);
  }
  const parsed = EventSpec.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`spec ${absolute} is invalid: ${issues}`);
  }
  return parsed.data;
}

function csvEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function numberEnv(name: string, fallback: number): number {
  const source = process.env[name]?.trim();
  if (!source) return fallback;
  const value = Number(source);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

main()
  .catch((error) => {
    console.error(`run failed: ${message(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await shutdownLangfuse();
    } catch (error) {
      console.error(`Langfuse shutdown failed: ${message(error)}`);
      process.exitCode = 1;
    }
  });
