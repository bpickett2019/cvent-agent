/** Smoke tests for the Pi executor. No Cvent, browser, network, or live model. */

import {
  createAssistantMessageEventStream,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { NOOP_TELEMETRY_CONTEXT } from "@earendil-works/pi-telemetry";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  createTaskExecutor,
  type ExecuteTaskArgs,
  type ExecutorDependencies,
  type TaskResult,
} from "./src/agent/executor";
import {
  createLangfuseTelemetry,
  shutdownLangfuse,
  type AuditTelemetry,
} from "./src/agent/telemetry";
import type { BrowserSession } from "./src/browser/driver";
import { Guardrails, type Action } from "./src/guardrails/middleware";
import { parseProcedure } from "./src/procedures/loader";

const EVENT_ID = "3f2b6a10-9c4d-4e21-b8f7-0a1c2d3e4f56";
let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = "") {
  checks += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

class StubSession {
  readonly actions: Action[] = [];

  constructor(private readonly guardrails: Guardrails) {}

  async perform(action: Action): Promise<void> {
    this.guardrails.check(action);
    this.actions.push(action);
  }

  async textOf(selector: string, taskId: string): Promise<string | null> {
    await this.perform({ type: "read", selector, taskId });
    return `text:${selector}`;
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from("failure-screenshot");
  }
}

class StubTelemetry implements AuditTelemetry {
  readonly context = NOOP_TELEMETRY_CONTEXT;
  readonly steps: string[] = [];
  flushed = false;

  recordStep(step: { name: string }): void {
    this.steps.push(step.name);
  }

  async flush(): Promise<void> {
    this.flushed = true;
  }
}

function result(): TaskResult {
  return {
    status: "success",
    taskId: "site.theme",
    summary: "The Emerald Corporate theme was applied.",
    haltReason: null,
    haltDetail: null,
    evidence: "Cvent showed Changes saved and the Emerald Corporate theme as active.",
    proposedProcedure: null,
  };
}

function makeArgs(budgetRemainingUsd = 30) {
  const guardrails = new Guardrails(
    {
      eventId: EVENT_ID,
      denyList: { selectors: [], urlPatterns: [] },
      costCeilingUsd: 30,
      costAlertUsd: 20,
    },
    () => {}
  );
  const session = new StubSession(guardrails);
  const args: ExecuteTaskArgs = {
    task: {
      id: "site.theme",
      kind: "site.theme",
      channel: "browser",
      dependsOn: [],
      procedure: "site/apply-theme",
      payload: { theme: { templateName: "Emerald Corporate", palette: { primary: "#0B7A4B" } } },
      label: "Apply theme Emerald Corporate",
    },
    eventId: EVENT_ID,
    procedure: null,
    session: session as unknown as BrowserSession,
    guardrails,
    budgetRemainingUsd,
  };
  return { args, session, guardrails };
}

function withCost(message: AssistantMessage, total: number): AssistantMessage {
  return {
    ...message,
    usage: {
      ...message.usage,
      cost: { ...message.usage.cost, total },
    },
  };
}

async function execute(
  responses: AssistantMessage[],
  args: ExecuteTaskArgs,
  streamOverride?: ExecutorDependencies["streamFn"]
) {
  const faux = fauxProvider();
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const telemetry = new StubTelemetry();
  const dependencies: ExecutorDependencies = {
    model: faux.getModel(),
    streamFn: streamOverride ?? models.streamSimple.bind(models),
    operator: "ops@example.com",
    runId: "run-smoke",
    createTelemetry: () => telemetry,
  };
  return { output: await createTaskExecutor(dependencies)(args), telemetry, faux };
}

console.log("\n[1] Executor happy path");
{
  const { args, session } = makeArgs();
  const { output, telemetry } = await execute(
    [
      fauxAssistantMessage(fauxToolCall("browser_click", { selector: "#theme" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("task_complete", { result: result() }), {
        stopReason: "toolUse",
      }),
    ],
    args
  );
  check("successful result accepted", output.status === "success", output.status);
  check("browser action used supplied session", session.actions.length === 1);
  check("audit trail flushed", telemetry.flushed);
}

console.log("\n[2] Guardrail block is terminal");
{
  const { args, session } = makeArgs();
  const { output, faux } = await execute(
    [
      fauxAssistantMessage(fauxToolCall("browser_click", { selector: "#publishEvent" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("browser_click", { selector: "#should-not-run" }), {
        stopReason: "toolUse",
      }),
    ],
    args
  );
  check("guardrail returns halted", output.haltReason === "guardrail-blocked", output.haltReason ?? "");
  check("blocked browser action did not execute", session.actions.length === 0);
  check("guardrail was not retried", faux.state.callCount === 1, `${faux.state.callCount} model call(s)`);
}

console.log("\n[3] Malformed model output");
{
  const { args } = makeArgs();
  const { output, faux } = await execute([fauxAssistantMessage("not json")], args);
  check("malformed output halts", output.haltReason === "malformed-model-output", output.haltReason ?? "");
  check("malformed output is not retried", faux.state.callCount === 1);
}

console.log("\n[4] Iteration cap");
{
  const { args, session } = makeArgs();
  const responses = Array.from({ length: 26 }, (_, index) =>
    fauxAssistantMessage(fauxToolCall("browser_read", { selector: `#control-${index}` }), {
      stopReason: "toolUse",
    })
  );
  const { output } = await execute(responses, args);
  check("iteration cap halts", output.haltReason === "iteration-cap", output.haltReason ?? "");
  check("only 25 tools execute", session.actions.length === 25, `${session.actions.length} actions`);
}

console.log("\n[5] Same-selector retry cap");
{
  const { args, session } = makeArgs();
  const responses = Array.from({ length: 4 }, () =>
    fauxAssistantMessage(fauxToolCall("browser_read", { selector: "#stuck" }), {
      stopReason: "toolUse",
    })
  );
  const { output } = await execute(responses, args);
  check("same-selector retry cap halts", output.haltReason === "selector-retry-cap", output.haltReason ?? "");
  check("only three repeated attempts execute", session.actions.length === 3, `${session.actions.length} actions`);
}

console.log("\n[6] Budget exhaustion");
{
  const { args, session, guardrails } = makeArgs(30);
  const costly = withCost(
    fauxAssistantMessage(fauxToolCall("browser_click", { selector: "#save" }), {
      stopReason: "toolUse",
    }),
    31
  );
  const costlyStream: ExecutorDependencies["streamFn"] = () => {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: "start", partial: { ...costly, content: [], stopReason: "pending" } });
      stream.push({ type: "done", reason: "toolUse", message: costly });
    });
    return stream;
  };
  const { output } = await execute([costly], args, costlyStream);
  check(
    "budget exhaustion halts",
    output.haltReason === "budget-exhausted",
    output.haltDetail ?? output.haltReason ?? ""
  );
  check("real provider cost accrued", guardrails.spent === 31, `$${guardrails.spent}`);
  check("post-budget action did not execute", session.actions.length === 0);
}

console.log("\n[7] Procedure loader");
{
  const yaml = `
id: site/test
version: 1
goal: Apply theme
preconditions: []
steps:
  - description: Choose theme
    selectorHint: "role=option[name='{{theme.templateName}}']"
failureModes: []
provenance:
  authoredBy: human
  validatedAgainst: null
  lastReviewed: null
`;
  const procedure = parseProcedure(yaml, { theme: { templateName: "Emerald Corporate" } });
  check("procedure values interpolate", procedure.steps[0].selectorHint?.includes("Emerald Corporate") === true);
  let malformed = false;
  try {
    parseProcedure("id: [", {});
  } catch (error) {
    malformed = error instanceof Error && error.message.includes("malformed YAML");
  }
  check("malformed YAML has a clear error", malformed);
}

console.log("\n[8] Langfuse audit adapter");
{
  const exporter = new InMemorySpanExporter();
  const telemetry = createLangfuseTelemetry({
    host: "https://langfuse.example",
    publicKey: "public",
    secretKey: "secret",
    runId: "run-audit",
    taskId: "site.theme",
    operator: "ops@example.com",
    task: { kind: "site.theme", label: "Apply the event theme" },
    exporter,
  });
  telemetry.recordGeneration?.(fauxAssistantMessage("Configured theme"), 1);
  telemetry.recordStep({
    name: "browser_fill",
    at: "2027-01-01T00:00:00.000Z",
    ok: false,
    action: { type: "fill", selector: "#field", value: "sensitive", taskId: "site.theme" },
    error: "failed",
    screenshot: Buffer.from("screenshot"),
  });
  telemetry.recordStep({
    name: "task.result",
    at: "2027-01-01T00:00:01.000Z",
    ok: false,
    output: { status: "halted" },
    error: "failed",
  });
  await telemetry.flush();
  const spans = exporter.getFinishedSpans();
  const serialized = JSON.stringify(spans.map((span) => ({ name: span.name, attributes: span.attributes })));
  const root = spans.find((span) => span.name === "execute-cvent-task");
  const modelSpan = spans.find((span) => span.name === "generate-cvent-action");
  const toolSpan = spans.find((span) => span.name === "fill-cvent-field");
  check("agent, generation, and tool observations are emitted", root !== undefined && modelSpan !== undefined && toolSpan !== undefined);
  check("generation and tool are nested under the agent", modelSpan?.parentSpanContext?.spanId === root?.spanContext().spanId && toolSpan?.parentSpanContext?.spanId === root?.spanContext().spanId);
  check("model and usage fields are attached to the generation", modelSpan?.attributes["langfuse.observation.type"] === "generation" && typeof modelSpan.attributes["langfuse.observation.model.name"] === "string" && typeof modelSpan.attributes["langfuse.observation.usage_details"] === "string");
  check("audit identity is attached without operator PII", serialized.includes("run-audit") && serialized.includes("operator-") && !serialized.includes("ops@example.com"));
  check("audit tool values are redacted", serialized.includes("«9 chars»") && !serialized.includes('"value":"sensitive"'));
  check("failure screenshot is hashed, not uploaded", serialized.includes("failureScreenshotSha256") && !serialized.includes(Buffer.from("screenshot").toString("base64")));
  await shutdownLangfuse();
}

console.log(`\n${failures === 0 ? `ALL EXECUTOR CHECKS PASSED (${checks} checks)` : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
