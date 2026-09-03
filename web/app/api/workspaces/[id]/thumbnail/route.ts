import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const path = resolve(/*turbopackIgnore: true*/ process.cwd(), "..", process.env.EMERALDX_WORKSPACE_DIR ?? ".workspaces", "workspaces.json");
    const document = JSON.parse(await readFile(path, "utf8")) as { workspaces?: Array<{ id: string; status: string; apiUrl: string | null }> };
    const workspace = document.workspaces?.find((candidate) => candidate.id === id && candidate.status === "ready");
    if (!workspace?.apiUrl) return NextResponse.json({ error: "Workspace is not ready" }, { status: 404 });
    const api = new URL(workspace.apiUrl);
    if (api.hostname !== "127.0.0.1" && api.hostname !== "localhost") throw new Error("Workspace API must be local");
    const response = await fetch(`${workspace.apiUrl}/v1/sessions/screenshot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fullPage: false }), cache: "no-store" });
    if (!response.ok) throw new Error(`Steel screenshot failed: ${response.status}`);
    const contentType = response.headers.get("content-type");
    return new Response(await response.arrayBuffer(), { status: 200, headers: { "content-type": contentType?.startsWith("image/") ? contentType : "image/jpeg", "cache-control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
