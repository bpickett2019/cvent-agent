/** Theme procedure smoke. No Cvent UI or network. */

import { readFile } from "node:fs/promises";
import { parseProcedure } from "./src/procedures/loader";

let failures = 0;
let checks = 0;
const check = (label: string, ok: boolean, detail = "") => {
  checks += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const applyThemeYaml = await readFile(new URL("./src/procedures/site/apply-theme.yaml", import.meta.url), "utf8");
const colorOnly = parseProcedure(applyThemeYaml, { theme: { palette: { primary: "#0B7A4B" } } }, "apply-theme.yaml");
check("color-only apply-theme loads", colorOnly.id === "site/apply-theme");
check("Color 1 interpolates", colorOnly.steps.some((step) => step.value === "#0B7A4B"));
check("idempotent on Color 1", colorOnly.idempotency?.check.includes("#0B7A4B") === true);
check("Save not Publish", colorOnly.steps.some((step) => step.selectorHint?.includes("site-designer-save-button")));
check("Way to go toast", colorOnly.steps.some((step) => step.verify?.includes("text=Way to go!")));
check("does not select Emerald Corporate", !colorOnly.steps.some((step) => (step.selectorHint ?? "").toLowerCase().includes("emerald")));
check("sandbox provenance", colorOnly.provenance.validatedAgainst?.includes("020c932b-59d7-484a-80e1-229f20d57a7e") === true);

const headerYaml = await readFile(new URL("./src/procedures/site/configure-header.yaml", import.meta.url), "utf8");
const footerYaml = await readFile(new URL("./src/procedures/site/configure-footer.yaml", import.meta.url), "utf8");
const header = parseProcedure(headerYaml, { header: { title: "x" } }, "configure-header.yaml");
const footer = parseProcedure(footerYaml, { footer: { text: "x" } }, "configure-footer.yaml");
check("header procedure is implemented", header.id === "site/configure-header" && header.steps.some((step) => step.selectorHint?.includes("site-designer-save-button")));
check("footer procedure is implemented", footer.id === "site/configure-footer" && footer.steps.some((step) => step.selectorHint?.includes("site-designer-save-button")));
check("header never instructs delete/publish", !/delete|publish|go live/i.test(header.steps.map((step) => step.description).join(" ")));
check("footer never instructs delete/publish", !/delete|publish|go live/i.test(footer.steps.map((step) => step.description).join(" ")));

console.log("");
console.log(failures === 0 ? `ALL THEME CHECKS PASSED (${checks} checks)` : `${failures} FAILURE(S)`);
console.log("");
process.exit(failures === 0 ? 0 : 1);
