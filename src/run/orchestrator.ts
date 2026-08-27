import { randomUUID } from "node:crypto";
import type { BrowserProvider, StepTrace } from "../browser/driver";
import { BrowserSession } from "../browser/driver";
import type { CventApi } from "../cvent/api";
import { executeTask, type ExecuteTaskArgs, type TaskResult } from "../agent/executor";
import { Guardrails, type DenyList } from "../guardrails/middleware";
import { executionOrder, plan, type Plan, type Task } from "../planner/plan";
import { loadProcedure, type Procedure } from "../procedures/loader";
import { EventSpec as EventSpecSchema, type EventSpec } from "../spec/eventSpec";
import { summarize, verify, type VerificationReport } from "../verify/verifier";

export type TaskStatus = "succeeded" | "halted" | "blocked" | "skipped";

export interface TaskCheckpoint {
  taskId: string;
  status: TaskStatus;
  evidence: string | null;
  detail: string | null;
  timestamp: string;
  /** Cumulative provider cost after this checkpoint, used to preserve run budget on resume. */
  totalCostUsd: number;
  /** Present on the event shell checkpoint so a resume remains bound to it. */
  eventId?: string;
}

export interface RunTrace {
  type: "browser" | "guardrail" | "orchestrator";
  timestamp: string;
  data: StepTrace | Record<string, unknown>;
}

export interface CreateRunInput {
  operator: { id: string; email: string };
  createdAt: string;
}

export interface LoadedCheckpoints {
  specHash: string;
  checkpoints: TaskCheckpoint[];
}

export interface RunStore {
  createRun(input: CreateRunInput): Promise<string>;
  savePlan(runId: string, plan: Plan): Promise<void>;
  saveCheckpoint(runId: string, checkpoint: TaskCheckpoint): Promise<void>;
  loadCheckpoints(runId: string): Promise<LoadedCheckpoints>;
  saveReport(runId: string, report: VerificationReport | null): Promise<void>;
  saveTrace(runId: string, trace: RunTrace): Promise<void>;
}

export interface TaskRunStatus {
  status: TaskStatus;
  evidence: string | null;
  detail: string | null;
  timestamp: string;
}

export interface RunResult {
  runId: string;
  eventId: string | null;
  specHash: string;
  status: "succeeded" | "halted";
  tasks: Record<string, TaskRunStatus>;
  report: VerificationReport | null;
  totalCost: number;
  triageSummary: string;
}

export interface ExecutionControl {
  /** Wait while paused; throw on cancellation. Called before tasks and actions. */
  waitUntilRunnable(): Promise<void>;
}

export interface RunEventArgs {
  spec: EventSpec;
  operator: { id: string; email: string };
  store: RunStore;
  api: CventApi;
  browserProvider: BrowserProvider;
  denyList: DenyList;
  /** Uploaded asset ids resolved by trusted server code before model execution. */
  assetPaths?: Record<string, string>;
  executionControl?: ExecutionControl;
  onBrowserConnected?: (details: {
    provider: string;
    viewerUrl?: string;
    providerSessionId?: string;
  }) => Promise<void>;
  costCeilingUsd: number;
  costAlertUsd: number;
  resumeRunId?: string;
}

type ExecuteTask = (args: ExecuteTaskArgs) => Promise<TaskResult>;
type LoadProcedure = (id: string, payload: Record<string, unknown>) => Promise<Procedure>;
type Verify = typeof verify;

export interface OrchestratorDependencies {
  executeTask: ExecuteTask;
  loadProcedure: LoadProcedure;
  verify: Verify;
  now(): Date;
}

const DEFAULT_DEPENDENCIES: OrchestratorDependencies = {
  executeTask,
  loadProcedure: (id, payload) => loadProcedure(id, payload),
  verify,
  now: () => new Date(),
};

