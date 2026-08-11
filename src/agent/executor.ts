import { readFile } from "node:fs/promises";
import { Agent, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import {
  Type,
  createModels,
  type AssistantMessage,
  type Model,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { z } from "zod";
import type { Task } from "../planner/plan";
import type { BrowserSession } from "../browser/driver";
import { GuardrailViolation, type Action, type Guardrails } from "../guardrails/middleware";
import type { Procedure } from "../procedures/loader";
import { createLangfuseTelemetry, type AuditTelemetry } from "./telemetry";

const ProposedProcedureSchema = z
  .object({
    id: z.string().min(1),
    basedOn: z.string().min(1).nullable(),
    steps: z.array(
      z
        .object({
          description: z.string().min(1),
          selectorHint: z.string(),
          verify: z.string(),
        })
        .strict()
    ),
    note: z.string(),
  })
  .strict();

const CommonResultShape = {
  taskId: z.string().min(1),
  summary: z.string().min(1),
  proposedProcedure: ProposedProcedureSchema.nullable(),
};

export const TaskResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("success"),
      ...CommonResultShape,
      haltReason: z.null(),
      haltDetail: z.null(),
      evidence: z.string().min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal("halted"),
      ...CommonResultShape,
      haltReason: z.string().min(1),
      haltDetail: z.string().min(1),
      evidence: z.null(),
    })
    .strict(),
]);

export type TaskResult = z.infer<typeof TaskResultSchema>;

export interface ExecuteTaskArgs {
  task: Task;
  eventId: string;
  procedure: Procedure | null;
  session: BrowserSession;
  guardrails: Guardrails;
  budgetRemainingUsd: number;
}

export interface ExecutorDependencies {
  model: Model<any>;
  streamFn: StreamFn;
  operator: string;
  runId: string;
  createTelemetry(taskId: string): AuditTelemetry;
}

const ProposedProcedureType = Type.Object(
  {
    id: Type.String(),
    basedOn: Type.Union([Type.String(), Type.Null()]),
    steps: Type.Array(
      Type.Object(
        {
          description: Type.String(),
          selectorHint: Type.String(),
          verify: Type.String(),
        },
        { additionalProperties: false }
      )
    ),
    note: Type.String(),
  },
  { additionalProperties: false }
);

const TaskResultType = Type.Union([
  Type.Object(
    {
      status: Type.Literal("success"),
      taskId: Type.String(),
      summary: Type.String(),
      haltReason: Type.Null(),
      haltDetail: Type.Null(),
      evidence: Type.String(),
      proposedProcedure: Type.Union([ProposedProcedureType, Type.Null()]),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      status: Type.Literal("halted"),
      taskId: Type.String(),
      summary: Type.String(),
      haltReason: Type.String(),
      haltDetail: Type.String(),
      evidence: Type.Null(),
      proposedProcedure: Type.Union([ProposedProcedureType, Type.Null()]),
    },
    { additionalProperties: false }
  ),
]);

const MAX_TOOL_CALLS = 25;
const MAX_SAME_SELECTOR_ATTEMPTS = 3;

