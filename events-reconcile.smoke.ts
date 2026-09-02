/** Deterministic Events reconcile planner/procedure checks. No browser, network, or Cvent. */
import assert from "node:assert/strict";
import { EventSpec } from "./src/spec/eventSpec";
import { plan } from "./src/planner/plan";
import { loadProcedure } from "./src/procedures/loader";

const eventId = "e712e34c-6117-4d13-bf4c-8ed54cf2b495";
const raw = {
  specVersion: "1.0",
  target: { tenantId: "tenant", accountId: "account", eventId, eventName: "Authorized Event", mode: "existingEvent" },
  details: { name: "Authorized Event", timezone: "America/Phoenix", start: "2027-03-01T09:00:00-07:00", end: "2027-03-02T17:00:00-07:00", format: "inPerson" },
  registrationTypes: [{ key: "attendee", name: "Attendee" }],
  questions: [],
  registration: {
    admissionItems: [{ key: "expo", name: "Expo", price: 125, currency: "USD" }],
    optionalItems: [],
    paths: [{ key: "public", name: "Public", admissionItemKeys: ["expo"], isDefault: true }],
    vouchers: [{ key: "vip", code: "VIP27", discountType: "fixed", amount: 25, appliesTo: ["expo"] }],
    discounts: [{ key: "partner", name: "Partner", code: "PARTNER10", discountType: "percent", amount: 10, admissionItemKeys: ["expo"] }],
    advancedRules: [],
  },
};
const spec = EventSpec.parse(raw);

const tasks = plan(spec).tasks;
const expected: Record<string, string> = {
  "event.details": "events/reconcile-event-details",
  "reg.type.attendee": "registration/reconcile-registration-type",
  "reg.admission.expo": "registration/reconcile-admission-item",
  "reg.path.public": "registration/reconcile-path",
  "reg.pricing.expo": "registration/reconcile-pricing",
  "reg.discount.partner": "registration/reconcile-discount",
  "reg.voucher.vip": "registration/reconcile-voucher",
};
for (const [id, procedure] of Object.entries(expected)) {
  const task = tasks.find((candidate) => candidate.id === id);
  assert.ok(task, `missing ${id}`);
  assert.equal(task.channel, "browser");
  assert.equal(task.procedure, procedure);
  assert.deepEqual(task.payload.guard, { eventId, eventName: "Authorized Event" });
}
assert.deepEqual(tasks.find((task) => task.id === "reg.pricing.expo")?.dependsOn, ["reg.admission.expo"]);
assert.deepEqual(tasks.find((task) => task.id === "reg.discount.partner")?.dependsOn, ["reg.pricing.expo"]);

for (const [id, procedureId] of Object.entries(expected)) {
  const task = tasks.find((candidate) => candidate.id === id)!;
  const procedure = await loadProcedure(procedureId, task.payload);
  const text = JSON.stringify(procedure);
  for (const contract of ["read", "exact event", "skip", "conflict", "Save once", "read-back"]) {
    assert.match(text, new RegExp(contract, "i"), `${procedureId} lacks ${contract}`);
  }
  assert.doesNotMatch(text, /\bTODO\b/);
}

console.log("events reconcile smoke: PASS");
