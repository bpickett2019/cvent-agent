import assert from "node:assert/strict";
import { plan } from "./src/planner/plan";
import { liveBoundedVoucherSpec } from "./src/acceptance/liveBoundedVoucher";

const planned = plan(liveBoundedVoucherSpec);
assert.equal(liveBoundedVoucherSpec.target?.eventId, "e712e34c-6117-4d13-bf4c-8ed54cf2b495");
assert.equal(liveBoundedVoucherSpec.target?.eventName, "(C+D) Medtrade Testing Clone 2");
assert.deepEqual(planned.tasks.filter((task) => task.channel === "browser").map((task) => task.id), ["event.details", "reg.voucher.HERMESQA260901"]);
assert.ok(planned.tasks.every((task) => !/delete|remove|publish|communication|attendee/i.test(`${task.kind} ${task.procedure ?? ""}`)));
assert.equal(liveBoundedVoucherSpec.registration.vouchers.length, 1);
console.log("live bounded voucher acceptance smoke passed");