export function createTaskExecutor(dependencies: ExecutorDependencies) {
  return async function runTask(args: ExecuteTaskArgs): Promise<TaskResult> {
    const telemetry = dependencies.createTelemetry(args.task.id);
    let terminal: TaskResult | null = null;
    let toolCalls = 0;
    let modelCost = 0;
    let budgetExhausted = args.budgetRemainingUsd <= 0;
    let lastSelectorAttempt: string | undefined;
    let sameSelectorAttempts = 0;

    if (budgetExhausted) {
      terminal = halt(
        args.task.id,
        "budget-exhausted",
        "The task did not start because no model budget remained for this task."
      );
    }

    const tools = createTools(args, telemetry, () => terminal, (result) => {
      terminal = result;
    });

    // pi-agent-core has no default tools: the agent receives only this explicit
    // list. Filesystem, shell, network, and code-execution tools are absent.
    const agent = new Agent({
      initialState: {
        systemPrompt: await renderSystemPrompt(args),
        model: dependencies.model,
        thinkingLevel: "low",
        tools,
        messages: [],
      },
      streamFn: (model, context, options) =>
        dependencies.streamFn(model, context, { ...options, telemetryContext: telemetry.context }),
      toolExecution: "sequential",
      beforeToolCall: async ({ toolCall, args: toolArgs }) => {
        if (terminal) return { block: true, reason: "task is already terminal", terminate: true };

        toolCalls += 1;
        if (toolCalls > MAX_TOOL_CALLS) {
          terminal = halt(
            args.task.id,
            "iteration-cap",
            `Stopped after ${MAX_TOOL_CALLS} tool calls without completing the task.`
          );
          return { block: true, reason: "tool-call iteration cap reached", terminate: true };
        }

        if (toolCall.name.startsWith("browser_")) {
          const selector = selectorFrom(toolArgs);
          if (selector) {
            const attemptKey = `${toolCall.name}\u0000${selector}`;
            if (attemptKey === lastSelectorAttempt) {
              sameSelectorAttempts += 1;
            } else {
              lastSelectorAttempt = attemptKey;
              sameSelectorAttempts = 1;
            }
            if (sameSelectorAttempts > MAX_SAME_SELECTOR_ATTEMPTS) {
              terminal = halt(
                args.task.id,
                "selector-retry-cap",
                `Stopped after three attempts on the same Cvent control without progress.`
              );
              return { block: true, reason: "same-selector retry cap reached", terminate: true };
            }
          }
        }
        return undefined;
      },
      afterToolCall: async ({ toolCall, isError }) => {
        if (isError && (toolCall.name === "task_complete" || toolCall.name === "task_halt") && !terminal) {
          terminal = halt(
            args.task.id,
            "malformed-model-output",
            "The model's task result did not match the required JSON contract. No retry was attempted."
          );
        }
        return terminal ? { terminate: true } : undefined;
      },
    });

    agent.subscribe(async (event) => {
      if (event.type === "message_end" && isAssistantMessage(event.message)) {
        const cost = event.message.usage.cost.total;
        args.guardrails.accrue(cost);
        modelCost += cost;
        if (modelCost > args.budgetRemainingUsd && !terminal) {
          budgetExhausted = true;
          terminal = halt(
            args.task.id,
            "budget-exhausted",
            `The model budget for this task was exhausted after $${modelCost.toFixed(2)} of usage.`
          );
        }
      }
    });

    try {
      if (!terminal) await agent.prompt("Execute the assigned task now.");
    } catch (error) {
      if (!terminal) {
        terminal = halt(
          args.task.id,
          "executor-error",
          `The task executor stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    let result = terminal ?? parseFinalAssistantResult(agent.state.messages, args.task.id);
    if (budgetExhausted && result.status === "success") {
      result = halt(args.task.id, "budget-exhausted", "The model budget was exhausted before success could be accepted.");
    }

    telemetry.recordStep({
      name: "task.result",
      at: new Date().toISOString(),
      ok: result.status === "success",
      error: result.haltDetail ?? undefined,
    });

    try {
      await telemetry.flush();
    } catch (error) {
      result = halt(
        args.task.id,
        "telemetry-failed",
        `The task stopped because its required audit trail could not be saved: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return result;
  };
}

export async function executeTask(args: ExecuteTaskArgs): Promise<TaskResult> {
  return createTaskExecutor(createProductionDependencies())(args);
}

function createTools(
  args: ExecuteTaskArgs,
  telemetry: AuditTelemetry,
  getTerminal: () => TaskResult | null,
  setTerminal: (result: TaskResult) => void
): AgentTool<any>[] {
  const browserTool = <T extends Record<string, unknown>>(
    name: string,
    description: string,
    parameters: AgentTool<any>["parameters"],
    action: (params: T) => Action,
    execute: (params: T) => Promise<string | null>
  ): AgentTool<any> => ({
    name,
    label: name,
    description,
    parameters,
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const typed = params as T;
      const browserAction = action(typed);
      const started = Date.now();
      try {
        const output = await execute(typed);
        telemetry.recordStep({
          name,
          at: new Date().toISOString(),
          ok: true,
          action: browserAction,
          durationMs: Date.now() - started,
        });
        return textResult(output ?? "ok");
      } catch (error) {
        const screenshot = await args.session.screenshot().catch(() => undefined);
        telemetry.recordStep({
          name,
          at: new Date().toISOString(),
          ok: false,
          action: browserAction,
          error: error instanceof Error ? error.message : String(error),
          screenshot,
          durationMs: Date.now() - started,
        });
        if (error instanceof GuardrailViolation) {
          setTerminal(
            halt(
              args.task.id,
              "guardrail-blocked",
              `The requested Cvent action was blocked by the ${error.rule} guardrail. No retry was attempted.`
            )
          );
        }
        throw error;
      }
    },
  });

  return [
    browserTool<{ url: string }>(
      "browser_navigate",
      "Navigate within the one Cvent event assigned to this task.",
      Type.Object({ url: Type.String() }, { additionalProperties: false }),
      ({ url }) => ({ type: "navigate", url, taskId: args.task.id }),
      async ({ url }) => {
        await args.session.perform({ type: "navigate", url, taskId: args.task.id });
        return "navigated";
      }
    ),
    browserTool<{ selector: string }>(
      "browser_click",
      "Click one Cvent control.",
      Type.Object({ selector: Type.String() }, { additionalProperties: false }),
      ({ selector }) => ({ type: "click", selector, taskId: args.task.id }),
      async ({ selector }) => {
        await args.session.perform({ type: "click", selector, taskId: args.task.id });
        return "clicked";
      }
    ),
    browserTool<{ selector: string; value: string }>(
      "browser_fill",
      "Fill one Cvent field with the exact supplied value.",
      Type.Object({ selector: Type.String(), value: Type.String() }, { additionalProperties: false }),
      ({ selector, value }) => ({ type: "fill", selector, value, taskId: args.task.id }),
      async ({ selector, value }) => {
        await args.session.perform({ type: "fill", selector, value, taskId: args.task.id });
        return "filled";
      }
    ),
    browserTool<{ selector: string; value: string }>(
      "browser_select",
      "Select the exact supplied value in one Cvent control.",
      Type.Object({ selector: Type.String(), value: Type.String() }, { additionalProperties: false }),
      ({ selector, value }) => ({ type: "select", selector, value, taskId: args.task.id }),
      async ({ selector, value }) => {
        await args.session.perform({ type: "select", selector, value, taskId: args.task.id });
        return "selected";
      }
    ),
    browserTool<{ selector: string; assetPath: string }>(
      "browser_upload",
      "Upload the exact supplied asset to one Cvent file control.",
      Type.Object({ selector: Type.String(), assetPath: Type.String() }, { additionalProperties: false }),
      ({ selector, assetPath }) => ({ type: "upload", selector, value: assetPath, taskId: args.task.id }),
      async ({ selector, assetPath }) => {
        await args.session.perform({ type: "upload", selector, value: assetPath, taskId: args.task.id });
        return "uploaded";
      }
    ),
    browserTool<{ selector: string }>(
      "browser_read",
      "Read text from one Cvent control, returning null when it has no text.",
      Type.Object({ selector: Type.String() }, { additionalProperties: false }),
      ({ selector }) => ({ type: "read", selector, taskId: args.task.id }),
      ({ selector }) => args.session.textOf(selector, args.task.id)
    ),
    {
      name: "task_complete",
      label: "task_complete",
      description: "Complete the task with a result matching the required JSON contract.",
      parameters: Type.Object({ result: TaskResultType }, { additionalProperties: false }),
      constrainedSampling: { type: "json_schema", strict: "require" },
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        if (getTerminal()) return { ...textResult("task already terminal"), terminate: true };
        const parsed = validateResult((params as { result: unknown }).result, args.task.id);
        setTerminal(parsed);
        telemetry.recordStep({ name: "task_complete", at: new Date().toISOString(), ok: true });
        return { ...textResult("task result accepted"), terminate: true };
      },
    },
    {
      name: "task_halt",
      label: "task_halt",
      description: "Halt the task with an operator-readable reason and detail.",
      parameters: Type.Object(
        { reason: Type.String(), detail: Type.String() },
        { additionalProperties: false }
      ),
      constrainedSampling: { type: "json_schema", strict: "require" },
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        const { reason, detail } = params as { reason: string; detail: string };
        setTerminal(halt(args.task.id, reason, detail));
        telemetry.recordStep({ name: "task_halt", at: new Date().toISOString(), ok: true });
        return { ...textResult("task halt accepted"), terminate: true };
      },
    },
  ];
}

