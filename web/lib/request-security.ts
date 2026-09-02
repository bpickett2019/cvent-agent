import type { SteelWorkspace } from "../../src/workspace/manager";

export type PublicWorkspace = Pick<
  SteelWorkspace,
  | "id"
  | "name"
  | "eventId"
  | "access"
  | "controller"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "viewerUrl"
  | "error"
  | "activity"
  | "initialUrl"
  | "assignment"
>;

/** Reject browser state changes unless the request came from this UI origin. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new Error("State-changing requests must be same-origin");
  let supplied: URL;
  try {
    supplied = new URL(origin);
  } catch {
    throw new Error("State-changing requests must be same-origin");
  }
  const target = new URL(request.url);
  if (supplied.origin === target.origin) return;
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (
    supplied.origin === origin &&
    supplied.protocol === target.protocol &&
    supplied.port === target.port &&
    loopback.has(supplied.hostname.toLowerCase()) &&
    loopback.has(target.hostname.toLowerCase())
  ) return;
  throw new Error("State-changing requests must be same-origin");
}

/** Deliberately excludes container, job, provider-session, and API coordinates. */
export function publicWorkspace(workspace: SteelWorkspace): PublicWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
    eventId: workspace.eventId,
    access: workspace.access,
    controller: workspace.controller,
    status: workspace.status,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    viewerUrl: workspace.viewerUrl,
    error: workspace.error,
    activity: workspace.activity,
    ...(workspace.initialUrl ? { initialUrl: workspace.initialUrl } : {}),
    ...(workspace.assignment ? { assignment: workspace.assignment } : {}),
  };
}
