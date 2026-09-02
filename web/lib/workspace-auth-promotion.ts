import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SteelWorkspace, WorkspaceActivity } from "../../src/workspace/manager";

interface PromotionManager {
  get(id: string): Promise<SteelWorkspace | null>;
  list(): Promise<SteelWorkspace[]>;
  recordActivity(id: string, activity: Pick<WorkspaceActivity, "type" | "message">): Promise<SteelWorkspace>;
  refreshAuthentication(id: string): Promise<SteelWorkspace>;
}
interface PromotionArgs {
  workspaceId: string;
  manager: PromotionManager;
  sessionPath: string;
  fetchImpl?: typeof fetch;
  writeContext?: (path: string, value: unknown) => Promise<void>;
}
export interface WorkspacePromotionResult { sourceWorkspaceId: string; refreshed: Array<{ id: string; status: "refreshed" | "failed" }> }

export async function promoteWorkspaceAuthentication(args: PromotionArgs): Promise<WorkspacePromotionResult> {
  const request = args.fetchImpl ?? fetch;
  const source = await args.manager.get(args.workspaceId);
  if (!source || source.status !== "ready" || !source.apiUrl || !source.providerSessionId) throw new Error("workspace is not ready for authentication promotion");
  const detailsResponse = await request(`${source.apiUrl}/v1/sessions/${source.providerSessionId}/live-details`);
  if (!detailsResponse.ok) throw new Error(`workspace authentication probe failed: ${detailsResponse.status}`);
  const details = await detailsResponse.json() as { pages?: Array<{ url?: string; title?: string }>; browserState?: { userAgent?: string } };
  const page = details.pages?.find((candidate) => candidate.url && !candidate.url.toLowerCase().includes("login"));
  if (!page?.url) throw new Error("workspace is not authenticated in Cvent");
  const url = new URL(page.url);
  if (url.hostname !== "app.cvent.com" || !page.url.toLowerCase().includes(source.eventId.toLowerCase())) throw new Error("workspace is not authenticated on its exact authorized Cvent event");
  const contextResponse = await request(`${source.apiUrl}/v1/sessions/${source.providerSessionId}/context`);
  if (!contextResponse.ok) throw new Error(`workspace context capture failed: ${contextResponse.status}`);
  const context = await contextResponse.json() as { cookies?: unknown[]; localStorage?: unknown; sessionStorage?: unknown; indexedDB?: unknown; userAgent?: string };
  if (!context.cookies?.length) throw new Error("authenticated workspace returned no browser cookies");
  if (details.browserState?.userAgent) context.userAgent = details.browserState.userAgent;
  await (args.writeContext ?? writePrivateContext)(args.sessionPath, context);
  await args.manager.recordActivity(source.id, { type: "authentication_promoted", message: "This authenticated workspace was promoted to Golden" });
  const siblings = (await args.manager.list()).filter((workspace) => workspace.id !== source.id && workspace.status === "ready");
  const refreshed: WorkspacePromotionResult["refreshed"] = [];
  for (const sibling of siblings) {
    try { await args.manager.refreshAuthentication(sibling.id); refreshed.push({ id: sibling.id, status: "refreshed" }); }
    catch (error) { await args.manager.recordActivity(sibling.id, { type: "authentication_refresh_failed", message: error instanceof Error ? error.message : String(error) }); refreshed.push({ id: sibling.id, status: "failed" }); }
  }
  return { sourceWorkspaceId: source.id, refreshed };
}

async function writePrivateContext(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
