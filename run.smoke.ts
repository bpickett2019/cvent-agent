/** Smoke tests for the run orchestrator. No Cvent, browser, network, or live model. */

import type { Browser } from "playwright";
import type { ExecuteTaskArgs, TaskResult } from "./src/agent/executor";
import type { BrowserProvider } from "./src/browser/driver";
import type {
  CventAdmissionItem,
  CventApi,
  CventEvent,
  CventQuestion,
  CventRegistrationPath,
  CventRegistrationType,
  CventVoucher,
} from "./src/cvent/api";
import {
  createRunOrchestrator,
  InMemoryRunStore,
  type RunEventArgs,
} from "./src/run/orchestrator";
import { EventSpec, type EventSpec as EventSpecType } from "./src/spec/eventSpec";
import type { Procedure } from "./src/procedures/loader";

const EVENT_ID = "3f2b6a10-9c4d-4e21-b8f7-0a1c2d3e4f56";
let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = "") {
  checks += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function makeSpec(name = "Emerald Expo West 2027"): EventSpecType {
  return EventSpec.parse({
    specVersion: "1.0",
    details: {
      name,
      timezone: "America/Los_Angeles",
      start: "2027-03-15T09:00:00-07:00",
      end: "2027-03-17T17:00:00-07:00",
      format: "inPerson",
    },
    theme: {
      templateName: "Emerald Corporate",
      palette: { primary: "#0B7A4B" },
    },
    header: { title: name },
    footer: { text: "© Emerald Holding" },
    pages: [
      {
        key: "home",
        title: "Home",
        widgets: [{ type: "text", heading: "Welcome", body: "Welcome to Emerald." }],
      },
      { key: "agenda", title: "Agenda", widgets: [] },
    ],
    registration: {
      admissionItems: [],
      optionalItems: [],
      vouchers: [],
      paths: [],
      advancedRules: [],
    },
  });
}

class StubCventApi {
  createCalls = 0;
  copyCalls = 0;
  updateCalls = 0;
  draftChecks = 0;
  verificationReads = 0;
  eventName = "";
  draft = true;

  async createEvent(input: Record<string, unknown>): Promise<{ id: string }> {
    this.createCalls += 1;
    this.eventName = typeof input.name === "string" ? input.name : this.eventName;
    return { id: EVENT_ID };
  }

  async copyEvent(_templateEventId: string, input: Record<string, unknown>): Promise<{ id: string }> {
    this.copyCalls += 1;
    this.eventName = typeof input.name === "string" ? input.name : this.eventName;
    return { id: EVENT_ID };
  }

  async updateEvent(_eventId: string, patch: Record<string, unknown>): Promise<void> {
    this.updateCalls += 1;
    this.eventName = typeof patch.name === "string" ? patch.name : this.eventName;
  }

  async getEvent(_eventId: string): Promise<CventEvent> {
    this.verificationReads += 1;
    return { id: EVENT_ID, title: this.eventName, status: this.draft ? "Draft" : "Live" };
  }

  async listAdmissionItems(_eventId: string): Promise<CventAdmissionItem[]> {
    this.verificationReads += 1;
    return [];
  }

  async listRegistrationPaths(_eventId: string): Promise<CventRegistrationPath[]> {
    this.verificationReads += 1;
    return [];
  }

  async listVouchers(_eventId: string): Promise<CventVoucher[]> {
    this.verificationReads += 1;
    return [];
  }

  async listRegistrationTypes(_eventId: string): Promise<CventRegistrationType[]> {
    this.verificationReads += 1;
    return [];
  }

  async listQuestions(_eventId: string): Promise<CventQuestion[]> {
    this.verificationReads += 1;
    return [];
  }

  async isDraft(_eventId: string): Promise<boolean> {
    this.draftChecks += 1;
    return this.draft;
  }
}

class StubBrowserProvider implements BrowserProvider {
  readonly name = "stub";
  connectCalls = 0;
  releaseCalls = 0;
  openedAfterEvent = true;

  constructor(private readonly eventExists: () => boolean) {}

  async connect(): Promise<{ browser: Browser; release: () => Promise<void> }> {
    this.connectCalls += 1;
    this.openedAfterEvent = this.openedAfterEvent && this.eventExists();
    const page = {};
    const context = { pages: () => [page] };
    const browser = { contexts: () => [context] } as unknown as Browser;
    return {
      browser,
      release: async () => {
        this.releaseCalls += 1;
      },
    };
  }
}

const procedure = (id: string): Procedure => ({
  id,
  version: 1,
  goal: "Smoke procedure",
  preconditions: [],
  steps: [{ description: "Smoke step" }],
  failureModes: [],
  provenance: { authoredBy: "human", validatedAgainst: null, lastReviewed: null },
});

function success(taskId: string): TaskResult {
  return {
    status: "success",
    taskId,
    summary: "Task completed.",
    haltReason: null,
    haltDetail: null,
    evidence: `Observed ${taskId} complete.`,
    proposedProcedure: null,
  };
}

function halted(taskId: string, detail = "The requested Cvent control was unavailable."): TaskResult {
  return {
    status: "halted",
    taskId,
    summary: detail,
    haltReason: "control-unavailable",
    haltDetail: detail,
    evidence: null,
    proposedProcedure: null,
  };
}

function makeHarness(executor: (args: ExecuteTaskArgs) => Promise<TaskResult>) {
  return createRunOrchestrator({
    executeTask: executor,
    loadProcedure: async (id) => procedure(id),
  });
}

function makeArgs(
  spec: EventSpecType,
  store: InMemoryRunStore,
  api: StubCventApi,
  browserProvider: StubBrowserProvider,
  resumeRunId?: string
): RunEventArgs {
  return {
    spec,
    operator: { id: "operator-1", email: "ops@example.com" },
    store,
    api: api as unknown as CventApi,
    browserProvider,
    denyList: { selectors: [], urlPatterns: [] },
    costCeilingUsd: 30,
    costAlertUsd: 20,
    resumeRunId,
  };
}

console.log("\n[1] Happy path");
{
  const store = new InMemoryRunStore();
  const api = new StubCventApi();
  const provider = new StubBrowserProvider(() => api.createCalls === 1);
  const calls: string[] = [];
  const run = makeHarness(async ({ task }) => {
    calls.push(task.id);
    return success(task.id);
  });
  const result = await run(makeArgs(makeSpec(), store, api, provider));
  check("run succeeds", result.status === "succeeded", result.status);
  check("all planned tasks succeed", Object.values(result.tasks).every((task) => task.status === "succeeded"));
  check("verification passes", result.report?.passed === true);
  check("plan persisted before event creation", provider.openedAfterEvent && api.createCalls === 1);
  check("browser closes", provider.releaseCalls === 1);
  check("browser tasks dispatched", calls.includes("site.theme") && calls.includes("verify.site"));
}

console.log("\n[2] Halt blocks dependents but not siblings");
{
  const store = new InMemoryRunStore();
  const api = new StubCventApi();
  const provider = new StubBrowserProvider(() => api.createCalls === 1);
  const calls: string[] = [];
  const run = makeHarness(async ({ task }) => {
    calls.push(task.id);
    return task.id === "site.page.home" ? halted(task.id) : success(task.id);
  });
  const result = await run(makeArgs(makeSpec(), store, api, provider));
  check("halted task recorded", result.tasks["site.page.home"]?.status === "halted");
  check("transitive dependent blocked", result.tasks["site.page.home.widget.0"]?.status === "blocked");
  check("sibling still runs", result.tasks["site.page.agenda"]?.status === "succeeded");
  check("blocked widget was not dispatched", !calls.includes("site.page.home.widget.0"));
  check("partial run is halted", result.status === "halted");
}

console.log("\n[3] Resume skips completed work");
{
  const store = new InMemoryRunStore();
  const api = new StubCventApi();
  const provider = new StubBrowserProvider(() => api.createCalls === 1);
  const counts = new Map<string, number>();
  const run = makeHarness(async ({ task }) => {
    counts.set(task.id, (counts.get(task.id) ?? 0) + 1);
    return success(task.id);
  });
  const first = await run(makeArgs(makeSpec(), store, api, provider));
  const second = await run(makeArgs(makeSpec(), store, api, provider, first.runId));
  check("completed browser task is skipped", second.tasks["site.theme"]?.status === "skipped");
  check("completed task is not re-executed", counts.get("site.theme") === 1, `${counts.get("site.theme")} execution(s)`);
  check("event is not created again", api.createCalls === 1, `${api.createCalls} create call(s)`);
  check("verification still runs on resume", (counts.get("verify.site") ?? 0) === 2);
}

console.log("\n[4] Resume after a task throws");
{
  const store = new InMemoryRunStore();
  const api = new StubCventApi();
  const provider = new StubBrowserProvider(() => api.createCalls === 1);
  const counts = new Map<string, number>();
  const run = makeHarness(async ({ task }) => {
    const invocation = (counts.get(task.id) ?? 0) + 1;
    counts.set(task.id, invocation);
    if (task.id === "site.page.home" && invocation === 1) {
      throw new Error("transient executor failure");
    }
    return success(task.id);
  });

  const first = await run(makeArgs(makeSpec(), store, api, provider));
  await run(makeArgs(makeSpec(), store, api, provider, first.runId));

  check(
    "tasks completed before the throw are not re-executed",
    counts.get("site.theme") === 1,
    `${counts.get("site.theme")} execution(s)`
  );
  check(
    "previously thrown task is re-executed",
    counts.get("site.page.home") === 2,
    `${counts.get("site.page.home")} execution(s)`
  );
  check(
    "resume does not create a duplicate event",
    api.createCalls === 1,
    `${api.createCalls} create call(s)`
  );
}

console.log("\n[5] Changed spec cannot resume");
{
  const store = new InMemoryRunStore();
  const api = new StubCventApi();
  const provider = new StubBrowserProvider(() => api.createCalls === 1);
  const run = makeHarness(async ({ task }) => success(task.id));
  const first = await run(makeArgs(makeSpec(), store, api, provider));
  let refused = false;
  try {
    await run(makeArgs(makeSpec("Changed Event Name"), store, api, provider, first.runId));
  } catch (error) {
    refused = error instanceof Error && error.message.includes("refusing to resume");
  }
  check("changed spec hash is refused", refused);
  check("refused resume has no new side effects", api.createCalls === 1 && provider.connectCalls === 1);
}

console.log("\n[6] Shared budget exhaustion");
{
  const store = new InMemoryRunStore();
  const api = new StubCventApi();
  const provider = new StubBrowserProvider(() => api.createCalls === 1);
  const calls: string[] = [];
  const run = makeHarness(async ({ task, guardrails }) => {
    calls.push(task.id);
    if (task.id === "site.theme") guardrails.accrue(30);
    return success(task.id);
  });
  const result = await run(makeArgs(makeSpec(), store, api, provider));
  check("budget exhaustion halts run", result.status === "halted");
  check("shared total cost is reported", result.totalCost === 30, `$${result.totalCost}`);
  check("later browser work is not dispatched", !calls.includes("site.header") && !calls.includes("verify.site"));
  check("remaining work is skipped", result.tasks["site.header"]?.status === "skipped");
  check("API verification still runs", result.report !== null && api.draftChecks > 0);
}

console.log("\n[7] Browser closes after task throw");
{
  const store = new InMemoryRunStore();
  const api = new StubCventApi();
  const provider = new StubBrowserProvider(() => api.createCalls === 1);
  const run = makeHarness(async ({ task }) => {
    if (task.id === "site.theme") throw new Error("executor exploded");
    return success(task.id);
  });
  const result = await run(makeArgs(makeSpec(), store, api, provider));
  check("thrown task becomes halted", result.tasks["site.theme"]?.status === "halted");
  check("browser closes after throw", provider.releaseCalls === 1);
}

console.log("\n[8] Verification follows partial failure");
{
  const store = new InMemoryRunStore();
  const api = new StubCventApi();
  const provider = new StubBrowserProvider(() => api.createCalls === 1);
  const run = makeHarness(async ({ task }) =>
    task.id === "site.page.home" ? halted(task.id) : success(task.id)
  );
  const result = await run(makeArgs(makeSpec(), store, api, provider));
  check("partial failure retained", result.tasks["site.page.home"]?.status === "halted");
  check("verification report still saved", result.report !== null);
  check("verification API reads occurred", api.verificationReads > 0 && api.draftChecks > 0);
  check("triage summary is operator-readable", result.triageSummary.includes("task") && !result.triageSummary.includes("selector"));
}

console.log(`\n${failures === 0 ? `ALL RUN CHECKS PASSED (${checks} checks)` : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
