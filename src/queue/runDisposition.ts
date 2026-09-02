export type RunQueueDisposition = "complete" | "fail";
export function queueDispositionForRunStatus(status: string): RunQueueDisposition {
  return status === "succeeded" ? "complete" : "fail";
}
export function publicRunStatus(queueStatus: string, runStatus?: string): string {
  return queueStatus === "succeeded" && runStatus && runStatus !== "succeeded" ? runStatus : queueStatus;
}