export function createRunOrchestrator(overrides: Partial<OrchestratorDependencies> = {}) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };

  return async function orchestrate(args: RunEventArgs): Promise<RunResult> {
    // Runtime validation is deliberate even though the caller is statically typed.
    // Invalid intake data must fail before a run record or Cvent side effect exists.
    const spec = EventSpecSchema.parse(args.spec);
    const eventPlan = plan(spec);
    const ordered = executionOrder(eventPlan);
    const costCeilingUsd = args.costCeilingUsd ?? 30;
    const costAlertUsd = args.costAlertUsd ?? 20;

    let runId: string;
    let priorCheckpoints: TaskCheckpoint[] = [];

    if (args.resumeRunId) {
      runId = args.resumeRunId;
      const loaded = await args.store.loadCheckpoints(runId);
      if (loaded.specHash !== eventPlan.specHash) {
        throw new Error(
          `refusing to resume run ${runId}: current spec hash ${eventPlan.specHash} does not match stored hash ${loaded.specHash}`
        );
      }
      priorCheckpoints = loaded.checkpoints;
    } else {
      runId = await args.store.createRun({
        operator: args.operator,
        createdAt: dependencies.now().toISOString(),
      });
      // The plan is durable before the first Cvent write.
      await args.store.savePlan(runId, eventPlan);
    }

    const tasks: Record<string, TaskRunStatus> = {};
    const satisfied = new Set<string>();
    for (const checkpoint of priorCheckpoints) {
      if (checkpoint.status === "succeeded") satisfied.add(checkpoint.taskId);
    }

    const shellTask = ordered.find((task) => task.id === "event.shell");
    if (!shellTask) throw new Error("plan does not contain the required event.shell task");

    // A job paused before claim must not create an event shell until resumed.
    await args.executionControl?.waitUntilRunnable();

    let eventId = eventIdFrom(priorCheckpoints);
    const priorShellSucceeded = satisfied.has(shellTask.id);
    if (priorShellSucceeded && !eventId) {
      throw new Error(`refusing to resume run ${runId}: succeeded event.shell checkpoint has no event id`);
    }

    if (priorShellSucceeded) {
      tasks[shellTask.id] = skippedStatus(
        dependencies,
        `Already completed in this run; continuing with event ${eventId}.`
      );
    } else {
      try {
        eventId = await createEventShell(args.api, shellTask);
        const checkpoint = checkpointFor(
          dependencies,
          shellTask.id,
          "succeeded",
          `Cvent created event ${eventId}.`,
          null,
          { eventId }
        );
        await args.store.saveCheckpoint(runId, checkpoint);
        tasks[shellTask.id] = statusFrom(checkpoint);
        satisfied.add(shellTask.id);
      } catch (error) {
        const detail = `Cvent could not create the event: ${message(error)}`;
        const checkpoint = checkpointFor(dependencies, shellTask.id, "halted", null, detail);
        await args.store.saveCheckpoint(runId, checkpoint);
        tasks[shellTask.id] = statusFrom(checkpoint);
        await blockRemainingTasks(args.store, runId, ordered, tasks, shellTask.id, dependencies);
        await args.store.saveReport(runId, null);
        return finishResult(runId, null, eventPlan.specHash, tasks, null, 0, false);
      }
    }

    if (!eventId) throw new Error(`run ${runId} has no authoritative event id after event.shell`);
    const authoritativeEventId = eventId;

    // The authoritative event id now exists. Guardrails are bound before the
    // browser is opened; reversing these two operations is prohibited.
    const traceWrites: Promise<void>[] = [];
    const traceErrors: Error[] = [];
    const queueTrace = (trace: RunTrace) => {
      traceWrites.push(
        args.store.saveTrace(runId, trace).catch((error) => {
          traceErrors.push(error instanceof Error ? error : new Error(String(error)));
        })
      );
    };
    const guardrails = new Guardrails(
      {
        eventId: authoritativeEventId,
        denyList: args.denyList,
        allowedUploadPaths: Object.values(args.assetPaths ?? {}),
        costCeilingUsd,
        costAlertUsd,
      },
      (entry) =>
        queueTrace({
          type: "guardrail",
          timestamp: dependencies.now().toISOString(),
          data: entry,
        })
    );
    const resumedCost = priorCheckpoints.reduce(
      (highest, checkpoint) => Math.max(highest, checkpoint.totalCostUsd ?? 0),
      0
    );
    if (resumedCost > 0) guardrails.accrue(resumedCost);

    let session: BrowserSession | null = null;
    let browserOpenError: Error | null = null;
    await args.executionControl?.waitUntilRunnable();
    try {
      session = await BrowserSession.open(
        args.browserProvider,
        guardrails,
        (trace) => queueTrace({ type: "browser", timestamp: trace.at, data: trace }),
        {
          beforeAction: () => args.executionControl?.waitUntilRunnable() ?? Promise.resolve(),
          onConnected: args.onBrowserConnected,
        }
      );
    } catch (error) {
      browserOpenError = error instanceof Error ? error : new Error(String(error));
      queueTrace({
        type: "orchestrator",
        timestamp: dependencies.now().toISOString(),
        data: { event: "browser.open.failed", error: browserOpenError.message },
      });
    }

    let report: VerificationReport | null = null;
    let draftConfirmed = false;
    let budgetExhausted = false;

    try {
      for (const task of ordered) {
        if (task.id === shellTask.id) continue;
        await args.executionControl?.waitUntilRunnable();
        const verificationTask = isVerificationTask(task);

        if (satisfied.has(task.id) && !verificationTask) {
          const previous = latestSucceeded(priorCheckpoints, task.id);
          tasks[task.id] = skippedStatus(
            dependencies,
            previous?.evidence ?? "Already completed in this run; it was not executed again."
          );
          continue;
        }

        const mandatoryApiVerification =
          task.kind === "verify.registration" || task.kind === "verify.draftStatus";
        if (!mandatoryApiVerification && guardrails.spent >= costCeilingUsd) {
          budgetExhausted = true;
          const checkpoint = checkpointFor(
            dependencies,
            task.id,
            "skipped",
            null,
            `The run reached its $${costCeilingUsd.toFixed(2)} cost ceiling before this task started.`,
            { totalCostUsd: guardrails.spent }
          );
          await args.store.saveCheckpoint(runId, checkpoint);
          tasks[task.id] = statusFrom(checkpoint);
          continue;
        }

        if (!verificationTask) {
          const unsatisfied = task.dependsOn.filter((dependency) => !satisfied.has(dependency));
          if (unsatisfied.length) {
            const checkpoint = checkpointFor(
              dependencies,
              task.id,
              "blocked",
              null,
              `Blocked because prerequisite task${unsatisfied.length === 1 ? "" : "s"} ${unsatisfied.join(", ")} did not succeed.`,
              { totalCostUsd: guardrails.spent }
            );
            await args.store.saveCheckpoint(runId, checkpoint);
            tasks[task.id] = statusFrom(checkpoint);
            continue;
          }
        }

        let outcome: { status: "succeeded" | "halted"; evidence: string | null; detail: string | null };
        try {
          if (task.channel === "api") {
            const apiOutcome = await dispatchApiTask(args.api, task, authoritativeEventId, spec, eventPlan.specHash, dependencies);
            outcome = apiOutcome.outcome;
            if (apiOutcome.report) report = apiOutcome.report;
            if (task.kind === "verify.draftStatus" && apiOutcome.outcome.status === "succeeded") {
              draftConfirmed = true;
            }
          } else if (!session) {
            outcome = {
              status: "halted",
              evidence: null,
              detail: `The browser session could not be opened: ${browserOpenError?.message ?? "unknown browser error"}`,
            };
          } else {
            const procedure = task.procedure
              ? await dependencies.loadProcedure(task.procedure, task.payload)
              : null;
            const taskResult = await dependencies.executeTask({
              task,
              eventId: authoritativeEventId,
              procedure,
              session,
              guardrails,
              assetPaths: args.assetPaths,
              budgetRemainingUsd: Math.max(0, costCeilingUsd - guardrails.spent),
            });
            outcome = taskResult.status === "success"
              ? { status: "succeeded", evidence: taskResult.evidence, detail: null }
              : { status: "halted", evidence: null, detail: taskResult.haltDetail };
          }
        } catch (error) {
          outcome = {
            status: "halted",
            evidence: null,
            detail: `${task.label} stopped: ${message(error)}`,
          };
        }

        const checkpoint = checkpointFor(
          dependencies,
          task.id,
          outcome.status,
          outcome.evidence,
          outcome.detail,
          { totalCostUsd: guardrails.spent }
        );
        await args.store.saveCheckpoint(runId, checkpoint);
        tasks[task.id] = statusFrom(checkpoint);
        if (outcome.status === "succeeded") satisfied.add(task.id);

        if (guardrails.spent >= costCeilingUsd) budgetExhausted = true;
      }

      // Defensive fallback: the deterministic plan contains both checks, but a
      // future plan must not be able to omit the promised final verification.
      if (!report) {
        report = await safeVerify(args.api, authoritativeEventId, spec, eventPlan.specHash, dependencies);
      }
      if (!draftConfirmed) {
        draftConfirmed = await safeDraftCheck(args.api, authoritativeEventId);
      }
      if (!draftConfirmed && !report.findings.some((finding) => finding.area === "status")) {
        report.findings.unshift({
          severity: "blocking",
          area: "status",
          message: "Event is published or not unpublished (Draft/Pending). The run must be halted and escalated immediately.",
        });
        report.passed = false;
      }
      await args.store.saveReport(runId, report);
    } finally {
      try {
        if (session) await session.close();
      } finally {
        await Promise.all(traceWrites);
      }
    }

    if (traceErrors.length) {
      throw new Error(`failed to save ${traceErrors.length} required audit trace(s): ${traceErrors[0].message}`);
    }

    return finishResult(
      runId,
      authoritativeEventId,
      eventPlan.specHash,
      tasks,
      report,
      guardrails.spent,
      budgetExhausted
    );
  };
}

