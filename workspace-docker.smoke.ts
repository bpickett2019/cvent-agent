import assert from "node:assert/strict";
import { buildDockerSteelRunArgs, resolveWorkspaceImage } from "./src/workspace/manager";

const args = buildDockerSteelRunArgs({ id: "workspace-1", ownerJobId: "job-1" }, 54351, 54352, "steel:test", "cvent-steel-worker");
assert.equal(args.includes("127.0.0.1:54351:3000"), true);
assert.equal(args.includes("127.0.0.1:54352:9223"), true);
assert.equal(args.includes("DOMAIN=127.0.0.1:54351"), true);
assert.equal(args.includes("CDP_DOMAIN=127.0.0.1:54352"), true);
assert.equal(args.includes("127.0.0.1::3000"), false);
assert.throws(() => resolveWorkspaceImage(undefined, true), /immutable/i);
assert.throws(() => resolveWorkspaceImage("ghcr.io/steel-dev/steel-browser:latest", true), /immutable/i);
assert.equal(resolveWorkspaceImage(`ghcr.io/steel-dev/steel-browser@sha256:${"a".repeat(64)}`, true).endsWith("a".repeat(64)), true);
assert.equal(resolveWorkspaceImage(undefined, false), "ghcr.io/steel-dev/steel-browser");
console.log("workspace Docker URL smoke passed");
