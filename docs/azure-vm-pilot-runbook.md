# CVENT-agent Azure VM Pilot Runbook

## Purpose

Deploy the current Docker-backed CVENT-agent pilot to one private Azure Linux VM using Azure CLI. This is the compatible first deployment for the current workspace manager, which starts one local Steel container per active agent by invoking the host Docker daemon.

This is not the final horizontally scalable architecture. Standard Azure Container Apps cannot run the current nested Docker workspace model. Production scale should move browser workspaces to AKS or a dedicated workspace service, and replace file persistence with PostgreSQL plus Service Bus.

## Safety boundary

- Deploy only reviewed, committed source from the private `bpickett2019/cvent-agent` repository.
- Do not deploy an uncommitted worktree.
- Do not expose Steel API, viewer, or CDP ports publicly.
- Do not place credentials in commands, shell history, images, GitHub, logs, or prompts.
- The operator performs Cvent/Microsoft login and MFA manually.
- Keep Delete/Remove, Publish/Go Live, communications, and attendee actions permanently denied.
- Add client events through the authorization registry; never use wildcard event access.

## Recommended pilot topology

```text
Operator
  -> SSH tunnel or Azure Bastion
      -> Azure Ubuntu VM
          -> CVENT-agent Next.js UI/API on 127.0.0.1:4320
          -> one-shot Pi workers
          -> workspace manager
          -> dedicated Steel/Chromium container per active job (max 6)
          -> private local queue/run/workspace/session data
```

All Steel containers share the VM egress IP but have isolated Chromium sessions and unique host API/CDP ports.

## Required operator inputs

Set these locally before running Azure CLI. Values below are examples, not defaults:

```bash
export AZ_SUBSCRIPTION_ID='<reviewed subscription UUID>'
export AZ_LOCATION='eastus2'
export AZ_RESOURCE_GROUP='rg-cvent-agent-pilot'
export AZ_VM_NAME='vm-cvent-agent-pilot'
export AZ_ADMIN_USER='azureuser'
export AZ_VM_SIZE='Standard_D8s_v5'
export AZ_VNET='vnet-cvent-agent-pilot'
export AZ_SUBNET='snet-cvent-agent'
export AZ_NSG='nsg-cvent-agent-pilot'
export ADMIN_CIDR='<operator public IP>/32'
export SSH_PUBLIC_KEY="$HOME/.ssh/id_ed25519.pub"
```

The deployment agent must validate that none are blank and must print only non-secret resource identifiers.

## Azure CLI bootstrap

```bash
az login
az account set --subscription "$AZ_SUBSCRIPTION_ID"
az account show --query '{name:name,id:id,tenantId:tenantId}' -o json

az group create \
  --name "$AZ_RESOURCE_GROUP" \
  --location "$AZ_LOCATION"

az network vnet create \
  --resource-group "$AZ_RESOURCE_GROUP" \
  --name "$AZ_VNET" \
  --address-prefixes 10.40.0.0/16 \
  --subnet-name "$AZ_SUBNET" \
  --subnet-prefixes 10.40.1.0/24

az network nsg create \
  --resource-group "$AZ_RESOURCE_GROUP" \
  --name "$AZ_NSG" \
  --location "$AZ_LOCATION"

az network nsg rule create \
  --resource-group "$AZ_RESOURCE_GROUP" \
  --nsg-name "$AZ_NSG" \
  --name AllowRestrictedSSH \
  --priority 100 \
  --access Allow \
  --protocol Tcp \
  --direction Inbound \
  --source-address-prefixes "$ADMIN_CIDR" \
  --destination-port-ranges 22

az vm create \
  --resource-group "$AZ_RESOURCE_GROUP" \
  --name "$AZ_VM_NAME" \
  --image Ubuntu2204 \
  --size "$AZ_VM_SIZE" \
  --admin-username "$AZ_ADMIN_USER" \
  --ssh-key-values "$SSH_PUBLIC_KEY" \
  --vnet-name "$AZ_VNET" \
  --subnet "$AZ_SUBNET" \
  --nsg "$AZ_NSG" \
  --public-ip-sku Standard \
  --storage-sku Premium_LRS
```

Do not create inbound rules for 4320, Steel API ports, viewer ports, or CDP ports.

## VM preparation

Retrieve the reviewed VM address:

```bash
export AZ_VM_IP=$(az vm show -d \
  --resource-group "$AZ_RESOURCE_GROUP" \
  --name "$AZ_VM_NAME" \
  --query publicIps -o tsv)
```

Run bootstrap through SSH:

```bash
ssh "$AZ_ADMIN_USER@$AZ_VM_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
sudo apt-get update
sudo apt-get install -y ca-certificates curl git jq
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
sudo mkdir -p /opt/cvent-agent /var/lib/cvent-agent
sudo chown -R "$USER:$USER" /opt/cvent-agent /var/lib/cvent-agent
REMOTE
```

Reconnect after the Docker group change.

## Source deployment

Use one of these approved methods:

1. CI builds a signed image in Azure Container Registry and the VM pulls the immutable digest.
2. For the pilot only, clone the reviewed private repository using an operator-configured GitHub credential helper or deploy key.

