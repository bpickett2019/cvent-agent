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

import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { Guardrails, type Action } from "../guardrails/middleware";

export interface BrowserConnection {
  browser: Browser;
  release: () => Promise<void>;
  viewerUrl?: string;
  providerSessionId?: string;
}

export interface BrowserProvider {
  readonly name: string;
  /** Returns a CDP endpoint, optional live viewer, and teardown hook. */
  connect(): Promise<BrowserConnection>;
}

/* --------------------------------------------------------------- Steel.dev -- */

export interface CapturedBrowserContext {
  cookies: unknown[];
  /** Legacy flat storage or Steel's complete origin-grouped storage. */
  localStorage?: Record<string, string> | Record<string, Record<string, string>>;
  localStorageOrigin?: string;
  sessionStorage?: Record<string, Record<string, string>>;
  indexedDB?: Record<string, unknown[]>;
  userAgent?: string;
}

export interface SteelConfig {
  apiKey: string;
  baseUrl?: string;
  /** Operator's captured Cvent session, replayed into the hosted browser. */
  sessionContext?: CapturedBrowserContext;
  timeoutMs?: number;
  /** Enables attended input after the run is cooperatively paused for takeover. */
  interactive?: boolean;
  /** Exact authorized page opened before the first agent action. */
  initialUrl?: string;
  /** Attach to a still-live self-hosted Steel browser rather than creating another session. */
  existingSessionId?: string;
}

export const STEEL_WORKER_TIMEOUT_MS = 3 * 60 * 60 * 1_000;

export class SteelProvider implements BrowserProvider {
  readonly name = "steel";
  constructor(private readonly cfg: SteelConfig) {}

