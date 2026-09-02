import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const scriptPath = "deploy/azure/steel-capacity-test.sh";
const script = await readFile(scriptPath, "utf8");
const digest = `ghcr.io/steel-dev/steel-browser@sha256:${"a".repeat(64)}`;

const run = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync("bash", [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

// Dry-run output is deterministic, machine-readable, and never invokes Docker.
const fakeBin = await mkdtemp(join(tmpdir(), "steel-capacity-smoke-"));
const dockerLog = join(fakeBin, "docker-called");
await writeFile(join(fakeBin, "docker"), `#!/bin/sh\nprintf called > ${JSON.stringify(dockerLog)}\nexit 99\n`);
await chmod(join(fakeBin, "docker"), 0o755);
const dryRun = run(["--count", "12", "--image", digest, "--dry-run"], {
  PATH: `${fakeBin}:${process.env.PATH}`,
  STEEL_CAPACITY_RUN_ID: "smoke",
});
assert.equal(dryRun.status, 0, dryRun.stderr);
const plan = JSON.parse(dryRun.stdout);
assert.deepEqual(plan, {
  dry_run: true,
  count: 12,
  image: digest,
  bind_host: "127.0.0.1",
  container_port: 3000,
  create_blank_sessions: false,
  run_id: "smoke",
});
assert.doesNotMatch(dryRun.stdout, /token|cookie|password|authorization/i);
assert.equal(spawnSync("test", ["!", "-e", dockerLog]).status, 0, "dry-run must not invoke Docker");

for (const count of ["0", "11", "13", "35", "37"]) {
  const result = run(["--count", count, "--image", digest, "--dry-run"]);
  assert.notEqual(result.status, 0, `count ${count} must be refused`);
  assert.match(result.stderr, /count.*12.*36/i);
}
for (const image of [
  "ghcr.io/steel-dev/steel-browser:latest",
  "ghcr.io/steel-dev/steel-browser:1.0.0",
  "ghcr.io/steel-dev/steel-browser",
  `ghcr.io/steel-dev/steel-browser@sha256:${"a".repeat(63)}`,
]) {
  const result = run(["--count", "12", "--image", image, "--dry-run"]);
  assert.notEqual(result.status, 0, `mutable image ${image} must be refused`);
  assert.match(result.stderr, /immutable|sha256/i);
}
assert.notEqual(run(["--count", "12", "--image", digest, "--bind", "0.0.0.0", "--dry-run"]).status, 0);
assert.equal(run(["--count", "36", "--image", digest, "--create-blank-sessions", "--dry-run"]).status, 0);

// Static security contract for the live-only path (the smoke never enters it).
assert.match(script, /trap cleanup EXIT INT TERM/);
assert.match(script, /docker run[\s\S]*127\.0\.0\.1::3000/);
assert.match(script, /docker port[\s\S]*127\.0\.0\.1/);
assert.match(script, /docker stats[\s\S]*--no-stream/);
assert.match(script, /about:blank/);
assert.match(script, /documentation\//);
assert.doesNotMatch(script, /https?:\/\/[^"' ]*cvent/i);
assert.match(script, /df -Pk/);
assert.match(script, /available_kb[\s\S]*required_kb/);
assert.match(script, /docker rm -f/);
assert.match(script, /umask 077/);

console.log("steel capacity dry-run/security smoke passed");