async function renderSystemPrompt(args: ExecuteTaskArgs): Promise<string> {
  const template = await readFile(new URL("./SYSTEM_PROMPT.md", import.meta.url), "utf8");
  const values: Record<string, string> = {
    eventId: args.eventId,
    "task.label": args.task.label,
    "task.id": args.task.id,
    "task.payload": JSON.stringify(args.task.payload, null, 2),
    "procedure|none": args.procedure ? JSON.stringify(args.procedure, null, 2) : "none",
    budgetRemaining: args.budgetRemainingUsd.toFixed(2),
  };
  return template.replace(/{{([^{}]+)}}/g, (slot, name: string) => values[name] ?? slot);
}

function parseFinalAssistantResult(messages: unknown[], taskId: string): TaskResult {
  const assistant = [...messages].reverse().find(isAssistantMessage);
  if (!assistant) return halt(taskId, "missing-model-output", "The model returned no final task result.");
  if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
    return halt(taskId, "model-error", assistant.errorMessage ?? "The model call did not complete successfully.");
  }
  const text = assistant.content
    .filter((part): part is Extract<(typeof assistant.content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
  try {
    return validateResult(JSON.parse(text), taskId);
  } catch (error) {
    return halt(
      taskId,
      "malformed-model-output",
      `The model's final response did not match the required task result: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function validateResult(value: unknown, taskId: string): TaskResult {
  const result = TaskResultSchema.parse(value);
  if (result.taskId !== taskId) {
    throw new Error(`result taskId "${result.taskId}" does not match assigned task "${taskId}"`);
  }
  return result;
}

function halt(taskId: string, reason: string, detail: string): TaskResult {
  return {
    status: "halted",
    taskId,
    summary: detail,
    haltReason: reason,
    haltDetail: detail,
    evidence: null,
    proposedProcedure: null,
  };
}

function selectorFrom(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const selector = (value as Record<string, unknown>).selector;
  return typeof selector === "string" ? selector : undefined;
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  return typeof value === "object" && value !== null && (value as { role?: unknown }).role === "assistant";
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function createProductionDependencies(): ExecutorDependencies {
  const models = createModels();
  models.setProvider(anthropicProvider());
  const modelId = requiredEnv("EMERALDX_MODEL_ID");
  const model = models.getModel("anthropic", modelId);
  if (!model) throw new Error(`Anthropic model "${modelId}" is not available in pi-ai`);

  const operator = requiredEnv("EMERALDX_OPERATOR");
  const runId = requiredEnv("EMERALDX_RUN_ID");
  const host = requiredEnv("LANGFUSE_HOST");
  const publicKey = requiredEnv("LANGFUSE_PUBLIC_KEY");
  const secretKey = requiredEnv("LANGFUSE_SECRET_KEY");

  return {
    model,
    streamFn: models.streamSimple.bind(models),
    operator,
    runId,
    createTelemetry: (taskId) =>
      createLangfuseTelemetry({ host, publicKey, secretKey, operator, runId, taskId }),
  };
}
