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
  if (!origin || origin !== new URL(request.url).origin) {
    throw new Error("State-changing requests must be same-origin");
  }
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
