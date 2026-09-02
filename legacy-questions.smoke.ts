import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { compileLegacyQuestions, type LegacyQuestionCell } from "./web/lib/compiler/legacy-questions";

const rows: LegacyQuestionCell[][] = [
  ["Page Displayed On", "Demo Name", "Company or Individual", "Question Text", "Answer Code", "Answer Text", "Question Appearance", "Required for Registrant to answer", "List Reg Types that see this.", "Does this determine Reg Type? If so, list corresponding reg type.", "Trigger Question?", "Notes"],
  ["Profile", "PARENT", "Individual", "Choose", null, null, "Single Select", "Y", "ATT, SPKR", "Yes", "YES", "If respondent answers A: Alpha, ask FOLLOW"],
  [null, null, null, null, "A", "Alpha", null, null, null, "ATT", null, null],
  [null, null, null, null, "B", "Beta", null, null, null, "NONEX", null, null],
  ["Profile", "FOLLOW", "Individual", "Why?", null, null, "Free Text", "sometimes", "Only ask if PARENT = A", "No", "No", "Show when PARENT = A | Alpha"],
  ["Profile", "MISSING", "Individual", "Optional?", null, null, "Free Text", null, null, null, null, null],
];

const result = compileLegacyQuestions({ sheetName: "Show Questions", rows });
assert.equal(result.length, 3);
const parent = result[0];
assert.deepEqual(parent.required, { value: true, status: "explicit", raw: "Y", provenance: { sheet: "Show Questions", row: 2, column: 8, header: "Required for Registrant to answer" } });
assert.deepEqual(parent.visibility.registrationTypeCodes, ["ATT", "SPKR"]);
assert.equal(parent.visibility.registrationTypesStatus, "explicit");
assert.equal(parent.visibility.online, null);
assert.equal(parent.visibility.onlineStatus, "missing");
assert.deepEqual(parent.registrationTypeOutcomes.map(x => [x.answer.code, x.answer.text, x.registrationType]), [["A", "Alpha", "ATT"], ["B", "Beta", "NONEX"]]);
assert.equal(parent.determinesRegistrationType.value, true);
assert.equal(parent.triggers.length, 2, "trigger flag and Notes rule are both retained");
assert.equal(parent.triggers[1].source, "notes");
assert.equal(parent.triggers[1].referencedQuestion, "PARENT");
assert.equal(parent.triggers[1].referencedAnswer?.code, "A");
assert.equal(parent.triggers[1].targetQuestion, "FOLLOW");

const follow = result[1];
assert.equal(follow.required.status, "review");
assert.equal(follow.visibility.registrationTypesStatus, "review", "conditional visibility is not misclassified as reg-type codes");
assert.deepEqual(follow.visibility.registrationTypeCodes, []);
assert.equal(follow.triggers.length, 2, "visibility and Notes conditions are preserved independently");
assert.equal(follow.triggers[0].source, "registration-type-visibility");
assert.equal(follow.triggers[0].referencedQuestion, "PARENT");
assert.equal(follow.triggers[0].referencedAnswer?.code, "A");

const missing = result[2];
assert.equal(missing.required.status, "missing");
assert.equal(missing.determinesRegistrationType.status, "missing");
assert.equal(missing.visibility.registrationTypesStatus, "missing");
assert.equal(missing.triggerStatus, "missing");

const workbook = process.env.BDNY_WORKBOOK ?? "/Users/bailey/Downloads/BDNY 2026 (BDE261) FINAL RR Doc_NEW_2.26.26.xlsx";
assert.ok(existsSync(workbook), `real BDNY workbook is required: ${workbook}`);
const python = [
  "import json,sys", "from openpyxl import load_workbook", "w=load_workbook(sys.argv[1],read_only=True,data_only=False)",
  "s=w['Show Questions']", "print(json.dumps([[c.value for c in r] for r in s.iter_rows()],default=str))",
].join(";");
const realRows = JSON.parse(execFileSync("python3", ["-c", python, workbook], { encoding: "utf8", maxBuffer: 20_000_000 })) as LegacyQuestionCell[][];
const bdny = compileLegacyQuestions({ sheetName: "Show Questions", rows: realRows });
assert.ok(bdny.length >= 20, "real BDNY questions are extracted");
const hotel = bdny.find(q => q.internalName === "HOTEL");
assert.ok(hotel);
assert.equal(hotel.required.value, true);
assert.equal(hotel.visibility.registrationTypesStatus, "review");
assert.ok(hotel.triggers.some(t => t.referencedQuestion === "NAICS36D" && t.referencedAnswer?.code === "72111A"));
const naics = bdny.find(q => q.internalName === "NAICS36D");
assert.ok(naics?.registrationTypeOutcomes.length);
assert.ok(naics.registrationTypeOutcomes.some(x => x.answer.code === "54131" && x.registrationType === "ATT"));
const diety = bdny.find(q => q.internalName === "DIETY");
assert.ok(diety?.triggers.some(t => t.referencedQuestion === "DIET" && t.referencedAnswer?.code === "Y"));

console.log(`legacy questions smoke passed (${bdny.length} real BDNY questions)`);
