import assert from "node:assert/strict";
import { publicRunStatus, queueDispositionForRunStatus } from "./src/queue/runDisposition";
assert.equal(queueDispositionForRunStatus("succeeded"), "complete");
assert.equal(queueDispositionForRunStatus("halted"), "fail");
assert.equal(queueDispositionForRunStatus("partial"), "fail");
assert.equal(publicRunStatus("succeeded", "halted"), "halted");
assert.equal(publicRunStatus("succeeded", "succeeded"), "succeeded");
console.log("worker run disposition smoke passed");
