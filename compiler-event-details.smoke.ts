/** Deterministic event-details compiler checks. No workbook writes, model, network, or Cvent. */
import { compileEventDetails, type EventDetailInput } from "./web/lib/compiler/event-details";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const templateRows: EventDetailInput[] = [
  { question: "Existing event name (template the agent copies)", answer: "BDNY 2025", source: "1. Event Setup!C4" },
  { question: "New event name", answer: "BDNY 2026", source: "1. Event Setup!C5" },
  { question: "Display / short name", answer: "BDNY 2026", source: "1. Event Setup!C6" },
  { question: "Venue name", answer: "Jacob K. Javits Convention Center", source: "1. Event Setup!C7" },
  { question: "City", answer: "New York", source: "1. Event Setup!C8" },
  { question: "State", answer: "NY", source: "1. Event Setup!C9" },
  { question: "Expo hall dates - START", answer: "November 8, 2026", source: "1. Event Setup!C12" },
  { question: "Expo hall dates - END", answer: "November 9, 2026", source: "1. Event Setup!C13" },
  { question: "Conference dates - START", answer: "2026-11-07", source: "1. Event Setup!C14" },
  { question: "Conference dates - END", answer: "2026-11-09", source: "1. Event Setup!C15" },
];
const compiled = compileEventDetails(templateRows);
check("existing and new event names remain distinct", compiled.value.existingEventName === "BDNY 2025" && compiled.value.newEventName === "BDNY 2026");
check("venue is structured", compiled.value.venue?.name === "Jacob K. Javits Convention Center" && compiled.value.venue.city === "New York" && compiled.value.venue.state === "NY");
check("expo start and end normalize separately", compiled.value.expoDates?.start === "2026-11-08" && compiled.value.expoDates.end === "2026-11-09");
check("conference start and end normalize separately", compiled.value.conferenceDates?.start === "2026-11-07" && compiled.value.conferenceDates.end === "2026-11-09");
check("complete authoritative-template values are exact", compiled.outcome === "exact" && compiled.review.length === 0);
check("compiler output is preview-only", compiled.safeToExecute === false);

const legacy = compileEventDetails([
  { question: "Event Name", answer: "BDNY 2026", source: "Event Details!B10" },
  { question: "Event Location", answer: "Javits Convention Center, NYC", source: "Event Details!B11" },
  { question: "Event Dates", answer: "November 8-9, 2026", source: "Event Details!B18" },
]);
check("legacy event name is not guessed as existing template name", legacy.value.newEventName === "BDNY 2026" && legacy.value.existingEventName === null);
check("legacy combined venue is retained but requires structured review", legacy.value.venue === null && legacy.review.some((item) => item.code === "combined-venue"));
check("legacy combined event dates normalize to expo bounds", legacy.value.expoDates?.start === "2026-11-08" && legacy.value.expoDates.end === "2026-11-09");
check("legacy inference produces review outcome", legacy.outcome === "review");

const invalid = compileEventDetails([
  { question: "New event name", answer: "Unsafe Date Expo" },
  { question: "Expo hall dates - START", answer: "next Friday" },
  { question: "Expo hall dates - END", answer: "2026-04-01" },
]);
check("ambiguous dates are never guessed", invalid.value.expoDates === null && invalid.review.some((item) => item.code === "invalid-date"));
check("reversed date ranges require review", compileEventDetails([
  { question: "Expo hall dates - START", answer: "2026-11-10" },
  { question: "Expo hall dates - END", answer: "2026-11-09" },
]).review.some((item) => item.code === "reversed-range"));

console.log(`\n${failures === 0 ? `ALL EVENT DETAILS CHECKS PASSED (${checks} checks)` : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