const defaultRunOrchestrator = createRunOrchestrator();

export async function runEvent(args: RunEventArgs): Promise<RunResult> {
  return defaultRunOrchestrator(args);
}

async function createEventShell(api: CventApi, task: Task): Promise<string> {
  const details = recordAt(task.payload, "details");
  if (task.kind === "event.create") return (await api.createEvent(details)).id;
  if (task.kind === "event.copy") {
    const templateEventId = details.templateEventId;
    if (typeof templateEventId !== "string" || !templateEventId) {
      throw new Error("event.copy task has no templateEventId");
    }
    return (await api.copyEvent(templateEventId, details)).id;
  }
  throw new Error(`unsupported event shell task kind "${task.kind}"`);
}

async function dispatchApiTask(
  api: CventApi,
  task: Task,
  eventId: string,
  spec: EventSpec,
  specHash: string,
  dependencies: OrchestratorDependencies
): Promise<{
  outcome: { status: "succeeded" | "halted"; evidence: string | null; detail: string | null };
  report?: VerificationReport;
}> {
  switch (task.kind) {
    case "event.update":
      await api.updateEvent(eventId, recordAt(task.payload, "details"));
      return {
        outcome: {
          status: "succeeded",
          evidence: "Cvent accepted the event detail update.",
          detail: null,
        },
      };
    case "verify.registration": {
      const report = await safeVerify(api, eventId, spec, specHash, dependencies);
      return {
        report,
        outcome: report.passed
          ? {
              status: "succeeded",
              evidence: "The independent Cvent API verification matched the intake specification.",
              detail: null,
            }
          : {
              status: "halted",
              evidence: null,
              detail: summarize(report),
            },
      };
    }
    case "verify.draftStatus": {
      const draft = await safeDraftCheck(api, eventId);
      return {
        outcome: draft
          ? {
              status: "succeeded",
              evidence: "The Cvent API confirmed that the event remains unpublished (Draft or Pending).",
              detail: null,
            }
          : {
              status: "halted",
              evidence: null,
              detail: "The event could not be confirmed as unpublished (Draft or Pending) and requires immediate operator review.",
            },
      };
    }
    case "event.create":
    case "event.copy":
      throw new Error("event shell task may only be dispatched before browser startup");
    default:
      throw new Error(`unsupported API task kind "${task.kind}"`);
  }
}

