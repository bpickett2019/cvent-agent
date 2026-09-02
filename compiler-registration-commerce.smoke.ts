/** Standalone registration-commerce compiler checks. No browser, model, or network. */
import { compileRegistrationCommerce, type RRSheet } from "./web/lib/compiler/registration-commerce";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const legacy: RRSheet[] = [
  { name: "NEW Reg Types & Pricing", rows: [
    ["OLD REG TYPE", "NEW REG CODE", "NEW REG TYPE NAME", "REGISTRATION PASS DESCRIPTION", "APPEARS ON", "WEB PAGE DESCRIPTION", "ADMISSION ITEMS", "ACTIVATE / NOT NEEDED"],
    ["Architect", "ATTARCH", "Attendee - Architect", "Architect pass", "Attendee", "Expo and conference", "FULLACC, KEYNOTE", "ACTIVATE"],
  ]},
  { name: "Registration Types & Pricing", rows: [
    ["Admission Item", "Admission Code", "Description", "Reg Types", "Super Saver Member", "Super Saver Non-Member", "Early Bird Member", "Early Bird Non-Member", "Advance Member", "Advance Non-Member", "Onsite Member", "Onsite Non-Member", "Processing Fee Note"],
    ["Full Access Pass", "FULLACC", "Everything", "ATTARCH", 100, 150, 125, 175, 150, 200, 200, 250, "Plus processing fee"],
  ]},
  { name: "Sessions_Add-Ons", rows: [
    ["Item Name", "Item Code", "Description", "Available to Reg Types", "Fee"],
    ["Keynote", "KEYNOTE", "Opening keynote", "ATTARCH", 25],
  ]},
];
const compiled = compileRegistrationCommerce(legacy);
const reg = compiled.registrationTypes[0];
check("complete legacy registration type normalized", reg?.code === "ATTARCH" && reg.name === "Attendee - Architect" && reg.passDescription === "Architect pass" && reg.appearsOn === "Attendee" && reg.description === "Expo and conference" && reg.admissionItemCodes.join("|") === "FULLACC|KEYNOTE" && reg.openForRegistration === true);
check("registration confidence is explicit", reg?.confidence === "review" && reg.fields.code.confidence === "exact" && reg.fields.openForRegistration.confidence === "review");
const full = compiled.admissionItems.find((item) => item.code === "FULLACC");
const keynote = compiled.admissionItems.find((item) => item.code === "KEYNOTE");
check("admission items combine legacy pricing and add-ons", full?.name === "Full Access Pass" && full.regTypeCodes[0] === "ATTARCH" && keynote?.description === "Opening keynote");
check("admission confidence is explicit", full?.confidence === "review" && keynote?.fields.code.confidence === "exact");
check("all four price tiers normalized", compiled.pricing.tiers.map((tier) => `${tier.name}:${tier.memberPrice}/${tier.nonMemberPrice}`).join("|") === "Super Saver:100/150|Early Bird:125/175|Advance:150/200|Onsite:200/250");
check("fee defaults and note are reviewable", compiled.pricing.fee.name === "Registration Fee" && compiled.pricing.fee.active === true && compiled.pricing.fee.processingNote === "Plus processing fee" && compiled.pricing.fee.confidence === "review");
check("first output assignment uses first real template row 8", compiled.assignments.find((item) => item.sheet === "4. Reg Types" && item.field === "code")?.cell === "A8" && compiled.assignments.find((item) => item.sheet === "5. Admission Items" && item.field === "name")?.cell === "A8");

const modern = compileRegistrationCommerce([
  { name: "4. Reg Types", rows: [["-> ignored"], ["Reg type code (NEW)", "Registration pass description", "Reg type name", "Appears on", "Web page description - what's included", "Admission items this type sees (codes, comma separated)", "Path assignment", "Open for registration", "Auto opens on", "Auto closes on", "Capacity", "Can add a guest?"], ["EXAMPLE", "Example", "Example", "Attendee"], ["ATTCON", "Contractor pass", "Attendee - Contractor", "Attendee", "Expo", "FULLACC", "Public", "No", "2027-01-01", "2027-02-01", 500, "Yes"]]},
  { name: "5. Admission Items", rows: [["-> ignored"], ["Name", "Code", "Description - what's included", "Which reg types can select this (codes)", "Open for registration", "Auto opens on", "Auto closes on", "Capacity", "Charge a fee?"], ["Example", "EXAMPLE"], ["Conference", "CONF", "Conference access", "ATTCON", "No", "2027-01-01", "2027-02-01", 300, "Yes"]]},
  { name: "6. Pricing", rows: [["Price tier", "-> Cvent field", "Starts", "Ends", "Member price", "Non-member price", "Notes"], ["Super Saver", "", "2027-01-01", "2027-01-15", 10, 20], ["Early Bird", "", "2027-01-16", "2027-02-01", 20, 30], ["Advance", "", "2027-02-02", "2027-02-15", 30, 40], ["Onsite", "", "2027-02-16", "2027-02-20", 40, 50], ["Fee name", "", "Custom Fee"], ["Fee active / display", "", "No"], ["Processing fee note (display text)", "", "Taxes extra"]]},
]);
check("example rows are excluded from modern tables", modern.registrationTypes.length === 1 && modern.registrationTypes[0].code === "ATTCON" && modern.admissionItems.length === 1 && modern.admissionItems[0].code === "CONF");
check("complete modern values retained", modern.registrationTypes[0].capacity === 500 && modern.registrationTypes[0].canAddGuest === true && modern.admissionItems[0].capacity === 300 && modern.admissionItems[0].openForRegistration === false);
check("modern pricing dates and fee retained", modern.pricing.tiers[0].starts === "2027-01-01" && modern.pricing.tiers[3].ends === "2027-02-20" && modern.pricing.fee.name === "Custom Fee" && modern.pricing.fee.active === false);

console.log(`\n${failures === 0 ? `ALL REGISTRATION COMMERCE CHECKS PASSED (${checks} checks)` : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
