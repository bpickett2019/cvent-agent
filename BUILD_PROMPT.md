# Build Prompt — EmeraldX Pi Executor

> Paste into Claude Code or Pi, with the `emeraldx` repo as the working
> directory. Written to be handed over without editing.

---

You are implementing the task executor for EmeraldX, a production automation
that configures Cvent events for an enterprise client under SOX audit. This is
client work on an 8-week fixed timeline, not a prototype.

## Read first, in this order

1. `README.md` — design commitments. Do not violate them.
2. `src/spec/eventSpec.ts`, `src/planner/plan.ts` — the contract and the DAG.
3. `src/guardrails/middleware.ts` — the controls you must route through.
4. `src/browser/driver.ts` — the only permitted path to the browser.
5. `src/agent/SYSTEM_PROMPT.md` — the executor's system prompt and its output
   contract.

Then read the actual `@earendil-works/pi-agent-core` documentation at
https://pi.dev/docs/latest before writing any code. **Do not guess at the API.**
If the docs are thin, install the package and read its type declarations. Pi's
own README notes you can ask the agent to explain itself.

## What you are building

`src/agent/executor.ts` — a function that takes one `Task` and runs it to
completion or halt, using `pi-agent-core` as the runtime.

```ts
export async function executeTask(args: {
  task: Task;                  // from src/planner/plan.ts
  eventId: string;
  procedure: Procedure | null; // parsed YAML from src/procedures/
  session: BrowserSession;     // from src/browser/driver.ts
  guardrails: Guardrails;
  budgetRemainingUsd: number;
}): Promise<TaskResult>;
```

`TaskResult` mirrors the JSON contract in `SYSTEM_PROMPT.md` exactly —
`status`, `taskId`, `summary`, `haltReason`, `haltDetail`, `evidence`,
`proposedProcedure`. Define it as a Zod schema and parse the model's output
through it. A response that fails to parse is a halt, not a retry loop.

## Tool surface — exactly these, nothing more

```
browser_navigate(url)
browser_click(selector)
browser_fill(selector, value)
browser_select(selector, value)
browser_upload(selector, assetPath)
browser_read(selector)        -> text content, or null
task_complete(result)
task_halt(reason, detail)
```

**Register no filesystem, shell, network, or code-execution tools.** Not read,
not write, not edit, not bash. The production agent must be structurally
incapable of modifying itself, its procedures, or the plan — that is a control
we committed to the client, and it is enforced by tool absence, not by
instruction. If `pi-agent-core` registers any such tools by default, disable
them explicitly and leave a comment saying so.

Every `browser.*` tool must dispatch through `BrowserSession.perform()`, which
runs the guardrail check. Do not touch Playwright directly. Do not construct a
second `Page`.

## Behaviour

- Load `SYSTEM_PROMPT.md` at startup, substitute the `{{...}}` slots from
  `args`, and use it as the system prompt. Do not inline a copy of the prompt
  into TypeScript.
- The agent sees **one task**, never the whole plan. Keep context minimal — the
  run has a hard $30 cost ceiling and a $9–12 target.
- After each model call, call `guardrails.accrue(costUsd)` with the real cost
  from the provider response. Do not estimate.
- A `GuardrailViolation` is terminal for the task. Catch it, return
  `status: "halted"` with `haltReason: "guardrail-blocked"`, and do not retry.
- Cap tool-call iterations (start at 25) and cap same-selector retries at 3.
  Exceeding either is a halt.
- If a procedure was supplied and the agent completed the task by deviating
  from it, capture that in `proposedProcedure`. Never write it to disk.

## Also build

- `src/procedures/loader.ts` — parse and validate the YAML format shown in
  `src/procedures/site/apply-theme.yaml`. Zod schema, `{{path.to.value}}`
  interpolation against the task payload, clear errors on malformed files.
- `src/agent/telemetry.ts` — wire `@earendil-works/pi-telemetry` to Langfuse.
  Every step needs run id, task id, operator, timestamp, and failure
  screenshots. This is the SOX audit trail; it is not optional logging. Redact
  tool argument values the way `driver.ts` already does.
- Tests in `smoke.ts` style — no network, no live model. Use a stub Pi model
  that replays scripted tool calls. Cover: happy path, guardrail block mid-task,
  malformed model output, iteration cap, budget exhaustion.

## Rules

- TypeScript strict. `npx tsc --noEmit` must pass clean.
- Do not modify `middleware.ts`, `eventSpec.ts`, or `plan.ts`. If you believe
  one needs to change, stop and explain why instead.
- Do not invent Cvent selectors. Procedures are loaded from disk; real
  selectors arrive after sandbox validation.
- Do not add dependencies beyond `pi-agent-core`, `pi-ai`, `pi-telemetry`, and
  a YAML parser.
- Pin exact versions. No caret ranges.

## When the API does not cooperate

If `pi-agent-core` cannot do something this prompt asks for — custom tool
registration, disabling default tools, per-call cost reporting, structured
output enforcement — **stop and report it.** Say what you tried, what the API
offers instead, and what the tradeoff is. Do not work around it silently and do
not fabricate an API that would be convenient.

Finish with a short summary: what you built, what you verified, what you
assumed, and what still needs a human decision.
