# EmeraldX Agent — Spine

Deterministic core of the Cvent configuration agent. Everything here runs
without a Cvent account, an Azure subscription, or a browser. `npx tsx smoke.ts`
proves it.

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
src/procedures/              Browser procedures as versioned data.
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

## Blocked, deliberately

Real selectors (Week 4 sandbox), intake form fields (Week 1 ops interviews),
deny-list contents (Emerald supplies Week 3), Azure IaC (tickets filed Week 0).

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