Never paste a GitHub token into a command or prompt.

Example source checkout after the operator configures GitHub access:

```bash
ssh "$AZ_ADMIN_USER@$AZ_VM_IP"
cd /opt/cvent-agent
git clone https://github.com/bpickett2019/cvent-agent.git source
cd source
git fetch --all --tags
git checkout '<reviewed commit SHA>'
git status --short
```

`git status --short` must be empty.

## Runtime secrets

The current pilot still consumes environment variables and a private `session.json`. Until Key Vault/Blob integration is completed:

- The operator installs `/etc/cvent-agent/cvent-agent.env` through an approved secret channel.
- The environment file remains owner `root:root`, mode `0600`; systemd reads it before dropping privileges.
- The authorization registry is installed separately as `root:cventagent`, mode `0640`, so only root and the service account can read it.
- The deployment agent must not read or print either file.
- The Cvent client secret exposed in an earlier transcript must be rotated before deployment.

Required configuration names include:

```text
CVENT_CLIENT_ID
CVENT_CLIENT_SECRET
CVENT_API_BASE_URL
STEEL_API_KEY
EMERALDX_STEEL_WORKSPACE_MODE=containers
EMERALDX_WORKSPACE_DIR=/var/lib/cvent-agent/workspaces
EMERALDX_QUEUE_DIR=/var/lib/cvent-agent/queue
EMERALDX_RUN_DIR=/var/lib/cvent-agent/runs
EMERALDX_ASSET_DIR=/var/lib/cvent-agent/assets
EMERALDX_SESSION_PATH=/var/lib/cvent-agent/session.json
EMERALDX_AUTHORIZATION_PATH=/etc/cvent-agent/authorizations.json
```

The authorization registry must be reviewed and copied separately with no wildcard events.

Pin both the pilot Steel container and all per-workspace Steel containers to the same reviewed immutable digest. Replace the placeholder below only after image review; tags such as `latest` are not acceptable:

```bash
export STEEL_IMAGE='ghcr.io/steel-dev/steel-browser@sha256:<reviewed-64-hex-digest>'
# Set STEEL_WORKSPACE_IMAGE in cvent-agent.env to the identical digest reference.
sudo --preserve-env=STEEL_IMAGE /opt/cvent-agent/source/deploy/azure/bootstrap-pilot.sh
```

The bootstrap rejects blank, tagged, malformed, or non-digest `STEEL_IMAGE` values. It also assigns the reviewed checkout to `cventagent` and removes group/world write access before running `npm ci`, tests, and the web build as that account.

## Build and service

The repository still needs a production Dockerfile or systemd packaging. For a pilot source deployment, install the pinned Node version and build:

```bash
cd /opt/cvent-agent/source
npm ci
npm test
cd web
npm ci
npm run build
```

Create a systemd unit only after the exact start command and environment path are reviewed. Bind the service to `127.0.0.1:4320`.

Example target command:

```bash
npm run start -- --hostname 127.0.0.1 --port 4320
```

## Operator access

From the operator machine:

```bash
ssh -N -L 4320:127.0.0.1:4320 "$AZ_ADMIN_USER@$AZ_VM_IP"
```

Open:

```text
http://127.0.0.1:4320
```

Do not expose the UI publicly until Entra ID is implemented and verified.

## Golden login

1. Start the attended Golden Cvent Login session from the tunneled UI.
2. Operator completes Microsoft/Cvent login and MFA.
3. Capture only after redirect to authenticated `app.cvent.com`.
4. Verify private context storage mode `0600`.
5. Recreate two isolated workspaces and prove login reuse.
6. Never store raw passwords or MFA values.

## Deployment verification

Run in this order:

1. UI health returns 200 through the tunnel.
2. No Azure NSG rule exposes 4320 or dynamic Steel/CDP ports.
3. Golden login capture and two-session reuse pass.
4. Registry loads and denies unknown tenant/account/event tuples.
5. Authorized event read-only preflight confirms UUID, visible name, account, and Draft status.
6. Start one harmless read-only worker; confirm workspace appears, viewer connects, activity reports, and workspace disappears at completion.
7. Verify Take over pauses before user control; Return leaves automation paused; explicit Resume continues.
8. Verify Stop/Cancel preserve checkpoints and do not retry.
9. Run bounded authorized-clone benchmark.
10. Run idempotent rerun and prove no duplicates/unnecessary Saves.

## Rollback

- Keep the previous reviewed commit/image digest.
- Stop the systemd/container service.
- Preserve `/var/lib/cvent-agent` before rollback.
- Restore the previous image/commit.
- Run read-only health and registry checks before re-enabling workers.
- Never roll back database schema after PostgreSQL migration without a reviewed reversible migration.

## Production migration

Before horizontal scale/client production:

- PostgreSQL becomes the system of record.
- Service Bus carries job notifications only.
- Golden context and evidence move to private Blob Storage.
- Secrets move to Key Vault through managed identity.
- Entra ID protects every UI/API route.
- Browser workspace orchestration moves to AKS or a dedicated workspace service; host Docker remains pilot/local only.
