import type { RRNormalizedPreview } from "./rr-normalize";

export interface WorkbookAssignment { sheet: string; cell: string; value: string | number | boolean; source: string; confidence: "exact" | "review" }

export function legacyPreviewAssignments(preview: RRNormalizedPreview): WorkbookAssignment[] {
  const output: WorkbookAssignment[] = [];
  const add = (sheet: string, cell: string, value: unknown, source: string, confidence: WorkbookAssignment["confidence"] = "exact") => {
    if (value === null || value === undefined || value === "") return;
    output.push({ sheet, cell, value: value as string | number | boolean, source, confidence });
  };
  add("1. Event Setup", "C6", preview.event.name, "legacy Event Details > New Event Name");
  add("1. Event Setup", "C8", preview.event.location, "legacy Event Details > Event Location", "review");
  add("1. Event Setup", "C11", normalizeTimezone(preview.event.timezoneSource), "legacy Event Details > Time Zone", "review");
  add("1. Event Setup", "C13", preview.event.expoDatesSource, "legacy Event Details > Expo Hall Dates", "review");
  add("1. Event Setup", "C15", preview.event.conferenceDatesSource, "legacy Event Details > Conference Dates", "review");
  add("1. Event Setup", "C21", preview.event.themeSource, "legacy Event Details > Event Theme", "review");

  preview.registrationTypes.slice(0, 50).forEach((type, index) => {
    const row = 8 + index;
    add("4. Reg Types", `A${row}`, type.code, "legacy NEW REG MAPPING > Reg Type Code");
    add("4. Reg Types", `C${row}`, type.name, "legacy NEW REG MAPPING > Reg Type Name");
    add("4. Reg Types", `D${row}`, classifyRegistrationType(type.name), "derived from legacy Reg Type Name", "review");
  });

  preview.questions.slice(0, 100).forEach((question, index) => {
    const row = 8 + index;
    add("9. Questions", `A${row}`, question.key.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20), "legacy Show Questions > Demo Name");
    add("9. Questions", `B${row}`, (question.page ?? "personal-information") === "personal-information" ? "Profile" : "Show Questions", "legacy Show Questions > Page Displayed On");
    add("9. Questions", `C${row}`, "Individual - every registrant answers", "conversion default", "review");
    add("9. Questions", `D${row}`, question.text, "legacy Show Questions > Question Text");
    add("9. Questions", `E${row}`, appearance(question.answerType), "legacy Show Questions > Question Appearance");
    add("9. Questions", `F${row}`, (question.answerValues ?? []).join(" ; "), "legacy Show Questions > Answer Text");
    add("9. Questions", `G${row}`, question.required ? "Yes" : "No", "legacy Show Questions > Required");
    add("9. Questions", `I${row}`, "Visible on the site", "conversion default", "review");
    add("9. Questions", `H${row}`, question.visibilitySource ?? "", "legacy Show Questions > Registration Type Visibility", "review");
  });
  return output;
}

function normalizeTimezone(value: string | null): string | null {
  if (!value) return null;
  if (/eastern|\bet\b/i.test(value)) return "Eastern (ET)";
  if (/central|\bct\b/i.test(value)) return "Central (CT)";
  if (/mountain|\bmt\b/i.test(value)) return "Mountain (MT)";
  if (/pacific|\bpt\b/i.test(value)) return "Pacific (PT)";
  return value;
}
function classifyRegistrationType(name: string): string {
  if (/exhibitor/i.test(name)) return "Exhibitor";
  if (/internal|staff/i.test(name)) return "Internal";
  if (/pre.?approved/i.test(name)) return "Attendee - pre-approved";
  return "Attendee";
}
function appearance(value: string): string {
  if (value === "singleSelect") return "Single select";
  if (value === "multiSelect") return "Multi-select";
  return "Free text";
}
