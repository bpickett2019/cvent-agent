import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plan } from "../planner/plan";
import { EventSpec, type EventSpec as EventSpecType } from "../spec/eventSpec";
import type { VerificationReport } from "../verify/verifier";
import type {
  CreateRunInput,
  LoadedCheckpoints,
  RunStore,
  RunTrace,
  TaskCheckpoint,
} from "./orchestrator";

interface StoredRunFile {
  version: 1;
  runId: string;
  input: CreateRunInput;
  spec: EventSpecType;
  plan?: Plan;
  checkpoints: TaskCheckpoint[];
  report?: VerificationReport | null;
  traces: RunTrace[];
}

/** A small durable store for CLI runs. One JSON file is retained per run. */
export class FileRunStore implements RunStore {
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly root: string,
    private readonly newRunSpec?: EventSpecType,
    private readonly onRunCreated?: (runId: string) => void
  ) {}

  async createRun(input: CreateRunInput): Promise<string> {
    if (!this.newRunSpec) throw new Error("a validated spec is required to create a run");
    const runId = randomUUID();
    const document: StoredRunFile = {
      version: 1,
      runId,
      input: structuredClone(input),
      spec: structuredClone(this.newRunSpec),
      checkpoints: [],
      traces: [],
    };
    await this.enqueue(async () => {
      await mkdir(resolve(this.root), { recursive: true });
      await this.write(document);
    });
    this.onRunCreated?.(runId);
    return runId;
  }

  async savePlan(runId: string, plan: Plan): Promise<void> {
    await this.mutate(runId, (run) => {
      run.plan = structuredClone(plan);
    });
  }

  async saveCheckpoint(runId: string, checkpoint: TaskCheckpoint): Promise<void> {
    await this.mutate(runId, (run) => {
      run.checkpoints.push(structuredClone(checkpoint));
    });
  }

  async loadCheckpoints(runId: string): Promise<LoadedCheckpoints> {
    await this.writes;
    const run = await this.read(runId);
    if (!run.plan) throw new Error(`run ${runId} has no persisted plan`);
    return {
      specHash: run.plan.specHash,
      checkpoints: structuredClone(run.checkpoints),
    };
  }

  async loadSpec(runId: string): Promise<EventSpecType> {
    await this.writes;
    return EventSpec.parse((await this.read(runId)).spec);
  }

  async saveReport(runId: string, report: VerificationReport | null): Promise<void> {
    await this.mutate(runId, (run) => {
      run.report = structuredClone(report);
    });
  }

  async saveTrace(runId: string, trace: RunTrace): Promise<void> {
    await this.mutate(runId, (run) => {
      run.traces.push(structuredClone(trace));
    });
  }

  private async mutate(runId: string, update: (run: StoredRunFile) => void): Promise<void> {
    await this.enqueue(async () => {
      const run = await this.read(runId);
      update(run);
      await this.write(run);
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.writes.then(operation, operation);
    this.writes = result.catch(() => {});
    return result;
  }

  private path(runId: string): string {
    if (!/^[A-Za-z0-9-]+$/.test(runId)) throw new Error(`invalid run id "${runId}"`);
    return resolve(this.root, `${runId}.json`);
  }

  private async read(runId: string): Promise<StoredRunFile> {
    const path = this.path(runId);
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch (error) {
      throw new Error(`could not load run ${runId} from ${path}: ${message(error)}`);
    }

    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new Error(`run file ${path} is not valid JSON: ${message(error)}`);
    }
    if (!isStoredRunFile(value) || value.runId !== runId) {
      throw new Error(`run file ${path} has an invalid or mismatched run record`);
    }
    return value;
  }

  private async write(run: StoredRunFile): Promise<void> {
    const path = this.path(run.runId);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  }
}

function isStoredRunFile(value: unknown): value is StoredRunFile {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Partial<StoredRunFile>;
  return (
    run.version === 1 &&
    typeof run.runId === "string" &&
    typeof run.input === "object" &&
    run.input !== null &&
    typeof run.spec === "object" &&
    run.spec !== null &&
    Array.isArray(run.checkpoints) &&
    Array.isArray(run.traces)
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
