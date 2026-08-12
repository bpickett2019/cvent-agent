# Cvent Agent Handoff

**Snapshot date:** 2026-08-11

**Repository:** `/Users/bp/CVENT-Agent`

**Branch:** `main`
**Read this first in a new chat.** This file separates working code from aspirational architecture and records the remaining path to a sandbox MVP.

## Repository state

The working tree was clean after this handoff was committed. Before the handoff commit, `main` was three commits ahead of `origin/main` (four including this document); push before moving to another machine.

Recent commits:

```text
5c6f9e5 Load local environment for CLI runs
414e90e Add Langfuse OpenTelemetry tracing
59af2d9 Build runnable CLI and selector discovery surface
3211192 Test resume after executor failure
e3d5763 Add resumable event run orchestrator
a342bb7 Build EmeraldX Anthropic task executor
0722c08 Add EmeraldX task executor system prompt
9e13f01 Initialize Cvent Agent architecture
```

No real Cvent event has been created by this code yet. Cvent API credentials have been requested from Emerald but have not been received, so API authentication and contract validation are blocked and deliberately deferred.

## Current delivery pivot

The immediate client-demo priority is now the operator-facing dashboard: intake, run review, and triage using the existing EventSpec/planner/verifier contracts and mocked run results. This UI can be demonstrated without a Cvent connection while API access and browser procedures remain blocked.

Selector discovery is prepared as a capture-only headed Playwright workflow in `bin/explore.ts`. The operator drives Cvent manually; touching `capture-now` records the current accessibility tree and refreshes a portable `session.json`. The approved capture-only workflow has not yet completed a selector-validation run. No selectors should be inferred from memory, documentation, or videos.

All 15 original TODO procedure files remain unresolved, as do the three new registration procedure scaffolds for questions, visibility, and registration types (18 TODO-bearing files total). None is executable until validated from an approved live capture.

## What works now

### Deterministic execution spine

- `src/spec/eventSpec.ts`: strict Zod EventSpec and referential-integrity checks.
- `src/planner/plan.ts`: deterministic EventSpec-to-task DAG and stable spec hash.
- `src/run/orchestrator.ts`: event shell, checkpoints, resume, dependency blocking, budget enforcement, verification, and triage summary.
- `src/run/fileStore.ts`: durable local `.runs/<runId>.json` records.
- `src/guardrails/middleware.ts`: permanent publish/attendee prohibitions, event-id boundary, deny lists, and cost ceiling.
- `src/cvent/api.ts`: provisional Cvent API client for event writes and verification reads.
- `src/browser/driver.ts`: Steel and local Playwright providers behind one guarded browser interface.
- `src/agent/executor.ts`: bounded Anthropic/Pi task executor with explicit browser tools and terminal result schema.

### Runnable tools

```bash
# Capture an authenticated Cvent browser session
npx tsx bin/capture-session.ts

# Discover interactive controls on a real Cvent page
npx tsx bin/discover.ts --url "<sandbox designer URL>" --session ./session.json

# Capture accessibility trees while the operator drives the headed browser
npx tsx bin/explore.ts
# In another terminal, once the desired panel is visible:
touch capture-now

# Validate and inspect the deterministic plan without side effects
npx tsx bin/run.ts --dry-run --spec ./specs/example.json

# Run locally once credentials and selectors are ready
npx tsx bin/run.ts --spec ./specs/example.json --session ./session.json --local

# Resume a durable run
npx tsx bin/run.ts --resume <runId> --local
```

`bin/run.ts` automatically loads the ignored project `.env` file.

### Session and local artifacts

- `session.json` exists, is mode `0600`, is ignored by Git, and contains the captured Cvent cookies/localStorage. It may expire and should be recaptured before a run.
- `.env` exists, is mode `0600`, is ignored by Git, and contains working Langfuse credentials only.
- `.runs/`, `session.json`, `discovered.json`, and `.env` are ignored.
- Never copy credential values into documentation, commits, chat prompts, or traces.

### Langfuse tracing

The globally installed Pi skill is at `~/.pi/agent/skills/langfuse`, sourced from `github.com/langfuse/skills` (repository commit inspected during installation: `b9958d6c7b0df35a7f1df76a5f6c3a4505b0a3d3`).

The app uses exact versions:

