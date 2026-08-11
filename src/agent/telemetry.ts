import { createHash } from "node:crypto";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  LangfuseAgent,
  LangfuseGeneration,
  type LangfuseObservation,
  propagateAttributes,
  startObservation,
} from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import type {
  SpanAttributes,
  SpanOptions,
  SpanStatus,
  TelemetryContext,
  TelemetrySpan,
} from "@earendil-works/pi-telemetry";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Action } from "../guardrails/middleware";
import type { StepTrace } from "../browser/driver";

export interface AuditIdentity {
  runId: string;
  taskId: string;
  operator: string;
}

export interface AuditStep {
  name: string;
  at: string;
  ok: boolean;
  action?: Action;
  output?: unknown;
  error?: string;
  screenshot?: Buffer;
  durationMs?: number;
}

export interface AuditTelemetry {
  readonly context: TelemetryContext;
  readonly traceId?: string;
  recordStep(step: AuditStep): void;
  recordGeneration?(message: AssistantMessage, turn: number): void;
  flush(): Promise<void>;
}

export interface LangfuseConfig extends AuditIdentity {
  host: string;
  publicKey: string;
  secretKey: string;
  environment?: string;
  release?: string;
  task?: {
    kind: string;
    label: string;
    payload?: Record<string, unknown>;
    procedure?: { id: string; version: number } | null;
  };
  /** Test seam; production uses Langfuse's OTLP exporter. */
  exporter?: SpanExporter;
}

interface LangfuseRuntime {
  key: string;
  sdk: NodeSDK;
  processor: LangfuseSpanProcessor;
}

let runtime: LangfuseRuntime | undefined;

class LangfuseTelemetryContext implements TelemetryContext {
  constructor(
    protected readonly parent: LangfuseObservation,
    protected readonly identity: AuditIdentity
  ) {}

  startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
    let observation: LangfuseObservation;
    try {
      const attributes = { metadata: { ...identityMetadata(this.identity), ...defined(options.attributes) } };
      const parentSpanContext = this.parent.otelSpan.spanContext();
      observation = options.name === "pi.ai.request"
        ? startObservation(stableSpanName(options.name), attributes, { asType: "generation", parentSpanContext })
        : startObservation(stableSpanName(options.name), attributes, { parentSpanContext });
    } catch {
      return invokeWithoutTelemetry(callback, this);
    }

    const span = new PiLangfuseSpan(observation, this.identity);
    let value: T | Promise<T>;
    try {
      value = callback(span);
    } catch (error) {
      span.setStatus(errorStatus(error));
      span.settle();
      return Promise.reject(error);
    }
    return Promise.resolve(value).then(
      (result) => {
        span.settle();
        return result;
      },
      (error) => {
        span.setStatus(errorStatus(error));
        span.settle();
        return Promise.reject(error);
      }
    );
  }
}

class PiLangfuseSpan extends LangfuseTelemetryContext implements TelemetrySpan {
  private attributes: SpanAttributes = {};
  private status: SpanStatus = { status: "ok" };
  private settled = false;

  constructor(private readonly observation: LangfuseObservation, identity: AuditIdentity) {
    super(observation, identity);
  }

  addEvent(name: string, attributes: SpanAttributes = {}): void {
    if (this.settled) return;
    try {
      const event = startObservation(
        stableSpanName(name),
        { metadata: { ...identityMetadata(this.identity), ...defined(attributes) } },
        { asType: "event", parentSpanContext: this.observation.otelSpan.spanContext() }
      );
      event.end();
    } catch {
      // Telemetry is passive; exporter failures are surfaced only by flush().
    }
  }

  setAttributes(attributes: SpanAttributes): void {
    if (this.settled) return;
    this.attributes = { ...this.attributes, ...defined(attributes) };
  }

  setStatus(status: SpanStatus): void {
    if (this.settled) return;
    this.status = status;
  }

  settle(): void {
    if (this.settled) return;
    this.settled = true;
    try {
      const error = this.status.status === "error" ? this.status.error : undefined;
      if (this.observation.type === "generation") {
        (this.observation as LangfuseGeneration).update({
          model: stringAttribute(this.attributes, "pi.ai.response.model") ?? stringAttribute(this.attributes, "pi.ai.model"),
          usageDetails: generationUsage(this.attributes),
          costDetails: generationCost(this.attributes),
          level: error ? "ERROR" : "DEFAULT",
          statusMessage: error?.message,
          metadata: { ...identityMetadata(this.identity), ...defined(this.attributes) },
        });
      } else {
        this.observation.updateOtelSpanAttributes({
          level: error ? "ERROR" : "DEFAULT",
          statusMessage: error?.message,
          metadata: { ...identityMetadata(this.identity), ...defined(this.attributes) },
        });
      }
      this.observation.end();
    } catch {
      // Keep the adapter non-interfering. forceFlush() is the durability boundary.
    }
  }
}

