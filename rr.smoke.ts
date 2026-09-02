/** RR allowlist and deterministic preview checks. No model or network. */

import { previewRRDocument, type RRSheet } from "./src/intake/rrDocument";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const sheets: RRSheet[] = [
  {
    name: "Event Details",
    rows: [
      [null, "Event Name", "Emerald Test Expo"],
      [null, "Event Location", "Denver Convention Center"],
      [null, "Time Zone for Event Location", "Mountain (US & Canada)"],
      [null, "Expo Hall Dates", "September 2 - 4, 2027"],
    ],
  },
  {
    name: "NEW REG MAPPING",
    rows: [
      [null, "OLD - Reg Type", "NEW - Reg Type", "New Reg Codes"],
      [null, "Attendee", "Attendee|Member", "ATTMEM"],
      [null, "Exhibitor", "Exhibitor/Sponsor", "EXHIB"],
    ],
  },
  {
    name: "Show Questions",
    rows: [
      [null, "Page Displayed On", "Demo Name", "Company or Individual", "Question Text", "Answer Code", "Answer Text", "Question Appearance", "Required for Registrant to answer", "List Reg Types that see this."],
      [null, "Profile", "ROLE", "Individual", "What is your role?", "A", "Buyer", "Single Select Radio", "Yes", "ATTMEM"],
      [null, null, null, null, null, "B", "Designer", null, null, null],
    ],
  },
  {
    name: "Access & Reports",
    rows: [[null, "Person Name", "person@example.com"]],
  },
];

const preview = previewRRDocument(sheets);
check("event details extracted", preview.event.name === "Emerald Test Expo");
check("registration mappings extracted", preview.registrationTypes.length === 2 && preview.registrationTypes[0].code === "ATTMEM");
const modernLegacyPreview = previewRRDocument([
  { name: "Registration Types & Pricing", rows: [["Reg Type Code", "Price"], ["ATT", 100]] },
  {
    name: "NEW Reg Types & Pricing",
    rows: [
      ["OLD REG TYPE", "NEW REG CODE", "NEW REG TYPE NAME", "ACTIVATE / NOT NEEDED"],
      ["Architect", "ATTARCH", "Attendee|Architect", "ACTIVATE"],
    ],
  },
]);
check("modern legacy registration sheet is recognized", modernLegacyPreview.registrationTypes[0]?.code === "ATTARCH");
const newFormatPreview = previewRRDocument([
  { name: "1. Event Setup", rows: [["Section", "Question (our form)", "YOUR ANSWER"], ["A", "Existing event name (template the agent copies)", "New Format Expo"]] },
  { name: "4. Reg Types", rows: [["-> Reg Type Code (new)", "-> Registration Pass Description", "-> Reg Type Name"], ["Reg type code (NEW)", "Registration pass description", "Reg type name"], ["ATTARCH", "Architect pass", "Attendee - Architect"]] },
  { name: "9. Questions", rows: [["-> Question internal name", "-> Page displayed on", "-> Company or Individual", "-> Question Text (display)", "-> Question Appearance", "-> Answer options (code + text)", "-> Required to answer", "-> Which reg types see this"], ["Internal name (Demo Name)", "Page displayed on", "Company or individual", "Question text (as displayed on the site)", "Question appearance", "Answer options - code | text, in display order", "Required to answer", "Which reg types see this (codes)"], ["ROLE", "Show Questions", "Individual", "What is your role?", "Single select", "Buyer ; Designer", "Yes", "ATTARCH"]] },
]);
check("new-format event setup is recognized", newFormatPreview.event.name === "New Format Expo");
check("new-format registration types are recognized", newFormatPreview.registrationTypes[0]?.code === "ATTARCH");
check("new-format questions are recognized", newFormatPreview.questions[0]?.key === "role" && newFormatPreview.questions[0]?.answerValues.join("|") === "Buyer|Designer" && newFormatPreview.questions[0]?.required === true);
check("question extracted", preview.questions.length === 1 && preview.questions[0].key === "role");
check("answer continuation rows grouped", preview.questions[0].answerValues.join("|") === "Buyer|Designer");
check("answer type normalized", preview.questions[0].answerType === "singleSelect");
check("personnel sheet is excluded", preview.ignoredSheets.includes("Access & Reports") && !JSON.stringify(preview).includes("person@example.com"));
check("preview cannot silently execute", preview.warnings.some((warning) => warning.includes("cannot execute")));

console.log(`\n${failures === 0 ? `ALL RR CHECKS PASSED (${checks} checks)` : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
