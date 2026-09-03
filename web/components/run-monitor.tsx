"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentWorkspaces } from "./agent-workspaces";

interface MonitoredJob {
  id: string;
  eventName: string;
  eventCode: string | null;
  status: "queued" | "paused" | "running" | "halted" | "succeeded" | "failed" | "cancelled";
  attempts: number;
  error: string | null;
  updatedAt: string;
  output: { status?: string; triageSummary?: string } | null;
  control: {
    paused: boolean;
    cancelRequested: boolean;
    viewerUrl: string | null;
    browserProvider: string | null;
  };
}

export function RunMonitor() {
  const [jobs, setJobs] = useState<MonitoredJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [selectedViewer, setSelectedViewer] = useState<{ url: string; eventName: string; workspaceId?: string; interactive: boolean } | null>(null);
  const [error, setError] = useState("");


  const watchViewer = useCallback((viewer: { url: string; eventName: string; workspaceId?: string; interactive?: boolean }) => {
    setSelectedViewer({ ...viewer, interactive: viewer.interactive ?? false });
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      const body = (await response.json()) as { jobs?: MonitoredJob[]; error?: string };
      if (!response.ok || !body.jobs) throw new Error(body.error || "Run status is unavailable.");
      setJobs(body.jobs);
      setError("");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Run status is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [refresh]);


  const control = async (job: MonitoredJob, action: "pause" | "resume" | "cancel") => {
    if (action === "cancel" && !window.confirm(`Cancel ${job.eventName}? Completed Cvent steps will remain for triage.`)) return;
    setPending((current) => ({ ...current, [job.id]: action }));
    try {
      const response = await fetch(`/api/jobs/${job.id}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Could not ${action} the run.`);
      await refresh();
    } catch (controlError) {
      setError(controlError instanceof Error ? controlError.message : `Could not ${action} the run.`);
    } finally {
      setPending((current) => { const next = { ...current }; delete next[job.id]; return next; });
    }
  };

  if (selectedViewer) {
    const returnControl = async () => {
      if (selectedViewer.interactive && selectedViewer.workspaceId) {
        const response = await fetch("/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "return", id: selectedViewer.workspaceId }) });
        if (!response.ok) { const body = await response.json() as { error?: string }; setError(body.error ?? "Could not return workspace control"); return; }
      }
      setSelectedViewer(null);
    };
    return <section className="workspace-focus-view"><header><button type="button" onClick={() => void returnControl()}>← {selectedViewer.interactive ? "Return control" : "Back to workspaces"}</button><div><span className="eyebrow">{selectedViewer.interactive ? "Interactive takeover" : "Read-only viewer"}</span><h1>{selectedViewer.eventName}</h1></div></header><div className="workspace-viewer-frame"><iframe src={selectedViewer.url} title={`Steel live viewer for ${selectedViewer.eventName}`} tabIndex={selectedViewer.interactive ? 0 : -1} inert={!selectedViewer.interactive} aria-hidden={selectedViewer.interactive ? undefined : true} style={{ pointerEvents: selectedViewer.interactive ? "auto" : "none" }} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />{!selectedViewer.interactive && <div className="workspace-viewer-shield" aria-label="Read-only viewer; take over the workspace to interact" />}</div></section>;
  }

  return (
    <div className="page-stack">
      <header className="page-intro">
        <div><span className="eyebrow">Live operations</span><h1>Run monitor</h1><p>Watch the Steel browser and stop automation before its next Cvent action.</p></div>
        <div className="queue-summary"><strong>{jobs.filter((job) => job.status === "running" || job.control.paused).length}</strong><span>active run{jobs.filter((job) => job.status === "running" || job.control.paused).length === 1 ? "" : "s"}</span></div>
      </header>

      <div className="safety-notice"><span>!</span><div><strong>Pause is a cooperative safety stop.</strong><p>An action already sent to Cvent may finish. No new browser action or task starts until Resume. Use Cancel to halt the run and send partial work to triage.</p></div></div>
      <AgentWorkspaces onWatch={watchViewer} />
      {error && <div className="notice error-summary" role="alert"><strong>Run control error.</strong><span>{error}</span></div>}
      {loading && <div className="empty-row">Loading durable queue…</div>}
      {!loading && jobs.length === 0 && <div className="empty-row">No queued runs yet. Submit a valid EventSpec from Event intake.</div>}

      <div className="monitor-list">
        {jobs.map((job) => {
          const isActive = job.status === "running";
          const isPaused = job.status === "paused" || job.control.paused;
          const terminal = ["halted", "succeeded", "failed", "cancelled"].includes(job.status);
          return (
            <article className="monitor-card" key={job.id}>
              <header><div className={`monitor-state ${isPaused ? "paused" : job.status}`}><span />{isPaused ? "Paused" : statusLabel(job.status)}</div><div><h2>{job.eventName}</h2><p>{job.eventCode ?? "No event code"} · Job {job.id}</p></div><time>{formatTime(job.updatedAt)}</time></header>
              <div className="monitor-body">
                <div className="monitor-facts"><div><small>Worker state</small><strong>{isPaused ? "Waiting for operator" : statusLabel(job.status)}</strong></div><div><small>Browser</small><strong>{job.control.viewerUrl ? "Steel connected" : isActive ? "Opening session" : "Not active"}</strong></div><div><small>Attempt</small><strong>{job.attempts || "Not started"}</strong></div></div>
                {(job.error || job.output?.triageSummary) && <p className="monitor-detail">{job.error || job.output?.triageSummary}</p>}
                <div className="monitor-actions">
                  {job.control.viewerUrl ? <button className="viewer-button" onClick={() => watchViewer({ url: job.control.viewerUrl!, eventName: job.eventName, interactive: false })}>Watch read-only</button> : <button disabled className="viewer-button disabled">Live browser unavailable</button>}
                  {!terminal && !isPaused && <button className="pause-button" disabled={Boolean(pending[job.id])} onClick={() => void control(job, "pause")}>{pending[job.id] === "pause" ? "Pausing…" : "Ⅱ Pause run"}</button>}
                  {!terminal && isPaused && <button className="resume-button" disabled={Boolean(pending[job.id])} onClick={() => void control(job, "resume")}>{pending[job.id] === "resume" ? "Resuming…" : "▶ Resume run"}</button>}
                  {!terminal && <button className="cancel-run-button" disabled={Boolean(pending[job.id])} onClick={() => void control(job, "cancel")}>{pending[job.id] === "cancel" ? "Cancelling…" : "Cancel run"}</button>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function statusLabel(status: MonitoredJob["status"]): string {
  return ({ queued: "Queued", paused: "Paused", running: "Running", halted: "Needs review", succeeded: "Completed", failed: "Failed", cancelled: "Cancelled" })[status];
}
function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}
