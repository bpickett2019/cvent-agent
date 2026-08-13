# EmeraldX Agent — Spine

Deterministic core of the Cvent configuration agent. Everything here runs
without a Cvent account, an Azure subscription, or a browser. `npx tsx smoke.ts`
proves it.

For current implementation status, local setup, blockers, and the exact next-chat
prompt, read [`docs/SESSION-NOTES-2026-08-12.md`](docs/SESSION-NOTES-2026-08-12.md)
and then [`docs/HANDOFF.md`](docs/HANDOFF.md).

## Design commitments

**The Event Spec is the only contract.** The intake form is validated into an
`EventSpec`; planner, executor, and verifier read nothing else. Field coverage
in `src/spec/eventSpec.ts` *is* the Week 3 gate with Emerald — if a
configuration element is not expressible there, the agent cannot produce it.

**Planning is deterministic.** `plan(spec)` is a pure function. Same spec, same
task DAG, same `specHash`. No model call decides which tasks exist. Pi's
judgment is confined to individual browser tasks — drag-and-drop, unexpected
modals, ambiguous widget placement.

**Guardrails sit below Pi.** The agent emits `Action` intents;
`Guardrails.check()` decides whether they execute. Nothing above
`src/browser/driver.ts` touches Playwright. If the agent could reach the `Page`
object, the deny-list would be advisory rather than enforced.

**The executor does not grade itself.** Verification reads back through the
Cvent REST API — a different channel from the browser that performed the
writes. That is what makes the Draft-status post-check credible to an auditor.

**No self-modification.** Adaptation lives in `src/procedures/*.yaml` — versioned
data, diffable, merged by a human. Proposed updates from a run land as a PR.
Production runs a pinned build.

## Layout

```
src/spec/eventSpec.ts        The contract. Zod schema + referential integrity.
src/planner/plan.ts          EventSpec -> ordered task DAG. Pure, testable.
src/guardrails/middleware.ts Deny-list, event-ID validation, publish
                             prohibition, attendee isolation, cost ceiling.
src/browser/driver.ts        Steel.dev + local Playwright behind one interface.
src/cvent/api.ts             REST client. Writes events; reads everything else.
src/verify/verifier.ts       Spec vs. actual diff. Operator-readable output.
src/run/orchestrator.ts      Persisted plan execution, resume, budget, and triage.
src/queue/jobQueue.ts        Durable leased local queue with retries and idempotency.
src/assets/store.ts          Validated, content-addressed image asset storage.
src/procedures/              Browser procedures as versioned data.
web/app/api/                 Dashboard queue and image-upload boundaries.
```

## Langfuse tracing

Production task execution uses the Langfuse JS/TS v5 SDK and OpenTelemetry. Each
Cvent task is one `agent` trace, grouped under the run id as its Langfuse
session. Model turns are `generation` observations with model, token usage, and
cost; browser actions are sibling `tool` observations. Run-specific values stay
in metadata while observation names remain stable for dashboards and evaluators.

Configure `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and
`LANGFUSE_BASE_URL`. Set `LANGFUSE_TRACING_ENVIRONMENT` so development traces do
not pollute production views, and set `LANGFUSE_RELEASE` in deployments. Operator
emails are hashed, field values and reasoning are redacted, common secrets and
emails are masked at export, and failure screenshots are represented only by a
SHA-256 digest. The short-lived CLI flushes every task and shuts OpenTelemetry
down before exit.

See the current [Langfuse tracing best practices](https://langfuse.com/docs/observability/best-practices)
and [SDK instrumentation guide](https://langfuse.com/docs/observability/sdk/instrumentation).

## Cvent API coverage

| Surface | Channel | Notes |
|---|---|---|
| Event create / copy / update | **API** | `event/events:write` |
| Discounts | **API** | write scope exists |
| Admission items, paths, fees, vouchers, questions | **API read / browser write** | no write scopes found |
| Theme, header, footer, pages, widgets | **Browser only** | no API surface at all |

The read surface carries the project: it powers verification *and* the
idempotency checks that make "retries resume from the failed step" true rather
than aspirational.

## Verify in Week 1, before trusting any of this

1. Pull the OpenAPI spec with Emerald's credentials. Public docs are
   JS-rendered and the scope inventory may be incomplete.
2. Confirm `event/events:write` is grantable in Emerald's account, and whether
   IT will approve a machine-to-machine app at all (CAB-adjacent).
3. Confirm the account's API tier and rate limits.
4. Confirm `POST /events/{id}/copy` exists and its request shape — template
   cloning is acceptance criterion #2 and is currently assumed.
5. Confirm the `status` enum value for Draft on `GET /events/{id}`.

## Local queue and image intake

The dashboard now queues validated `EventSpec` jobs instead of pretending to
execute in the request lifecycle. Queue state is durable under ignored
`.queue/`; `bin/worker.ts` claims jobs with a lease, heartbeats long runs,
retries infrastructure failures, and dispatches through the existing
orchestrator. The Run monitor exposes Steel's read-only live viewer while a
session exists and provides durable Pause, Resume, and Cancel controls. Pause
is enforced below Pi immediately before every task and browser action; an action
already in flight may finish. This local backend is the development
implementation of the job contract; hosted production still requires Azure
Service Bus and authenticated operator identity.

Uploaded PNG/JPEG/GIF/WebP images are signature-checked, limited to 10 MB,
content-addressed, and stored under ignored `.assets/`. The model receives an
asset id, never a filesystem path, and guardrails permit only trusted
server-resolved paths. SharePoint references are captured in the UI but remain
fail-closed until an approved Microsoft Graph resolver is configured.

RR `.xlsx` and `.csv` documents can be uploaded for a deterministic, allowlisted
preview. The importer extracts build metadata, registration mappings, and show
questions while excluding personnel/reporting sheets. A preview is not an
EventSpec and cannot execute; constrained AI normalization plus operator review
is the next gate.

```bash
# Run all deterministic checks
npm test

# Claim one queued dashboard job with local Playwright
npm run worker -- --once --local

# Validate Steel against one explicitly approved disposable event
npx tsx bin/validate-steel.ts --url "<sandbox event URL>" --event-id "<event UUID>"
```

## Blocked, deliberately

Real selectors (approved sandbox capture), complete RR-to-EventSpec mapping,
client deny-list contents, Microsoft Graph resolution, and hosted Azure infrastructure.

Writing browser automation against assumed DOM today is exactly the work that
Week 5 first contact invalidates. The procedure format is built; the procedures
are not.

## Security note carried forward

An API application is a standing credential, which sits in tension with
"the agent never holds standing credentials of its own." Recommendation: a
**read-only** verification credential, all writes through the operator's
captured browser session. That reads as a control strengthening rather than a
weakening. `event/events:write` for template cloning is a separate ask and
should be explicit with Dane, not folded into a scope list.
