/** Smoke test for the deterministic spine. No Cvent, no browser, no network. */

import { EventSpec } from "./src/spec/eventSpec";
import { plan, executionOrder } from "./src/planner/plan";
import { Guardrails, GuardrailViolation, extractEventIds } from "./src/guardrails/middleware";
import type { CventApi } from "./src/cvent/api";
import { verify } from "./src/verify/verifier";

const EVENT_ID = "3f2b6a10-9c4d-4e21-b8f7-0a1c2d3e4f56";
const OTHER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const raw = {
  specVersion: "1.0",
  details: {
    name: "Emerald Expo West 2027",
    timezone: "America/Los_Angeles",
    start: "2027-03-15T09:00:00-07:00",
    end: "2027-03-17T17:00:00-07:00",
    format: "inPerson",
    templateEventId: "tmpl-expo-base",
    venue: { name: "Anaheim Convention Center", city: "Anaheim", state: "CA" },
  },
  theme: { templateName: "Emerald Corporate", palette: { primary: "#0B7A4B", accent: "#F4C430" } },
  header: { title: "Emerald Expo West 2027", subtitle: "The industry gathers" },
  footer: { text: "© Emerald Holding", socialLinks: { linkedin: "https://linkedin.com/company/emerald" } },
  pages: [
    {
      key: "home",
      title: "Home",
      widgets: [
        { type: "text", heading: "Welcome", body: "Three days of product discovery." },
        { type: "button", label: "Register Now", action: "register" },
        { type: "divider" },
      ],
    },
    { key: "agenda", title: "Agenda", widgets: [{ type: "agenda", heading: "Full Schedule" }] },
  ],
  registration: {
    registrationTypes: [
      { key: "attendee", name: "Attendee" },
      { key: "exhibitor", name: "Exhibitor" },
    ],
    questions: [
      {
        key: "attending-dinner",
        text: "Will you attend the dinner?",
        page: "show-questions",
        order: 1,
        answerType: "boolean",
        required: true,
        visibility: { type: "always" },
      },
      {
        key: "dietary-needs",
        text: "Select dietary needs",
        page: "show-questions",
        order: 2,
        answerType: "multiSelect",
        answerValues: ["Vegetarian", "Vegan", "Gluten-free"],
        required: false,
        visibility: {
          type: "questionAnswer",
          questionKey: "attending-dinner",
          matchingValues: ["true"],
        },
      },
      {
        key: "booth-size",
        text: "Select your booth size",
        page: "exhibitor-details",
        order: 3,
        answerType: "singleSelect",
        answerValues: ["10x10", "10x20"],
        required: true,
        visibility: { type: "registrationTypes", registrationTypeKeys: ["exhibitor"] },
      },
    ],
    admissionItems: [
      { key: "full", name: "Full Conference Pass", price: 1295, capacity: 5000 },
      { key: "expo", name: "Expo Only", price: 0 },
    ],
    optionalItems: [{ key: "workshop", name: "Pre-Conference Workshop", price: 349, availableTo: ["full"] }],
    vouchers: [{ key: "early", code: "EARLY25", discountType: "percent", amount: 25, appliesTo: ["full"] }],
    paths: [
      { key: "attendee", name: "Attendee", admissionItemKeys: ["full", "expo"], isDefault: true },
      { key: "vip", name: "VIP", admissionItemKeys: ["full"] },
    ],
    advancedRules: [],
  },
};

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("\n[1] Spec validation");
const parsed = EventSpec.safeParse(raw);
check("valid spec with conditional questions parses", parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues[0]));
if (!parsed.success) process.exit(1);
const spec = parsed.data;

const orphan = structuredClone(raw) as typeof raw;
orphan.registration.paths[0].admissionItemKeys = ["does-not-exist"];
check("orphan admission reference rejected", !EventSpec.safeParse(orphan).success);

const twoDefaults = structuredClone(raw) as typeof raw;
(twoDefaults.registration.paths[1] as { isDefault?: boolean }).isDefault = true;
check("two default paths rejected", !EventSpec.safeParse(twoDefaults).success);

const unknownQuestion = structuredClone(raw);
unknownQuestion.registration.questions[1].visibility = {
  type: "questionAnswer",
  questionKey: "does-not-exist",
  matchingValues: ["true"],
};
check("question gated on unknown question rejected", !EventSpec.safeParse(unknownQuestion).success);

const unknownRegistrationType = structuredClone(raw);
unknownRegistrationType.registration.questions[2].visibility = {
  type: "registrationTypes",
  registrationTypeKeys: ["press"],
};
check(
  "question gated on unknown registration type rejected",
  !EventSpec.safeParse(unknownRegistrationType).success
);

const laterQuestion = structuredClone(raw);
laterQuestion.registration.questions[1].visibility = {
  type: "questionAnswer",
  questionKey: "booth-size",
  matchingValues: ["10x10"],
};
check("question gated on later question rejected", !EventSpec.safeParse(laterQuestion).success);

