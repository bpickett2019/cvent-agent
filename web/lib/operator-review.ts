import type { FullRRCompilation } from "./compiler/full-rr";

export const TEMPLATE_ROW_CAPS = {
  registrationTypes: 57,
  admissionItems: 57,
  discounts: 116,
  vouchers: 57,
  questions: 116,
} as const;

export type ReviewStatus = "exact" | "review" | "missing" | "unsupported" | "overflow";
export interface ReviewCounts { exact: number; review: number; missing: number; unsupported: number; overflow: number }
export interface OperatorReviewIssue {
  section: string;
  path: string;
  label: string;
  status: Exclude<ReviewStatus, "exact">;
  required: boolean;
  message: string;
}
export interface OperatorReviewSection { counts: ReviewCounts; rowCount?: number; rowCap?: number }
export interface OperatorReview {
  sections: Record<string, OperatorReviewSection>;
  issues: OperatorReviewIssue[];
  unresolvedRequired: number;
  canProceed: boolean;
}

const SECTION_SHEETS: Record<string, string[]> = {
  event: ["1. Event Setup"], footer: ["2. Footer Links"], paths: ["3. Reg Paths"],
  registrationTypes: ["4. Reg Types"], admissionItems: ["5. Admission Items", "6. Pricing"],
  discounts: ["7. Discounts"], vouchers: ["8. Vouchers"], questions: ["9. Questions"],
};

export function buildOperatorReview(compiled: FullRRCompilation): OperatorReview {
  const sections: Record<string, OperatorReviewSection> = {};
  for (const [section, sheets] of Object.entries(SECTION_SHEETS)) {
    const assignments = compiled.assignments.filter((item) => sheets.includes(item.sheet));
    sections[section] = { counts: counts({ exact: assignments.filter((item) => item.confidence === "exact").length, review: assignments.filter((item) => item.confidence === "review").length }) };
  }
  const issues: OperatorReviewIssue[] = [];
  const add = (issue: OperatorReviewIssue) => { issues.push(issue); sections[issue.section].counts[issue.status] += 1; };
  const collection = (section: keyof typeof TEMPLATE_ROW_CAPS, values: unknown[]) => {
    const cap = TEMPLATE_ROW_CAPS[section];
    sections[section].rowCount = values.length;
    sections[section].rowCap = cap;
    const overflow = Math.max(0, values.length - cap);
    for (let index = 0; index < overflow; index += 1) add({ section, path: `${section}.${cap + index}`, label: `${section} row ${cap + index + 1}`, status: "overflow", required: true, message: `Template supports ${cap} ${section} rows; row ${cap + index + 1} is preserved but cannot be applied.` });
  };
  const commerce = compiled.sections.commerce;
  const admissionItems = commerce.admissionItems.length ? commerce.admissionItems : compiled.sections.legacyRegistration?.admissionItems ?? [];
  const questions = compiled.sections.legacyQuestions?.length ? compiled.sections.legacyQuestions : compiled.sections.questions;
  collection("registrationTypes", commerce.registrationTypes);
  collection("admissionItems", admissionItems);
  collection("discounts", compiled.sections.discounts.discounts);
  collection("vouchers", compiled.sections.discounts.vouchers);
  collection("questions", questions);

  requiredStrings(add, "registrationTypes", commerce.registrationTypes, ["code", "name"]);
  requiredStrings(add, "admissionItems", admissionItems, ["code", "name"]);
  requiredStrings(add, "discounts", compiled.sections.discounts.discounts, ["code", "name"]);
  requiredStrings(add, "vouchers", compiled.sections.discounts.vouchers, ["code"]);
  requiredStrings(add, "questions", questions, ["internalName"]);
  optionalStrings(add, "registrationTypes", commerce.registrationTypes, ["description"]);
  optionalStrings(add, "admissionItems", admissionItems, ["description"]);
  optionalStrings(add, "vouchers", compiled.sections.discounts.vouchers, ["alertEmail", "description"]);
  for (const item of compiled.sections.footer) {
    if (item.outcome === "unsupported") add({ section: "footer", path: `footer.${item.key}.destination`, label: `${item.sourceLabel} destination`, status: "unsupported", required: false, message: "This optional footer value is not supported and will not be applied." });
  }
  const unresolvedRequired = issues.filter((issue) => issue.required).length;
  return { sections, issues, unresolvedRequired, canProceed: unresolvedRequired === 0 };
}

export function canProceedWithReview(review: Pick<OperatorReview, "issues">): boolean {
  return !review.issues.some((issue) => issue.required);
}

function requiredStrings(add: (issue: OperatorReviewIssue) => void, section: string, values: unknown[], fields: string[]): void {
  values.forEach((value, index) => fields.forEach((field) => {
    const record = value as Record<string, unknown>;
    if (typeof record?.[field] === "string" && record[field].trim()) return;
    add({ section, path: `${section}.${index}.${field}`, label: `${section} row ${index + 1} ${field}`, status: "missing", required: true, message: `Required value ${field} is genuinely absent.` });
  }));
}

function optionalStrings(add: (issue: OperatorReviewIssue) => void, section: string, values: unknown[], fields: string[]): void {
  values.forEach((value, index) => fields.forEach((field) => {
    const record = value as Record<string, unknown>;
    if (typeof record?.[field] === "string" && record[field].trim()) return;
    add({ section, path: `${section}.${index}.${field}`, label: `${section} row ${index + 1} ${field}`, status: "missing", required: false, message: `Optional value ${field} is genuinely absent; no default was inferred.` });
  }));
}

function counts(seed: Partial<ReviewCounts> = {}): ReviewCounts {
  return { exact: seed.exact ?? 0, review: seed.review ?? 0, missing: 0, unsupported: 0, overflow: 0 };
}
