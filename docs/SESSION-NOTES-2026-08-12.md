# Cvent Agent Session Notes — 2026-08-12

## Executive summary

This session moved `/Users/bp/CVENT-Agent` from a dashboard demonstration and
deterministic execution spine toward a locally operable Cvent automation system.
It now has RR workbook/CSV preview, durable queued jobs, validated image intake,
hardened deterministic guardrails, live Steel browser validation, a read-only
live-browser view in the UI, and cooperative Pause/Resume/Cancel controls.

No production event was changed. The live Steel test was read-only against an
approved Cvent testing event. It did not Save, Publish, or access attendee data.

## Current local services

At the time these notes were written:

| Service | Status | Location / PID |
|---|---|---|
| Operator dashboard | Running | <http://127.0.0.1:3000>, PID `11000` |
| Durable worker | Running | PID `16684` |
| Dashboard health | Healthy | HTTP `200` |
| Jobs API health | Healthy | HTTP `200` |
| Queue | Empty | `0` jobs |

Logs and process files:

```text
logs/dashboard.log
logs/dashboard.pid
logs/worker.log
logs/worker.pid
```

The PID values are only a snapshot. Check them before relying on them:

```bash
cd /Users/bp/CVENT-Agent
for service in dashboard worker; do
  pid=$(cat "logs/$service.pid" 2>/dev/null)
  kill -0 "$pid" 2>/dev/null && echo "$service running ($pid)" || echo "$service stopped"
done
curl -I http://127.0.0.1:3000/
```

Stop the locally started services:

```bash
cd /Users/bp/CVENT-Agent
kill "$(cat logs/dashboard.pid)" "$(cat logs/worker.pid)"
```

Restart them:

```bash
cd /Users/bp/CVENT-Agent
mkdir -p logs
(cd web && nohup npm start -- --hostname 127.0.0.1 --port 3000 > ../logs/dashboard.log 2>&1 &)
nohup npm run worker > logs/worker.log 2>&1 &
```

## Steel and Cvent validation

### Approved testing event

```text
Event UUID: 020c932b-59d7-484a-80e1-229f20d57a7e
```

Validated administrative URL:

```text
https://app.cvent.com/subscribers/events2/EventWebsite/EditWebsite/Index/View?evtstub=020c932b-59d7-484a-80e1-229f20d57a7e&startSection=Registration&parentUrl=%2FSubscribers%2FEvents2%2FRegistrationOption%2FRegistrationProcessPages%2FIndex%2F%3Fevtstub%3D020c932b-59d7-484a-80e1-229f20d57a7e&scrollX=0&scrollY=0
```

Steel validation passed after refreshing `session.json`. It proved:

- Steel session creation and release.
- Authenticated Cvent session replay.
- Visible Site Designer content—not merely a successful URL or blank SPA shell.
- Binding to the exact `evtstub` event UUID.
- Wrong-event navigation denial.
- Publish-control denial.
- Read-only screenshot evidence.

Passing evidence:

```text
artifacts/steel-validation/2026-08-12T21-46-18-887Z.json
artifacts/steel-validation/2026-08-12T21-46-18-887Z.png
Screenshot SHA-256:
2fb587e35cbdaaa1d5cb59a5bc4b15b7cb9076e300673737b313b31f4b8af69d
```

The evidence and `session.json` are ignored runtime artifacts and must not be
committed or shared publicly.

To refresh the Cvent login if Steel reaches the login screen:

```bash
cd /Users/bp/CVENT-Agent
npx tsx bin/capture-session.ts --auto \
  --url "https://app.cvent.com/subscribers/events2/EventWebsite/EditWebsite/Index/View?evtstub=020c932b-59d7-484a-80e1-229f20d57a7e"
```

Then log in in the opened Chromium window. Capture completes automatically when
the requested authenticated event becomes visible.

## Features implemented

### 1. Durable job queue and worker

Key files:

```text
src/queue/jobQueue.ts
src/queue/runJob.ts
bin/worker.ts
web/app/api/jobs/route.ts
```

Capabilities:

- Durable local `.queue/jobs.json` state.
- Idempotent enqueue.
- Worker leases and heartbeats.
- Retry delay and maximum attempts.
- Expired-lease recovery.
- Pre-start pause.
- Terminal cancellation.
- Existing resumable orchestrator and `.runs/` checkpoints remain the run layer.

This is a local development adapter. Hosted production still requires Azure
Service Bus, a shared durable database, and Entra-backed operator identity.

### 2. Live browser view and safety controls

Key files:

```text
src/run/control.ts
src/browser/driver.ts
src/run/orchestrator.ts
web/components/run-monitor.tsx
web/app/api/jobs/[id]/control/route.ts
```

The dashboard has a new **Run monitor** workspace with:

- Queue and worker state.
- Steel connection status.
- **View live browser** while a Steel session exists.
- **Pause run**.
- **Resume run**.
- **Cancel run**.

Important semantics:

- The Steel viewer is configured read-only so an operator cannot bypass
  guardrails by manually clicking inside the hosted browser.
- Steel has no native pause API. Pause is enforced by our durable action gate
  below Pi.
- An action already sent to Cvent may finish.
- No subsequent task, navigation, click, fill, select, read, or upload starts
  while paused.
- Resume releases the gate.
- Cancel interrupts the gate, releases the browser, and preserves partial run
  evidence for triage.
- The viewer URL is removed when the browser session is released.

### 3. Deterministic guardrails

Key file:

```text
src/guardrails/middleware.ts
```

Controls now include:

