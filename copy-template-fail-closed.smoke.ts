import assert from "node:assert/strict";
import type { BrowserProvider } from "./src/browser/driver";
import type { CventApi } from "./src/cvent/api";
import { assertTemplateCopyExecutionAvailable } from "./src/run/copyTemplate";
import { createRunOrchestrator, InMemoryRunStore } from "./src/run/orchestrator";
import { EventSpec } from "./src/spec/eventSpec";

const spec = EventSpec.parse({
  specVersion: "1.0",
  target: {
    mode: "copyTemplate",
    tenantId: "tenant",
    accountId: "account",
    templateEventId: "6d5f9383-432b-4b87-a59b-c37163d72c19",
    templateEventName: "Authorized Template",
    newEventName: "Safe New Event",
  },
  details: {
    name: "Safe New Event",
    timezone: "America/Los_Angeles",
    start: "2027-03-15T09:00:00-07:00",
    end: "2027-03-17T17:00:00-07:00",
    format: "inPerson",
    templateEventId: "6d5f9383-432b-4b87-a59b-c37163d72c19",
  },
  registrationTypes: [], questions: [],
  registration: { admissionItems: [], optionalItems: [], vouchers: [], paths: [], advancedRules: [] },
});

assert.throws(
  () => assertTemplateCopyExecutionAvailable(spec),
  /copy contract not verified/,
  "queue admission must reject copy specs when no verified capability is available",
);
assert.doesNotThrow(() => assertTemplateCopyExecutionAvailable(spec, { verified: true }));

let createRunCalls = 0;
let copyEventCalls = 0;
const store = new InMemoryRunStore();
const originalCreateRun = store.createRun.bind(store);
store.createRun = async (input) => { createRunCalls += 1; return originalCreateRun(input); };
const api = {
  copyEvent: async () => { copyEventCalls += 1; return { id: "3f2b6a10-9c4d-4e21-b8f7-0a1c2d3e4f56" }; },
} as unknown as CventApi;
const browserProvider = { name: "unused", connect: async () => { throw new Error("browser must not open"); } } as BrowserProvider;
const run = createRunOrchestrator();
await assert.rejects(
  run({
    spec,
    operator: { id: "operator", email: "operator@example.com" },
    store,
    api,
    browserProvider,
    denyList: { selectors: [], urlPatterns: [] },
    costCeilingUsd: 30,
    costAlertUsd: 20,
  }),
  /copy contract not verified/,
);
assert.equal(createRunCalls, 0, "direct orchestration must reject before creating durable run state");
assert.equal(copyEventCalls, 0, "legacy CventApi.copyEvent must never be called");

console.log("COPY TEMPLATE FAIL-CLOSED CHECKS PASSED");
