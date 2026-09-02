import assert from "node:assert/strict";
import {
  DOCUMENT_TEAM_ROLES,
  DocumentTeamScheduler,
  assignPlanTasks,
  type PlanTask,
} from "./src/workspace/documentTeam";

assert.equal(DOCUMENT_TEAM_ROLES.length, 12);
assert.equal(new Set(DOCUMENT_TEAM_ROLES).size, 12);
assert.deepEqual(DOCUMENT_TEAM_ROLES, [
  "coordinator",
  "event-details",
  "registration-settings",
  "registration-types",
  "registration-paths",
  "admission-items",
  "optional-items",
  "pricing-fees",
  "discounts-vouchers",
  "registration-questions",
  "site-designer",
  "verification",
]);

const tasks: PlanTask[] = [
  { id: "event", section: "event", eventId: "evt-a", access: "mutation", dependsOn: [] },
  { id: "types", section: "registrationTypes", eventId: "evt-a", access: "mutation", dependsOn: ["event"] },
  { id: "verify-a", section: "verification", eventId: "evt-a", access: "readOnly", dependsOn: [] },
  { id: "verify-b", section: "verification", eventId: "evt-a", access: "readOnly", dependsOn: [] },
];
const assigned = assignPlanTasks(tasks);
assert.equal(assigned.find((task) => task.id === "event")?.role, "event-details");
assert.equal(assigned.find((task) => task.id === "types")?.role, "registration-types");
assert.deepEqual(assignPlanTasks([...tasks].reverse()).sort((a, b) => a.id.localeCompare(b.id)), assigned.slice().sort((a, b) => a.id.localeCompare(b.id)));

const scheduler = new DocumentTeamScheduler();
const teamA = scheduler.activateTeam("document-a", tasks);
const teamB = scheduler.activateTeam("document-b", [
  { id: "other-write", section: "event", eventId: "evt-a", access: "mutation", dependsOn: [] },
]);
const teamC = scheduler.activateTeam("document-c", []);
assert.equal(scheduler.activeTeamCount, 3);
assert.equal(scheduler.activeSlotCount, 36);
assert.throws(() => scheduler.activateTeam("document-d", []), /active document team limit of 3/i);

assert.equal(scheduler.readyTasks(teamA.id).some((task) => task.id === "types"), false);
const writeA = scheduler.claimReady(teamA.id, "event-details");
assert.equal(writeA?.taskId, "event");
assert.equal(scheduler.claimReady(teamB.id, "event-details"), undefined, "a second mutation for one event is blocked");
const readA = scheduler.claimReady(teamA.id, "verification");
const readB = scheduler.claimReady(teamA.id, "verification");
assert.ok(readA && readB, "read-only claims may overlap for one event");

assert.equal(scheduler.complete(writeA!), true);
assert.equal(scheduler.readyTasks(teamA.id).some((task) => task.id === "types"), true);
const writeB = scheduler.claimReady(teamB.id, "event-details");
assert.ok(writeB, "completing a mutation releases the event fence");

const stale = writeB!;
assert.equal(scheduler.releaseClaim(stale), true);
const replacement = scheduler.claimReady(teamB.id, "event-details");
assert.ok(replacement);
assert.ok(replacement!.generation > stale.generation);
assert.equal(scheduler.releaseClaim(stale), false, "a stale generation cannot release a newer claim");
assert.equal(scheduler.complete(stale), false, "a stale generation cannot complete a newer claim");
assert.equal(scheduler.releaseClaim(replacement!), true);

assert.equal(scheduler.releaseTeam(teamC.id, teamC.generation), true);
const reactivated = scheduler.activateTeam("document-c", []);
assert.ok(reactivated.generation > teamC.generation);
assert.equal(scheduler.releaseTeam(reactivated.id, teamC.generation), false, "a stale team generation cannot release a reactivated team");
assert.equal(scheduler.activeTeamCount, 3);

console.log("document team smoke passed");
