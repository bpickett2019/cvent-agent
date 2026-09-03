import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { jobQueue } from "../../../../../lib/job-server";
import { requireRole } from "../../../../../lib/require-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireRole("Viewer");
  if (denied) return denied;
  const { id } = await context.params;
  const job = (await jobQueue().list()).find((candidate) => candidate.id === id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const output = job.output as { runId?: unknown; status?: unknown } | null;
  const runId = output?.runId ? String(output.runId) : null;
  const displayStatus = typeof output?.status === "string" ? output.status : job.status;
  if (!runId) return NextResponse.json({ job: { id: job.id, status: displayStatus, error: job.error, output: job.output }, run: null });
  const runPath = resolve(/*turbopackIgnore: true*/ process.cwd(), "..", process.env.EMERALDX_RUN_DIR ?? ".runs", `${runId}.json`);
  const run = await readFile(runPath, "utf8").then((source) => JSON.parse(source)).catch(() => null);
  return NextResponse.json({ job: { id: job.id, status: displayStatus, error: job.error, output: job.output, createdAt: job.createdAt, updatedAt: job.updatedAt }, run });
}