console.log("\n[2] Planner");
const p = plan(spec);
const ordered = executionOrder(p);
check("plan is acyclic and orderable", ordered.length === p.tasks.length, `${ordered.length} tasks`);
check("spec hash is stable", plan(spec).specHash === p.specHash, p.specHash);

const idx = (id: string) => ordered.findIndex((t) => t.id === id);
check("admission items precede their path", idx("reg.admission.full") < idx("reg.path.attendee"));
check("theme precedes pages", idx("site.theme") < idx("site.page.home"));
check("page precedes its widgets", idx("site.page.home") < idx("site.page.home.widget.0"));
check(
  "gating question is configured before gated question",
  idx("reg.question.attending-dinner.visibility") < idx("reg.question.dietary-needs")
);
check("registration type precedes type-gated question", idx("reg.type.exhibitor") < idx("reg.question.booth-size"));
check("verification runs last", idx("verify.registration") > idx("reg.path.vip"));

const inheritedSite = structuredClone(raw) as Record<string, unknown>;
delete inheritedSite.theme;
delete inheritedSite.header;
delete inheritedSite.footer;
delete inheritedSite.pages;
const inheritedSitePlan = plan(EventSpec.parse(inheritedSite));
check(
  "inherited site configuration emits no site tasks",
  !inheritedSitePlan.tasks.some((task) => task.id.startsWith("site.") || task.id === "verify.site")
);

const api = ordered.filter((t) => t.channel === "api").length;
const browser = ordered.filter((t) => t.channel === "browser").length;
check("channel split recorded", api > 0 && browser > 0, `${api} API / ${browser} browser`);

console.log("\n[3] Verification coverage");
const verificationApi = {
  isDraft: async () => true,
  getEvent: async () => ({ id: EVENT_ID, title: spec.details.name, status: "Draft" }),
  listAdmissionItems: async () =>
    spec.registration.admissionItems.map((item) => ({ id: item.key, ...item })),
  listRegistrationPaths: async () =>
    spec.registration.paths.map((path) => ({
      id: path.key,
      name: path.name,
      isDefault: path.isDefault,
      admissionItems: path.admissionItemKeys.map((id) => ({ id })),
    })),
  listVouchers: async () => spec.registration.vouchers.map((voucher) => ({ id: voucher.key, ...voucher })),
  listRegistrationTypes: async () =>
    spec.registration.registrationTypes.map((registrationType) => ({ id: registrationType.key, ...registrationType })),
  listQuestions: async () =>
    spec.registration.questions.map(({ visibility: _visibility, ...question }) => ({ id: question.key, ...question })),
} as unknown as CventApi;
const report = await verify(verificationApi, EVENT_ID, spec, p.specHash);
check("questions and registration types match API reads", report.passed);
check(
  "visibility read gap is explicit to the operator",
  report.findings.some((finding) => finding.message.includes("does not expose question visibility rules"))
);

console.log("\n[4] Guardrails");
const denied: string[] = [];
const g = new Guardrails(
  {
    eventId: EVENT_ID,
    denyList: { selectors: ["#danger-zone"], urlPatterns: ["https://*.cvent.com/admin/*"] },
    costCeilingUsd: 30,
    costAlertUsd: 20,
  },
  (e) => denied.push(String(e.rule))
);

const blocked = (label: string, action: Parameters<typeof g.check>[0]) => {
  try {
    g.check(action);
    check(label, false, "was ALLOWED");
  } catch (err) {
    check(label, err instanceof GuardrailViolation, (err as GuardrailViolation).rule);
  }
};

blocked("publish button blocked", { type: "click", selector: "button#publishEvent", taskId: "t1" });
blocked("Publish w/ spacing+case blocked", { type: "click", selector: "#Publish Event", taskId: "t2" });
blocked("attendee list blocked", {
  type: "navigate",
  url: `https://app.cvent.com/events/${EVENT_ID}/attendees`,
  taskId: "t3",
});
blocked("wrong event id blocked", {
  type: "navigate",
  url: `https://app.cvent.com/events/${OTHER_ID}/designer`,
  taskId: "t4",
});
blocked("deny-listed selector blocked", { type: "click", selector: "#danger-zone > a", taskId: "t5" });
blocked("deny-listed url blocked", { type: "navigate", url: "https://web.cvent.com/admin/users", taskId: "t6" });

try {
  g.check({ type: "navigate", url: `https://app.cvent.com/events/${EVENT_ID}/designer`, taskId: "t7" });
  check("in-scope navigation allowed", true);
} catch (err) {
  check("in-scope navigation allowed", false, String(err));
}

check("every denial was logged", denied.length === 6, `${denied.length} logged`);
check("event id extraction", extractEventIds(`https://app.cvent.com/events/${EVENT_ID}/x`)[0] === EVENT_ID);

g.accrue(19);
g.accrue(12); // 31 — over ceiling
blocked("cost ceiling halts run", { type: "click", selector: "#save", taskId: "t8" });

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
