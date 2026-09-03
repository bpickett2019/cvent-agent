/** Event-source normalization checks using BDNY-shaped legacy rows and synthetic edges. */
import { normalizeEventSource, type EventSourceRow } from "./web/lib/compiler/event-source";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const bdnyLegacy: EventSourceRow[] = [
  { sheet: "Event Details ", label: "Existing Event Name", value: "BDNY 2025", source: "Event Details!C5" },
  { sheet: "Event Details ", label: "New Event Name", value: "BDNY 2026", source: "Event Details!C6" },
  { sheet: "Event Details ", label: "Event Location", value: "Jacob K. Javits Convention Center, New York, NY", source: "Event Details!C8" },
  { sheet: "Event Details ", label: "Expo Hall Dates", value: "November 8, 2026 10:00 AM - November 9, 2026 5:00 PM", source: "Event Details!C13" },
  { sheet: "Event Details ", label: "Conference Dates", value: "November 7, 2026, 8:30 AM – November 9, 2026, 4:15 PM", source: "Event Details!C15" },
];
const bdny = normalizeEventSource(bdnyLegacy);
check("legacy sheet alias is accepted despite spacing", bdny.value.newEventName === "BDNY 2026" && bdny.value.existingEventName === "BDNY 2025");
check("BDNY combined location becomes structured venue", bdny.value.venue?.name === "Jacob K. Javits Convention Center" && bdny.value.venue.city === "New York" && bdny.value.venue.state === "NY");
check("expo date and time range is complete", bdny.value.expo?.start === "2026-11-08T10:00:00" && bdny.value.expo.end === "2026-11-09T17:00:00");
check("conference date and time range is complete", bdny.value.conference?.start === "2026-11-07T08:30:00" && bdny.value.conference.end === "2026-11-09T16:15:00");
check("deterministic BDNY source needs no review", bdny.outcome === "exact" && bdny.review.length === 0 && bdny.safeToExecute === false);

const aliases = normalizeEventSource([
  { sheet: "1 - Event Setup", label: "Event Name", value: "Alias Expo" },
  { sheet: "1 - Event Setup", label: "Location", value: "Mandalay Bay Convention Center | Las Vegas, NV" },
  { sheet: "1 - Event Setup", label: "Expo Dates/Times", value: "Sep 2-4, 2027; 9 AM - 6:30 PM" },
  { sheet: "1 - Event Setup", label: "Conference Date & Time", value: "09/01/2027 1:05 PM to 09/04/2027 11:45 AM" },
]);
check("legacy labels map to canonical fields", aliases.value.newEventName === "Alias Expo");
check("pipe and city-state location parses", aliases.value.venue?.name === "Mandalay Bay Convention Center" && aliases.value.venue.city === "Las Vegas" && aliases.value.venue.state === "NV");
check("shared-time shorthand applies times to both expo bounds", aliases.value.expo?.start === "2027-09-02T09:00:00" && aliases.value.expo.end === "2027-09-04T18:30:00");
check("numeric conference range parses without locale guessing", aliases.value.conference?.start === "2027-09-01T13:05:00" && aliases.value.conference.end === "2027-09-04T11:45:00");

const unsafe = normalizeEventSource([
  { sheet: "Event Details", label: "Event Location", value: "Javits Center, NYC" },
  { sheet: "Event Details", label: "Expo Hall Dates", value: "next weekend, morning to evening" },
]);
check("ambiguous location is retained for review", unsafe.value.venue === null && unsafe.review.some((item) => item.code === "invalid-venue"));
check("ambiguous dates are not guessed", unsafe.value.expo === null && unsafe.review.some((item) => item.code === "invalid-range"));

console.log(`\n${failures === 0 ? `ALL EVENT SOURCE CHECKS PASSED (${checks} checks)` : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
