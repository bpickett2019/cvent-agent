import assert from "node:assert/strict";
import { CventApi } from "./src/cvent/api";
import {
  CVENT_TEMPLATE_COPY_CONTRACT_FIXTURE,
  createCventTemplateCopyContract,
  type CventContractRequest,
  type CventOperationPoller,
  type CventTransport,
} from "./src/cvent/templateCopyContract";

const requests: CventContractRequest[] = [];
const transport: CventTransport = async (request) => {
  requests.push(request);
  if (request.path === "/events/template-123/copy") {
    return { status: 202, body: { operationId: "operation-456", status: "pending" } };
  }
  if (request.path === "/events/event-789") {
    return {
      status: 200,
      body: {
        id: "event-789",
        title: "Annual Summit",
        status: "Draft",
        start: "2027-04-01T09:00:00-07:00",
        end: "2027-04-01T17:00:00-07:00",
        timezone: "America/Los_Angeles",
      },
    };
  }
  throw new Error(`unexpected request ${request.method} ${request.path}`);
};

const pollCalls: unknown[] = [];
const pollOperation: CventOperationPoller = async (operation) => {
  pollCalls.push(operation);
  return { operationId: operation.operationId, status: "succeeded", eventId: "event-789" };
};

const client = createCventTemplateCopyContract({
  transport,
  pollOperation,
  verification: { enabled: true, fixture: CVENT_TEMPLATE_COPY_CONTRACT_FIXTURE },
});
const result = await client.copyTemplate({
  templateEventId: "template-123",
  idempotencyKey: "copy:annual-summit:2027",
  event: {
    title: "Annual Summit",
    start: "2027-04-01T09:00:00-07:00",
    end: "2027-04-01T17:00:00-07:00",
    timezone: "America/Los_Angeles",
  },
});

assert.deepEqual(requests, [
  {
    method: "POST",
    path: "/events/template-123/copy",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "copy:annual-summit:2027",
    },
    body: {
      title: "Annual Summit",
      start: "2027-04-01T09:00:00-07:00",
      end: "2027-04-01T17:00:00-07:00",
      timezone: "America/Los_Angeles",
    },
  },
  { method: "GET", path: "/events/event-789", headers: { accept: "application/json" } },
]);
assert.deepEqual(pollCalls, [{ operationId: "operation-456", status: "pending" }]);
assert.equal(result.id, "event-789");
assert.equal(result.status, "Draft");

let dispatches = 0;
const countingTransport: CventTransport = async () => {
  dispatches += 1;
  throw new Error("must not dispatch");
};
const disabled = createCventTemplateCopyContract({ transport: countingTransport, pollOperation });
await assert.rejects(
  disabled.copyTemplate({
    templateEventId: "template-123",
    idempotencyKey: "key",
    event: {
      title: "Annual Summit",
      start: "2027-04-01T09:00:00Z",
      end: "2027-04-01T17:00:00Z",
      timezone: "UTC",
    },
  }),
  /provisional.*disabled/i
);
assert.equal(dispatches, 0);

const invalidInputs = [
  { templateEventId: "", idempotencyKey: "key", event: { title: "x", start: "2027-01-01", end: "2027-01-02", timezone: "UTC" } },
  { templateEventId: "template", idempotencyKey: " ", event: { title: "x", start: "2027-01-01", end: "2027-01-02", timezone: "UTC" } },
  { templateEventId: "template", idempotencyKey: "key", event: { title: "", start: "bad", end: "2027-01-02", timezone: "UTC" } },
];
for (const input of invalidInputs) {
  const guarded = createCventTemplateCopyContract({
    transport: countingTransport,
    pollOperation,
    verification: { enabled: true, fixture: CVENT_TEMPLATE_COPY_CONTRACT_FIXTURE },
  });
  await assert.rejects(guarded.copyTemplate(input), /invalid template copy request/i);
}
assert.equal(dispatches, 0);

let liveFetches = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  liveFetches += 1;
  throw new Error("network dispatch attempted");
}) as typeof fetch;
try {
  const legacyApi = new CventApi({ clientId: "not-used", clientSecret: "not-used" });
  await assert.rejects(legacyApi.copyEvent("template-123", { title: "Annual Summit" }), /provisional.*disabled/i);
  assert.equal(liveFetches, 0);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("cvent template copy contract smoke: PASS");
