import { NextResponse } from "next/server";
import { resolve } from "node:path";
import { captureGoldenLogin, goldenStatus, resetLoginMaintenance, startLoginMaintenance } from "../../../lib/steel-auth";
import { DockerSteelWorkspaceRuntime, FileSteelWorkspaceManager } from "../../../../src/workspace/manager";
import { assertSameOrigin } from "../../../lib/request-security";
import { requireRole } from "../../../lib/require-role";

export const dynamic = "force-dynamic";

export async function GET() { return NextResponse.json(await goldenStatus()); }

export async function POST(request: Request) {
  const denied = await requireRole("Operator");
  if (denied) return denied;
  try {
    assertSameOrigin(request);
    const body = await request.json() as { action?: string };
    if (body.action === "start") return NextResponse.json({ maintenance: await startLoginMaintenance() }, { status: 201 });
    if (body.action === "restart") { await resetLoginMaintenance(); return NextResponse.json({ maintenance: await startLoginMaintenance() }, { status: 201 }); }
    if (body.action === "capture") {
      await captureGoldenLogin();
      const root = resolve(/*turbopackIgnore: true*/ process.cwd(), "..", process.env.EMERALDX_WORKSPACE_DIR ?? ".workspaces");
      const sessionContextPath = resolve(/*turbopackIgnore: true*/ process.cwd(), "..", process.env.EMERALDX_SESSION_PATH ?? "session.json");
      const store = new FileSteelWorkspaceManager(root, new DockerSteelWorkspaceRuntime({ image: process.env.STEEL_WORKSPACE_IMAGE?.trim() || undefined, sessionContextPath }));
      const active = (await store.list()).filter((workspace) => workspace.status === "ready");
      const results = [];
      for (const workspace of active) {
        try { await store.refreshAuthentication(workspace.id); results.push({ id: workspace.id, status: "refreshed" }); }
        catch (error) { await store.recordActivity(workspace.id, { type: "authentication_refresh_failed", message: error instanceof Error ? error.message : String(error) }); results.push({ id: workspace.id, status: "failed" }); }
      }
      return NextResponse.json({ status: "ready", workspaceRefresh: results });
    }
    return NextResponse.json({ error: "action must be start, restart, or capture" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