- Permanent Publish/Go Live/Launch prohibition.
- Attendee, registrant, invitee, contact, and address-book isolation.
- Configurable selectors and URL deny lists.
- Event UUID validation for paths and Cvent `evtstub` query parameters.
- Encoded-URL checks.
- Redirect and current-page event-boundary checks before DOM actions.
- Case-insensitive UUID comparison.
- Exact allowlist for server-resolved upload paths.
- Cost alert and ceiling.

These controls execute below the model in `BrowserSession.perform()`.

### 4. RR workbook and CSV intake

Key files:

```text
src/intake/rrDocument.ts
web/app/api/rr-preview/route.ts
web/components/rr-document-import.tsx
```

Capabilities:

- `.xlsx` and `.csv` upload, maximum 20 MB.
- Deterministic build-sheet allowlist.
- Exclusion of access/report personnel content from the preview.
- Extraction preview for event metadata, registration mappings, and questions.
- Tested against the known 20-sheet RR workbook:
  - 18 registration mappings recognized.
  - 42 question definitions recognized.
  - 17 non-selected sheets excluded from the preview.

The RR preview does **not** execute. It does not yet become an EventSpec. Raw RR
content must never be passed directly to the execution agent.

### 5. Image intake

Key files:

```text
src/assets/store.ts
web/app/api/assets/route.ts
web/components/image-ref-field.tsx
```

Capabilities:

- Drag/drop and file browser.
- PNG, JPEG, GIF, and WebP signature validation.
- 10 MB maximum.
- MIME/content mismatch rejection.
- Content-addressed IDs and deduplication.
- Private `.assets/` storage.
- Model receives an asset ID, not an arbitrary filesystem path.
- Browser upload only accepts exact server-resolved allowlisted paths.
- SharePoint references can be captured in the UI.

SharePoint execution remains fail-closed until approved Microsoft Graph identity
and resolution are implemented.

### 6. Automated test pipeline

Key file:

```text
.github/workflows/ci.yml
```

CI runs root install/audit/typecheck/tests and dashboard install/audit/typecheck/
production build. Local suites cover:

```text
smoke.ts
executor.smoke.ts
run.smoke.ts
queue.smoke.ts
asset.smoke.ts
rr.smoke.ts
browser.smoke.ts
control.smoke.ts
```

Last validation in this session:

- Core checks passed.
- Executor checks passed: 23.
- Run checks passed: 31.
- Queue checks passed: 15.
- Asset checks passed: 9.
- RR checks passed: 7.
- Browser checks passed: 4.
- Control checks passed: 6.
- Root `npm audit`: zero vulnerabilities.
- Dashboard `npm audit`: zero vulnerabilities.
- Next.js production build passed, including:
  - `/api/assets`
  - `/api/jobs`
  - `/api/jobs/[id]/control`
  - `/api/rr-preview`

## Credential state

Do not record values in documentation or chat. At the end of the session these
were configured by name:

```text
STEEL_API_KEY
EMERALDX_MODEL_ID=claude-sonnet-4-5
ANTHROPIC_API_KEY
LANGFUSE_* credentials
```

`STEEL_BASE_URL` is intentionally blank, causing the default
`https://api.steel.dev` to be used.

Cvent API client credentials were still not configured at the latest explicit
status check:

```text
CVENT_CLIENT_ID
CVENT_CLIENT_SECRET
```

That means the full queued orchestrator cannot create/copy an event shell or run
independent API verification yet. The Steel browser itself is validated.

## Important remaining work and blockers

1. **Do not queue a real run yet.** The worker is running, but full execution is
   still blocked by Cvent API credentials and unvalidated procedure selectors.
2. Build constrained AI normalization from the safe RR preview into a candidate
   EventSpec.
3. Add an explicit operator review/edit/approval screen before that EventSpec can
   enter the queue.
4. Validate Cvent API authentication and current request/response contracts when
   client credentials are supplied.
5. Replace every `selectorHint: "TODO"` only from approved live sandbox captures.
6. Validate registration-question, question-visibility, and registration-type
   procedures first.
7. Implement Microsoft Graph SharePoint asset resolution with least privilege.
8. Replace demo operator identity with Entra authentication and authorization.
9. Replace local file queue/control state with Azure Service Bus and shared
   persistence for hosted production.
10. Add authorization before returning a Steel live-view URL in a hosted setup.

## Repository and Git state

Repository:

```text
/Users/bp/CVENT-Agent
```

Branch:

```text
main
```

The implementation from this session is currently an uncommitted working tree.
Do not reset or discard it. Review `git status`, rerun `npm test` and the web
build, then commit intentionally. Runtime credentials and artifacts remain
ignored.

## Recommended next sequence

1. Keep the current worker idle; the queue is currently empty.
2. Implement RR preview → candidate EventSpec normalization with a strict schema
   and no browser tools.
3. Build the operator diff/review screen.
4. Receive and validate Cvent API credentials read-only before any API write.
5. Use the approved testing event and capture workflow to validate one procedure
   at a time.
6. Run a minimal disposable Draft event end to end.
7. Test Pause during a real browser task, Resume, Cancel, independent verification,
   and checkpoint resume without duplicate writes.

## Starter prompt for the next coding session

```text
Work in /Users/bp/CVENT-Agent. Read docs/SESSION-NOTES-2026-08-12.md and
then docs/HANDOFF.md completely before changing anything. Do not expose .env,
session.json, Steel viewer URLs, or validation screenshots. Preserve the
uncommitted working tree. Verify the dashboard and worker status, run npm test
and the web production build, then continue with constrained RR-preview-to-
EventSpec normalization and an operator review gate. Do not queue a real Cvent
run: Cvent API credentials and real browser procedure selectors are still
blocked. Keep Publish and attendee access permanently prohibited.
```
