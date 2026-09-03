import assert from "node:assert/strict";
import { copyTemplateTasks, plan } from "./src/planner/plan";
import {
  runCopyTemplateLifecycle,
  type CopyTemplateCheckpoint,
  type CopyTemplateServices,
} from "./src/run/copyTemplate";

const TEMPLATE_ID = "6d5f9383-432b-4b87-a59b-c37163d72c19";
const CREATED_ID = "3f2b6a10-9c4d-4e21-b8f7-0a1c2d3e4f56";
const target = {
  mode: "copyTemplate" as const,
  tenantId: "emerald-pilot",
  accountId: "emerald-cvent",
  templateEventId: TEMPLATE_ID,
  templateEventName: "Authorized Template",
  newEventName: "Safe New Event",
  newEventCode: "SAFE27",
};

const lifecycleTasks = copyTemplateTasks(target, { name: target.newEventName, code: target.newEventCode });
assert.deepEqual(lifecycleTasks.map((task) => task.id), [
  "event.template.authorize",
  "event.shell",
  "event.copy.verify",
  "event.postCopyGrant",
]);
assert.deepEqual(lifecycleTasks[1].dependsOn, ["event.template.authorize"]);
assert.deepEqual(lifecycleTasks[2].dependsOn, ["event.shell"]);
assert.deepEqual(lifecycleTasks[3].dependsOn, ["event.copy.verify"]);
assert.equal(lifecycleTasks[0].payload.templateEventId, TEMPLATE_ID);
assert.equal("wildcard" in lifecycleTasks[0].payload, false);

const spec = {
  specVersion: "1.0",
  target,
  details: {
    name: target.newEventName,
    code: target.newEventCode,
    timezone: "America/Los_Angeles",
    start: "2027-03-15T09:00:00-07:00",
    end: "2027-03-17T17:00:00-07:00",
    format: "inPerson",
    templateEventId: TEMPLATE_ID,
  },
  registrationTypes: [], questions: [],
  registration: { admissionItems: [], optionalItems: [], vouchers: [], paths: [], advancedRules: [] },
} as any;
const planned = plan(spec);
assert.deepEqual(planned.tasks.slice(0, 4).map((task) => task.id), lifecycleTasks.map((task) => task.id));
assert.equal(planned.tasks.find((task) => task.id === "event.details")?.dependsOn[0], "event.postCopyGrant");
assert.deepEqual((planned.tasks.find((task) => task.id === "event.details")?.payload.guard), {
  eventIdFrom: "event.postCopyGrant", eventName: target.newEventName,
});

const checkpoints: CopyTemplateCheckpoint[] = [];
let authorizeCalls = 0;
let copyCalls = 0;
let readCalls = 0;
let countCalls = 0;
let mintCalls = 0;
const services: CopyTemplateServices = {
  authorizeTemplate: async (request) => {
    authorizeCalls += 1;
    assert.deepEqual(request, {
      tenantId: target.tenantId,
      accountId: target.accountId,
      templateEventId: TEMPLATE_ID,
      templateEventName: target.templateEventName,
      permission: "copy",
    });
    return Object.freeze({ ...request, permission: "copy" as const, grantId: "template-grant-1" });
  },
  copyTemplate: async (grant, details) => {
    copyCalls += 1;
    assert.equal(grant.templateEventId, TEMPLATE_ID);
    assert.equal(details.name, target.newEventName);
    return { id: CREATED_ID };
  },
  readEvent: async (eventId) => {
    readCalls += 1;
    assert.equal(eventId, CREATED_ID);
    return { id: CREATED_ID, name: target.newEventName, status: "Draft" };
  },
  readRegistrationCount: async (eventId) => {
    countCalls += 1;
    assert.equal(eventId, CREATED_ID);
    return 0;
  },
  mintPostCopyGrant: async (request) => {
    mintCalls += 1;
    return Object.freeze({ ...request, grantId: "post-copy-grant-1", permissions: Object.freeze(["read", "configure"] as const) });
  },
};
const checkpointStore = {
  load: async () => structuredClone(checkpoints),
  save: async (_runId: string, checkpoint: CopyTemplateCheckpoint) => { checkpoints.push(structuredClone(checkpoint)); },
};

const first = await runCopyTemplateLifecycle({
  runId: "run-1", target, details: spec.details, services, checkpointStore,
});
assert.equal(first.eventId, CREATED_ID);
assert.equal(Object.isFrozen(first.postCopyGrant), true);
assert.equal(first.postCopyGrant.eventId, CREATED_ID);
assert.equal(first.postCopyGrant.runId, "run-1");
assert.deepEqual(first.postCopyGrant.permissions, ["read", "configure"]);
assert.equal(first.postCopyGrant.permissions.includes("delete" as never), false);
assert.equal(first.postCopyGrant.permissions.includes("publish" as never), false);
assert.deepEqual([authorizeCalls, copyCalls, readCalls, countCalls, mintCalls], [1, 1, 1, 1, 1]);

const resumed = await runCopyTemplateLifecycle({
  runId: "run-1", target, details: spec.details, services, checkpointStore,
});
assert.equal(resumed.eventId, CREATED_ID);
assert.deepEqual([authorizeCalls, copyCalls, readCalls, countCalls, mintCalls], [1, 1, 1, 1, 1]);
assert.deepEqual(resumed.postCopyGrant, first.postCopyGrant);

const interrupted: CopyTemplateCheckpoint[] = checkpoints.filter((checkpoint) => checkpoint.phase !== "grant");
let resumedMintCalls = 0;
const afterVerification = await runCopyTemplateLifecycle({
  runId: "run-2", target, details: spec.details,
  services: { ...services, mintPostCopyGrant: async (request) => {
    resumedMintCalls += 1;
    return Object.freeze({ ...request, grantId: "post-copy-grant-2", permissions: Object.freeze(["read", "configure"] as const) });
  } },
  checkpointStore: {
    load: async () => structuredClone(interrupted),
    save: async (_runId, checkpoint) => { interrupted.push(structuredClone(checkpoint)); },
  },
});
assert.equal(afterVerification.eventId, CREATED_ID);
assert.equal(resumedMintCalls, 1);
assert.equal(copyCalls, 1, "resume after copy checkpoint must never copy again");

await assert.rejects(
  runCopyTemplateLifecycle({
    runId: "run-bad", target, details: spec.details, services: {
      ...services,
      readEvent: async () => ({ id: CREATED_ID, name: "Wrong Name", status: "Draft" }),
    },
    checkpointStore: { load: async () => [], save: async () => {} },
  }),
  /proposed name/i,
);

console.log("COPY TEMPLATE CHECKS PASSED");
