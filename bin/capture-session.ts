#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";
import { message, parseArgs } from "./shared";

const DEFAULT_CVENT_URL = "https://app.cvent.com/";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), {
    values: ["url", "output", "auto-timeout-ms"],
    flags: ["auto", "help"],
  });
  if (args.flags.has("help")) {
    console.log("Usage: npx tsx bin/capture-session.ts [--url <cvent-url>] [--output session.json] [--auto]");
    return;
  }

  const url = args.values.get("url") ?? process.env.CVENT_APP_URL ?? DEFAULT_CVENT_URL;
  const output = resolve(args.values.get("output") ?? "session.json");
  const browser = await chromium.launch({ headless: false });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    console.log("Log in to Cvent in the Chromium window.");
    if (args.flags.has("auto")) {
      const timeoutMs = parseTimeout(args.values.get("auto-timeout-ms"));
      console.log("Waiting to capture automatically when the requested Cvent event is visible.");
      await waitForAuthenticatedEvent(page, url, timeoutMs);
    } else {
      const prompt = createInterface({ input: stdin, output: stdout });
      try {
        await prompt.question("When login is complete and the Cvent app is visible, press Enter to capture the session. ");
      } finally {
        prompt.close();
      }
    }

    const cookies = await context.cookies();
    const localStorage = await page.evaluate(() =>
      Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, index) => {
        const key = window.localStorage.key(index) ?? "";
        return [key, window.localStorage.getItem(key) ?? ""];
      }).filter(([key]) => key.length > 0))
    );

    await mkdir(dirname(output), { recursive: true });
    const localStorageOrigin = new URL(page.url()).origin;
    await writeFile(output, `${JSON.stringify({ cookies, localStorage, localStorageOrigin }, null, 2)}\n`, { mode: 0o600 });
    console.log(`Captured ${cookies.length} cookies and ${Object.keys(localStorage).length} localStorage entries from ${localStorageOrigin} to ${output}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function waitForAuthenticatedEvent(page: import("playwright").Page, requestedUrl: string, timeoutMs: number): Promise<void> {
  const expectedEventId = new URL(requestedUrl).searchParams.get("evtstub")?.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = new URL(page.url());
    const directId = current.searchParams.get("evtstub")?.toLowerCase() ?? null;
    const onLogin = /(?:^|\/)login(?:\.|\/|$)/i.test(current.pathname);
    if (!onLogin && current.hostname.endsWith("cvent.com") && (!expectedEventId || directId === expectedEventId)) {
      await page.waitForTimeout(2_000);
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for the authenticated Cvent event`);
}

function parseTimeout(value: string | undefined): number {
  if (!value) return 10 * 60_000;
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 10_000) throw new Error("--auto-timeout-ms must be an integer of at least 10000");
  return timeout;
}

main().catch((error) => {
  console.error(`session capture failed: ${message(error)}`);
  process.exitCode = 1;
});
