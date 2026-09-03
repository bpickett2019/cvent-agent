"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { Finding } from "../../src/verify/verifier";
import type { DashboardRun } from "../lib/fixtures";

export function ReviewPage({ runs, onDecisionComplete }: { runs: DashboardRun[]; onDecisionComplete?: () => void }) {
  const reviewable = runs.filter((run) => run.report);
  const [selectedId, setSelectedId] = useState(reviewable[0]?.id ?? "");
  const [decision, setDecision] = useState<Record<string, "approved" | "sent-back">>({});
  const [showSendBack, setShowSendBack] = useState(false);
  const [reason, setReason] = useState("");
  const run = reviewable.find((candidate) => candidate.id === selectedId) ?? reviewable[0];
  const findings = useMemo(() => sortFindings(run?.report?.findings ?? []), [run]);
  const blocking = findings.filter((finding) => finding.severity === "blocking");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  const visibilityGaps = warnings.filter((finding) => finding.message.includes("could not be verified programmatically"));
  const otherWarnings = warnings.filter((finding) => !finding.message.includes("could not be verified programmatically"));

  if (!run || !run.report) return null;
  const currentDecision = decision[run.id];

  const sendBack = () => {
    if (!reason.trim()) return;
    setDecision((current) => ({ ...current, [run.id]: "sent-back" }));
    setShowSendBack(false);
    setReason("");
  };

  return (
    <div className="page-stack">
      <header className="page-intro review-intro">
        <div><span className="eyebrow">Quality control</span><h1>Run review</h1><p>Independent verification, execution evidence, and the final operator decision.</p></div>
        <select className="run-select" value={run.id} onChange={(event) => { setSelectedId(event.target.value); setShowSendBack(false); }}>
          {reviewable.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.eventName} · {candidate.id}</option>)}
        </select>
      </header>
      <div className="notice error-summary" role="status"><strong>Demo data</strong><span>These review records are interface fixtures, not live Cvent execution results.</span></div>

      <div className="review-hero">
        <div className="review-event-mark"><span>{initials(run.eventName)}</span></div>
        <div className="review-event-copy"><div className="review-title-line"><h2>{run.eventName}</h2><StatusBadge status={run.status} /></div><p>Cloned from <strong>{run.templateName}</strong> · {run.eventCode}</p><div className="meta-row"><span>Run {run.id}</span><span>Owner {run.owner}</span><span>Completed {formatDate(run.completedAt)}</span></div></div>
        <div className="review-score"><strong>{run.report.passed ? "Passed" : `${blocking.length} blocking`}</strong><span>API verification</span></div>
      </div>

      {currentDecision && <div className={`notice decision-notice ${currentDecision}`}><strong>{currentDecision === "approved" ? "Approved for handoff" : "Sent back for correction"}</strong><span>This mock decision is recorded for the executive demo.</span></div>}

      <div className="review-layout">
        <main className="review-main">
          {blocking.length > 0 && <FindingGroup title="Must be resolved" count={blocking.length} tone="blocking" findings={blocking} />}

          {visibilityGaps.length > 0 && (
            <section className="visibility-review-card">
              <div className="human-eye-icon">◎</div>
              <div className="visibility-review-copy"><span className="eyebrow amber">Human verification required</span><h3>Visibility rules need your eyes</h3><p>Cvent’s API cannot read these rules. Compare each rule against the captured registration screens before approving.</p>
                <ul>{visibilityGaps.map((finding, index) => <li key={index}><span>{index + 1}</span>{shortVisibilityMessage(finding.message)}</li>)}</ul>
              </div>
            </section>
          )}

          {otherWarnings.length > 0 && <FindingGroup title="Review recommended" count={otherWarnings.length} tone="warning" findings={otherWarnings} />}
          {findings.length === 0 && <div className="empty-success"><span>✓</span><div><strong>Everything matches</strong><p>No differences were found between the intake and Cvent.</p></div></div>}

          <section className="review-section">
            <div className="review-section-head"><div><span className="eyebrow">Execution record</span><h2>Task status</h2></div><span className="count-label">{run.tasks.filter((task) => task.status === "succeeded").length} of {run.tasks.length} complete</span></div>
            <div className="task-table">
              <div className="task-table-head"><span>Task</span><span>Channel</span><span>Status</span><span>Completed</span></div>
              {run.tasks.map((item) => <div className="task-table-row" key={item.task.id}><div><strong>{item.task.label}</strong><small>{item.task.id}</small></div><span className={`channel-tag ${item.task.channel}`}>{item.task.channel === "api" ? "API" : "Browser"}</span><TaskBadge status={item.status} /><span className="task-time">{item.completedAt ? formatTime(item.completedAt) : "—"}</span>{item.detail && <p className="task-detail">{item.detail}</p>}</div>)}
            </div>
          </section>

          <section className="review-section">
            <div className="review-section-head"><div><span className="eyebrow">Visual evidence</span><h2>Captured screenshots</h2></div><span className="count-label">{run.screenshots.length} capture{run.screenshots.length === 1 ? "" : "s"}</span></div>
            {run.screenshots.length ? <div className="screenshot-grid">{run.screenshots.map((shot) => <figure key={shot.src}><div className="screenshot-frame"><Image src={shot.src} alt={shot.label} width={1200} height={720} /></div><figcaption><strong>{shot.label}</strong><span>{formatDateTime(shot.capturedAt)}</span></figcaption></figure>)}</div> : <div className="empty-row">No screenshots were captured for this run.</div>}
          </section>
        </main>

        <aside className="decision-panel">
          <span className="eyebrow">Operator decision</span><h3>Ready for handoff?</h3><p>Approval confirms the API findings and screenshots have been reviewed. It does not publish the event.</p>
          <div className="decision-checks"><span><b className={blocking.length ? "not-done" : "done"}>{blocking.length ? "!" : "✓"}</b>Blocking findings resolved</span><span><b className="done">✓</b>Event remains in Draft</span><span><b className={visibilityGaps.length ? "attention" : "done"}>{visibilityGaps.length ? "◎" : "✓"}</b>Visibility reviewed manually</span></div>
          <button className="approve-button" disabled={blocking.length > 0} onClick={() => { setDecision((current) => ({ ...current, [run.id]: "approved" })); window.setTimeout(() => onDecisionComplete?.(), 1200); }}>Approve run</button>
          <button className="send-back-button" onClick={() => setShowSendBack(true)}>Send back</button>
          <small>Publishing remains a separate, human-controlled action in Cvent.</small>
        </aside>
      </div>

      {showSendBack && <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="send-back-title"><button className="modal-close" aria-label="Close" onClick={() => setShowSendBack(false)}>×</button><span className="eyebrow">Return to operator</span><h2 id="send-back-title">What needs to change?</h2><p>Be specific so the next operator can resolve the issue without interpreting technical logs.</p><label className="field"><span>Reason for sending back</span><textarea autoFocus rows={5} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: The Retail Buyer visibility rule should include both qualified buyer registration types." /></label><div className="modal-actions"><button className="secondary-button" onClick={() => setShowSendBack(false)}>Cancel</button><button className="danger-button" disabled={!reason.trim()} onClick={sendBack}>Send back with reason</button></div></div></div>}
    </div>
  );
}

