import assert from "node:assert/strict";
import { compileFullRR } from "./web/lib/compiler/full-rr";
import { compileFullRRToEventSpec } from "./web/lib/compiler/event-spec-adapter";
import { EventSpec } from "./src/spec/eventSpec";

const compiled = compileFullRR([
  { name: "Event Details", rows: [["Event Name", "Test"], ["Event Location", "Javits Convention Center, New York, NY"], ["Expo Hall Dates", "November 8, 2026 10:00 AM - November 9, 2026 5:00 PM"]] },
  { name: "Helpful & Social Media Links", rows: [["Footer Options - Attendee/Press"], ["Footer Options", "Visible?", "Provide Link Here"], ["Show Hours", "Yes", "https://example.com/hours"]] },
  { name: "Show Questions", rows: [["Demo Name", "Question Text", "Answer Code", "Answer Text", "Required for Registrant to answer", "List Reg Types that see this.", "Trigger Question?", "Notes"], ["ROLE", "Role?", "A", "Architect", "Yes", "ATT", "Yes", "Show when CONSENT = Y"]] },
]);
assert.equal(compiled.sections.legacyEvent.value.venue?.city, "New York");
assert.equal(compiled.sections.legacyEvent.value.expo?.start, "2026-11-08T10:00:00");
assert.equal(compiled.sections.legacyFooter.links[0]?.key, "show-hours");
assert.equal(compiled.sections.legacyQuestions[0]?.required.value, true);
assert.ok(compiled.sections.legacyRegistration);
const seed = EventSpec.parse({ specVersion: "1.0", details: { name: "Seed", timezone: "America/New_York", start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z", format: "inPerson" }, registration: {} });
const spec = compileFullRRToEventSpec(seed, compiled);
assert.equal(spec.details.venue?.city, "New York");
assert.equal(spec.questions[0]?.required, true);
console.log("full RR legacy integration smoke passed");
