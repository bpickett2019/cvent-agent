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
assert.deepEqual(assignments.find((item) => item.sheet === "1. Event Setup" && item.cell === "C5")?.value, "(C+D) Medtrade Testing Clone 2");
assert.deepEqual(assignments.find((item) => item.sheet === "4. Reg Types" && item.cell === "A7")?.value, "Attendee- New");
assert.deepEqual(assignments.find((item) => item.sheet === "9. Questions" && item.cell === "D7")?.value, "Mock question");

const monitor = await readFile("web/components/run-monitor.tsx", "utf8");
assert.match(monitor, /Steel live viewer/i);
assert.match(monitor, /iframe/i);
assert.match(monitor, /Cancel run/);
const dashboard = await readFile("web/components/operator-dashboard.tsx", "utf8");
const golden = await readFile("web/components/golden-login.tsx", "utf8");
assert.match(dashboard, /GoldenLogin/);
assert.match(golden, /Golden Cvent login/i);
console.log("web console smoke passed");
