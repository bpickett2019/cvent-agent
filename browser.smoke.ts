/** Browser boundary checks with a fake Playwright page. No real browser or network. */

import type { Browser } from "playwright";
import { BrowserSession, STEEL_WORKER_TIMEOUT_MS, type BrowserProvider } from "./src/browser/driver";
import { GuardrailViolation, Guardrails } from "./src/guardrails/middleware";
import { readFileSync } from "node:fs";

const EVENT_ID = "3f2b6a10-9c4d-4e21-b8f7-0a1c2d3e4f56";
const OTHER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
let failures = 0;
let checks = 0;
function check(label: string, ok: boolean) {
  checks += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}`);
  if (!ok) failures += 1;
}
check("Steel worker default timeout is three hours", STEEL_WORKER_TIMEOUT_MS === 10_800_000);
check("Steel retries Cvent SSO from cloned identity cookies", /Log in using Single Sign-On/.test(readFileSync("src/browser/driver.ts", "utf8")));
check("Steel can attach to a retained provider session", /existingSessionId/.test(readFileSync("src/browser/driver.ts", "utf8")));

class FakeProvider implements BrowserProvider {
  readonly name = "fake";
  current = `https://app.cvent.com/events/${EVENT_ID}/designer`;
  redirectTo: string | null = null;
  abortNextNavigation = false;
  clicks = 0;

  async connect(): Promise<{ browser: Browser; release: () => Promise<void> }> {
    const page = {
      url: () => this.current,
      goto: async (url: string) => { if (this.abortNextNavigation) { this.abortNextNavigation = false; throw new Error("page.goto: net::ERR_ABORTED"); } this.current = this.redirectTo ?? url; },
      screenshot: async () => Buffer.from("shot"),
      locator: () => ({
        click: async () => { this.clicks += 1; },
        fill: async () => {},
        selectOption: async () => {},
        setInputFiles: async () => {},
      }),
    };
    const context = { pages: () => [page] };
    return {
      browser: { contexts: () => [context] } as unknown as Browser,
      release: async () => {},
    };
  }
}

const guardrails = new Guardrails({
  eventId: EVENT_ID,
  denyList: { selectors: [], urlPatterns: [] },
  costCeilingUsd: 30,
  costAlertUsd: 20,
}, () => {});
const provider = new FakeProvider();
const session = await BrowserSession.open(provider, guardrails, () => {});

provider.redirectTo = `https://app.cvent.com/events/${OTHER_ID}/designer`;
let redirectBlocked = false;
try {
  await session.perform({
    type: "navigate",
    url: `https://app.cvent.com/events/${EVENT_ID}/designer`,
    taskId: "redirect",
  });
} catch (error) {
  redirectBlocked = error instanceof GuardrailViolation && error.rule === "eventId.mismatch";
}
check("post-navigation redirect to another event is blocked", redirectBlocked);

provider.redirectTo = null;
provider.current = `https://app.cvent.com/events/${OTHER_ID}/designer`;
let driftBlocked = false;
try {
  await session.perform({ type: "click", selector: "#save", taskId: "drift" });
} catch (error) {
  driftBlocked = error instanceof GuardrailViolation && error.rule === "eventId.mismatch";
}
check("live page drift is checked before selector action", driftBlocked);
check("blocked drift never reaches Playwright click", provider.clicks === 0);

provider.current = `https://app.cvent.com/events/${EVENT_ID}/designer`;
await session.perform({ type: "click", selector: "#save", taskId: "safe" });
check("in-bound selector action executes", provider.clicks === 1);
provider.abortNextNavigation = true;
await session.perform({ type: "navigate", url: `https://app.cvent.com/events/${EVENT_ID}/designer`, taskId: "abort-retry" });
check("transient Cvent ERR_ABORTED navigation is retried once", provider.current.includes(EVENT_ID));
await session.close();

console.log(`\n${failures === 0 ? `ALL BROWSER CHECKS PASSED (${checks} checks)` : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
