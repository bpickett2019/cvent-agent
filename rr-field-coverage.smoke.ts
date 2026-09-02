import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const matrixPath = join(root, "docs/rr-field-coverage.json");
const reportPath = join(root, "docs/rr-field-coverage.md");
const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
const report = readFileSync(reportPath, "utf8");

assert.equal(matrix.schemaVersion, "1.0");
assert.equal(matrix.contract.fieldCount, 107);
assert.equal(matrix.fields.length, 107);
assert.deepEqual(matrix.fields.map((field: any) => field.id), Array.from({ length: 107 }, (_, index) => `RR-${String(index + 1).padStart(3, "0")}`));
assert.equal(new Set(matrix.fields.map((field: any) => field.template.row)).size, 107);
assert.deepEqual(matrix.fields.map((field: any) => field.template.row), Array.from({ length: 107 }, (_, index) => index + 5));

const required = ["sourceAliases", "parser", "eventSpecPath", "cventDestination", "procedure", "verification", "status"];
for (const field of matrix.fields) {
  for (const key of required) assert.ok(field[key] !== undefined && field[key] !== "", `${field.id} missing ${key}`);
  assert.ok(Array.isArray(field.sourceAliases) && field.sourceAliases.length > 0, `${field.id} sourceAliases must be non-empty`);
  assert.ok(["covered", "partial", "carryover", "gap", "unsupported"].includes(field.status.classification), `${field.id} invalid status`);
  assert.ok(["exact", "review", "none"].includes(field.status.confidence), `${field.id} invalid confidence`);
}
const counts = Object.fromEntries(["covered", "partial", "carryover", "gap", "unsupported"].map((status) => [status, matrix.fields.filter((field: any) => field.status.classification === status).length]));
assert.deepEqual(matrix.summary.byStatus, counts);
assert.equal(Object.values(counts).reduce((sum: number, count: any) => sum + count, 0), 107);
assert.match(report, /Definitive 107-Field RR Coverage Matrix/);
assert.equal((report.match(/^\| RR-\d{3} \|/gm) ?? []).length, 107);
console.log(`RR FIELD COVERAGE PASSED: 107 fields; ${JSON.stringify(counts)}`);
