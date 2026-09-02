"use client";

import { useCallback, useEffect, useState } from "react";

interface WorkspaceView {
  id: string;
  name: string;

  eventId: string;
  access: "mutation" | "readOnly";
  controller?: "agent" | "user";
  status: "starting" | "ready" | "failed" | "released";
  viewerUrl: string | null;

  updatedAt: string;
  error: string | null;
  activity?: Array<{ type: string; message: string; at: string }>;
}

export function AgentWorkspaces({ onWatch }: { onWatch: (viewer: { url: string; eventName: string; workspaceId: string; interactive: boolean }) => void }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  const [previewTick, setPreviewTick] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/workspaces", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const body = await response.json() as { workspaces?: WorkspaceView[] };
    setWorkspaces(body.workspaces ?? []);
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    const previewTimer = window.setInterval(() => setPreviewTick((current) => current + 1), 10_000);
    return () => { window.clearInterval(timer); window.clearInterval(previewTimer); };
  }, [refresh]);
  const action = async (actionName: "release" | "takeover" | "return" | "promote-login", id?: string): Promise<boolean> => {
    setBusy(id ?? actionName); setError("");
    try {
      const response = await fetch("/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: actionName, id }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Workspace action failed");
      await refresh();
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { setBusy(""); }
  };
  const active = workspaces.filter((workspace) => workspace.status === "starting" || workspace.status === "ready");
  return <section className="workspace-browser-board">
    <header className="workspace-board-head"><div><span>ISOLATED BROWSER WORKSPACES</span><h2>Agent workspaces</h2><p>Dedicated Chromium sessions with document-scoped login contexts and independent ownership.</p></div><strong>{active.length} active · 12 per document · 36 global</strong></header>
    {error && <div className="workspace-board-error">{error}</div>}
    {active.length === 0 && <div className="empty-row">Workspaces appear automatically when an AI agent is deployed.</div>}
    <div className="workspace-browser-grid">
      {active.map((workspace) => {
        const latest = workspace.activity?.at(-1);
        const authRequired = latest?.type === "auth_required";
        return <article className="workspace-browser-card" key={workspace.id}>
        <div className="workspace-preview">
          {workspace.viewerUrl ? <img src={`/api/workspaces/${workspace.id}/thumbnail?t=${previewTick}`} alt={`Live preview of ${workspace.name}`} /> : <div className="workspace-preview-loading"><span />Starting Chromium…</div>}
          {authRequired && <div className="workspace-preview-state auth"><strong>Login required</strong><span>Cvent redirected this runner to Client Login. The container and live viewer remain active.</span></div>}
          {!authRequired && latest && <div className="workspace-preview-state"><strong>{workspace.status === "ready" ? "Live runner" : "Starting"}</strong><span>{latest.message}</span></div>}
          <span className="workspace-preview-shield" />
        </div>
        <div className="workspace-card-meta"><span className={`workspace-status-chip ${workspace.status}`}>{authRequired ? "Waiting for login" : workspace.status === "ready" ? "Running" : "Starting"}</span><strong title={workspace.name}>{workspace.name}</strong><span className="workspace-browser-owner">Steel Chromium</span></div>
        <div className="workspace-card-footer"><span>{workspace.access === "mutation" ? "Mutation lease" : "Read-only"} · {workspace.id.slice(0, 8)}</span><div><button onClick={() => workspace.viewerUrl && onWatch({ url: workspace.viewerUrl, eventName: workspace.name, workspaceId: workspace.id, interactive: false })}>View</button><button disabled={busy === workspace.id} onClick={() => void action("promote-login", workspace.id)}>Use login for this document</button><button className="workspace-stop" disabled={busy === workspace.id} onClick={() => void action("release", workspace.id)}>{busy === workspace.id ? "…" : "Stop"}</button></div></div>
        <div className="workspace-activity"><span>Agent activity</span><strong>{latest?.message ?? "Waiting for agent report"}</strong><ol className="workspace-activity-list">{workspace.activity?.slice(-4).reverse().map((entry) => <li key={`${entry.at}-${entry.type}`}><time>{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span>{entry.message}</span></li>)}</ol></div>
        <div className="workspace-control-dock"><span className="workspace-pause-mark">Ⅱ</span><span className="workspace-agent-mark">✣</span><div><strong>{workspace.name}</strong><small>{workspace.controller === "user" ? "You are in control" : authRequired ? "Agent waiting for login" : "Agent is in control"}</small></div>{workspace.controller === "user" ? <button className="workspace-takeover" onClick={() => void action("return", workspace.id)}>Return</button> : <button className="workspace-takeover" onClick={async () => { if (await action("takeover", workspace.id)) workspace.viewerUrl && onWatch({ url: workspace.viewerUrl, eventName: workspace.name, workspaceId: workspace.id, interactive: true }); }}>Take over</button>}<button className="workspace-dock-stop" disabled={busy === workspace.id} onClick={() => void action("release", workspace.id)}>Stop</button></div>
      </article>})}
    </div>
  </section>;
}
