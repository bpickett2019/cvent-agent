import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bootstrap = await readFile("deploy/azure/bootstrap-pilot.sh", "utf8");
const service = await readFile("deploy/systemd/cvent-agent.service", "utf8");
const envExample = await readFile("deploy/systemd/cvent-agent.env.example", "utf8");
const runbook = await readFile("docs/azure-vm-pilot-runbook.md", "utf8");

// The service can read the registry, but neither it nor other users can read the root-only env file.
assert.match(bootstrap, /chown root:root "\$ENV_FILE"/);
assert.match(bootstrap, /chmod 0600 "\$ENV_FILE"/);
assert.match(bootstrap, /chown root:cventagent "\$AUTH_FILE"/);
assert.match(bootstrap, /chmod 0640 "\$AUTH_FILE"/);
assert.doesNotMatch(bootstrap, /chmod 600 "\$ENV_FILE" "\$AUTH_FILE"/);
assert.match(service, /^Group=cventagent$/m);
assert.match(service, /^SupplementaryGroups=docker$/m);

// npm runs as cventagent only after the reviewed checkout is safely assigned to it.
const ownership = bootstrap.indexOf('chown -R cventagent:cventagent "$SOURCE_DIR"');
const npmCi = bootstrap.indexOf('sudo -u cventagent npm --prefix "$SOURCE_DIR" ci');
assert.ok(ownership >= 0 && ownership < npmCi, "source ownership must be set before npm ci");
assert.match(bootstrap, /chmod -R u\+rwX,go-w "\$SOURCE_DIR"/);

// Both the pilot container and per-workspace containers use an explicitly reviewed immutable image.
assert.match(bootstrap, /STEEL_IMAGE=.*STEEL_IMAGE/);
assert.match(bootstrap, /sha256:\[0-9a-fA-F\]\{64\}/);
assert.match(bootstrap, /"\$STEEL_IMAGE"/);
assert.match(bootstrap, /STEEL_WORKSPACE_IMAGE.*digest-pinned/);
assert.match(bootstrap, /STEEL_WORKSPACE_IMAGE != "\$STEEL_IMAGE"/);
assert.doesNotMatch(bootstrap, /\n\s*ghcr\.io\/steel-dev\/steel-browser\s*>/);
assert.match(envExample, /STEEL_WORKSPACE_IMAGE=.*@sha256:<reviewed-64-hex-digest>/);
assert.match(runbook, /STEEL_IMAGE=.*@sha256:<reviewed-64-hex-digest>/);
assert.match(runbook, /replace.*placeholder.*review/si);

console.log("deployment bootstrap security smoke passed");