class EmeraldAuditTelemetry implements AuditTelemetry {
  readonly context: TelemetryContext;
  readonly traceId: string;
  private ended = false;

  constructor(
    private readonly processor: LangfuseSpanProcessor,
    private readonly root: LangfuseAgent,
    private readonly identity: AuditIdentity
  ) {
    this.context = new LangfuseTelemetryContext(root, identity);
    this.traceId = root.traceId;
  }

  recordStep(step: AuditStep): void {
    if (this.ended) return;
    try {
      if (step.name === "task.result") {
        this.root.update({
          output: step.output ?? { ok: step.ok },
          level: step.ok ? "DEFAULT" : "ERROR",
          statusMessage: step.error,
          metadata: {
            ...identityMetadata(this.identity),
            completedAt: step.at,
            durationMs: step.durationMs,
          },
        });
        return;
      }

      const action = step.action ? redactAction(step.action) : undefined;
      const startedAt = new Date(new Date(step.at).getTime() - (step.durationMs ?? 0));
      const observation = startObservation(
        toolObservationName(step.name),
        {
          input: action ?? { taskId: this.identity.taskId },
          metadata: {
            ...identityMetadata(this.identity),
            durationMs: step.durationMs,
            screenshotCaptured: step.screenshot !== undefined,
            failureScreenshotSha256: step.screenshot ? sha256(step.screenshot) : undefined,
          },
        },
        { asType: "tool", startTime: startedAt, parentSpanContext: this.root.otelSpan.spanContext() }
      );
      observation.update({
        output: step.output ?? { ok: step.ok },
        level: step.ok ? "DEFAULT" : "ERROR",
        statusMessage: step.error,
      });
      observation.end(new Date(step.at));
    } catch {
      // Recording must never alter browser or agent behavior.
    }
  }

  recordGeneration(message: AssistantMessage, turn: number): void {
    if (this.ended) return;
    try {
      const generation = startObservation(
        "generate-cvent-action",
        {
          input: {
            taskId: this.identity.taskId,
            turn,
            instruction: "Execute the assigned Cvent configuration task.",
          },
          model: message.responseModel ?? message.model,
          metadata: {
            ...identityMetadata(this.identity),
            provider: message.provider,
            requestedModel: message.model,
            responseId: message.responseId,
            stopReason: message.stopReason,
          },
        },
        {
          asType: "generation",
          startTime: new Date(message.timestamp),
          parentSpanContext: this.root.otelSpan.spanContext(),
        }
      );
      generation.update({
        output: redactAssistantContent(message),
        usageDetails: {
          input: message.usage.input,
          output: message.usage.output,
          total: message.usage.totalTokens,
          cacheRead: message.usage.cacheRead,
          cacheWrite: message.usage.cacheWrite,
          ...(message.usage.reasoning === undefined ? {} : { reasoning: message.usage.reasoning }),
        },
        costDetails: {
          input: message.usage.cost.input,
          output: message.usage.cost.output,
          cacheRead: message.usage.cost.cacheRead,
          cacheWrite: message.usage.cost.cacheWrite,
          total: message.usage.cost.total,
        },
        level: message.stopReason === "error" || message.stopReason === "aborted" ? "ERROR" : "DEFAULT",
        statusMessage: message.errorMessage,
      });
      generation.end();
    } catch {
      // Recording must never alter model execution.
    }
  }

  async flush(): Promise<void> {
    if (!this.ended) {
      this.ended = true;
      this.root.end();
    }
    await this.processor.forceFlush();
  }
}

export function createLangfuseTelemetry(config: LangfuseConfig): AuditTelemetry {
  const activeRuntime = getRuntime(config);
  const identity = { runId: config.runId, taskId: config.taskId, operator: config.operator };
  const root = propagateAttributes(
    {
      userId: pseudonymousUserId(config.operator),
      sessionId: config.runId,
      traceName: "execute-cvent-task",
      tags: ["emeraldx", "cvent-configuration"],
      metadata: identityMetadata(identity),
    },
    () =>
      startObservation(
        "execute-cvent-task",
        {
          input: {
            taskId: config.taskId,
            kind: config.task?.kind,
            label: config.task?.label,
            payload: redactObject(config.task?.payload),
            procedure: config.task?.procedure,
          },
          metadata: identityMetadata(identity),
        },
        { asType: "agent" }
      )
  );
  return new EmeraldAuditTelemetry(activeRuntime.processor, root, identity);
}

export async function shutdownLangfuse(): Promise<void> {
  const active = runtime;
  runtime = undefined;
  if (active) await active.sdk.shutdown();
}

export function createBrowserTraceHandler(telemetry: AuditTelemetry): (trace: StepTrace) => void {
  return (trace) => {
    telemetry.recordStep({
      name: `browser_${trace.action.type}`,
      at: trace.at,
      ok: trace.ok,
      action: trace.action,
      error: trace.error,
      screenshot: trace.screenshot,
      durationMs: trace.durationMs,
    });
  };
}

