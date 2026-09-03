import { compileEventDetails, type EventDetailInput } from "./event-details";
import { compileFooterLinks, compileRegistrationPaths, FOOTER_LINK_CONTRACT, type FooterLinkSourceRow, type RegistrationPathSourceRow } from "./footer-paths";
import { compileRegistrationCommerce } from "./registration-commerce";
import { compileDiscountsAndVouchers } from "./discounts-vouchers";
import { compileQuestionSemantics } from "./question-semantics";
import { previewRRDocument, type RRSheet } from "../../../src/intake/rrDocument";
import { legacyPreviewAssignments } from "../legacy-rr-converter";
import { normalizeEventSource } from "./event-source";
import { compileLegacyRegistration } from "./legacy-registration";
import { compileLegacyFooter } from "./legacy-footer";
import { compileLegacyQuestions } from "./legacy-questions";
export { compileFullRRToEventSpec } from "./event-spec-adapter";

export type FullRRCell = string | number | boolean | Date | null;
export interface FullRRSheet { name: string; rows: FullRRCell[][] }
export interface FullRRAssignment { sheet: string; cell: string; value: string | number | boolean; confidence: "exact" | "review"; source: string }
export interface FullRRCompilation {
  assignments: FullRRAssignment[];
  sections: { event: ReturnType<typeof compileEventDetails>; footer: ReturnType<typeof compileFooterLinks>; paths: ReturnType<typeof compileRegistrationPaths>; commerce: ReturnType<typeof compileRegistrationCommerce>; discounts: ReturnType<typeof compileDiscountsAndVouchers>; questions: ReturnType<typeof compileQuestionSemantics>; legacyEvent: ReturnType<typeof normalizeEventSource>; legacyRegistration: ReturnType<typeof compileLegacyRegistration>; legacyFooter: ReturnType<typeof compileLegacyFooter>; legacyQuestions: ReturnType<typeof compileLegacyQuestions> };
  summary: { contractFields: 107; coveredContractFields: number; destinationTabs: 9; assignedCells: number; reviewItems: number };
}

