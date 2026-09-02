"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function GoldenLogin() {
  const [status, setStatus] = useState<"ready" | "missing">("missing");
  const [viewer, setViewer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  const refresh = async () => {
    const response = await fetch("/api/auth", { cache: "no-store" });
    const body = await response.json() as { status?: "ready" | "missing"; maintenance?: { viewerUrl?: string } | null };
    setStatus(body.status ?? "missing"); setViewer(body.maintenance?.viewerUrl ?? null);
  };
  useEffect(() => { setMounted(true); void refresh(); }, []);
  useEffect(() => {
    if (!viewer) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setViewer(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer]);

  const action = async (name: "start" | "capture") => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: name }) });
      const body = await response.json() as { maintenance?: { viewerUrl?: string }; status?: "ready"; error?: string };
      if (!response.ok) throw new Error(body.error || "Cvent login maintenance failed");
      if (name === "start") setViewer(body.maintenance?.viewerUrl ?? null); else { setViewer(null); setStatus("ready"); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const dialog = viewer && mounted ? createPortal(
    <div className="modal-backdrop golden-login-modal" role="dialog" aria-modal="true" aria-label="Golden Cvent login">
      <section className="modal-card">
        <button className="modal-close" aria-label="Close golden login" onClick={() => setViewer(null)}>×</button>
        <span className="eyebrow">Golden Cvent login</span>
        <h2>Authenticate once for every worker</h2>
        <p>Complete Cvent login and MFA in the Steel viewer, then save the refreshed browser context.</p>
        <iframe src={viewer} title="Steel Cvent login viewer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        <div className="modal-actions"><a className="secondary-button" href={viewer} target="_blank" rel="noreferrer">Open full screen ↗</a><button className="approve-button" disabled={busy} onClick={() => void action("capture")}>Save refreshed login</button></div>
        {error && <p className="inline-error">{error}</p>}
      </section>
    </div>, document.body
  ) : null;

  return <>
    <button className={`golden-login-pill ${status}`} onClick={() => void action("start")} disabled={busy}><span />Golden Cvent login · {status}</button>
    {dialog}
  </>;
}