```text
@langfuse/tracing 5.10.0
@langfuse/otel 5.10.0
@opentelemetry/sdk-node 0.221.0
```

Trace design:

- One `execute-cvent-task` **agent** trace per browser task.
- All task traces share the run id as `sessionId`.
- Each model turn is a nested `generate-cvent-action` **generation** with model, tokens, cache usage, and cost.
- Browser operations are sibling **tool** observations under the agent.
- Stable low-cardinality names; task/run details live in metadata/input.
- Root input/output are explicitly populated.
- Environment, release support, tags, pseudonymous operator id, and run session are attached.
- Operator emails, common secrets, fill/upload values, and model reasoning are redacted.
- Failure screenshots are represented in Langfuse by SHA-256 only; browser/run audit storage retains required evidence separately.
- Every task force-flushes; the short-lived CLI shuts OpenTelemetry down before exit.

Credentials were authenticated through `langfuse-cli`. A synthetic live trace was created, fetched back, and audited against the current Langfuse best-practices page. It contained one AGENT root, one GENERATION, and one TOOL with correct parentage, root and observation I/O, model/usage/cost, environment/session/tags, and no email or API key leakage.

Validation trace:

<https://us.cloud.langfuse.com/project/cmso1w9d102tnad0i8fjkkn3s/traces/5e4548ef51d98edbe7811be852882986>

Current references:

- <https://langfuse.com/docs/observability/best-practices>
- <https://langfuse.com/docs/observability/sdk/instrumentation>
- <https://langfuse.com/docs/observability/sdk/advanced-features>

## Credential/configuration status

Do not put values in this table.

| Setting | Status | Needed for |
|---|---|---|
| `LANGFUSE_BASE_URL` | Configured in `.env` | Trace export/query |
| `LANGFUSE_PUBLIC_KEY` | Configured in `.env` | Trace export/query |
| `LANGFUSE_SECRET_KEY` | Configured in `.env` | Trace export/query |
| `LANGFUSE_TRACING_ENVIRONMENT` | `development` in `.env` | Trace isolation |
| `ANTHROPIC_API_KEY` | Present in the current shell, not `.env` | Model execution |
| `EMERALDX_MODEL_ID` | Missing | Model selection |
| `EMERALDX_OPERATOR` | Missing; CLI flags can supply identity | Audit attribution |
| `CVENT_CLIENT_ID` | Requested from Emerald; not received | Event shell and API verification |
| `CVENT_CLIENT_SECRET` | Requested from Emerald; not received | Event shell and API verification |
| `CVENT_API_BASE_URL` | Optional/default provisional | Regional Cvent API |
| `STEEL_API_KEY` | Missing and not needed with `--local` | Hosted Steel runs |

Do not ask users to paste secrets into chat. Have them place credentials in `.env` or their shell and report only whether each variable is set.

## Critical blockers to the first real run

### 1. Cvent API access is absent and validation is deferred

Credentials have been requested from Emerald but have not yet been received. The orchestrator creates/copies the event shell via `CventApi` before opening the browser. A captured browser session does not replace `CVENT_CLIENT_ID` and `CVENT_CLIENT_SECRET`. Do not spend demo work on live API validation until Emerald supplies the application credentials.

The request/response shapes and scopes in `src/cvent/api.ts` remain provisional. Confirm against the account's current OpenAPI contract before trusting a write. At minimum validate:

- OAuth token URL and regional base URL.
- `POST /events` request and response.
- `POST /events/{id}/copy` if template cloning is required.
- `PATCH /events/{id}` shape.
- Event Draft status value.
- Admission/path/voucher list endpoints and pagination.

### 2. The model id is absent

Choose a currently available Anthropic model and configure `EMERALDX_MODEL_ID`. Confirm it resolves through `pi-ai` before a browser run. The Anthropic key is not persisted in `.env`.

### 3. Real Cvent selectors are absent

The 15 original procedure files intentionally contain `selectorHint: "TODO"`; the loader rejects them with a filename and step number so stubs cannot execute:

```text
registration/create-admission-item
registration/create-advanced-rule
registration/create-optional-item
registration/create-path
registration/create-voucher
site/capture-screenshots
site/configure-footer
site/configure-header
site/create-page
site/widget-agenda
site/widget-button
site/widget-divider
site/widget-image
site/widget-text
site/widget-video
```

