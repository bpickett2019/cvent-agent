import assert from "node:assert/strict";
import {
  compileQuestionSemantics,
  normalizeQuestionVisibility,
  type QuestionCell,
} from "./web/lib/compiler/question-semantics";

const authoritative: QuestionCell[][] = [
  ["9. REGISTRATION QUESTIONS"],
  ["instructions"],
  [],
  ["-> Question internal name", "-> Page displayed on", "-> Company or Individual", "-> Question Text (display)", "-> Question Appearance", "-> Answer options (code + text)", "-> Required to answer", "-> Which reg types see this", "-> Visible online", "-> Determines Reg Type?", "-> Trigger / conditional logic"],
  ["Internal name (Demo Name)", "Page displayed on", "Company or individual", "Question text (as displayed on the site)", "Question appearance", "Answer options - code | text, in display order", "Required to answer", "Which reg types see this (codes)", "Visible online", "Determines reg type? (if yes, name it)", "Trigger / conditional logic"],
  ["default"],
  ["EXAMPLE", "Show Questions", "Individual", "Template only", "Single select", "X | Example", "Yes", "ATT", "Visible on the site"],
  ["ROLE", "Show Questions", "Individual", "What is your role?", "Single select", "A01 | Architect ; A02 | Designer", "Yes", " ATTARCH, ATTDSN ", "Visible on the site", "Architect", "Show when CONSENT = Y | Yes"],
];

const compiled = compileQuestionSemantics({ sheetName: "9. Questions", rows: authoritative });
assert.equal(compiled.length, 1, "the first real authoritative question is Excel row 8");
assert.equal(compiled[0].sourceRow, 8);
assert.equal(compiled[0].questionText, "What is your role?");
assert.deepEqual(compiled[0].answers, [
  { code: "A01", text: "Architect" },
  { code: "A02", text: "Designer" },
]);
assert.deepEqual(compiled[0].visibility, {
  registrationTypeCodes: ["ATTARCH", "ATTDSN"],
  online: true,
});
assert.equal(compiled[0].determinesRegistrationType, "Architect");
assert.equal(compiled[0].trigger!.raw, "Show when CONSENT = Y | Yes");
assert.equal(compiled[0].trigger!.questionInternalName, "CONSENT");
assert.deepEqual(compiled[0].trigger!.answer, { code: "Y", text: "Yes" });
assert.ok(!("trigger" in compiled[0].visibility), "visibility stays separate from conditional logic");
assert.ok(!("determinesRegistrationType" in compiled[0].visibility), "visibility stays separate from reg-type determination");

assert.deepEqual(normalizeQuestionVisibility("All", "Hidden"), {
  registrationTypeCodes: [],
  online: false,
});

const legacy = compileQuestionSemantics({
  sheetName: "Show Questions",
  rows: [
    [null, "Page Displayed On", "Demo Name", "Company or Individual", "Question Text", "Answer Code", "Answer Text", "Question Appearance", "Required for Registrant to answer", "List Reg Types that see this."],
    [null, "Profile", "ROLE", "Individual", "What is your role?", "A01", "Architect", "Single Select Radio", "Yes", "ATTARCH"],
    [null, null, null, null, null, "A02", "Designer", null, null, null],
  ],
});
assert.equal(legacy.length, 1);
assert.equal(legacy[0].sourceRow, 2);
assert.equal(legacy[0].questionText, "What is your role?");
assert.deepEqual(legacy[0].answers, [
  { code: "A01", text: "Architect" },
  { code: "A02", text: "Designer" },
]);
assert.deepEqual(legacy[0].visibility, { registrationTypeCodes: ["ATTARCH"], online: null });
assert.equal(legacy[0].trigger, null);
assert.equal(legacy[0].determinesRegistrationType, null);

console.log("question semantics smoke passed");
