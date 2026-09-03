#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR=${SOURCE_DIR:-/opt/cvent-agent/source}
STATE_DIR=${STATE_DIR:-/var/lib/cvent-agent}
ENV_FILE=${ENV_FILE:-/etc/cvent-agent/cvent-agent.env}
AUTH_FILE=${AUTH_FILE:-/etc/cvent-agent/authorizations.json}
STEEL_IMAGE=${STEEL_IMAGE:-}

if [[ $EUID -ne 0 ]]; then echo 'Run with sudo/root.' >&2; exit 1; fi
if [[ ! -f "$SOURCE_DIR/package-lock.json" || ! -f "$SOURCE_DIR/web/package-lock.json" ]]; then echo 'Reviewed source checkout is missing.' >&2; exit 1; fi
if [[ -n $(git -C "$SOURCE_DIR" status --short) ]]; then echo 'Refusing to deploy a dirty source checkout.' >&2; exit 1; fi
if [[ ! -s "$ENV_FILE" || ! -s "$AUTH_FILE" ]]; then echo 'Private environment and authorization registry must be installed first.' >&2; exit 1; fi
if [[ ! $STEEL_IMAGE =~ ^[^[:space:]@]+@sha256:[0-9a-fA-F]{64}$ ]]; then echo 'STEEL_IMAGE must be a reviewed immutable image reference ending in @sha256:<64 hex characters>.' >&2; exit 1; fi
STEEL_WORKSPACE_IMAGE=''
while IFS='=' read -r key value; do [[ $key == STEEL_WORKSPACE_IMAGE ]] && STEEL_WORKSPACE_IMAGE=$value; done < "$ENV_FILE"
if [[ ! $STEEL_WORKSPACE_IMAGE =~ ^[^[:space:]@]+@sha256:[0-9a-fA-F]{64}$ ]]; then echo 'STEEL_WORKSPACE_IMAGE in the private environment must be digest-pinned.' >&2; exit 1; fi
if [[ $STEEL_WORKSPACE_IMAGE != "$STEEL_IMAGE" ]]; then echo 'Main Steel and workspace Steel must use the identical reviewed digest.' >&2; exit 1; fi

getent group cventagent >/dev/null 2>&1 || groupadd --system cventagent
id cventagent >/dev/null 2>&1 || useradd --system --gid cventagent --create-home --shell /usr/sbin/nologin cventagent
usermod -aG docker cventagent

chown root:root "$ENV_FILE"
chmod 0600 "$ENV_FILE"
chown root:cventagent "$AUTH_FILE"
chmod 0640 "$AUTH_FILE"
install -d -m 0700 -o cventagent -g cventagent "$STATE_DIR"/{queue,runs,workspaces,assets}

# The reviewed checkout may arrive owned by the deployment operator. npm must be
# able to create node_modules and build output without making it group/world-writable.
chown -R cventagent:cventagent "$SOURCE_DIR"
chmod -R u+rwX,go-w "$SOURCE_DIR"
sudo -u cventagent npm --prefix "$SOURCE_DIR" ci
sudo -u cventagent npm --prefix "$SOURCE_DIR" test
sudo -u cventagent npm --prefix "$SOURCE_DIR/web" ci
sudo -u cventagent npm --prefix "$SOURCE_DIR/web" run build

docker volume create cvent-steel-profiles >/dev/null
docker rm -f cvent-steel >/dev/null 2>&1 || true
docker run -d --name cvent-steel --restart unless-stopped \
  -p 127.0.0.1:3300:3000 -p 127.0.0.1:9223:9223 \
  -v cvent-steel-profiles:/profiles \
  -e DOMAIN=127.0.0.1:3300 -e CDP_DOMAIN=127.0.0.1:9223 -e USE_SSL=false -e CHROME_HEADLESS=true \
  "$STEEL_IMAGE" >/dev/null

install -m 0644 "$SOURCE_DIR/deploy/systemd/cvent-agent.service" /etc/systemd/system/cvent-agent.service
systemctl daemon-reload
systemctl enable --now cvent-agent.service

for _ in {1..60}; do curl -fsS http://127.0.0.1:4320/ >/dev/null && break; sleep 2; done
curl -fsS http://127.0.0.1:4320/ >/dev/null
curl -fsS http://127.0.0.1:3300/v1/sessions >/dev/null
ss -lnt | grep -E '127\.0\.0\.1:(4320|3300|9223)' >/dev/null
if ss -lnt | grep -E '0\.0\.0\.0:(4320|3300|9223)|\[::\]:(4320|3300|9223)'; then echo 'Unsafe public listener detected.' >&2; exit 1; fi
echo 'CVENT-agent pilot is healthy on localhost-only ports.'