function getRuntime(config: LangfuseConfig): LangfuseRuntime {
  const key = `${config.host.replace(/\/$/, "")}\u0000${config.publicKey}\u0000${config.environment ?? ""}`;
  if (runtime) {
    if (runtime.key !== key) throw new Error("Langfuse was already initialized with different project settings");
    return runtime;
  }

  const processor = new LangfuseSpanProcessor({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.host,
    environment: config.environment ?? process.env.NODE_ENV ?? "development",
    release: config.release,
    exporter: config.exporter,
    mask: maskLangfuseData,
    mediaUploadEnabled: false,
  });
  const sdk = new NodeSDK({ spanProcessors: [processor] });
  sdk.start();
  runtime = { key, sdk, processor };
  return runtime;
}

function identityMetadata(identity: AuditIdentity): Record<string, string> {
  return {
    runId: identity.runId,
    taskId: identity.taskId,
    operatorId: pseudonymousUserId(identity.operator),
  };
}

function defined(attributes: SpanAttributes | undefined): SpanAttributes {
  return Object.fromEntries(Object.entries(attributes ?? {}).filter(([, value]) => value !== undefined)) as SpanAttributes;
}

function stableSpanName(name: string): string {
  if (name === "pi.ai.request") return "generate-cvent-action";
  return name.replace(/[._]/g, "-");
}

function toolObservationName(name: string): string {
  const names: Record<string, string> = {
    browser_navigate: "navigate-cvent",
    browser_click: "click-cvent-control",
    browser_fill: "fill-cvent-field",
    browser_select: "select-cvent-option",
    browser_upload: "upload-cvent-asset",
    browser_read: "read-cvent-control",
    task_complete: "complete-cvent-task",
    task_halt: "halt-cvent-task",
  };
  return names[name] ?? stableSpanName(name);
}

function redactAction(action: Action): Action {
  return action.value === undefined ? action : { ...action, value: `«${action.value.length} chars»` };
}

function redactAssistantContent(message: AssistantMessage): unknown[] {
  return message.content.map((part) => {
    if (part.type === "thinking") return { type: "thinking", content: "[REDACTED]" };
    if (part.type === "toolCall") {
      return { type: "toolCall", name: part.name, arguments: redactObject(part.arguments) };
    }
    return { type: "text", text: part.text };
  });
}

function redactObject(value: unknown, key = ""): unknown {
  if (/^(?:value|assetPath|apiKey|clientSecret|secret|token|password|authorization|cookie)$/i.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) return value.map((item) => redactObject(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactObject(child, childKey)]));
  }
  return value;
}

function maskLangfuseData({ data }: { data: unknown }): unknown {
  if (typeof data !== "string") return data;
  return data
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL_REDACTED]")
    .replace(/\b(?:sk|pk)-(?:ant-|lf-)?[A-Za-z0-9_-]{12,}\b/g, "[SECRET_REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]");
}

function pseudonymousUserId(operator: string): string {
  return `operator-${createHash("sha256").update(operator).digest("hex").slice(0, 16)}`;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stringAttribute(attributes: SpanAttributes, key: string): string | undefined {
  const value = attributes[key];
  return typeof value === "string" ? value : undefined;
}

function numberAttribute(attributes: SpanAttributes, key: string): number | undefined {
  const value = attributes[key];
  return typeof value === "number" ? value : undefined;
}

function generationUsage(attributes: SpanAttributes): Record<string, number> | undefined {
  const values = {
    input: numberAttribute(attributes, "pi.ai.usage.input_tokens"),
    output: numberAttribute(attributes, "pi.ai.usage.output_tokens"),
    total: numberAttribute(attributes, "pi.ai.usage.total_tokens"),
    cacheRead: numberAttribute(attributes, "pi.ai.usage.cache_read_tokens"),
    cacheWrite: numberAttribute(attributes, "pi.ai.usage.cache_write_tokens"),
    reasoning: numberAttribute(attributes, "pi.ai.usage.reasoning_tokens"),
  };
  const definedValues = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Record<string, number>;
  return Object.keys(definedValues).length ? definedValues : undefined;
}

function generationCost(attributes: SpanAttributes): Record<string, number> | undefined {
  const total = numberAttribute(attributes, "pi.ai.usage.cost");
  return total === undefined ? undefined : { total };
}

function errorStatus(error: unknown): SpanStatus {
  return {
    status: "error",
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function invokeWithoutTelemetry<T>(
  callback: (span: TelemetrySpan) => T | Promise<T>,
  context: TelemetryContext
): Promise<T> {
  const inert: TelemetrySpan = {
    startSpan: context.startSpan.bind(context),
    addEvent: () => {},
    setAttributes: () => {},
    setStatus: () => {},
  };
  try {
    return Promise.resolve(callback(inert));
  } catch (error) {
    return Promise.reject(error);
  }
}
