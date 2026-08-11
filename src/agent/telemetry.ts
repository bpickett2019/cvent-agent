import { randomUUID } from "node:crypto";
import type {
  SpanAttributes,
  SpanOptions,
  SpanStatus,
  TelemetryContext,
  TelemetrySpan,
} from "@earendil-works/pi-telemetry";
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
  error?: string;
  screenshot?: Buffer;
  durationMs?: number;
}

export interface AuditTelemetry {
  readonly context: TelemetryContext;
  recordStep(step: AuditStep): void;
  flush(): Promise<void>;
}

interface LangfuseIngestionEvent {
  id: string;
  timestamp: string;
  type: "trace-create" | "span-create" | "span-update" | "event-create";
  body: Record<string, unknown>;
}

export interface LangfuseConfig extends AuditIdentity {
  host: string;
  publicKey: string;
  secretKey: string;
  fetch?: typeof globalThis.fetch;
}

class LangfuseBatch {
  private readonly pending: LangfuseIngestionEvent[] = [];
  private readonly traceId = randomUUID();
  private sentTrace = false;

  constructor(private readonly cfg: LangfuseConfig) {}

  get trace(): string {
    return this.traceId;
  }

  enqueue(event: LangfuseIngestionEvent): void {
    try {
      if (!this.sentTrace) {
        this.sentTrace = true;
        this.pending.push({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type: "trace-create",
          body: {
            id: this.traceId,
            name: "emeraldx.task",
            sessionId: this.cfg.runId,
            userId: this.cfg.operator,
            metadata: identityMetadata(this.cfg),
          },
        });
      }
      this.pending.push(event);
    } catch {
      // Telemetry recording is passive. flush() remains the durability boundary.
    }
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0, this.pending.length);
    const fetchFn = this.cfg.fetch ?? globalThis.fetch;
    const endpoint = `${this.cfg.host.replace(/\/$/, "")}/api/public/ingestion`;
    let response: Response;
    try {
      response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${this.cfg.publicKey}:${this.cfg.secretKey}`).toString("base64")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ batch }),
      });
    } catch (error) {
      this.pending.unshift(...batch);
      throw new Error(`Langfuse audit upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const responseText = await response.text();
    if (!response.ok) {
      this.pending.unshift(...batch);
      throw new Error(`Langfuse audit upload failed: ${response.status} ${responseText}`);
    }
    try {
      const result = JSON.parse(responseText) as { errors?: { id?: string; message?: string }[] };
      if (result.errors?.length) {
        const failedIds = new Set(result.errors.map((error) => error.id).filter((id): id is string => Boolean(id)));
        this.pending.unshift(...(failedIds.size ? batch.filter((event) => failedIds.has(event.id)) : batch));
        throw new Error(
          `Langfuse rejected ${result.errors.length} audit event(s): ${result.errors
            .map((error) => error.message ?? error.id ?? "unknown ingestion error")
            .join("; ")}`
        );
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        this.pending.unshift(...batch);
        throw new Error(`Langfuse audit upload returned invalid JSON: ${responseText}`);
      }
      throw error;
    }
  }
}

class LangfuseContext implements TelemetryContext {
  constructor(
    protected readonly batch: LangfuseBatch,
    protected readonly identity: AuditIdentity,
    protected readonly parentObservationId?: string
  ) {}

  startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    this.batch.enqueue({
      id: randomUUID(),
      timestamp: startedAt,
      type: "span-create",
      body: {
        id,
        traceId: this.batch.trace,
        parentObservationId: this.parentObservationId,
        name: options.name,
        startTime: startedAt,
        metadata: { ...identityMetadata(this.identity), ...defined(options.attributes) },
      },
    });

    const span = new LangfuseSpan(this.batch, this.identity, id);
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

class LangfuseSpan extends LangfuseContext implements TelemetrySpan {
  private attributes: SpanAttributes = {};
  private status: SpanStatus = { status: "ok" };
  private settled = false;

  constructor(batch: LangfuseBatch, identity: AuditIdentity, private readonly observationId: string) {
    super(batch, identity, observationId);
  }

  addEvent(name: string, attributes: SpanAttributes = {}): void {
    if (this.settled) return;
    this.batch.enqueue({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "event-create",
      body: {
        id: randomUUID(),
        traceId: this.batch.trace,
        parentObservationId: this.observationId,
        name,
        metadata: { ...identityMetadata(this.identity), ...defined(attributes) },
      },
    });
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
    this.batch.enqueue({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "span-update",
      body: {
        id: this.observationId,
        traceId: this.batch.trace,
        endTime: new Date().toISOString(),
        level: this.status.status === "error" ? "ERROR" : "DEFAULT",
        statusMessage: this.status.status === "error" ? this.status.error?.message : undefined,
        metadata: { ...identityMetadata(this.identity), ...defined(this.attributes) },
      },
    });
  }
}

class EmeraldAuditTelemetry implements AuditTelemetry {
  readonly context: TelemetryContext;

  constructor(private readonly batch: LangfuseBatch, private readonly identity: AuditIdentity) {
    this.context = new LangfuseContext(batch, identity);
  }

  recordStep(step: AuditStep): void {
    const action = step.action ? redactAction(step.action) : undefined;
    this.batch.enqueue({
      id: randomUUID(),
      timestamp: step.at,
      type: "event-create",
      body: {
        id: randomUUID(),
        traceId: this.batch.trace,
        name: step.name,
        level: step.ok ? "DEFAULT" : "ERROR",
        statusMessage: step.error,
        metadata: {
          ...identityMetadata(this.identity),
          timestamp: step.at,
          ok: step.ok,
          durationMs: step.durationMs,
          action,
          failureScreenshotBase64: step.screenshot?.toString("base64"),
        },
      },
    });
  }

  flush(): Promise<void> {
    return this.batch.flush();
  }
}

export function createLangfuseTelemetry(config: LangfuseConfig): AuditTelemetry {
  const identity = { runId: config.runId, taskId: config.taskId, operator: config.operator };
  return new EmeraldAuditTelemetry(new LangfuseBatch(config), identity);
}

export function createBrowserTraceHandler(telemetry: AuditTelemetry): (trace: StepTrace) => void {
  return (trace) => {
    telemetry.recordStep({
      name: `browser.${trace.action.type}`,
      at: trace.at,
      ok: trace.ok,
      action: trace.action,
      error: trace.error,
      screenshot: trace.screenshot,
      durationMs: trace.durationMs,
    });
  };
}

function identityMetadata(identity: AuditIdentity): Record<string, string> {
  return {
    runId: identity.runId,
    taskId: identity.taskId,
    operator: identity.operator,
  };
}

function defined(attributes: SpanAttributes | undefined): SpanAttributes {
  return Object.fromEntries(
    Object.entries(attributes ?? {}).filter(([, value]) => value !== undefined)
  ) as SpanAttributes;
}

function redactAction(action: Action): Action {
  return action.value === undefined ? action : { ...action, value: `«${action.value.length} chars»` };
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
