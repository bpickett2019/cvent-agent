# Cvent Agent Handoff

**Current snapshot:** 2026-08-12

**Repository:** `/Users/bp/CVENT-Agent`

**Branch:** `main`

Read [`SESSION-NOTES-2026-08-12.md`](SESSION-NOTES-2026-08-12.md) for the full
implementation record, commands, evidence, security boundaries, and completed
checklists. This handoff is the concise current-state entry point for a new
session.

## Current state

The repository now contains:

- A strict `EventSpec` contract and deterministic task planner.
- A bounded Pi/Anthropic browser-task executor.
- Browser access isolated behind deterministic guardrails.
- Durable local run checkpoints and safe resume.
- A durable leased local job queue and worker.
- RR `.xlsx`/`.csv` upload with deterministic, allowlisted preview extraction.
- Validated drag/drop image intake and exact SharePoint references.
- A Next.js operator dashboard for intake, run monitoring, review, and triage.
- A read-only Steel live-browser viewer in the Run monitor.
- Cooperative Pause, Resume, and Cancel controls beneath the model.
- Langfuse tracing with redaction and required audit flushing.
- CI and deterministic smoke suites with no-network test doubles.

The dashboard and queue are functional local-development implementations. This
is **not yet a complete runnable Cvent event builder** because API credentials,
RR-to-EventSpec normalization, and validated browser procedures remain blocked.

## Live Steel validation

Steel passed read-only validation against the approved Cvent testing event:

```text
Event UUID: 020c932b-59d7-484a-80e1-229f20d57a7e
```

The validation proved:

- Steel session creation and release.
- Refreshed authenticated Cvent session replay.
- Visible Site Designer rendering.
- Exact `evtstub` event-boundary enforcement.
- Wrong-event navigation denial.
- Publish-control denial.
- Read-only screenshot evidence.

Passing local evidence:

```text
artifacts/steel-validation/2026-08-12T21-46-18-887Z.json
artifacts/steel-validation/2026-08-12T21-46-18-887Z.png
SHA-256: 2fb587e35cbdaaa1d5cb59a5bc4b15b7cb9076e300673737b313b31f4b8af69d
```

These artifacts and `session.json` are ignored and must not be committed.
The validation did not Save, Publish, alter Cvent, or access attendee data.

## Durable queue and run controls

A validated EventSpec can be submitted through `POST /api/jobs`. The worker:

1. Claims a job with a lease.
2. Heartbeats while it runs.
3. Dispatches through the existing resumable orchestrator.
4. Retries bounded infrastructure failures.
5. Persists checkpoints and triage output.

The Run monitor shows durable state and exposes:

- **View live browser** while the Steel session exists.
- **Pause run**.
- **Resume run**.
- **Cancel run**.

Pause is cooperative and enforced immediately before every task and browser
action below Pi. An action already sent to Cvent may finish; no subsequent
action begins until Resume. Cancel interrupts that same gate and releases the
browser. The Steel viewer is configured read-only so manual interaction cannot
bypass guardrails.

## Deterministic guardrails

The browser layer permanently enforces:

- Publish, Go Live, and Launch prohibition.
- Attendee, registrant, invitee, contact, and address-book isolation.
- Exact event UUID validation, including Cvent `evtstub` URLs.
- Encoded URL, redirect, and current-page boundary checks.
- Configurable selector and URL deny lists.
- Exact allowlisting of server-resolved upload paths.
- Cost alert and ceiling.

The model cannot reach Playwright, shell, filesystem, network, plan mutation, or
procedure mutation tools.

## RR document status

Event intake accepts `.xlsx` and `.csv` RR documents up to 20 MB and produces a
safe preview. The known 20-sheet workbook was tested successfully:

- 18 registration mappings recognized.
- 42 question definitions recognized.
- Personnel/reporting sheets excluded from the preview.

A preview is **not** an EventSpec and cannot execute. The next product feature is
constrained AI normalization into a candidate EventSpec followed by explicit
operator review and approval. Raw workbook content must never be sent directly
to the execution agent.

## Image and SharePoint status

Uploaded PNG/JPEG/GIF/WebP files are signature-checked, limited to 10 MB,
content-addressed, deduplicated, and stored privately under ignored `.assets/`.
The model receives asset IDs rather than filesystem paths.

SharePoint references can be entered in the UI but execution fails closed until
an approved Microsoft Graph resolver and least-privilege identity are built.

## Credentials and configuration

Never put secret values in source, documentation, prompts, or chat. At this
snapshot, local `.env` status by name was:

