import assert from "node:assert/strict";
import { buildOperatorReview, canProceedWithReview, TEMPLATE_ROW_CAPS } from "./web/lib/operator-review";
import type { FullRRCompilation } from "./web/lib/compiler/full-rr";

const rows = <T>(count: number, make: (index: number) => T) => Array.from({ length: count }, (_, index) => make(index));
const compiled = {
  assignments: [
    { sheet: "1. Event Setup", cell: "C6", value: "Event", confidence: "exact", source: "event" },
    { sheet: "1. Event Setup", cell: "C8", value: "Venue", confidence: "review", source: "venue" },
  ],
  sections: {
    event: { value: { newEventName: "Event" }, outcome: "review", review: [], sources: {} },
    footer: [{ key: "privacy", sourceLabel: "Privacy", include: true, destination: "", outcome: "unsupported" }],
    paths: [],
    commerce: {
      registrationTypes: rows(TEMPLATE_ROW_CAPS.registrationTypes + 1, (index) => ({ code: `R${index}`, name: index === 0 ? "" : `Type ${index}` })),
      admissionItems: rows(TEMPLATE_ROW_CAPS.admissionItems, (index) => ({ code: `A${index}`, name: `Admission ${index}` })),
      assignments: [], warnings: [], pricing: { tiers: [] },
    },
    discounts: {
      discounts: rows(TEMPLATE_ROW_CAPS.discounts + 2, (index) => ({ code: `D${index}`, name: `Discount ${index}` })),
      vouchers: rows(TEMPLATE_ROW_CAPS.vouchers, (index) => ({ code: `V${index}` })),
      discountOutcomes: [], voucherOutcome: { status: "compiled" },
    },
    questions: rows(TEMPLATE_ROW_CAPS.questions + 3, (index) => ({ internalName: index === 0 ? "" : `q-${index}` })),
  },
  summary: { contractFields: 107, coveredContractFields: 1, destinationTabs: 9, assignedCells: 2, reviewItems: 0 },
} as unknown as FullRRCompilation;

const review = buildOperatorReview(compiled);
assert.equal(review.sections.event.counts.exact, 1);
assert.equal(review.sections.event.counts.review, 1);
assert.equal(review.sections.footer.counts.unsupported, 1);
assert.ok(review.sections.registrationTypes.counts.missing > 1, "required and optional absent values are both counted as missing");
assert.equal(review.sections.registrationTypes.counts.overflow, 1);
assert.equal(review.sections.discounts.counts.overflow, 2);
assert.equal(review.sections.questions.counts.overflow, 3);
assert.equal(review.sections.admissionItems.counts.overflow, 0);
assert.equal(review.issues.find((issue) => issue.path === "registrationTypes.0.name")?.required, true);
assert.equal(review.issues.find((issue) => issue.path === "registrationTypes.0.description")?.required, false);
assert.equal(review.issues.find((issue) => issue.path === "footer.privacy.destination")?.required, false);
assert.equal(canProceedWithReview(review), false, "required missing and overflow issues block");
const optionalOnly = { ...review, issues: review.issues.filter((issue) => !issue.required) };
assert.equal(canProceedWithReview(optionalOnly), true, "optional review and unsupported values do not block");
assert.equal(compiled.sections.commerce.registrationTypes.length, TEMPLATE_ROW_CAPS.registrationTypes + 1, "review must never truncate source rows");
console.log("operator review smoke passed");
