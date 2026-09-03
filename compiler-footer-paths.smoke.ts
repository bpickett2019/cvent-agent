import assert from "node:assert/strict";
import {
  compileFooterLinks,
  compileRegistrationPaths,
  FOOTER_LINK_CONTRACT,
  REGISTRATION_PATH_CONTRACT,
} from "./web/lib/compiler/footer-paths";

assert.equal(FOOTER_LINK_CONTRACT.length, 10);
const footer = compileFooterLinks([
  { include: "Yes", destination: "https://example.com/hours", label: "Show Hours" },
  { include: "No", destination: "https://example.com/policy", label: "Show Policy" },
  { include: "Yes", destination: "https://example.com/hotel", label: "Hotel Info" },
  { include: "Yes", destination: "https://example.com/mystery", label: "Mystery Link" },
]);
assert.deepEqual(footer[0], {
  slice: "footer-link",
  key: "show-hours",
  sourceLabel: "Show Hours",
  cventField: "Show Hours link",
  include: true,
  destination: "https://example.com/hours",
  outcome: "exact",
  reason: "Confirmed by the authoritative Cvent field map.",
});
assert.equal(footer[1]?.include, false);
assert.equal(footer[1]?.destination, undefined);
assert.equal(footer[1]?.outcome, "exact");
assert.equal(footer[2]?.key, "hotel-info");
assert.equal(footer[2]?.outcome, "review");
assert.match(footer[2]?.reason ?? "", /needs confirmation/i);
assert.deepEqual(footer[3], {
  slice: "footer-link",
  key: "unsupported:mystery-link",
  sourceLabel: "Mystery Link",
  cventField: null,
  include: true,
  destination: "https://example.com/mystery",
  outcome: "unsupported",
  reason: "The footer label is not part of the authoritative intake contract.",
});

assert.deepEqual(
  FOOTER_LINK_CONTRACT.map(({ sourceLabel, cventField, outcome }) => ({ sourceLabel, cventField, outcome })),
  [
    ["Show Hours", "Show Hours link", "exact"],
    ["Show Policy", "Show Policy link", "exact"],
    ["Emerald Privacy Policy", "Emerald Privacy Policy link", "exact"],
    ["Browse Sessions", "Browse Sessions link", "exact"],
    ["Review Pricing", "Review Pricing link", "exact"],
    ["Registration Status", "Registration Status link", "exact"],
    ["FAQ", "FAQ link", "exact"],
    ["Contact Us button", "Contact Us button", "exact"],
    ["Exhibitor Resource Center", "Exhibitor Resource Center link", "exact"],
    ["Hotel Info", "Hotel Info link", "review"],
  ].map(([sourceLabel, cventField, outcome]) => ({ sourceLabel, cventField, outcome })),
);

assert.deepEqual(REGISTRATION_PATH_CONTRACT, [
  { sourceField: "name", cventField: "Path list", outcome: "review" },
  { sourceField: "privacy", cventField: "Path Privacy", outcome: "review" },
  { sourceField: "status", cventField: "Path Status", outcome: "review" },
  { sourceField: "redirectUrl", cventField: "Post-registration redirect URL", outcome: "exact" },
]);
const paths = compileRegistrationPaths([
  {
    name: "Attendee",
    privacy: "Public - on the registration site",
    status: "Active",
    redirectUrl: "https://emeraldx.com/thank-you",
  },
]);
assert.deepEqual(paths.map(({ sourceField, outcome }) => [sourceField, outcome]), [
  ["name", "review"],
  ["privacy", "review"],
  ["status", "review"],
  ["redirectUrl", "exact"],
]);
assert.equal(paths[0]?.pathName, "Attendee");
assert.match(paths[0]?.reason ?? "", /existing path/i);

const unsupportedPath = compileRegistrationPaths([
  { name: "VIP", privacy: "Public", status: "Active", redirectUrl: "https://example.com", create: true },
]);
assert.ok(unsupportedPath.every((field) => field.outcome === "unsupported"));
assert.ok(unsupportedPath.every((field) => /cannot create/i.test(field.reason)));

console.log("footer links and registration paths compiler smoke passed");
