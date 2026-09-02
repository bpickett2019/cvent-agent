import assert from "node:assert/strict";
import { plan } from "./src/planner/plan";
import { assertAuthorizedExecutionTarget } from "./src/safety/authorizedTarget";
import { initialSpec } from "./web/lib/fixtures";

const AUTHORIZED_NAME = "(C+D) Medtrade Testing Clone 2";
const AUTHORIZED_UUID = "e712e34c-6117-4d13-bf4c-8ed54cf2b495";

const authorized = {
  ...structuredClone(initialSpec),
  target: { tenantId: "emerald-pilot", accountId: "emerald-cvent", eventId: AUTHORIZED_UUID, eventName: AUTHORIZED_NAME, mode: "existingEvent" as const },
  details: { ...structuredClone(initialSpec.details), name: AUTHORIZED_NAME, templateEventId: undefined },
};

assert.doesNotThrow(() => assertAuthorizedExecutionTarget(authorized));
const tasks = plan(authorized).tasks;
assert.equal(tasks[0]?.kind, "event.attach");
assert.equal(tasks[0]?.payload.eventId, AUTHORIZED_UUID);
assert.equal(tasks.some((task) => task.kind === "event.create" || task.kind === "event.copy"), false);

for (const target of [
  { tenantId: "emerald-pilot", accountId: "emerald-cvent", eventId: "00000000-0000-0000-0000-000000000000", eventName: AUTHORIZED_NAME, mode: "existingEvent" as const },
  { tenantId: "emerald-pilot", accountId: "emerald-cvent", eventId: AUTHORIZED_UUID, eventName: "Med Trade 2027", mode: "existingEvent" as const },
]) {
  assert.throws(
    () => assertAuthorizedExecutionTarget({ ...authorized, target }),
    /authorized Cvent clone/i
  );
}

assert.throws(
  () => assertAuthorizedExecutionTarget({ ...authorized, details: { ...authorized.details, templateEventId: "legacy-template" } }),
  /create or copy/i
);

console.log("authorized target smoke passed");
