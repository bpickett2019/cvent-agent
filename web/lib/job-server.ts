import { resolve } from "node:path";
import { FileJobQueue, type JobRecord } from "../../src/queue/jobQueue";
import type { RunEventJobOutput, RunEventJobPayload } from "../../src/queue/runJob";
import { publicRunStatus } from "../../src/queue/runDisposition";
import { FileRunControlStore, type RunControlState } from "../../src/run/control";

export function queueRoot(): string {
  const projectRoot = resolve(process.cwd(), "..");
  return resolve(/*turbopackIgnore: true*/ projectRoot, process.env.EMERALDX_QUEUE_DIR ?? ".queue");
}

export function jobQueue(): FileJobQueue<RunEventJobPayload, RunEventJobOutput> {
  return new FileJobQueue(queueRoot());
}

export function runControls(): FileRunControlStore {
  return new FileRunControlStore(resolve(queueRoot(), "controls"));
}

export function publicJob(
  job: JobRecord<RunEventJobPayload, RunEventJobOutput>,
  control: RunControlState
) {
  return {
    id: job.id,
    kind: job.kind,
    eventName: job.payload.spec.details.name,
    eventCode: job.payload.spec.details.code ?? null,
    status: publicRunStatus(job.status, job.output?.status),
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    error: job.error,
    output: job.output,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    control: {
      paused: control.paused,
      cancelRequested: control.cancelRequested,
      viewerUrl: control.viewerUrl,
      browserProvider: control.browserProvider,
    },
  };
}
