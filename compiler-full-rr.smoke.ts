import assert from "node:assert/strict";
import { compileFullRR } from "./web/lib/compiler/full-rr";

const compiled = compileFullRR([
  { name: "1. Event Setup", rows: [["Section","Question (our form)","YOUR ANSWER"],["A","Existing event name (template the agent copies)","Template 2025"],["A","New event name","Event 2026"],["A","Venue name","Venue"],["A","City","New York"],["A","State","NY"],["A","Expo hall dates - START","2026-11-08"],["A","Expo hall dates - END","2026-11-09"]] },
  { name: "2. Footer Links", rows: [[],[],[],["Include? (Yes/No)","URL / destination","Footer link (our form)"],["Yes","https://example.com/hours","Show Hours"]] },
  { name: "3. Reg Paths", rows: [[],[],[],[],["Path name (exactly as named in Cvent)","Path privacy","Path status","Post-registration redirect URL"],[],["Attendee","Public","Active","https://example.com/thanks"],["COLUMN NOTES  -  status and open questions"],["Path status | Needs confirmation"]] },
  { name: "4. Reg Types", rows: [[],[],[],["-> Reg Type Code (new)","-> Registration Pass Description","-> Reg Type Name"],["Reg type code (NEW)","Registration pass description","Reg type name","Appears on","Web page description - what's included","Admission items this type sees (codes, comma separated)","Path assignment","Open for registration","Auto opens on","Auto closes on","Capacity","Can add a guest?"],[],["ATT","Attendee pass","Attendee","Attendee","Access","FULL","Attendee","Yes","2026-01-01","2026-12-31",100,"No"],["COLUMN NOTES  -  status and open questions"],["Reg type code (NEW) | Confirmed"]] },
  { name: "5. Admission Items", rows: [[],[],[],[],["Name","Code","Description - what's included","Which reg types can select this (codes)","Open for registration","Auto opens on","Auto closes on","Capacity","Charge a fee?"],[],[],["Full","FULL","Access","ATT","Yes","2026-01-01","2026-12-31",100,"Yes"]] },
  { name: "7. Discounts", rows: [[],[],[],[],["Name / description","Discount code","Method","Amount / percentage","Effective from","Effective to","Capacity","Stackable","Usable by","Count guests toward capacity","Active","Applicable admission items (codes)","Applicable optional items (codes)"],[],[],["Ten off","TEN","Percentage","10%","2026-01-01","2026-02-01",100,"No","Invitees","No","Yes","FULL",""]] },
  { name: "8. Vouchers", rows: [[],[],[],[],["Voucher code","Alert email address","Description","Capacity"],[],[],["VIP","ops@example.com","VIP",50]] },
  { name: "9. Questions", rows: [[],[],[],["-> Question internal name","-> Page displayed on",null,"-> Question Text (display)"],["Internal name (Demo Name)","Page displayed on","Company or individual","Question text (as displayed on the site)","Question appearance","Answer options - code | text, in display order","Required to answer","Which reg types see this (codes)","Visible online","Determines reg type?","Trigger / conditional logic"],["default: UPPERCASE"], [], ["ROLE","Show Questions","Individual","Role?","Single select","A | Architect","Yes","ATT","Visible on the site"], ["COLUMN NOTES  -  status and open questions"], ["Internal name (Demo Name) | Needs confirmation"]] },
]);
const at = (sheet:string,cell:string) => compiled.assignments.find((item)=>item.sheet===sheet&&item.cell===cell)?.value;
assert.equal(at("1. Event Setup","C5"),"Template 2025");
assert.equal(at("1. Event Setup","C6"),"Event 2026");
assert.equal(at("1. Event Setup","C9"),"New York");
assert.equal(at("2. Footer Links","A5"),"Yes");
assert.equal(at("3. Reg Paths","A8"),"Attendee");
assert.equal(at("4. Reg Types","A8"),"ATT");
assert.equal(at("5. Admission Items","B8"),"FULL");
assert.equal(at("7. Discounts","B8"),"TEN");
assert.equal(at("8. Vouchers","A8"),"VIP");
assert.deepEqual(compiled.sections.commerce.registrationTypes.map((item) => item.code), ["ATT"]);
assert.deepEqual([...new Set(compiled.sections.paths.map((item) => item.pathName))], ["Attendee"]);
assert.deepEqual(compiled.sections.questions.map((item) => item.internalName), ["ROLE"]);
assert.equal(compiled.summary.contractFields,107);
console.log("full RR compiler smoke passed");
