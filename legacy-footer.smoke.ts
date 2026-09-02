import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { compileLegacyFooter, type LegacyFooterSheet } from "./web/lib/compiler/legacy-footer";

const synthetic: LegacyFooterSheet = { name: "Helpful & Social Media Links", rows: [
  ["Footer Options - Attendee/Press"],
  ["Footer Options", "Visible?", "Provide Link Here"],
  ["Show Hours", "Yes", "https://example.com/attendee"],
  ["Contact Us Button", "Yes", "Connect to help@example.com"],
  ["Footer Options - Exhibitor"],
  ["Footer Options", "Include?", "Destination"],
  ["Show Hours", "No", "https://example.com/ignored"],
  ["Exhibitor Resource Centre (Exhibitor flow only)", "Yes", "https://example.com/exhibitor"],
  ["Footer Options - Internal"],
  ["Footer Options", "Visible?", "Literal URL / Destination"],
  ["FAQ Link", true, "https://example.com/internal-faq"],
  ["Footer Options - Path: VIP Buyers"],
  ["Link", "Visible", "URL"],
  ["Registration Status", "Y", "Use Cvent Registration Status action"],
] };
const result = compileLegacyFooter(synthetic);
assert.equal(result.blocks.length, 4);
assert.deepEqual(result.blocks.map((b) => b.applicability), [
  { kind: "attendee", paths: ["Attendee", "Press"] },
  { kind: "exhibitor", paths: ["Exhibitor"] },
  { kind: "internal", paths: ["Internal"] },
  { kind: "path", paths: ["VIP Buyers"] },
]);
assert.equal(result.links.length, 6);
assert.equal(result.links[0]?.key, "show-hours");
assert.equal(result.links[0]?.include, true);
assert.equal(result.links[0]?.destination, "https://example.com/attendee");
assert.deepEqual(result.links[0]?.provenance, { sheet: synthetic.name, row: 3, labelCell: "A3", includeCell: "B3", destinationCell: "C3", blockHeadingCell: "A1" });
assert.equal(result.links[1]?.destination, "Connect to help@example.com");
assert.equal(result.links[3]?.key, "exhibitor-resource-center");
assert.equal(result.links[4]?.key, "faq");
assert.equal(result.links[5]?.literalDestination, true);
assert.equal(result.links[2]?.destination, undefined, "hidden links retain no active destination");
assert.ok(result.review.some((r) => r.code === "hidden-destination"));

const conflicts = compileLegacyFooter({ name: "Legacy", rows: [
  ["Footer Options - Attendee"], ["Footer Options", "Visible?", "URL"],
  ["FAQ", "Yes", "https://one.example"], ["FAQ link", "Yes", "https://two.example"],
  ["Mystery", "Maybe", ""], ["Hotel Information", "Yes", ""],
] });
assert.ok(conflicts.conflicts.some((c) => c.code === "conflicting-duplicate" && c.key === "faq"));
assert.ok(conflicts.review.some((r) => r.code === "unknown-include"));
assert.ok(conflicts.review.some((r) => r.code === "unknown-label"));
assert.ok(conflicts.review.some((r) => r.code === "missing-destination"));
assert.ok(conflicts.review.some((r) => r.code === "contract-review" && r.key === "hotel-info"));
assert.equal(conflicts.outcome, "review");
assert.equal(conflicts.safeToExecute, false);

const workbook = process.env.BDNY_RR ?? "/Users/bailey/Downloads/BDNY 2026 (BDE261) FINAL RR Doc_NEW_2.26.26.xlsx";
let hasOpenpyxl = false;
try { execFileSync("python3", ["-c", "import openpyxl"], { stdio: "ignore" }); hasOpenpyxl = true; } catch { /* optional real-workbook check */ }
if (existsSync(workbook) && hasOpenpyxl) {
const payload = execFileSync("python3", ["-c", `
import json,sys
from openpyxl import load_workbook
w=load_workbook(sys.argv[1],data_only=True,read_only=True)
s=w['Helpful & Social Media Links']
print(json.dumps({'name':s.title,'rows':[[c.isoformat() if hasattr(c,'isoformat') else c for c in r] for r in s.iter_rows(values_only=True)]}))
`, workbook], { encoding: "utf8" });
const bdny = compileLegacyFooter(JSON.parse(payload));
assert.equal(bdny.blocks.length, 2);
assert.equal(bdny.links.length, 17);
assert.deepEqual(bdny.blocks.map((b) => b.applicability.kind), ["attendee", "exhibitor"]);
assert.equal(bdny.links.find((l) => l.key === "contact-us" && l.applicability.kind === "attendee")?.destination, "Connect to emeraldsupport@cvent.com");
assert.equal(bdny.links.find((l) => l.key === "exhibitor-resource-center")?.provenance.labelCell, "A22");
assert.ok(bdny.review.some((r) => r.code === "hidden-destination" && r.provenance.row === 20) === false);
}
console.log("legacy footer/path variants smoke passed");
