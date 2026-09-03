"use client";
import { useEffect, useState } from "react";

export function LiveRunTriage({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { void fetch(`/api/jobs/${jobId}/result`, { cache: "no-store" }).then((response) => response.json()).then(setData); }, [jobId]);
  const checkpoints = data?.run?.checkpoints ?? [];
  const stopped = checkpoints.filter((item: any) => item.status === "halted" || item.status === "blocked");
  return <div className="page-stack"><header className="page-intro"><div><span className="eyebrow">Live triage</span><h1>{data?.run?.spec?.details?.name ?? "Run triage"}</h1><p>Job {jobId} · actual durable worker receipt</p></div></header>{!data ? <div className="empty-row">Loading live triage…</div> : <><section className="finding-group blocking"><div className="finding-group-head"><span className="finding-icon">!</span><h3>{stopped.length} stopped or dependent tasks</h3></div><div>{stopped.map((item: any) => <article className="finding-row" key={item.taskId}><div><strong>{item.taskId}</strong><p>{item.detail ?? "Blocked without a structured reason"}</p></div><span className="area-tag">{item.status}</span></article>)}</div></section><button className="secondary-button" onClick={onBack}>Back to Run Monitor</button></>}</div>;
}
