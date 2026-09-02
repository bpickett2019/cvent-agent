import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { compileLegacyRegistration, type LegacySheet } from "./web/lib/compiler/legacy-registration";

const bdny: LegacySheet[] = [{ name: "NEW Reg Types & Pricing", rows: [
  ["", "OLD REG TYPE", "NEW REG CODE", "NEW REG TYPE NAME", "ACTIVATE / NOT NEEDED", "ADMISSION ITEM CODE", "ADMISSION ITEM", "ADMISSION ITEM ADDITIONAL TEXT", "Can this reg type register another person?", "Which registration path should this reg type appear on", "Admission Item Description", "Badge Description", "Registration Method", "", "", "", "", "", "", "Price Tier 1", "Price Tier 2", "Price Tier 3"],
  ["", "Attendee", "ATT", "Attendee", "ACTIVATE", "EXONLY", "Expo Only", "Both days at the trade fair", "Y", "Attendee", "Trade Fair Only Pass", "", "Web & Staff", "", "", "", "", "", "", 105, 205, 305],
  ["", "", "ATT", "Attendee", "ACTIVATE", "FULL", "Conference + Expo", "All education", "Y", "Attendee", "Full Conference Pass", "", "Web & Staff", "", "", "", "", "", "", 255, 330, 530],
  ["", "Staff", "STAFF", "Staff", "REQUIRED", "FULL ", "Full Access Pass", "", "N", "Internal", "Show Staff", "", "Staff Only", "", "", "", "", "", "", 0, 0, 0],
]}];
const compiled = compileLegacyRegistration(bdny);
assert.deepEqual(compiled.registrationPaths.map((x) => x.name), ["Attendee", "Internal"]);
assert.equal(compiled.registrationPaths[0].outcome, "review");
assert.match(compiled.registrationPaths[0].provenance.source, /J2/);
assert.equal(compiled.admissionItems.length, 2);
assert.deepEqual(compiled.admissionItems.find((x) => x.code === "FULL")?.registrationTypeCodes, ["ATT", "STAFF"]);
assert.equal(compiled.admissionItems.find((x) => x.code === "EXONLY")?.description, "Both days at the trade fair");
assert.equal(compiled.admissionItems[0].fields.code.outcome, "exact");
assert.equal(compiled.pricing.length, 9);
assert.deepEqual(compiled.pricing.filter((x) => x.admissionItemCode === "EXONLY").map((x) => x.amount), [105, 205, 305]);
assert.equal(compiled.pricing[0].tierName, "Price Tier 1");
assert.match(compiled.pricing[0].provenance.source, /T2/);

const aliases = compileLegacyRegistration([{ name: "Registration Types & Pricing", rows: [
  ["Reg Type", "Reg Type Code", "Which admission items should this reg type see?", "Group Registration Y/N", "Registration Path", "Admission Item Description", "Badge Description", "Registration Method", "Reported?", "Approval Needed?", "Qualified", "Badge Color", "Early Bird", "Advance"],
  ["ATT Attendee", "EO-ATT", "EO Expo Only", "Y", "Public", "Expo access", "Trade Fair", "Web", "Yes", "No", "Yes", "Green", "$25.00", "Free"],
]}]);
assert.equal(aliases.admissionItems[0].code, "EO");
assert.equal(aliases.admissionItems[0].name, "Expo Only");
assert.equal(aliases.pricing[0].amount, 25);
assert.equal(aliases.pricing[1].amount, 0);
assert.equal(aliases.registrationPaths[0].name, "Public");

const missing = compileLegacyRegistration([{ name: "NEW REG MAPPING", rows: [["NEW REG CODE", "ADMISSION ITEM CODE"], ["ATT", ""]] }]);
assert.equal(missing.outcomes.admissionItems, "missing");
assert.equal(missing.outcomes.pricing, "missing");
assert.equal(missing.outcomes.registrationPaths, "missing");

const overflowRows = Array.from({ length: 4 }, (_, i) => ["R" + i, "A" + i, "Item " + i, "Desc", "Path " + i, i + 1]);
const overflow = compileLegacyRegistration([{ name: "NEW REG MAPPING", rows: [["NEW REG CODE", "ADMISSION ITEM CODE", "ADMISSION ITEM", "ADMISSION ITEM ADDITIONAL TEXT", "REGISTRATION PATH", "Price Tier 1"], ...overflowRows] }], { admissionItems: 2, registrationPaths: 2, pricing: 3 });
assert.equal(overflow.admissionItems.length, 2);
assert.equal(overflow.registrationPaths.length, 2);
assert.equal(overflow.pricing.length, 3);
assert.equal(overflow.outcomes.admissionItems, "review");
assert.ok(overflow.warnings.some((x) => /capacity.*admission/i.test(x)));
assert.ok(overflow.warnings.some((x) => /capacity.*registration path/i.test(x)));
assert.ok(overflow.warnings.some((x) => /capacity.*pricing/i.test(x)));

// The production-shaped fixture is checked above; when the authorized source workbook
// is present locally, also smoke the parser against its actual cell values.
const realWorkbook = "/Users/bailey/Downloads/BDNY 2026 (BDE261) FINAL RR Doc_NEW_2.26.26.xlsx";
if (existsSync(realWorkbook)) {
  const script = "import openpyxl,json,sys; w=openpyxl.load_workbook(sys.argv[1],data_only=True); print(json.dumps([{'name':s.title,'rows':[[c.isoformat() if hasattr(c,'isoformat') else c for c in r] for r in s.iter_rows(values_only=True)]} for s in w]))";
  const realSheets = JSON.parse(execFileSync("python3", ["-c", script, realWorkbook], { encoding: "utf8", maxBuffer: 20_000_000 })) as LegacySheet[];
  const real = compileLegacyRegistration(realSheets);
  assert.equal(real.admissionItems.length, 11);
  assert.equal(real.registrationPaths.length, 6);
  assert.ok(real.pricing.length >= 60);
  assert.deepEqual(real.admissionItems.find((x) => x.code === "FULL")?.registrationTypeCodes, ["ATT", "SHOWGUE", "STAFF"]);
  assert.ok(real.pricing.some((x) => x.admissionItemCode === "EXONLY" && x.registrationTypeCode === "ATT" && x.amount === 105));
}

console.log("legacy registration compiler smoke passed");
