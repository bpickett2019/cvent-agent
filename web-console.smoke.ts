import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mergeRRPreview } from "./web/lib/rr-normalize";
import { legacyPreviewAssignments } from "./web/lib/legacy-rr-converter";
import { initialSpec } from "./web/lib/fixtures";

const preview = {
  event: { name: "(C+D) Medtrade Testing Clone 2", location: "Phoenix Convention Center", timezoneSource: "Mountain", expoDatesSource: null, conferenceDatesSource: null, themeSource: null },
  registrationTypes: [{ key: "attendee-new", name: "Attendee- New", code: "Attendee- New" }],
  questions: [{ key: "mock-e2e", text: "Mock question", answerType: "text" }],
  recognizedSheets: ["Event Intake"], ignoredSheets: [], warnings: [],
};
const merged = mergeRRPreview(initialSpec, preview);
assert.equal(merged.details.name, "(C+D) Medtrade Testing Clone 2");
assert.equal(merged.details.venue?.name, "Phoenix Convention Center");
assert.equal(merged.registrationTypes[0]?.name, "Attendee- New");
assert.equal(merged.questions[0]?.text, "Mock question");
const assignments = legacyPreviewAssignments(preview);
assert.deepEqual(assignments.find((item) => item.sheet === "1. Event Setup" && item.cell === "C6")?.value, "(C+D) Medtrade Testing Clone 2");
assert.deepEqual(assignments.find((item) => item.sheet === "4. Reg Types" && item.cell === "A8")?.value, "Attendee- New");
assert.deepEqual(assignments.find((item) => item.sheet === "9. Questions" && item.cell === "D8")?.value, "Mock question");
assert.deepEqual(assignments.find((item) => item.sheet === "9. Questions" && item.cell === "H8")?.value, undefined);

const workspaceComponent = await readFile("web/components/agent-workspaces.tsx", "utf8");
assert.match(workspaceComponent, /workspace-browser-grid/);
assert.match(workspaceComponent, /Workspaces appear automatically when an AI agent is deployed/);
assert.match(workspaceComponent, /thumbnail/);
assert.match(workspaceComponent, /Agent activity/);
assert.match(workspaceComponent, /workspace-activity-list/);
assert.match(workspaceComponent, /workspace-preview-state/);
assert.match(workspaceComponent, /Login required/);
assert.match(workspaceComponent, /Use login for this document/);
assert.match(workspaceComponent, /12 per document · 36 global/);
assert.match(workspaceComponent, /recentTerminal/);
assert.match(workspaceComponent, /Workspace released; task result is retained separately/);
assert.match(workspaceComponent, /<img/);
const monitor = await readFile("web/components/run-monitor.tsx", "utf8");
assert.match(monitor, /Steel live viewer/i);
assert.match(monitor, /AgentWorkspaces/);
assert.match(monitor, /Back to workspaces/);
assert.match(monitor, /workspace-focus-view/);
assert.match(monitor, /iframe/i);
assert.match(monitor, /Cancel run/);
const dashboard = await readFile("web/components/operator-dashboard.tsx", "utf8");
const rrImport = await readFile("web/components/rr-document-import.tsx", "utf8");
const operatorReviewSummary = await readFile("web/components/operator-review-summary.tsx", "utf8");
const globalStyles = await readFile("web/app/globals.css", "utf8");
const intakeForm = await readFile("web/components/intake-form.tsx", "utf8");
const reviewPage = await readFile("web/components/review-page.tsx", "utf8");
const triageQueue = await readFile("web/components/triage-queue.tsx", "utf8");
assert.match(reviewPage, /Demo data/);
assert.match(triageQueue, /Demo data/);
const golden = await readFile("web/components/golden-login.tsx", "utf8");
const jobsRoute = await readFile("web/app/api/jobs/route.ts", "utf8");
assert.match(dashboard, /GoldenLogin/);
assert.match(golden, /Default Cvent login/i);
assert.match(golden, /document team receives an isolated copy/i);
assert.match(golden, /createPortal/);
assert.match(golden, /role="dialog"/);
assert.match(golden, /aria-modal="true"/);
assert.match(jobsRoute, /startLocalWorker/);
assert.match(rrImport, /onApply\(result\.normalizedSpec\)/);
assert.ok(rrImport.indexOf("rr-convert-actions") < rrImport.indexOf("<OperatorReviewSummary"), "post-upload actions must appear before the detailed review");
assert.match(operatorReviewSummary, /<details className="operator-review-details"/);
assert.match(operatorReviewSummary, /const flaggedIssues = review\.issues\.length/);
assert.match(globalStyles, /\.operator-review\s*\{/);
assert.match(globalStyles, /\.rr-next-step\s*\{/);
assert.match(intakeForm, /applyNormalizedSpec/);
assert.doesNotMatch(intakeForm, /mergeRRPreview/);
assert.match(intakeForm, /copyTemplate/);
assert.match(intakeForm, /Copy approved template/);
assert.match(intakeForm, /e712e34c-6117-4d13-bf4c-8ed54cf2b495/);
assert.match(intakeForm, /rrApplied/);
assert.match(intakeForm, /Upload and apply an RR workbook/);
assert.match(intakeForm, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/, "green intake actions advance to the next section");
assert.match(dashboard, /onQueued=.*setView\("monitor"\)/, "queued intake advances to agent monitor");
assert.doesNotMatch(dashboard, /onRunComplete=.*setView\("review"\)/, "run monitor must not auto-navigate into fixture review data");
assert.match(dashboard, /onDecisionComplete=.*setView\("triage"\)/, "completed review advances to triage");
console.log("web console smoke passed");
