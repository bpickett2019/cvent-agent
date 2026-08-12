"use client";

import Image from "next/image";
import { useState } from "react";
import type { DashboardRun } from "../lib/fixtures";

export function TriageQueue({ runs }: { runs: DashboardRun[] }) {
  const halted = runs.filter((run) => run.status === "halted" && run.halt);
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  const retry = (id: string) => {
    setRetrying((current) => ({ ...current, [id]: true }));
    window.setTimeout(() => setRetrying((current) => ({ ...current, [id]: false })), 1600);
  };

  return (
    <div className="page-stack">
      <header className="page-intro">
        <div><span className="eyebrow">Operations</span><h1>Triage queue</h1><p>Runs that need a Cvent operator’s judgment before automation can continue.</p></div>
        <div className="queue-summary"><strong>{halted.length}</strong><span>run{halted.length === 1 ? "" : "s"} waiting</span></div>
      </header>

      <div className="triage-filterbar"><div><span className="pulse-dot" />Needs attention</div><span>Oldest issue first</span></div>

      <div className="triage-list">
        {halted.map((run) => {
          const halt = run.halt!;
          const failed = run.tasks.find((task) => task.status === "halted");
          return (
            <article className="triage-card" key={run.id}>
              <div className="triage-stripe" />
              <header className="triage-card-head">
                <div className="event-monogram">{initials(run.eventName)}</div>
                <div><div className="triage-title"><h2>{run.eventName}</h2><span>Halted</span></div><p>{run.eventCode} · cloned from {run.templateName}</p></div>
                <div className="triage-age"><strong>18 min</strong><span>waiting</span></div>
              </header>

              <div className="triage-content">
                <div className="triage-explanation">
                  <span className="eyebrow red">Where work stopped</span>
                  <h3>{halt.taskLabel}</h3>
                  <div className="plain-reason"><span>!</span><div><strong>What happened</strong><p>{halt.reason}</p></div></div>
                  <div className="operator-guidance"><strong>What to check in Cvent</strong><p>{halt.operatorGuidance}</p></div>
                  <dl className="triage-meta"><div><dt>Run</dt><dd>{run.id}</dd></div><div><dt>Operator</dt><dd>{run.owner}</dd></div><div><dt>Started</dt><dd>{formatDateTime(run.startedAt)}</dd></div><div><dt>Completed steps</dt><dd>{run.tasks.filter((task) => task.status === "succeeded").length} of {run.tasks.length}</dd></div></dl>
                  <button className={`retry-button ${retrying[run.id] ? "loading" : ""}`} disabled={retrying[run.id]} onClick={() => retry(run.id)}>{retrying[run.id] ? <><span className="spinner" />Queuing retry…</> : <>↻ Retry from this step</>}</button>
                  <small className="retry-note">Completed work will not run again.</small>
                </div>

                <figure className="failure-evidence"><div className="failure-shot"><Image src={halt.screenshot} alt={`Cvent screen when ${halt.taskLabel} halted`} width={1200} height={720} /></div><figcaption><span><strong>Failure capture</strong><small>{failed?.completedAt ? formatDateTime(failed.completedAt) : "Capture unavailable"}</small></span><button onClick={() => window.open(halt.screenshot, "_blank")}>Open full size ↗</button></figcaption></figure>
              </div>
            </article>
          );
        })}
      </div>

      <section className="queue-help"><div className="help-icon">?</div><div><strong>Nothing here mentions selectors or page code.</strong><p>The queue translates automation failures into the Cvent task and operator action that matter. Technical evidence remains attached to the run audit.</p></div></section>
    </div>
  );
}

function initials(name: string): string { return name.split(/\s+/).filter((part) => !/20\d\d/.test(part)).slice(0, 2).map((part) => part[0]).join(""); }
function formatDateTime(value: string): string { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
