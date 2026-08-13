import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

export const JobStatus = z.enum(["queued", "paused", "running", "succeeded", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatus>;

const JobRecordSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.string().min(1),
    idempotencyKey: z.string().min(1).max(256),
    payload: z.unknown(),
    status: JobStatus,
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    availableAt: z.string().datetime(),
    leaseOwner: z.string().min(1).nullable(),
    leaseExpiresAt: z.string().datetime().nullable(),
    output: z.unknown().nullable(),
    error: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export interface JobRecord<Payload = unknown, Output = unknown>
  extends Omit<z.infer<typeof JobRecordSchema>, "payload" | "output"> {
  payload: Payload;
  output: Output | null;
}

interface QueueDocument {
  version: 1;
  jobs: JobRecord[];
}

export interface EnqueueJob<Payload> {
  kind: string;
  idempotencyKey: string;
  payload: Payload;
  maxAttempts?: number;
  availableAt?: Date;
}

export interface ClaimOptions {
  workerId: string;
  leaseMs?: number;
  kinds?: string[];
}

export interface JobListFilter {
  statuses?: JobStatus[];
  kinds?: string[];
}

/**
 * Durable local queue used by the dashboard and local worker.
 *
 * All state transitions occur while holding an atomic directory lock and the
 * queue document is replaced with an atomic rename. This makes multiple local
 * worker processes safe. Azure Service Bus can implement the same interface in
 * production without changing the worker's job contract.
 */
export class FileJobQueue<Payload = unknown, Output = unknown> {
  private readonly statePath: string;
  private readonly lockPath: string;

  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.statePath = resolve(root, "jobs.json");
    this.lockPath = resolve(root, ".lock");
  }

  async enqueue(input: EnqueueJob<Payload>): Promise<JobRecord<Payload, Output>> {
    if (!input.kind.trim()) throw new Error("job kind is required");
    if (!input.idempotencyKey.trim()) throw new Error("job idempotency key is required");
    if (input.idempotencyKey.length > 256) throw new Error("job idempotency key exceeds 256 characters");
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error("job maxAttempts must be a positive integer");
    }

    return this.withLock(async (document) => {
      const existing = document.jobs.find(
        (job) => job.kind === input.kind && job.idempotencyKey === input.idempotencyKey
      );
      if (existing) return structuredClone(existing) as JobRecord<Payload, Output>;

      const timestamp = this.now().toISOString();
      const job: JobRecord<Payload, Output> = {
        id: randomUUID(),
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        payload: structuredClone(input.payload),
        status: "queued",
        attempts: 0,
        maxAttempts,
        availableAt: (input.availableAt ?? this.now()).toISOString(),
        leaseOwner: null,
        leaseExpiresAt: null,
        output: null,
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      document.jobs.push(job);
      return structuredClone(job);
    });
  }

  async claim(options: ClaimOptions): Promise<JobRecord<Payload, Output> | null> {
    if (!options.workerId.trim()) throw new Error("workerId is required");
    const leaseMs = options.leaseMs ?? 15 * 60_000;
    if (!Number.isInteger(leaseMs) || leaseMs < 1_000) throw new Error("leaseMs must be at least 1000");

    return this.withLock(async (document) => {
      const now = this.now();
      recoverExpiredLeases(document.jobs, now);
      const kinds = options.kinds ? new Set(options.kinds) : null;
      const next = document.jobs
        .filter(
          (job) =>
            job.status === "queued" &&
            new Date(job.availableAt) <= now &&
            (!kinds || kinds.has(job.kind))
        )
        .sort((a, b) =>
          a.availableAt.localeCompare(b.availableAt) || a.createdAt.localeCompare(b.createdAt)
        )[0];
      if (!next) return null;

      next.status = "running";
      next.attempts += 1;
      next.leaseOwner = options.workerId;
      next.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
      next.updatedAt = now.toISOString();
      return structuredClone(next) as JobRecord<Payload, Output>;
    });
  }

  async heartbeat(jobId: string, workerId: string, leaseMs = 15 * 60_000): Promise<void> {
    await this.withLock(async (document) => {
      const job = requireJob(document.jobs, jobId);
      requireLease(job, workerId);
      const now = this.now();
      job.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
      job.updatedAt = now.toISOString();
    });
  }

  async complete(jobId: string, workerId: string, output: Output): Promise<JobRecord<Payload, Output>> {
    return this.withLock(async (document) => {
      const job = requireJob(document.jobs, jobId);
      requireLease(job, workerId);
      job.status = "succeeded";
      job.output = structuredClone(output);
      job.error = null;
      clearLease(job);
      job.updatedAt = this.now().toISOString();
      return structuredClone(job) as JobRecord<Payload, Output>;
    });
  }

  async fail(
    jobId: string,
    workerId: string,
    error: string,
    options: { retryDelayMs?: number } = {}
  ): Promise<JobRecord<Payload, Output>> {
    const safeError = error.trim().slice(0, 2_000) || "Worker failed without an error message.";
    const retryDelayMs = options.retryDelayMs ?? 5_000;
    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
      throw new Error("retryDelayMs must be non-negative");
    }

    return this.withLock(async (document) => {
      const job = requireJob(document.jobs, jobId);
      requireLease(job, workerId);
      const now = this.now();
      job.error = safeError;
      job.output = null;
      clearLease(job);
      if (job.attempts < job.maxAttempts) {
        job.status = "queued";
        job.availableAt = new Date(now.getTime() + retryDelayMs).toISOString();
      } else {
        job.status = "failed";
      }
      job.updatedAt = now.toISOString();
      return structuredClone(job) as JobRecord<Payload, Output>;
    });
  }

  /** Pauses an unclaimed job. Running jobs pause through FileRunControlStore. */
  async pause(jobId: string): Promise<JobRecord<Payload, Output>> {
    return this.withLock(async (document) => {
      const job = requireJob(document.jobs, jobId);
      if (job.status === "paused") return structuredClone(job) as JobRecord<Payload, Output>;
      if (job.status !== "queued") throw new Error(`cannot queue-pause job ${jobId} (${job.status})`);
      job.status = "paused";
      job.updatedAt = this.now().toISOString();
      return structuredClone(job) as JobRecord<Payload, Output>;
    });
  }

  async resume(jobId: string): Promise<JobRecord<Payload, Output>> {
    return this.withLock(async (document) => {
      const job = requireJob(document.jobs, jobId);
      if (job.status === "queued") return structuredClone(job) as JobRecord<Payload, Output>;
      if (job.status !== "paused") throw new Error(`cannot queue-resume job ${jobId} (${job.status})`);
      job.status = "queued";
      job.availableAt = this.now().toISOString();
      job.updatedAt = this.now().toISOString();
      return structuredClone(job) as JobRecord<Payload, Output>;
    });
  }

  async cancel(jobId: string, workerId?: string): Promise<JobRecord<Payload, Output>> {
    return this.withLock(async (document) => {
      const job = requireJob(document.jobs, jobId);
      if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
        if (job.status === "cancelled") return structuredClone(job) as JobRecord<Payload, Output>;
        throw new Error(`cannot cancel terminal job ${jobId} (${job.status})`);
      }
      if (job.status === "running") {
        if (!workerId) throw new Error(`running job ${jobId} must be cancelled cooperatively`);
        requireLease(job, workerId);
      }
      job.status = "cancelled";
      job.error = "Cancelled by an operator.";
      clearLease(job);
      job.updatedAt = this.now().toISOString();
      return structuredClone(job) as JobRecord<Payload, Output>;
    });
  }

  async get(jobId: string): Promise<JobRecord<Payload, Output> | null> {
    const document = await this.readDocument();
    const job = document.jobs.find((candidate) => candidate.id === jobId);
    return job ? (structuredClone(job) as JobRecord<Payload, Output>) : null;
  }

  async list(filter: JobListFilter = {}): Promise<Array<JobRecord<Payload, Output>>> {
    const statuses = filter.statuses ? new Set(filter.statuses) : null;
    const kinds = filter.kinds ? new Set(filter.kinds) : null;
    return (await this.readDocument()).jobs
      .filter((job) => (!statuses || statuses.has(job.status)) && (!kinds || kinds.has(job.kind)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((job) => structuredClone(job) as JobRecord<Payload, Output>);
  }

  private async withLock<T>(operation: (document: QueueDocument) => Promise<T>): Promise<T> {
    await mkdir(resolve(this.root), { recursive: true });
    await this.acquireLock();
    try {
      const document = await this.readDocument();
      const result = await operation(document);
      await this.writeDocument(document);
      return result;
    } finally {
      await rm(this.lockPath, { recursive: true, force: true });
    }
  }

  private async acquireLock(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (true) {
      try {
        await mkdir(this.lockPath);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const lockStat = await stat(this.lockPath).catch(() => null);
        if (lockStat && Date.now() - lockStat.mtimeMs > 30_000) {
          await rm(this.lockPath, { recursive: true, force: true });
          continue;
        }
        if (Date.now() >= deadline) throw new Error(`timed out waiting for queue lock ${this.lockPath}`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
    }
  }

  private async readDocument(): Promise<QueueDocument> {
    let source: string;
    try {
      source = await readFile(this.statePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, jobs: [] };
      throw error;
    }

    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new Error(`queue state ${this.statePath} is not valid JSON: ${message(error)}`);
    }
    if (typeof value !== "object" || value === null || (value as { version?: unknown }).version !== 1) {
      throw new Error(`queue state ${this.statePath} has an unsupported format`);
    }
    const parsed = z.array(JobRecordSchema).safeParse((value as { jobs?: unknown }).jobs);
    if (!parsed.success) {
      throw new Error(`queue state ${this.statePath} is invalid: ${parsed.error.issues[0]?.message}`);
    }
    return { version: 1, jobs: parsed.data as JobRecord[] };
  }

  private async writeDocument(document: QueueDocument): Promise<void> {
    const temporary = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.statePath);
  }
}

function recoverExpiredLeases(jobs: JobRecord[], now: Date): void {
  for (const job of jobs) {
    if (
      job.status === "running" &&
      job.leaseExpiresAt &&
      new Date(job.leaseExpiresAt).getTime() <= now.getTime()
    ) {
      clearLease(job);
      job.error = "The prior worker lease expired; the job was returned to the queue.";
      if (job.attempts < job.maxAttempts) {
        job.status = "queued";
        job.availableAt = now.toISOString();
      } else {
        job.status = "failed";
      }
      job.updatedAt = now.toISOString();
    }
  }
}

function requireJob(jobs: JobRecord[], jobId: string): JobRecord {
  const job = jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error(`job ${jobId} was not found`);
  return job;
}

function requireLease(job: JobRecord, workerId: string): void {
  if (job.status !== "running" || job.leaseOwner !== workerId) {
    throw new Error(`worker ${workerId} does not hold the lease for job ${job.id}`);
  }
}

function clearLease(job: JobRecord): void {
  job.leaseOwner = null;
  job.leaseExpiresAt = null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