async function safeVerify(
  api: CventApi,
  eventId: string,
  spec: EventSpec,
  specHash: string,
  dependencies: OrchestratorDependencies
): Promise<VerificationReport> {
  try {
    return await dependencies.verify(api, eventId, spec, specHash);
  } catch (error) {
    return {
      eventId,
      specHash,
      passed: false,
      findings: [
        {
          severity: "blocking",
          area: "event",
          message: `Independent verification could not be completed: ${message(error)}`,
        },
      ],
      siteVerifiedBy: "screenshot-review",
      checkedAt: dependencies.now().toISOString(),
    };
  }
}

async function safeDraftCheck(api: CventApi, eventId: string): Promise<boolean> {
  try {
    return await api.isDraft(eventId);
  } catch {
    return false;
  }
}

function checkpointFor(
  dependencies: OrchestratorDependencies,
  taskId: string,
  status: TaskStatus,
  evidence: string | null,
  detail: string | null,
  options: { eventId?: string; totalCostUsd?: number } = {}
): TaskCheckpoint {
  return {
    taskId,
    status,
    evidence,
    detail,
    timestamp: dependencies.now().toISOString(),
    totalCostUsd: options.totalCostUsd ?? 0,
    ...(options.eventId ? { eventId: options.eventId } : {}),
  };
}

function skippedStatus(dependencies: OrchestratorDependencies, evidence: string): TaskRunStatus {
  return {
    status: "skipped",
    evidence,
    detail: null,
    timestamp: dependencies.now().toISOString(),
  };
}

function statusFrom(checkpoint: TaskCheckpoint): TaskRunStatus {
  return {
    status: checkpoint.status,
    evidence: checkpoint.evidence,
    detail: checkpoint.detail,
    timestamp: checkpoint.timestamp,
  };
}

