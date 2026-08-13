#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BrowserSession, SteelProvider } from "../src/browser/driver";
import { GuardrailViolation, Guardrails, extractEventIds } from "../src/guardrails/middleware";
import { loadCapturedSession, message, parseArgs, requiredEnv } from "./shared";

const HELP = `Usage:
  npx tsx bin/validate-steel.ts --url <approved sandbox URL> --event-id <uuid>

Options:
  --session <file>       Captured session (default: session.json)
  --artifact-dir <dir>   Validation evidence (default: artifacts/steel-validation)
  --help                 Show help

This performs no model calls and no Cvent writes. It proves Steel.dev session
creation, authenticated navigation, guardrail enforcement, evidence capture,
and release against one explicitly approved event.
`;

async function main(): Promise<void> {
  loadLocalEnvironment();
  const args = parseArgs(process.argv.slice(2), {
    values: ["url", "event-id", "session", "artifact-dir"],
    flags: ["help"],
  });
  if (args.flags.has("help")) {
    console.log(HELP);
    return;
  }
  const url = args.values.get("url");
  const eventId = args.values.get("event-id")?.toLowerCase();
  if (!url || !eventId) throw new Error("--url and --event-id are required");
  if (!extractEventIds(url).includes(eventId)) {
    throw new Error("--url must contain the exact --event-id so the sandbox boundary can be proven");
  }

  const audit: Array<Record<string, unknown>> = [];
  const guardrails = new Guardrails(
    {
      eventId,
      denyList: { selectors: [], urlPatterns: [] },
      allowedUploadPaths: [],
      costCeilingUsd: 1,
      costAlertUsd: 0.5,
    },
    (entry) => audit.push(entry)
  );
  assertBlocked(guardrails, {
    type: "navigate",
    url: url.replace(new RegExp(eventId, "i"), "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
    taskId: "steel.validation",
  }, "eventId.mismatch");
  assertBlocked(guardrails, {
    type: "click",
    selector: "role=button[name='Publish']",
    taskId: "steel.validation",
  }, "permanent.selector");

  const captured = await loadCapturedSession(args.values.get("session") ?? "session.json");
  const provider = new SteelProvider({
    apiKey: requiredEnv("STEEL_API_KEY"),
    baseUrl: process.env.STEEL_BASE_URL?.trim() || undefined,
    sessionContext: {
      ...captured,
      // Backward-compatible upgrade for captures written before origin-scoped
      // Steel storage was documented. The approved validation URL supplies it.
      localStorageOrigin: captured.localStorageOrigin ?? new URL(url).origin,
    },
    timeoutMs: 10 * 60_000,
  });
  const traces: unknown[] = [];
  const session = await BrowserSession.open(provider, guardrails, (trace) => traces.push(trace));
  let screenshot: Buffer;
  let finalUrl: string;
  try {
    await session.perform({ type: "navigate", url, taskId: "steel.validation" });
    finalUrl = session.currentUrl();
    guardrails.check({ type: "navigate", url: finalUrl, taskId: "steel.validation.redirect" });
    if (isAuthenticationPage(finalUrl)) {
      throw new Error("Steel reached the Cvent login page; recapture the authenticated Cvent session and retry");
    }
    if (!extractEventIds(finalUrl).includes(eventId)) {
      throw new Error(`Steel navigation ended outside the approved event URL (${finalUrl})`);
    }
    const renderedText = await waitForRenderedCvent(session, 90_000);
    if (/client login|username\s+password|log in using single sign-on/i.test(renderedText)) {
      throw new Error("Steel rendered the Cvent login page; recapture the authenticated session and retry");
    }
    screenshot = await session.screenshot();
  } finally {
    await session.close();
  }

  const artifactDir = resolve(args.values.get("artifact-dir") ?? "artifacts/steel-validation");
  await mkdir(artifactDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = resolve(artifactDir, `${stamp}.png`);
  await writeFile(screenshotPath, screenshot, { mode: 0o600 });
  const result = {
    passed: true,
    provider: provider.name,
    eventId,
    finalUrl,
    guardrailDenialsProven: audit.length,
    browserSteps: traces.length,
    screenshotPath,
    screenshotSha256: createHash("sha256").update(screenshot).digest("hex"),
    checkedAt: new Date().toISOString(),
  };
  await writeFile(resolve(artifactDir, `${stamp}.json`), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}

async function waitForRenderedCvent(session: BrowserSession, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = (await session.textOf("body", "steel.validation.render").catch(() => null))?.trim() ?? "";
    if (text.length >= 20) return text;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  throw new Error(`Cvent did not render usable page content within ${timeoutMs}ms`);
}

function isAuthenticationPage(url: string): boolean {
  const parsed = new URL(url);
  return (
    /(?:^|\/)(?:login|signin|sign-in)(?:\.|\/|$)/i.test(parsed.pathname) ||
    /login\.microsoftonline\.com$/i.test(parsed.hostname)
  );
}

function assertBlocked(
  guardrails: Guardrails,
  action: Parameters<Guardrails["check"]>[0],
  expectedRule: string
): void {
  try {
    guardrails.check(action);
  } catch (error) {
    if (error instanceof GuardrailViolation && error.rule === expectedRule) return;
    throw error;
  }
  throw new Error(`guardrail validation failed: ${expectedRule} action was allowed`);
}

function loadLocalEnvironment(): void {
  try {
    process.loadEnvFile(resolve(".env"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

main().catch((error) => {
  console.error(`Steel validation failed: ${message(error)}`);
  process.exitCode = 1;
});
