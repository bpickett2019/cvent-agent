"use client";

import { useEffect, useState } from "react";

type LiveResult = {
  job: { id: string; status: string; error?: string | null; output?: { runId?: string; triageSummary?: string } | null };
  run: { spec?: { details?: { name?: string }; target?: { eventId?: string } }; checkpoints?: Array<{ taskId: string; status: string; evidence?: string | null; detail?: string | null }>; report?: { passed: boolean; findings: Array<{ severity: string; area: string; message: string }> } } | null;
};

export function LiveRunReview({ jobId, onTriage }: { jobId: string; onTriage: () => void }) {
  const [result, setResult] = useState<LiveResult | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}/result`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Run result unavailable");
        if (active) { setResult(body); setError(""); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }
    };
    void load(); const timer = window.setInterval(() => void load(), 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [jobId]);
  if (error) return <div className="notice error-summary" role="alert"><strong>Live run unavailable</strong><span>{error}</span></div>;
  if (!result) return <div className="empty-row">Loading live run receipt…</div>;
  const checkpoints = result.run?.checkpoints ?? [];
  const terminal = ["succeeded", "failed", "cancelled"].includes(result.job.status) || result.job.output?.triageSummary;
  return <div className="page-stack">
    <header className="page-intro"><div><span className="eyebrow">Live execution receipt</span><h1>{result.run?.spec?.details?.name ?? "Run review"}</h1><p>Job {result.job.id} · Run {result.job.output?.runId ?? "pending"}</p></div><div className={`validation-pill ${result.run?.report?.passed ? "valid" : "invalid"}`}><span className="status-dot" />{result.job.status}</div></header>
    <section className="review-section"><div className="review-section-head"><div><span className="eyebrow">Actual worker output</span><h2>Task status</h2></div><span className="count-label">{checkpoints.filter((item) => item.status === "succeeded").length} of {checkpoints.length} succeeded</span></div><div className="task-table"><div className="task-table-head"><span>Task</span><span>Status</span><span>Evidence / reason</span><span /></div>{checkpoints.map((item) => <div className="task-table-row" key={item.taskId}><div><strong>{item.taskId}</strong></div><span className={`task-status ${item.status}`}>{item.status}</span><p className="task-detail">{item.evidence ?? item.detail ?? "No receipt"}</p><span /></div>)}</div></section>
    {result.job.output?.triageSummary && <section className="finding-group blocking"><div className="finding-group-head"><span className="finding-icon">!</span><h3>Real triage summary</h3></div><div className="finding-row"><pre style={{ whiteSpace: "pre-wrap" }}>{result.job.output.triageSummary}</pre></div></section>}
    {result.run?.report && <section className="review-section"><div className="review-section-head"><h2>Independent verification</h2><span className="count-label">{result.run.report.passed ? "Passed" : "Blocked"}</span></div>{result.run.report.findings.map((finding, index) => <article className={`finding-row ${finding.severity}`} key={index}><strong>{finding.message}</strong><span className="area-tag">{finding.area}</span></article>)}</section>}
    {terminal && <button className="approve-button" onClick={onTriage}>Continue to triage</button>}
  </div>;
}