function finishResult(
  runId: string,
  eventId: string | null,
  specHash: string,
  tasks: Record<string, TaskRunStatus>,
  report: VerificationReport | null,
  totalCost: number,
  budgetExhausted: boolean
): RunResult {
  const failedTasks = Object.values(tasks).filter((task) => task.status === "halted").length;
  const blockedTasks = Object.values(tasks).filter((task) => task.status === "blocked").length;
  const skippedTasks = Object.values(tasks).filter(
    (task) => task.status === "skipped" && task.detail !== null
  ).length;
  const halted =
    budgetExhausted ||
    failedTasks > 0 ||
    blockedTasks > 0 ||
    skippedTasks > 0 ||
    !report?.passed;

  return {
    runId,
    eventId,
    specHash,
    status: halted ? "halted" : "succeeded",
    tasks,
    report,
    totalCost,
    triageSummary: triageSummary(eventId, report, failedTasks, blockedTasks, budgetExhausted),
  };
}

function triageSummary(
  eventId: string | null,
  report: VerificationReport | null,
  halted: number,
  blocked: number,
  budgetExhausted: boolean
): string {
  if (!eventId) return "Cvent could not create the event, so no configuration work or verification was performed.";
  if (!halted && !blocked && !budgetExhausted && report?.passed) {
    return "All configuration tasks completed, independent verification passed, and the event remains in Draft for human review.";
  }
  const parts = [
    `${halted} task${halted === 1 ? "" : "s"} stopped and ${blocked} dependent task${blocked === 1 ? "" : "s"} could not run.`,
  ];
  if (budgetExhausted) parts.push("The run reached its cost ceiling, so remaining configuration work was not dispatched.");
  if (report) parts.push(summarize(report));
  else parts.push("Independent verification did not produce a report.");
  return parts.join(" ");
}

async function blockRemainingTasks(
  store: RunStore,
  runId: string,
  ordered: Task[],
  tasks: Record<string, TaskRunStatus>,
  failedTaskId: string,
  dependencies: OrchestratorDependencies
): Promise<void> {
  for (const task of ordered) {
    if (task.id === failedTaskId) continue;
    const checkpoint = checkpointFor(
      dependencies,
      task.id,
      "blocked",
      null,
      `Blocked because prerequisite task ${failedTaskId} did not succeed.`
    );
    await store.saveCheckpoint(runId, checkpoint);
    tasks[task.id] = statusFrom(checkpoint);
  }
}

function eventIdFrom(checkpoints: TaskCheckpoint[]): string | null {
  for (let index = checkpoints.length - 1; index >= 0; index -= 1) {
    const checkpoint = checkpoints[index];
    if (checkpoint.taskId === "event.shell" && checkpoint.status === "succeeded" && checkpoint.eventId) {
      return checkpoint.eventId;
    }
  }
  return null;
}

function latestSucceeded(checkpoints: TaskCheckpoint[], taskId: string): TaskCheckpoint | undefined {
  return [...checkpoints].reverse().find((checkpoint) => checkpoint.taskId === taskId && checkpoint.status === "succeeded");
}

function isVerificationTask(task: Task): boolean {
  return task.kind.startsWith("verify.");
}

function recordAt(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`task payload field "${key}" must be an object`);
  }
  return value as Record<string, unknown>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface StoredRun {
  input: CreateRunInput;
  plan?: Plan;
  checkpoints: TaskCheckpoint[];
  report?: VerificationReport | null;
  traces: RunTrace[];
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, StoredRun>();

  async createRun(input: CreateRunInput): Promise<string> {
    const runId = randomUUID();
    this.runs.set(runId, { input: structuredClone(input), checkpoints: [], traces: [] });
    return runId;
  }

  async savePlan(runId: string, value: Plan): Promise<void> {
    this.requireRun(runId).plan = structuredClone(value);
  }

  async saveCheckpoint(runId: string, checkpoint: TaskCheckpoint): Promise<void> {
    this.requireRun(runId).checkpoints.push(structuredClone(checkpoint));
  }

  async loadCheckpoints(runId: string): Promise<LoadedCheckpoints> {
    const run = this.requireRun(runId);
    if (!run.plan) throw new Error(`run ${runId} has no persisted plan`);
    return {
      specHash: run.plan.specHash,
      checkpoints: structuredClone(run.checkpoints),
    };
  }

  async saveReport(runId: string, report: VerificationReport | null): Promise<void> {
    this.requireRun(runId).report = structuredClone(report);
  }

  async saveTrace(runId: string, trace: RunTrace): Promise<void> {
    this.requireRun(runId).traces.push(structuredClone(trace));
  }

  getRun(runId: string): Readonly<StoredRun> | undefined {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  private requireRun(runId: string): StoredRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`run ${runId} was not found`);
    return run;
  }
}