  async connect() {
    const base = this.cfg.baseUrl ?? "https://api.steel.dev";
    if (this.cfg.existingSessionId) {
      const browser = await chromium.connectOverCDP(rebaseProviderUrl(base, base, true));
      const context = browser.contexts()[0] ?? await browser.newContext();
      const page = context.pages()[0] ?? await context.newPage();
      if (this.cfg.initialUrl && page.url() !== this.cfg.initialUrl) await page.goto(this.cfg.initialUrl, { waitUntil: "domcontentloaded" });
      return { browser, viewerUrl: `${base}/v1/sessions/debug`, providerSessionId: this.cfg.existingSessionId, release: async () => {} };
    }
    const context = this.cfg.sessionContext;
    const groupedLocalStorage = context?.localStorage
      ? context.localStorageOrigin
        ? { [context.localStorageOrigin]: context.localStorage as Record<string, string> }
        : context.localStorage as Record<string, Record<string, string>>
      : undefined;
    const res = await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { "steel-api-key": this.cfg.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        // Container workspaces permit attended input only through the operator
        // takeover flow, which pauses the cooperative action gate first.
        debugConfig: { interactive: this.cfg.interactive ?? false, systemCursor: this.cfg.interactive ?? false },
        sessionContext: context
          ? {
              cookies: context.cookies,
              // Steel's API requires storage grouped by origin. Local capture
              // stays flat so Playwright can replay it with addInitScript.
              ...(groupedLocalStorage ? { localStorage: groupedLocalStorage } : {}),
              ...(context.sessionStorage ? { sessionStorage: context.sessionStorage } : {}),
              ...(context.indexedDB ? { indexedDB: context.indexedDB } : {}),
            }
          : undefined,
        timeout: this.cfg.timeoutMs ?? STEEL_WORKER_TIMEOUT_MS,
      }),
    });
    if (!res.ok) throw new Error(`steel session create failed: ${res.status} ${await res.text()}`);
    const session = (await res.json()) as {
      id: string;
      websocketUrl: string;
      sessionViewerUrl?: string;
      debugUrl?: string;
    };

    const websocketUrl = rebaseProviderUrl(session.websocketUrl, base, true);
    const rawViewer = this.cfg.baseUrl ? session.debugUrl ?? session.sessionViewerUrl : session.sessionViewerUrl ?? session.debugUrl;
    const viewerUrl = rawViewer ? rebaseProviderUrl(rawViewer, base, false) : undefined;
    const browser = await chromium.connectOverCDP(websocketUrl);
    if (this.cfg.initialUrl) {
      const context = browser.contexts()[0] ?? await browser.newContext();
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(this.cfg.initialUrl, { waitUntil: "domcontentloaded" });
      if (/\/Subscribers\/Login\.aspx/i.test(new URL(page.url()).pathname)) {
        const sso = page.getByText("Log in using Single Sign-On", { exact: true });
        if (await sso.count()) {
          await sso.click();
          await page.waitForURL((value) => value.hostname === "app.cvent.com" && !/login/i.test(value.pathname), { timeout: 20_000 }).catch(() => undefined);
          if (page.url() !== this.cfg.initialUrl && new URL(page.url()).hostname === "app.cvent.com" && !/login/i.test(new URL(page.url()).pathname)) await page.goto(this.cfg.initialUrl, { waitUntil: "domcontentloaded" });
        }
      }
    }
    return {
      browser,
      viewerUrl,
      providerSessionId: session.id,
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

export interface LocalPlaywrightOptions {
  headless?: boolean;
  sessionContext?: SteelConfig["sessionContext"];
}

export class LocalPlaywrightProvider implements BrowserProvider {
  readonly name = "playwright-local";
  constructor(private readonly opts: LocalPlaywrightOptions = {}) {}

  async connect() {
    const browser = await chromium.launch({ headless: this.opts.headless ?? true });
    try {
      if (this.opts.sessionContext) {
        const context = await browser.newContext();
        const cookies = this.opts.sessionContext.cookies as Parameters<BrowserContext["addCookies"]>[0];
        if (cookies.length) await context.addCookies(cookies);
        const capturedStorage = this.opts.sessionContext.localStorage;
        const localStorage = capturedStorage
          ? Object.values(capturedStorage)[0] && typeof Object.values(capturedStorage)[0] === "object"
            ? Object.values(capturedStorage as Record<string, Record<string, string>>)[0]
            : capturedStorage as Record<string, string>
          : undefined;
        if (localStorage) {
          await context.addInitScript((entries: Record<string, string>) => {
            try {
              for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
            } catch {
              // Some non-web origins do not expose localStorage. The script runs
              // again when the context reaches the captured Cvent origin.
            }
          }, localStorage);
        }
      }
      return { browser, release: async () => void (await browser.close().catch(() => {})) };
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
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
    private readonly release: () => Promise<void>,
    private readonly beforeAction: () => Promise<void>
  ) {}

  static async open(
    provider: BrowserProvider,
    guardrails: Guardrails,
    trace: (s: StepTrace) => void,
    options: {
      beforeAction?: () => Promise<void>;
      onConnected?: (details: { provider: string; viewerUrl?: string; providerSessionId?: string; currentUrl: string }) => Promise<void>;
    } = {}
  ): Promise<BrowserSession> {
    const { browser, release, viewerUrl, providerSessionId } = await provider.connect();
    try {
      const context = browser.contexts()[0] ?? (await browser.newContext());
      const page = context.pages()[0] ?? (await context.newPage());
      await options.onConnected?.({ provider: provider.name, viewerUrl, providerSessionId, currentUrl: page.url() });
      return new BrowserSession(page, guardrails, trace, release, options.beforeAction ?? (async () => {}));
    } catch (error) {
      await release().catch(() => {});
      throw error;
    }
  }

  /**
   * The only way to touch the browser. Guardrail check happens before the
   * action reaches Playwright, and every step — pass or fail — is traced.
   */
  async perform(action: Action): Promise<void> {
    const started = Date.now();
    try {
      // Cooperative operator pause/cancel sits beneath Pi, immediately before
      // each browser action. An action already in flight is allowed to finish.
      await this.beforeAction();
      this.guardrails.check(action);
      // Re-check the live page boundary before every DOM action. This catches a
      // prior redirect or manual drift even when the action itself has no URL.
      if (action.type !== "navigate") {
        this.guardrails.check({ type: "navigate", url: this.page.url(), taskId: action.taskId });
      }
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
        try {
          await this.page.goto(a.url!, { waitUntil: "domcontentloaded" });
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("net::ERR_ABORTED")) throw error;
          await this.page.goto(a.url!, { waitUntil: "domcontentloaded" });
        }
        // Redirects are untrusted. Validate the actual destination as well as
        // the requested URL before any subsequent action can run.
        this.guardrails.check({ type: "navigate", url: this.page.url(), taskId: a.taskId });
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
    const locator = this.page.locator(selector).first();
    return locator.evaluate((element) => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element.value : (element as HTMLElement).innerText);
  }

  async screenshot(): Promise<Buffer> {
    return this.page.screenshot({ fullPage: true });
  }

  /** Read-only location used by sandbox validation and redirect boundary checks. */
  currentUrl(): string {
    return this.page.url();
  }

  async close(): Promise<void> {
    await this.release();
  }
}

function rebaseProviderUrl(raw: string, base: string, websocket: boolean): string {
  const source = new URL(raw);
  const target = new URL(base);
  source.protocol = websocket ? (target.protocol === "https:" ? "wss:" : "ws:") : target.protocol;
  source.host = target.host;
  return source.toString();
}

/** Values never land in the trail verbatim — the audit log is retained. */
function redact(a: Action): Action {
  return a.value === undefined ? a : { ...a, value: `«${a.value.length} chars»` };
}
