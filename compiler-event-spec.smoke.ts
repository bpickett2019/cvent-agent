import assert from "node:assert/strict";
import { EventSpec } from "./src/spec/eventSpec";
import { compileFullRR, compileFullRRToEventSpec } from "./web/lib/compiler/full-rr";

const seed = EventSpec.parse({
  specVersion: "1.0",
  details: { name: "Seed", description: "", timezone: "America/New_York", start: "2026-11-08T09:00:00-05:00", end: "2026-11-09T17:00:00-05:00", format: "inPerson" },
  registration: {},
});
const blank = Array.from({ length: 7 }, () => [] as never[]);
const compiled = compileFullRR([
  { name: "2. Footer Links", rows: [[], [], [], ["Include? (Yes/No)", "URL / destination", "Footer link (our form)"], ["Yes", "https://example.com/hours", "Show Hours"]] },
  { name: "3. Reg Paths", rows: [[], [], [], [], ["Path name (exactly as named in Cvent)", "Path privacy", "Path status", "Post-registration redirect URL"], [], [], ["Attendee", "Public", "Active", "https://example.com/thanks"]] },
  { name: "4. Reg Types", rows: [...blank, ["Reg type code (NEW)", "Registration pass description", "Reg type name", "Appears on", "Web page description - what's included", "Admission items this type sees (codes, comma separated)", "Path assignment", "Open for registration", "Auto opens on", "Auto closes on", "Capacity", "Can add a guest?"], ["ATT", "Attendee pass", "Attendee", "Attendee", "Access", "FULL", "Attendee", "Yes", "2026-01-01", "2026-12-31", 100, "No"]] },
  { name: "5. Admission Items", rows: [...blank, ["Name", "Code", "Description - what's included", "Which reg types can select this (codes)", "Open for registration", "Auto opens on", "Auto closes on", "Capacity", "Charge a fee?"], ["Full", "FULL", "Access", "ATT", "Yes", "2026-01-01", "2026-12-31", 100, "Yes"]] },
  { name: "6. Pricing", rows: [["Price tier", "", "Starts", "Ends", "Member price", "Non-member price"], ["Super Saver", "", "2026-01-01", "2026-02-01", 100, 150]] },
  { name: "7. Discounts", rows: [...blank, ["Name / description", "Discount code", "Method", "Amount / percentage", "Effective from", "Effective to", "Capacity", "Stackable", "Usable by", "Count guests toward capacity", "Active", "Applicable admission items (codes)", "Applicable optional items (codes)"], ["Ten off", "TEN", "Percentage", "10%", "2026-01-01", "2026-02-01", 100, "No", "Invitees", "No", "Yes", "FULL", ""]] },
  { name: "8. Vouchers", rows: [...blank, ["Voucher code", "Alert email address", "Description", "Capacity"], ["VIP", "ops@example.com", "VIP", 50]] },
  { name: "9. Questions", rows: [...blank, ["q-role", "Role?", "singleSelect", "", "", "ATTENDEE|Attendee;EXHIBITOR|Exhibitor", "", "ATT", "Yes", "ATT", "q-country=US|United States"]] },
]);

const spec = compileFullRRToEventSpec(seed, compiled);
assert.deepEqual(spec.footer?.links, [{ key: "show-hours", label: "Show Hours", destination: "https://example.com/hours", enabled: true, appliesToPaths: [] }]);
assert.equal(spec.registrationTypes[0].code, "ATT");
assert.equal(spec.registrationTypes[0].pathKey, "attendee");
assert.equal(spec.registration.paths[0].privacy, "public");
assert.equal(spec.registration.paths[0].status, "active");
assert.equal(spec.registration.admissionItems[0].openForRegistration, true);
assert.equal(spec.registration.admissionItems[0].pricing![0].memberPrice, 100);
assert.equal(spec.registration.discounts![0].code, "TEN");
assert.equal(spec.registration.vouchers[0].alertEmail, "ops@example.com");
assert.deepEqual(spec.questions[0].answerOptions, [{ code: "ATTENDEE", text: "Attendee" }, { code: "EXHIBITOR", text: "Exhibitor" }]);
assert.deepEqual(spec.questions[0].visibility, { type: "registrationTypes", registrationTypeKeys: ["att"] });
assert.deepEqual(spec.questions[0].trigger, { questionKey: "q-country", answerCode: "US", answerText: "United States", raw: "q-country=US|United States" });
EventSpec.parse(spec);
console.log("compiler EventSpec adapter smoke passed");
