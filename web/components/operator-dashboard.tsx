"use client";

import { useState } from "react";
import { IntakeForm } from "./intake-form";
import { ReviewPage } from "./review-page";
import { TriageQueue } from "./triage-queue";
import { initialSpec, runs } from "../lib/fixtures";

type View = "intake" | "review" | "triage";

const navigation: Array<{ id: View; label: string; description: string; icon: React.ReactNode }> = [
  { id: "intake", label: "Event intake", description: "Create a build", icon: <Icon name="document" /> },
  { id: "review", label: "Run review", description: "Verify and approve", icon: <Icon name="check" /> },
  { id: "triage", label: "Triage queue", description: "Resolve halted work", icon: <Icon name="alert" /> },
];

export function OperatorDashboard() {
  const [view, setView] = useState<View>("intake");

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">EX</div><div><strong>Emerald</strong><span>Event operations</span></div></div>
        <nav aria-label="Primary navigation">
          <span className="nav-label">Workspace</span>
          {navigation.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span className="nav-icon">{item.icon}</span><span><strong>{item.label}</strong><small>{item.description}</small></span>{item.id === "triage" && <b className="nav-count">1</b>}</button>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="environment-card"><span className="environment-dot" /><div><strong>Demo workspace</strong><small>Mock data · no Cvent writes</small></div></div>
        <div className="user-card"><div className="avatar">AM</div><div><strong>Alex Morgan</strong><span>Event operations</span></div><button aria-label="User menu">•••</button></div>
      </aside>

      <div className="workspace">
        <header className="topbar"><div className="breadcrumbs"><span>Event Operations</span><b>/</b><strong>{navigation.find((item) => item.id === view)?.label}</strong></div><div className="topbar-actions"><button className="icon-button" aria-label="Help">?</button><button className="icon-button notification" aria-label="Notifications"><Icon name="bell" /><span /></button></div></header>
        <main className="workspace-main">
          {view === "intake" && <IntakeForm seed={initialSpec} />}
          {view === "review" && <ReviewPage runs={runs} />}
          {view === "triage" && <TriageQueue runs={runs} />}
        </main>
      </div>
    </div>
  );
}

function Icon({ name }: { name: "document" | "check" | "alert" | "bell" }) {
  const paths = {
    document: <><path d="M7 3.5h7l3 3V20H7z"/><path d="M14 3.5V7h3M10 11h4M10 15h4"/></>,
    check: <><circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.3 2.4 4.8-5"/></>,
    alert: <><path d="M12 4 3.8 19h16.4z"/><path d="M12 9v4M12 16.3h.01"/></>,
    bell: <><path d="M7.5 10a4.5 4.5 0 0 1 9 0c0 5 2 5 2 6h-13c0-1 2-1 2-6Z"/><path d="M10 19h4"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
