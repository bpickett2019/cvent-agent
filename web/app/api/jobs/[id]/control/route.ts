import { NextResponse } from "next/server";
import { jobQueue, publicJob, runControls } from "../../../../../lib/job-server";
import { assertSameOrigin } from "../../../../../lib/request-security";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const body = (await request.json()) as { action?: unknown };
    if (body.action !== "pause" && body.action !== "resume" && body.action !== "cancel") {
      throw new Error('control action must be "pause", "resume", or "cancel"');
    }

    const queue = jobQueue();
    const controls = runControls();
    let job = await queue.get(id);
    if (!job) return NextResponse.json({ error: `Job ${id} was not found.` }, { status: 404 });
    if (["succeeded", "failed", "cancelled"].includes(job.status)) {
      throw new Error(`Job ${id} is already ${job.status}.`);
    }

    if (body.action === "pause") {
      await controls.pause(id);
      if (job.status === "queued") {
        try {
          job = await queue.pause(id);
        } catch {
          // A worker may have claimed between the read and pause. The durable
          // action gate still pauses it before its next task/browser action.
          job = (await queue.get(id))!;
        }
      }
    } else if (body.action === "resume") {
      await controls.resume(id);
      if (job.status === "paused") job = await queue.resume(id);
    } else {
      await controls.requestCancel(id);
      if (job.status === "queued" || job.status === "paused") job = await queue.cancel(id);
    }

    const latest = (await queue.get(id)) ?? job;
    return NextResponse.json({ job: publicJob(latest, await controls.get(id)) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The run control could not be applied." },
      { status: 400 }
    );
  }
}
