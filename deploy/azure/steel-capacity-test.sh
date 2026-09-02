#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

COUNT=""
IMAGE=""
BIND_HOST="127.0.0.1"
CONTAINER_PORT=3000
CREATE_BLANK_SESSIONS=false
DRY_RUN=false
REPORT="steel-capacity-report.json"
RUN_ID="${STEEL_CAPACITY_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
HEALTH_TIMEOUT_SECONDS="${STEEL_CAPACITY_HEALTH_TIMEOUT_SECONDS:-120}"
# Capacity guard: 2 GiB per browser plus 5 GiB host headroom.
PER_CONTAINER_KB=$((2 * 1024 * 1024))
HOST_HEADROOM_KB=$((5 * 1024 * 1024))

usage() {
  cat >&2 <<'EOF'
Usage: steel-capacity-test.sh --count 12|36 --image REPO@sha256:HEX [options]
  --create-blank-sessions  Create one about:blank session per container
  --report PATH            Non-secret JSON report path (default: steel-capacity-report.json)
  --bind 127.0.0.1         Accepted only to make the loopback boundary explicit
  --dry-run                Validate and print the deterministic plan; no Docker calls
EOF
}

die() { printf 'error: %s\n' "$*" >&2; exit 2; }

while (($#)); do
  case "$1" in
    --count) (($# >= 2)) || die "--count requires a value"; COUNT="$2"; shift 2 ;;
    --image) (($# >= 2)) || die "--image requires a value"; IMAGE="$2"; shift 2 ;;
    --bind) (($# >= 2)) || die "--bind requires a value"; BIND_HOST="$2"; shift 2 ;;
    --report) (($# >= 2)) || die "--report requires a value"; REPORT="$2"; shift 2 ;;
    --create-blank-sessions) CREATE_BLANK_SESSIONS=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ "$COUNT" == "12" || "$COUNT" == "36" ]] || die "--count must be exactly 12 or 36"
[[ "$IMAGE" =~ ^[^[:space:]@]+@sha256:[0-9a-fA-F]{64}$ ]] || die "--image must be an immutable repository@sha256:<64 hex> reference"
[[ "$BIND_HOST" == "127.0.0.1" ]] || die "public bindings are refused; --bind must be 127.0.0.1"
[[ -n "$REPORT" && "$REPORT" != "/dev/stdout" && "$REPORT" != "-" ]] || die "--report must be a file path"
[[ "$HEALTH_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "health timeout must be a positive integer"

if [[ "$DRY_RUN" == true ]]; then
  printf '{"dry_run":true,"count":%s,"image":"%s","bind_host":"127.0.0.1","container_port":3000,"create_blank_sessions":%s,"run_id":"%s"}\n' \
    "$COUNT" "$IMAGE" "$CREATE_BLANK_SESSIONS" "$RUN_ID"
  exit 0
fi

command -v docker >/dev/null || die "docker is required"
command -v curl >/dev/null || die "curl is required"
command -v python3 >/dev/null || die "python3 is required"
docker info >/dev/null 2>&1 || die "Docker daemon is unavailable"

available_kb=$(df -Pk "$(dirname "$REPORT")" | tail -1 | tr -s ' ' | cut -d ' ' -f4)
[[ "$available_kb" =~ ^[0-9]+$ ]] || die "could not determine available disk"
required_kb=$((COUNT * PER_CONTAINER_KB + HOST_HEADROOM_KB))
((available_kb >= required_kb)) || die "low disk: ${available_kb} KiB available; ${required_kb} KiB required before launch"

container_ids=()
container_names=()
ports=()
cid_dir=$(mktemp -d)
cleanup() {
  local id cidfile
  set +e
  # Cidfiles close the signal race between docker creating a container and Bash
  # appending docker's stdout to container_ids.
  for cidfile in "$cid_dir"/*.cid; do
    [[ -f "$cidfile" ]] || continue
    id=$(<"$cidfile")
    [[ -n "$id" ]] && docker rm -f "$id" >/dev/null 2>&1
  done
  rm -rf "$cid_dir"
}
trap cleanup EXIT INT TERM

safe_run_id=${RUN_ID//[^a-zA-Z0-9_.-]/-}
for ((i=1; i<=COUNT; i++)); do
  name="steel-capacity-${safe_run_id}-${i}"
  cidfile="$cid_dir/${i}.cid"
  id=$(docker run -d --cidfile "$cidfile" --name "$name" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=1g \
    --security-opt no-new-privileges --cap-drop ALL --pids-limit 512 \
    -p 127.0.0.1::3000 "$IMAGE")
  container_ids+=("$id")
  container_names+=("$name")

  mapping=$(docker port "$id" 3000/tcp)
  [[ "$mapping" =~ ^127\.0\.0\.1:([0-9]+)$ ]] || die "container $i received a non-loopback or invalid port mapping: $mapping"
  port=${BASH_REMATCH[1]}
  ports+=("$port")

  deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  until curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:${port}/documentation/" >/dev/null; do
    ((SECONDS < deadline)) || die "container $i health timeout"
    sleep 1
  done

  if [[ "$CREATE_BLANK_SESSIONS" == true ]]; then
    curl --fail --silent --show-error --max-time 10 \
      -H 'content-type: application/json' --data '{"persist":false,"headless":true}' \
      "http://127.0.0.1:${port}/v1/sessions" >/dev/null
  fi
done

stats_file=$(mktemp)
trap 'rm -f "$stats_file"; cleanup' EXIT INT TERM
docker stats --no-stream --format '{{json .}}' "${container_ids[@]}" >"$stats_file"

COUNT="$COUNT" IMAGE="$IMAGE" RUN_ID="$RUN_ID" CREATED_BLANK="$CREATE_BLANK_SESSIONS" \
REPORT="$REPORT" STATS_FILE="$stats_file" python3 - <<'PY'
import json, os
from datetime import datetime, timezone

allowed = {"Name", "CPUPerc", "MemUsage", "MemPerc", "NetIO", "BlockIO", "PIDs"}
stats = []
with open(os.environ["STATS_FILE"], encoding="utf-8") as handle:
    for line in handle:
        row = json.loads(line)
        stats.append({key: row.get(key) for key in sorted(allowed)})
report = {
    "schema_version": 1,
    "run_id": os.environ["RUN_ID"],
    "completed_at": datetime.now(timezone.utc).isoformat(),
    "count": int(os.environ["COUNT"]),
    "image": os.environ["IMAGE"],
    "bind_host": "127.0.0.1",
    "container_port": 3000,
    "created_blank_sessions": os.environ["CREATED_BLANK"] == "true",
    "stats": stats,
}
with open(os.environ["REPORT"], "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY
printf 'report written: %s\n' "$REPORT"