| Variable | Status |
|---|---|
| `STEEL_API_KEY` | Set |
| `STEEL_BASE_URL` | Blank intentionally; default is `https://api.steel.dev` |
| `EMERALDX_MODEL_ID` | Set to `claude-sonnet-4-5` |
| `ANTHROPIC_API_KEY` | Set |
| `LANGFUSE_*` | Set |
| `CVENT_CLIENT_ID` | Blank |
| `CVENT_CLIENT_SECRET` | Blank |

The missing Cvent API credentials block event create/copy/update and independent
API verification. The request/response shapes in `src/cvent/api.ts` are still
provisional and must be validated against Emerald's current Cvent account.

## Browser procedure blockers

TODO selectors remain in the browser procedure YAML files. Do not infer or
invent them. Replace them only from approved live captures and record provenance.
Prioritize:

1. `registration/create-question`
2. `registration/set-question-visibility`
3. `registration/create-registration-type`
4. The smallest browser procedure set needed for one disposable Draft run

A live Steel connection does not mean these procedures are validated.

## Local operation

The dashboard and worker were running when the snapshot was prepared:

```text
Dashboard: http://127.0.0.1:3000
Logs: logs/dashboard.log, logs/worker.log
PID files: logs/dashboard.pid, logs/worker.pid
Queue at snapshot: empty
```

Check rather than assuming those processes survived:

```bash
cd /Users/bp/CVENT-Agent
for service in dashboard worker; do
  pid=$(cat "logs/$service.pid" 2>/dev/null)
  kill -0 "$pid" 2>/dev/null && echo "$service running ($pid)" || echo "$service stopped"
done
curl -I http://127.0.0.1:3000/
```

Start manually in separate terminals if needed:

```bash
cd /Users/bp/CVENT-Agent/web
npm run dev
```

```bash
cd /Users/bp/CVENT-Agent
npm run worker
```

Refresh an expired Cvent session:

```bash
cd /Users/bp/CVENT-Agent
npx tsx bin/capture-session.ts --auto \
  --url "https://app.cvent.com/subscribers/events2/EventWebsite/EditWebsite/Index/View?evtstub=020c932b-59d7-484a-80e1-229f20d57a7e"
```

## Validation commands

Run before merging or claiming readiness:

```bash
cd /Users/bp/CVENT-Agent
npm ci
npm audit --audit-level=high
npm test

cd web
npm ci
npm audit --audit-level=high
npm run typecheck
npm run build
```

The latest local run passed all suites:

- Core guardrail/planner/spec checks.
- Executor: 23 checks.
- Orchestrator: 31 checks.
- Queue: 15 checks.
- Assets: 9 checks.
- RR importer: 7 checks.
- Browser boundaries: 4 checks.
- Pause/control layer: 6 checks.
- Root and dashboard audits: zero vulnerabilities.
- Next.js production build: passed.

## Remaining work, in order

1. Build constrained RR preview → candidate EventSpec normalization.
2. Build an operator review/edit/diff/approval gate before enqueue.
3. Obtain Cvent API credentials and validate authentication read-only.
4. Confirm current Cvent API create/copy/update/read contracts and Draft enum.
5. Validate minimum registration procedures from approved sandbox captures.
6. Implement least-privilege Microsoft Graph SharePoint resolution.
7. Run one disposable Draft event end to end.
8. Test live Pause, Resume, Cancel, interruption resume, and no duplicate writes.
9. Replace demo identity with Entra authorization.
10. Replace local queue/control files with Azure Service Bus and shared hosted
    persistence.

Do not describe the system as a runnable Cvent MVP until one disposable Draft
event completes, is independently verified, emits a real Langfuse session, and
resumes after interruption without duplicate side effects.

## Security reminders

- Never commit `.env`, `session.json`, `.queue/`, `.runs/`, `.assets/`,
  `artifacts/`, or `logs/`.
- Never paste credentials, cookies, session context, or Steel viewer URLs into
  chat or public issues.
- Never expose the Steel viewer without authenticated authorization in hosted
  deployment.
- Keep Publish and attendee access permanently prohibited.
- Keep all event-changing actions attributable to an operator and auditable.

## Starter prompt for a new session

```text
Work in /Users/bp/CVENT-Agent. Read docs/HANDOFF.md and
then docs/SESSION-NOTES-2026-08-12.md completely before changing anything.
Do not expose .env, session.json, Steel viewer URLs, screenshots, or client data.
Verify git status, service health, and credential presence by variable name only.
Run npm test and the web production build. Continue with constrained RR-preview-
to-candidate-EventSpec normalization and an explicit operator review gate.
Do not queue a real Cvent run: Cvent API credentials and validated browser
procedures are still missing. Keep Publish and attendee access permanently
prohibited.
```
