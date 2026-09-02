import assert from "node:assert/strict";
import {
  compileDiscountsAndVouchers,
  type CompilerSheet,
} from "./web/lib/compiler/discounts-vouchers";

const legacySheets: CompilerSheet[] = [
  {
    name: "Discount Code Template",
    rows: [
      ["Name / Description", "Discount Code", "Method", "Amount / Percentage", "Effective From", "Effective To", "Capacity", "Stackable", "Usable by", "Count guests toward capacity", "Active", "Applicable Admission Items", "Applicable Optional Items"],
      ["  Exhibitor comp  ", " exhcomp26 ", "Percentage", "100%", "", "", "25", "No", "Registrant", "Yes", "Yes", "ATT; EXH, ATT", "DINNER"],
    ],
  },
  {
    name: "Group Discounts",
    rows: [
      ["Description", "Code", "Discount Type", "Discount Amount", "Admission Item Codes"],
      ["Buyer rebate", "BUY50", "Amount", "$50.00", "BUYER"],
    ],
  },
];

const legacy = compileDiscountsAndVouchers(legacySheets);
assert.deepEqual(legacy.discounts.map((discount) => ({
  code: discount.code,
  method: discount.method,
  amount: discount.amount,
  admissionItemCodes: discount.admissionItemCodes,
})), [
  { code: "EXHCOMP26", method: "percent", amount: 100, admissionItemCodes: ["ATT", "EXH"] },
  { code: "BUY50", method: "amount", amount: 50, admissionItemCodes: ["BUYER"] },
]);
assert.equal(legacy.vouchers.length, 0);
assert.equal(legacy.voucherOutcome.status, "unsupported");
assert.match(legacy.voucherOutcome.reason, /no voucher source/i);

const authoritative = compileDiscountsAndVouchers([
  {
    name: "7. Discounts",
    rows: [
      ["-> Name / Description", "-> Discount Code", "-> Method", "-> Amount / Percentage"],
      ["Name / description", "Discount code", "Method", "Amount / percentage"],
      ["Partner rate", "PARTNER10", "Percentage", "10%"],
      ["Bad rate", "BROKEN", "Mystery", "ten"],
    ],
  },
  {
    name: "8. Vouchers",
    rows: [
      ["-> Voucher Code", "-> Alert Email Address", "-> Description", "-> Capacity"],
      ["Voucher code", "Alert email address", "Description", "Capacity"],
      ["VIP2026", "registration@example.com", "VIP guest comp", "50"],
    ],
  },
]);
assert.equal(authoritative.discounts.length, 1);
assert.equal(authoritative.discounts[0]?.code, "PARTNER10");
assert.equal(authoritative.discountOutcomes.some((outcome) => outcome.status === "review" && outcome.sourceRow === 4), true);
assert.deepEqual(authoritative.vouchers, [{
  code: "VIP2026",
  alertEmail: "registration@example.com",
  description: "VIP guest comp",
  capacity: 50,
  source: { sheet: "8. Vouchers", row: 3 },
}]);
assert.equal(authoritative.voucherOutcome.status, "compiled");

const blankVoucherTemplate = compileDiscountsAndVouchers([{ name: "8. Vouchers", rows: [["Voucher code", "Description"], ["default: EMERALD ONLY - do not fill yet", "default: EMERALD ONLY"]] }]);
assert.deepEqual(blankVoucherTemplate.vouchers, []);
assert.equal(blankVoucherTemplate.voucherOutcome.status, "review");
assert.match(blankVoucherTemplate.voucherOutcome.reason, /no usable voucher rows/i);

console.log("compiler discounts/vouchers smoke: PASS");