export function compileFullRR(sheets: FullRRSheet[]): FullRRCompilation {
  const eventSheet = findSheet(sheets, "1. Event Setup") ?? findSheet(sheets, "Event Details");
  const event = compileEventDetails(eventSheet ? eventInputs(eventSheet) : []);
  const footerSheet = findSheet(sheets, "2. Footer Links") ?? findSheet(sheets, "Helpful & Social Media Links");
  const footer = compileFooterLinks(footerSheet ? footerInputs(footerSheet) : []);
  const pathSheet = findSheet(sheets, "3. Reg Paths");
  const paths = compileRegistrationPaths(pathSheet ? pathInputs(pathSheet) : []);
  const commerce = compileRegistrationCommerce(sheets);
  const discounts = compileDiscountsAndVouchers(sheets);
  const questionSheet = findSheet(sheets, "9. Questions") ?? findSheet(sheets, "Show Questions");
  const questions = questionSheet ? compileQuestionSemantics({ sheetName: questionSheet.name, rows: questionSheet.rows }) : [];
  const legacyEvent = normalizeEventSource(sheets.flatMap((sheet) => sheet.rows.map((row, index) => ({ sheet: sheet.name, label: text(row[0]), value: eventAnswer(row[1]), source: `${sheet.name} row ${index + 1}` }))));
  const legacyRegistration = compileLegacyRegistration(sheets);
  const legacyFooterSheet = findSheet(sheets, "Helpful & Social Media Links");
  const legacyFooter = compileLegacyFooter(legacyFooterSheet ?? { name: "Helpful & Social Media Links", rows: [] });
  const legacyQuestionSheet = findSheet(sheets, "Show Questions");
  const legacyQuestions = compileLegacyQuestions({ sheetName: legacyQuestionSheet?.name ?? "Show Questions", rows: legacyQuestionSheet?.rows ?? [] });
  const assignments: FullRRAssignment[] = [];
  const add = (sheet: string, cell: string, value: unknown, source: string, confidence: "exact" | "review" = "exact") => {
    if (value === null || value === undefined || value === "") return;
    assignments.push({ sheet, cell, value: Array.isArray(value) ? value.join(", ") : value as string | number | boolean, source, confidence });
  };
  const legacyPreview = previewRRDocument(sheets as RRSheet[]);
  legacyPreviewAssignments(legacyPreview).forEach((item) => add(item.sheet, item.cell, item.value, item.source, item.confidence));
  add("1. Event Setup", "C5", event.value.existingEventName, "compiled event existing name", event.outcome);
  add("1. Event Setup", "C6", event.value.newEventName, "compiled event new name", event.outcome);
  add("1. Event Setup", "C7", event.value.displayName, "compiled event display name", event.outcome);
  add("1. Event Setup", "C8", event.value.venue?.name, "compiled venue name", event.outcome);
  add("1. Event Setup", "C9", event.value.venue?.city, "compiled venue city", event.outcome);
  add("1. Event Setup", "C10", event.value.venue?.state, "compiled venue state", event.outcome);
  add("1. Event Setup", "C13", event.value.expoDates?.start, "compiled expo start", event.outcome);
  add("1. Event Setup", "C14", event.value.expoDates?.end, "compiled expo end", event.outcome);
  add("1. Event Setup", "C15", event.value.conferenceDates?.start, "compiled conference start", event.outcome);
  add("1. Event Setup", "C16", event.value.conferenceDates?.end, "compiled conference end", event.outcome);
  footer.forEach((item) => { const index = FOOTER_LINK_CONTRACT.findIndex((field) => field.key === item.key); if (index >= 0) { add("2. Footer Links", `A${5 + index}`, item.include ? "Yes" : "No", item.sourceLabel, item.outcome === "exact" ? "exact" : "review"); add("2. Footer Links", `B${5 + index}`, item.destination, item.sourceLabel, item.outcome === "exact" ? "exact" : "review"); } });
  const pathNames = [...new Set(paths.map((item) => item.pathName))];
  pathNames.forEach((name, index) => { const fields = paths.filter((item) => item.pathName === name); const row = 8 + index; const value = (field: string) => fields.find((item) => item.sourceField === field)?.value; add("3. Reg Paths", `A${row}`, value("name") ?? name, "compiled path", "review"); add("3. Reg Paths", `B${row}`, value("privacy"), "compiled path privacy", "review"); add("3. Reg Paths", `C${row}`, value("status"), "compiled path status", "review"); add("3. Reg Paths", `D${row}`, value("redirectUrl"), "compiled path redirect"); });
  commerce.assignments.forEach((item) => add(item.sheet, item.cell, item.value, item.source, item.confidence));
  discounts.discounts.slice(0, 116).forEach((discount, index) => { const row = 8 + index; const values: unknown[] = [discount.name, discount.code, discount.method === "percent" ? "Percentage" : "Amount", discount.amount, discount.effectiveFrom, discount.effectiveTo, discount.capacity, discount.stackable, discount.usableBy, discount.countGuestsTowardCapacity, discount.active, discount.admissionItemCodes, discount.optionalItemCodes]; values.forEach((value, column) => add("7. Discounts", `${columnName(column + 1)}${row}`, value, `${discount.source.sheet} row ${discount.source.row}`, "review")); });
  discounts.vouchers.slice(0, 57).forEach((voucher, index) => { const row = 8 + index; [voucher.code, voucher.alertEmail, voucher.description, voucher.capacity].forEach((value, column) => add("8. Vouchers", `${columnName(column + 1)}${row}`, value, `${voucher.source.sheet} row ${voucher.source.row}`, "review")); });
  const reviewItems = event.review.length + footer.filter((item) => item.outcome !== "exact").length + paths.filter((item) => item.outcome !== "exact").length + commerce.warnings.length + discounts.discountOutcomes.filter((item) => item.status !== "compiled").length + Number(discounts.voucherOutcome.status !== "compiled") + Math.max(0, discounts.discounts.length - 116) + Math.max(0, discounts.vouchers.length - 57);
  const finalAssignments = dedupeAssignments(assignments);
  return { assignments: finalAssignments, sections: { event, footer, paths, commerce, discounts, questions, legacyEvent, legacyRegistration, legacyFooter, legacyQuestions }, summary: { contractFields: 107, coveredContractFields: countCoveredContractFields(finalAssignments), destinationTabs: 9, assignedCells: finalAssignments.length, reviewItems } };
}