The three registration-delta scaffolds also remain unresolved:

```text
registration/create-question
registration/set-question-visibility
registration/create-registration-type
```

`site/apply-theme.yaml` has non-TODO example selectors, but its own comments say they are placeholders and it has **not** been validated against the sandbox. Treat it as unknown too.

The minimal `specs/example.json` still plans header, footer, one page, and screenshots because those are required by EventSpec/planner. Therefore it is not currently possible to get a successful “theme-only” run merely by validating `apply-theme`; the header, footer, page, and screenshot procedures must also be validated or the planning contract must be deliberately redesigned.

### 4. No sandbox designer URL has been recorded

Use the real event designer URL with `bin/discover.ts`. Do not invent selectors. Prefer role/name selectors, record the Cvent build in `provenance.validatedAgainst`, and update one procedure at a time.

## Recommended next sequence

1. Build and demo the operator-facing dashboard against EventSpec and realistic mocked run results.
2. Keep live Cvent API validation deferred until Emerald supplies client credentials.
3. Run `bin/explore.ts` only against an explicitly approved disposable event; the operator drives and the tool captures only.
4. Replace TODO selectors only from approved live accessibility captures, with provenance recorded per procedure.
5. Validate question, visibility, and registration-type procedures before lower-priority site procedures.
6. Once credentials arrive, verify API authentication read-only and confirm copy/update/read contracts before any write.
7. Run one disposable Draft event end to end, inspect verification and Langfuse, then test interruption and resume.

## MVP readiness assessment

There are three useful percentages, because one number hides the actual risk:

| Scope | Estimate | Meaning |
|---|---:|---|
| Deterministic engineering foundation | **~75%** | Spec, planner, executor, guardrails, resume, CLI, session tools, tracing, and tests exist. |
| First successful sandbox runnable MVP | **~40%** | Blocked on Cvent credentials/API validation, model selection, and all minimum real selectors. No end-to-end Cvent run has happened. |
| Full product described in architecture docs | **~20%** | Dashboard, Entra auth, approvals UI, queues/workers, Azure persistence, Key Vault, IaC, evaluations, and deployment pipeline remain aspirational. |

With credentials and a cooperative sandbox available, a first minimal site run is plausibly **2–5 focused engineering days**, mostly selector discovery and live API debugging. Validating all widgets and registration paths is more likely **1–3 additional weeks** because each procedure needs real sandbox evidence and idempotency testing. The full hosted/dashboard MVP is a separate multi-week phase.

Do not describe the system as a working MVP until it has completed at least one disposable Draft event end-to-end, independently verified the result, emitted a real Langfuse session, and successfully resumed an interrupted run without duplicate side effects.

## Validation commands

```bash
npm audit
npm run typecheck
npm run smoke
npm run smoke:executor
npm run smoke:run
npx tsx bin/run.ts --dry-run --spec ./specs/example.json
```

At this snapshot all commands passed and `npm audit` reported zero vulnerabilities.

## Documents and source map

- `README.md`: current design commitments, layout, tracing setup, API coverage.
- `docs/HANDOFF.md`: current implementation and next-chat state (this file).
- `docs/architecture.md`: target hosted architecture; mostly aspirational.
- `docs/agent-specification.md`: long-term product capabilities and approval model.
- `docs/deployment.md`: target Azure release architecture; not implemented.
- `BUILD_PROMPT.md`: original build context.
- `SECURITY.md`: disclosure and security notes.
- `src/agent/SYSTEM_PROMPT.md`: pinned single-task agent behavior.
- `src/procedures/**/*.yaml`: versioned browser procedures.
- `specs/example.json`: minimal valid first-run specification.

Files intentionally not committed: `.env`, `session.json`, `.runs/`, and discovery output.

## Starter prompt for a new chat

```text
Work in /Users/bp/CVENT-Agent. Read docs/HANDOFF.md completely, then README.md,
docs/architecture.md, and the relevant source files before changing anything.
Do not expose .env or session.json. Verify git status and credential presence by
name only. Continue from the recommended next sequence in the handoff. The
immediate goal is one independently verified disposable Draft event in the Cvent
sandbox; do not invent selectors or claim MVP readiness before a live end-to-end
run and resume test pass.
```
