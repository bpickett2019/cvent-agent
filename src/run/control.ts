import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const ControlStateSchema = z
  .object({
    version: z.literal(1),
    jobId: z.string().uuid(),
    paused: z.boolean(),
    cancelRequested: z.boolean(),
    viewerUrl: z.string().url().nullable(),
    browserProvider: z.string().nullable(),
    providerSessionId: z.string().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type RunControlState = z.infer<typeof ControlStateSchema>;

export class RunCancelledError extends Error {
  constructor(readonly jobId: string) {
    super(`job ${jobId} was cancelled by an operator`);
    this.name = "RunCancelledError";
  }
}

/** Durable operator controls shared by the web process and worker process. */
export class FileRunControlStore {
  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  async initialize(jobId: string): Promise<RunControlState> {
    return this.mutate(jobId, (state) => state);
  }

  async get(jobId: string): Promise<RunControlState> {
    assertJobId(jobId);
    return (await this.read(jobId)) ?? initialState(jobId, this.now());
  }

  async pause(jobId: string): Promise<RunControlState> {
    return this.mutate(jobId, (state) => {
      state.paused = true;
    });
  }

  async resume(jobId: string): Promise<RunControlState> {
    return this.mutate(jobId, (state) => {
      state.paused = false;
    });
  }

  async requestCancel(jobId: string): Promise<RunControlState> {
    return this.mutate(jobId, (state) => {
      state.cancelRequested = true;
      state.paused = false;
    });
  }

  async setBrowser(
    jobId: string,
    browser: { viewerUrl?: string; provider: string; providerSessionId?: string }
  ): Promise<RunControlState> {
    return this.mutate(jobId, (state) => {
      state.viewerUrl = browser.viewerUrl ?? null;
      state.browserProvider = browser.provider;
      state.providerSessionId = browser.providerSessionId ?? null;
    });
  }

  async clearBrowser(jobId: string): Promise<RunControlState> {
    return this.mutate(jobId, (state) => {
      state.viewerUrl = null;
      state.providerSessionId = null;
    });
  }

  /**
   * Cooperative gate used immediately before every browser action and task.
   * A pause never interrupts an action already sent to Cvent; it prevents the
   * next action. Cancellation is terminal and is checked while paused too.
   */
  async waitUntilRunnable(jobId: string, pollMs = 250): Promise<void> {
    while (true) {
      const state = await this.get(jobId);
      if (state.cancelRequested) throw new RunCancelledError(jobId);
      if (!state.paused) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, pollMs));
    }
  }

  private async mutate(
    jobId: string,
    update: (state: RunControlState) => void | RunControlState
  ): Promise<RunControlState> {
    assertJobId(jobId);
    await mkdir(resolve(this.root), { recursive: true });
    const lockPath = this.lockPath(jobId);
    await acquireLock(lockPath);
    try {
      const state = (await this.read(jobId)) ?? initialState(jobId, this.now());
      update(state);
      state.updatedAt = this.now().toISOString();
      await this.write(state);
      return structuredClone(state);
    } finally {
      await rm(lockPath, { recursive: true, force: true });
    }
  }

  private async read(jobId: string): Promise<RunControlState | null> {
    let source: string;
    try {
      source = await readFile(this.path(jobId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new Error(`run control ${jobId} is not valid JSON: ${message(error)}`);
    }
    const parsed = ControlStateSchema.safeParse(value);
    if (!parsed.success || parsed.data.jobId !== jobId) {
      throw new Error(`run control ${jobId} is invalid`);
    }
    return parsed.data;
  }

  private async write(state: RunControlState): Promise<void> {
    const path = this.path(state.jobId);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  }

  private path(jobId: string): string {
    return resolve(this.root, `${jobId}.json`);
  }

  private lockPath(jobId: string): string {
    return resolve(this.root, `${jobId}.lock`);
  }
}

function initialState(jobId: string, now: Date): RunControlState {
  return {
    version: 1,
    jobId,
    paused: false,
    cancelRequested: false,
    viewerUrl: null,
    browserProvider: null,
    providerSessionId: null,
    updatedAt: now.toISOString(),
  };
}

async function acquireLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      await mkdir(lockPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lock = await stat(lockPath).catch(() => null);
      if (lock && Date.now() - lock.mtimeMs > 30_000) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`timed out waiting for control lock ${lockPath}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
  }
}

function assertJobId(jobId: string): void {
  if (!z.string().uuid().safeParse(jobId).success) throw new Error(`invalid job id "${jobId}"`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