function FindingGroup({ title, count, tone, findings }: { title: string; count: number; tone: "blocking" | "warning"; findings: Finding[] }) { return <section className={`finding-group ${tone}`}><div className="finding-group-head"><span className="finding-icon">{tone === "blocking" ? "!" : "i"}</span><h3>{title}</h3><span>{count}</span></div><div>{findings.map((finding, index) => <article className="finding-row" key={index}><div><strong>{finding.message}</strong>{finding.expected !== undefined && <dl><div><dt>Expected</dt><dd>{renderValue(finding.expected)}</dd></div><div><dt>Found</dt><dd>{renderValue(finding.actual)}</dd></div></dl>}</div><span className="area-tag">{finding.area}</span></article>)}</div></section>; }
function StatusBadge({ status }: { status: DashboardRun["status"] }) { return <span className={`status-badge ${status}`}>{status === "passed" ? "Ready for approval" : status === "review" ? "Needs review" : "Halted"}</span>; }
function TaskBadge({ status }: { status: DashboardRun["tasks"][number]["status"] }) { return <span className={`task-status ${status}`}>{status === "succeeded" ? "Complete" : status}</span>; }
function sortFindings(findings: Finding[]): Finding[] { return [...findings].sort((a, b) => Number(b.severity === "blocking") - Number(a.severity === "blocking")); }
function shortVisibilityMessage(message: string): string { const match = message.match(/question "([^"]+)"/); return match ? match[1] : message; }
function renderValue(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value); }
function initials(name: string): string { return name.split(/\s+/).filter((part) => !/20\d\d/.test(part)).slice(0, 2).map((part) => part[0]).join(""); }
function formatDate(value: string | null): string { return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "In progress"; }
function formatTime(value: string): string { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function formatDateTime(value: string): string { return `${formatDate(value)} · ${formatTime(value)}`; }