function eventInputs(sheet: FullRRSheet): EventDetailInput[] {
  const modernHeader = sheet.rows.findIndex((row) => row.some((cell) => /question \(our form\)/i.test(text(cell))));
  if (modernHeader >= 0) {
    const header = sheet.rows[modernHeader].map(text); const q = header.findIndex((value) => /question \(our form\)/i.test(value)); const a = header.findIndex((value) => /your answer/i.test(value));
    return sheet.rows.slice(modernHeader + 1).map((row, index) => ({ question: text(row[q]), answer: eventAnswer(row[a]), source: `${sheet.name} row ${modernHeader + index + 2}` })).filter((row) => row.question);
  }
  return sheet.rows.map((row, index) => ({ question: text(row[0]), answer: eventAnswer(row[1]), source: `${sheet.name} row ${index + 1}` })).filter((row) => row.question);
}
function footerInputs(sheet: FullRRSheet): FooterLinkSourceRow[] {
  const headerIndex = sheet.rows.findIndex((row) => row.some((cell) => /footer link \(our form\)|footer options/i.test(text(cell))) && row.some((cell) => /include|visible/i.test(text(cell))));
  if (headerIndex < 0) return [];
  const header = sheet.rows[headerIndex].map((cell) => text(cell).toLowerCase());
  const label = header.findIndex((value) => /footer link|footer options/.test(value)); const include = header.findIndex((value) => /include|visible/.test(value)); const destination = header.findIndex((value) => /url|destination|provide link/.test(value));
  return sheet.rows.slice(headerIndex + 1).map((row) => ({ label: text(row[label]), include: text(row[include]), destination: text(row[destination]) })).filter((row) => row.label && !/for all/i.test(row.label));
}
function pathInputs(sheet: FullRRSheet): RegistrationPathSourceRow[] {
  const headerIndex = sheet.rows.findIndex((row) => row.some((cell) => /path name/i.test(text(cell)))); if (headerIndex < 0) return [];
  return sheet.rows.slice(Math.max(headerIndex + 2, 6)).map((row) => ({ name: text(row[0]), privacy: text(row[1]), status: text(row[2]), redirectUrl: text(row[3]) })).filter((row) => row.name && !isInstructionalRow(row.name));
}
function findSheet(sheets: FullRRSheet[], name: string): FullRRSheet | undefined { return sheets.find((sheet) => normalize(sheet.name) === normalize(name)); }
function eventAnswer(value: FullRRCell | undefined): string | number | Date | null | undefined { return typeof value === "boolean" ? String(value) : value; }
function text(value: FullRRCell | undefined): string { return value == null ? "" : value instanceof Date ? value.toISOString() : String(value).trim(); }
function normalize(value: string): string { return value.toLowerCase().replace(/\s+/g, " ").trim(); }
function isInstructionalRow(value: string): boolean { return /^(?:default:|column notes|->)|\|\s*(?:needs confirmation|confirmed|gap)/i.test(value.trim()); }
function columnName(index: number): string { let out = ""; for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) out = String.fromCharCode(65 + ((value - 1) % 26)) + out; return out; }
function dedupeAssignments(values: FullRRAssignment[]): FullRRAssignment[] { const map = new Map<string, FullRRAssignment>(); values.forEach((item) => map.set(`${item.sheet}!${item.cell}`, item)); return [...map.values()]; }
function countCoveredContractFields(values: FullRRAssignment[]): number { const keys = new Set<string>(); for (const item of values) { const match = /^([A-Z]+)(\d+)$/.exec(item.cell); if (!match) continue; if (["4. Reg Types", "5. Admission Items", "6. Pricing", "7. Discounts", "8. Vouchers", "9. Questions"].includes(item.sheet)) keys.add(`${item.sheet}:${match[1]}`); else if (item.sheet === "2. Footer Links") keys.add(`${item.sheet}:${match[2]}`); else if (item.sheet === "3. Reg Paths") keys.add(`${item.sheet}:${match[1]}`); else keys.add(`${item.sheet}:${item.cell}`); } return keys.size; }
