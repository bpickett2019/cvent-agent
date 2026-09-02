import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { DockerSteelWorkspaceRuntime, FileSteelWorkspaceManager, scopedSessionContextPath } from "../../../../src/workspace/manager";
import { runControls } from "../../../lib/job-server";
import { promoteWorkspaceAuthentication } from "../../../lib/workspace-auth-promotion";
import { assertSameOrigin, publicWorkspace } from "../../../lib/request-security";
import { requireRole } from "../../../lib/require-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function manager(): FileSteelWorkspaceManager {
  const root = resolve(/*turbopackIgnore: true*/ process.cwd(), "..", process.env.EMERALDX_WORKSPACE_DIR ?? ".workspaces");
  const sessionBasePath = resolve(/*turbopackIgnore: true*/ process.cwd(), "..", process.env.EMERALDX_SESSION_PATH ?? "session.json");
  return new FileSteelWorkspaceManager(root, new DockerSteelWorkspaceRuntime({
    image: process.env.STEEL_WORKSPACE_IMAGE?.trim() || undefined,
    sessionContextPath: (workspace) => scopedSessionContextPath(sessionBasePath, workspace.authScopeId),
  }));
}

export async function GET(): Promise<NextResponse> {
  const store = manager();
  await store.reapExpired(3 * 60 * 60 * 1_000 + 5 * 60_000);
  return NextResponse.json({ workspaces: (await store.list()).map(publicWorkspace) });
}

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireRole("Operator");
  if (denied) return denied;
  try {
    assertSameOrigin(request);
    const body = await request.json() as { action?: string; id?: string; name?: string };

    if (body.action === "release" && body.id) {
      const store = manager();
      const current = await store.get(body.id);
      if (!current) throw new Error(`unknown workspace ${body.id}`);
      if (current.access === "mutation") await runControls().requestCancel(current.ownerJobId);
      return NextResponse.json({ workspace: publicWorkspace(await store.release(body.id)) });
    }
    if (body.action === "promote-login" && body.id) {
      const store = manager();
      const current = await store.get(body.id);
      if (!current) throw new Error(`unknown workspace ${body.id}`);
      const sessionBasePath = resolve(/*turbopackIgnore: true*/ process.cwd(), "..", process.env.EMERALDX_SESSION_PATH ?? "session.json");
      const sessionPath = scopedSessionContextPath(sessionBasePath, current.authScopeId);
      return NextResponse.json({ promotion: await promoteWorkspaceAuthentication({ workspaceId: body.id, manager: store, sessionPath }) });
    }
    if ((body.action === "takeover" || body.action === "return") && body.id) {
      const store = manager();
      const current = await store.get(body.id);
      if (!current) throw new Error(`unknown workspace ${body.id}`);
      if (body.action === "takeover") {
        if (current.access === "mutation") await runControls().pause(current.ownerJobId);
        return NextResponse.json({ workspace: publicWorkspace(await store.takeOver(body.id)) });
      }
      // Return leaves mutation run paused; explicit Resume is a separate operator action.
      const workspace = await store.returnToAgent(body.id);
      return NextResponse.json({ workspace: publicWorkspace(workspace) });
    }
    return NextResponse.json({ error: "action must be release, takeover, return, or promote-login" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
