import { readFile } from "node:fs/promises";
import { EventSpec } from "./src/spec/eventSpec";
import { plan } from "./src/planner/plan";
import { loadProcedure } from "./src/procedures/loader";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const root = new URL("./src/procedures/", import.meta.url).pathname;
const cases: Array<[string, Record<string, unknown>, string[]]> = [
  ["site/apply-theme", { theme: { templateName: "0 medtrade theme", palette: { primary: "#112233" } } }, ["site-designer-save-button", "0 medtrade theme", "reload", "read back"]],
  ["site/configure-header", { header: { title: "Title" } }, ["Default Header and Footer", "HEADER AND FOOTER", "site-designer-save-button", "reload", "read back"]],
  ["site/configure-footer", { footer: { text: "Footer", socialLinks: {}, contactEmail: "ops@example.com" } }, ["Default Header and Footer", "HEADER AND FOOTER", "literal", "site-designer-save-button", "reload", "read back"]],
  ["site/widget-text", { pageKey: "home", index: 0, widget: { type: "text", body: "Body" } }, ["WEBSITE PAGE", "widget-category-customContent-NucleusText", "site-designer-save-button", "reload", "read back"]],
  ["site/widget-image", { pageKey: "home", index: 1, widget: { type: "image", image: { source: "upload", assetId: "a" } } }, ["WEBSITE PAGE", "widget-category-customContent-NucleusImage", "site-designer-save-button", "reload", "read back"]],
  ["site/widget-video", { pageKey: "home", index: 2, widget: { type: "video", url: "https://example.com" } }, ["WEBSITE PAGE", "widget-category-customContent-Video", "site-designer-save-button", "reload", "read back"]],
  ["site/widget-button", { pageKey: "home", index: 3, widget: { type: "button", label: "Go", action: "register" } }, ["WEBSITE PAGE", "widget-category-buttonsAndLinks-NucleusLinkButton", "site-designer-save-button", "reload", "read back"]],
  ["site/widget-agenda", { pageKey: "home", index: 4, widget: { type: "agenda" } }, ["WEBSITE PAGE", "widget-category-productInformation-AgendaV2", "site-designer-save-button", "reload", "read back"]],
  ["site/widget-divider", { pageKey: "home", index: 5, widget: { type: "divider" } }, ["WEBSITE PAGE", "widget-category-structualElements-NucleusDivider", "site-designer-save-button", "reload", "read back"]],
  ["registration/reconcile-question", { question: { key: "q1", text: "Question?", page: "personal-information", order: 0, answerType: "text", answerValues: [], required: false }, visibility: { type: "always" } }, ["regProcessStep1", "widget-", "required_0", "registrantSpecificVisibilityLogic", "site-designer-save-button", "reload", "read back"]],
];

for (const [id, payload, required] of cases) {
  try {
    const procedure = await loadProcedure(id, payload, root);
    const text = JSON.stringify(procedure);
    check(`${id} loads`, true);
    for (const token of required) check(`${id} encodes ${token}`, text.toLowerCase().includes(token.toLowerCase()));
    check(`${id} has exactly one top-level save step`, procedure.steps.filter((step) => /site-designer-save-button/.test(step.selectorHint ?? "")).length === 1);
    check(`${id} never instructs Publish/Delete/Remove`, !procedure.steps.some((step) => /\b(publish|go live|delete|remove)\b/i.test(`${step.description} ${step.onMiss ?? ""}`)));
  } catch (error) {
    check(`${id} loads`, false, String(error));
  }
}

const raw = JSON.parse(await readFile(new URL("./specs/example.json", import.meta.url), "utf8"));
raw.questions = [
  { key: "gate", text: "Gate?", page: "personal-information", order: 0, answerType: "singleSelect", answerValues: ["Yes", "No"], required: true, visibility: { type: "always" } },
  { key: "child", text: "Child?", page: "personal-information", order: 1, answerType: "text", required: false, visibility: { type: "questionAnswer", questionKey: "gate", matchingValues: ["Yes"] } },
];
const p = plan(EventSpec.parse(raw));
const questionTasks = p.tasks.filter((task) => task.kind === "reg.question.reconcile");
check("planner emits one reconcile task per question", questionTasks.length === 2);
check("planner does not split question visibility into a second save task", !p.tasks.some((task) => task.kind === "reg.question.visibility"));
check("question reconcile carries semantics and visibility together", questionTasks.every((task) => "question" in task.payload && "visibility" in task.payload));
check("triggering question reconcile precedes dependent question", p.tasks.find((task) => task.id === "reg.question.child")?.dependsOn.includes("reg.question.gate") === true);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
