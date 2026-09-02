import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const procedures = [
  "src/procedures/events/reconcile-event-details.yaml",
  "src/procedures/registration/reconcile-registration-type.yaml",
  "src/procedures/registration/reconcile-admission-item.yaml",
  "src/procedures/registration/reconcile-path.yaml",
  "src/procedures/registration/reconcile-pricing.yaml",
  "src/procedures/registration/reconcile-discount.yaml",
  "src/procedures/registration/reconcile-voucher.yaml",
  "src/procedures/registration/reconcile-question.yaml",
  "src/procedures/site/configure-footer.yaml",
  "src/procedures/site/apply-theme.yaml",
];
for (const path of procedures) {
  const source = await readFile(path, "utf8");
  assert.doesNotMatch(source, /selectorHint:\s*["']?TODO/i, `${path} must not ship placeholder selectors`);
  assert.match(source, /read|inspect/i, `${path} must read current state before mutation`);
  assert.match(source, /verify|confirm|read.back/i, `${path} must independently read back state`);
  assert.match(source, /event/i, `${path} must retain exact event scope`);
}
console.log("procedure promotion smoke passed");
