/** Offline acceptance tests. No Cvent, browser, network, or model execution. */
import assert from "node:assert/strict";
import { EventSpec } from "./src/spec/eventSpec";
import {
  ACCEPTANCE_EVENT_ID,
  ACCEPTANCE_EVENT_NAME,
  ACCEPTANCE_FIXTURE_OBJECTS,
  acceptanceEventSpec,
  assertIdempotentSecondRun,
  reconcileFixtureObjects,
  summarizeReconciliation,
  type FixtureObject,
} from "./src/acceptance/boundedFixture";

const parsed = EventSpec.parse(acceptanceEventSpec);
assert.equal(parsed.target?.eventId, ACCEPTANCE_EVENT_ID);
assert.equal(parsed.target?.eventName, ACCEPTANCE_EVENT_NAME);
assert.equal(parsed.details.name, ACCEPTANCE_EVENT_NAME);
assert.equal(parsed.target?.mode, "existingEvent");
assert.equal(parsed.details.name, "(C+D) Medtrade Testing Clone 2");

const serialized = JSON.stringify(parsed).toLowerCase();
for (const forbidden of ["rename", "delete", "remove", "publish", "go live", "communicat", "attendee"]) {
  assert.equal(serialized.includes(forbidden), false, `fixture must not contain forbidden capability: ${forbidden}`);
}

const fixtureNames = ACCEPTANCE_FIXTURE_OBJECTS.map((object) => object.name);
assert.equal(new Set(fixtureNames).size, fixtureNames.length, "acceptance object names must be unique");
assert.equal(fixtureNames.every((name) => name.startsWith("[ACCEPTANCE MOCK e712e34c]")), true);
assert.equal(Object.isFrozen(ACCEPTANCE_FIXTURE_OBJECTS), true);

const desired: readonly FixtureObject[] = structuredClone(ACCEPTANCE_FIXTURE_OBJECTS);
const current: FixtureObject[] = [
  { id: "q-update", ...desired[1], values: { required: false } },
  { id: "q-correct", ...desired[2] },
  { id: "q-conflict-a", ...desired[3] },
  { id: "q-conflict-b", ...desired[3] },
];

const first = reconcileFixtureObjects(desired, current);
assert.deepEqual(first.map((row) => row.status), ["created", "updated", "already-correct", "conflict"]);
assert.deepEqual(summarizeReconciliation(first), {
  total: 4,
  created: 1,
  updated: 1,
  "already-correct": 1,
  conflict: 1,
  creates: 1,
  saves: 1,
});
assert.equal(first[3]?.reason, "multiple existing objects match the fixture identity");

const converged = desired.map((object, index) => ({ ...object, id: `retained-${index + 1}` }));
const second = reconcileFixtureObjects(desired, converged);
assert.deepEqual(second.map((row) => row.status), ["already-correct", "already-correct", "already-correct", "already-correct"]);
assert.doesNotThrow(() => assertIdempotentSecondRun(second));
assert.deepEqual(summarizeReconciliation(second), {
  total: 4,
  created: 0,
  updated: 0,
  "already-correct": 4,
  conflict: 0,
  creates: 0,
  saves: 0,
});
assert.throws(() => assertIdempotentSecondRun(first), /zero creates and zero saves/i);

console.log("PASS bounded acceptance fixture and reconciliation receipts (offline only)");
