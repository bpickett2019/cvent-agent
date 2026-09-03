import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { plan } from "../../../../src/planner/plan";
import {
  RUN_EVENT_JOB_KIND,
  type RunEventJobPayload,
} from "../../../../src/queue/runJob";
import { EventSpec } from "../../../../src/spec/eventSpec";
import { authorizeEventSpec, loadAuthorizationRegistry } from "../../../../src/safety/authorizationRegistry";
import { assertTemplateCopyExecutionAvailable } from "../../../../src/run/copyTemplate";
import { jobQueue, publicJob, runControls } from "../../../lib/job-server";
import { startLocalWorker } from "../../../lib/worker-launcher";
import { assertSameOrigin } from "../../../lib/request-security";
import { requireRole } from "../../../lib/require-role";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireRole("Operator");
  if (denied) return denied;
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as { spec?: unknown; operator?: unknown; authScopeId?: unknown };
    const spec = EventSpec.parse(body.spec);
    assertTemplateCopyExecutionAvailable(spec);
    authorizeEventSpec(spec, await loadAuthorizationRegistry(process.env.EMERALDX_AUTHORIZATION_PATH ?? new URL("../../../../config/authorizations.json", import.meta.url).pathname));
    const operator = parseOperator(body.operator);
    const requestKey = request.headers.get("idempotency-key")?.trim() || randomUUID();
    const specHash = plan(spec).specHash;
    const queue = jobQueue();
    const job = await queue.enqueue({
      kind: RUN_EVENT_JOB_KIND,
      idempotencyKey: `${operator.id}:${requestKey}`,
      maxAttempts: 3,
      payload: {
        spec,
        authScopeId: parseAuthScope(body.authScopeId),
        operator,
        requestedAt: new Date().toISOString(),
      },
    });
    const control = await runControls().initialize(job.id);
    const worker = startLocalWorker();
    return NextResponse.json(
      { job: publicJob(job, control), specHash, worker },
      { status: job.attempts === 0 && job.status === "queued" ? 202 : 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The run could not be queued." },
      { status: 400 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  const jobs = (await jobQueue().list({ kinds: [RUN_EVENT_JOB_KIND] })).slice(0, 50);
  const controls = runControls();
  return NextResponse.json({
    jobs: await Promise.all(jobs.map(async (job) => publicJob(job, await controls.get(job.id)))),
  });
}

function parseOperator(value: unknown): RunEventJobPayload["operator"] {
  if (typeof value !== "object" || value === null) {
    return { id: "demo-operator", email: "demo-operator@example.invalid" };
  }
  const candidate = value as { id?: unknown; email?: unknown };
  if (typeof candidate.id !== "string" || !candidate.id.trim()) throw new Error("operator id is required");
  if (typeof candidate.email !== "string" || !/^\S+@\S+\.\S+$/.test(candidate.email)) {
    throw new Error("operator email is invalid");
  }
  return { id: candidate.id.trim(), email: candidate.email.trim() };
}

function parseAuthScope(value: unknown): string {
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
  return randomUUID();
}
