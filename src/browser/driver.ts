/**
 * Browser layer.
 *
 * Steel.dev and local Playwright sit behind one interface. This is the seam the
 * scope doc promises when it says a swap "does not restart the project" — build
 * it now, not when you need it.
 *
 * Nothing above this file touches Playwright directly. Pi emits Action intents;
 * BrowserSession runs them through Guardrails first. If the agent could reach
 * the Page object, the deny-list would be advisory.
 */

import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { Guardrails, type Action } from "../guardrails/middleware";

export interface BrowserProvider {
  readonly name: string;
  /** Returns a CDP endpoint plus a teardown hook. */
  connect(): Promise<{ browser: Browser; release: () => Promise<void> }>;
}

/* --------------------------------------------------------------- Steel.dev -- */

export interface SteelConfig {
  apiKey: string;
  baseUrl?: string;
  /** Operator's captured Cvent session, replayed into the hosted browser. */
  sessionContext?: { cookies: unknown[]; localStorage?: Record<string, string> };
  timeoutMs?: number;
}

export class SteelProvider implements BrowserProvider {
  readonly name = "steel";
  constructor(private readonly cfg: SteelConfig) {}

  async connect() {
    const base = this.cfg.baseUrl ?? "https://api.steel.dev";
    const res = await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { "steel-api-key": this.cfg.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        sessionContext: this.cfg.sessionContext,
        timeout: this.cfg.timeoutMs ?? 900_000,
      }),
    });
    if (!res.ok) throw new Error(`steel session create failed: ${res.status} ${await res.text()}`);
    const session = (await res.json()) as { id: string; websocketUrl: string };

    const browser = await chromium.connectOverCDP(session.websocketUrl);
    return {
      browser,
      release: async () => {
        await browser.close().catch(() => {});
        await fetch(`${base}/v1/sessions/${session.id}/release`, {
          method: "POST",
          headers: { "steel-api-key": this.cfg.apiKey },
        }).catch(() => {});
      },
    };
  }
}

/* ---------------------------------------------------- local Playwright ------ */
/* The documented fallback. Also what CI runs against.                          */

export class LocalPlaywrightProvider implements BrowserProvider {
  readonly name = "playwright-local";
  constructor(private readonly opts: { headless?: boolean } = {}) {}

  async connect() {
    const browser = await chromium.launch({ headless: this.opts.headless ?? true });
    return { browser, release: async () => void (await browser.close().catch(() => {})) };
  }
}

/* ------------------------------------------------------------- the session -- */

export interface StepTrace {
  taskId: string;
  action: Action;
  ok: boolean;
  error?: string;
  screenshot?: Buffer;
  at: string;
  durationMs: number;
}

export class BrowserSession {
  private constructor(
    private readonly page: Page,
    private readonly guardrails: Guardrails,
    private readonly trace: (s: StepTrace) => void,
    private readonly release: () => Promise<void>
  ) {}

  static async open(
    provider: BrowserProvider,
    guardrails: Guardrails,
    trace: (s: StepTrace) => void
  ): Promise<BrowserSession> {
    const { browser, release } = await provider.connect();
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return new BrowserSession(page, guardrails, trace, release);
  }

  /**
   * The only way to touch the browser. Guardrail check happens before the
   * action reaches Playwright, and every step — pass or fail — is traced.
   */
  async perform(action: Action): Promise<void> {
    const started = Date.now();
    try {
      this.guardrails.check(action);
      await this.run(action);
      this.trace({
        taskId: action.taskId,
        action: redact(action),
        ok: true,
        at: new Date().toISOString(),
        durationMs: Date.now() - started,
      });
    } catch (err) {
      this.trace({
        taskId: action.taskId,
        action: redact(action),
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        screenshot: await this.page.screenshot({ fullPage: false }).catch(() => undefined),
        at: new Date().toISOString(),
        durationMs: Date.now() - started,
      });
      throw err;
    }
  }

  private async run(a: Action): Promise<void> {
    switch (a.type) {
      case "navigate":
        await this.page.goto(a.url!, { waitUntil: "domcontentloaded" });
        return;
      case "click":
        await this.page.locator(a.selector!).click();
        return;
      case "fill":
        await this.page.locator(a.selector!).fill(a.value ?? "");
        return;
      case "select":
        await this.page.locator(a.selector!).selectOption(a.value!);
        return;
      case "upload":
        await this.page.locator(a.selector!).setInputFiles(a.value!);
        return;
      case "read":
        return;
    }
  }

  /** Read-only DOM access for idempotency checks. Still guardrail-checked. */
  async exists(selector: string, taskId: string): Promise<boolean> {
    await this.perform({ type: "read", selector, taskId });
    return (await this.page.locator(selector).count()) > 0;
  }

  async textOf(selector: string, taskId: string): Promise<string | null> {
    await this.perform({ type: "read", selector, taskId });
    return this.page.locator(selector).first().textContent();
  }

  async screenshot(): Promise<Buffer> {
    return this.page.screenshot({ fullPage: true });
  }

  async close(): Promise<void> {
    await this.release();
  }
}

/** Values never land in the trail verbatim — the audit log is retained. */
function redact(a: Action): Action {
  return a.value === undefined ? a : { ...a, value: `«${a.value.length} chars»` };
}
