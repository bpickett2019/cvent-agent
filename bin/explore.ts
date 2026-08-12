#!/usr/bin/env node

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { message, parseArgs } from "./shared";

const DEFAULT_PROFILE = ".playwright/cvent-explore";
const DEFAULT_SENTINEL = "capture-now";
const DEFAULT_OUTPUT_DIR = "discovered";
const DEFAULT_SESSION = "session.json";

interface FrameCapture {
  name: string;
  url: string;
  accessibilityTree: string;
}

interface Capture {
  capturedAt: string;
  pageUrl: string;
  pageTitle: string;
  frames: FrameCapture[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), {
    values: ["profile", "sentinel", "output-dir", "session", "poll-ms"],
    flags: ["help"],
  });

  if (args.flags.has("help")) {
    console.log(`Usage: npx tsx bin/explore.ts [options]

Options:
  --profile <directory>  Persistent Chromium profile (default: ${DEFAULT_PROFILE})
  --sentinel <path>      Capture sentinel (default: ${DEFAULT_SENTINEL})
  --output-dir <dir>     Accessibility captures (default: ${DEFAULT_OUTPUT_DIR})
  --session <path>       Portable Steel session context (default: ${DEFAULT_SESSION})
  --poll-ms <number>     Sentinel polling interval (default: 500)

This tool is capture-only. It never navigates, clicks, fills, selects, submits,
or otherwise interacts with Cvent. Drive the headed browser manually. Each time
you create the sentinel file, the tool captures the focused page, refreshes the
portable session file, deletes the sentinel, and continues waiting.`);
    return;
  }

  const profile = resolve(args.values.get("profile") ?? DEFAULT_PROFILE);
  const sentinel = resolve(args.values.get("sentinel") ?? DEFAULT_SENTINEL);
  const outputDir = resolve(args.values.get("output-dir") ?? DEFAULT_OUTPUT_DIR);
  const sessionPath = resolve(args.values.get("session") ?? DEFAULT_SESSION);
  const pollMs = parsePollMs(args.values.get("poll-ms"));

  await Promise.all([
    mkdir(profile, { recursive: true }),
    mkdir(outputDir, { recursive: true }),
    mkdir(dirname(sessionPath), { recursive: true }),
  ]);

  const context = await chromium.launchPersistentContext(profile, { headless: false });
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  context.once("close", stop);

  console.log(`Opened capture-only Chromium with persistent profile ${profile}`);
  console.log("Log in and navigate manually. This process will not interact with the page.");
  console.log(`Touch ${sentinel} whenever the state you want captured is visible.`);
  console.log(`Press Ctrl+C or close Chromium to stop.`);

  try {
    while (!stopped) {
      if (await consumeSentinel(sentinel)) {
        const page = await focusedPage(context);
        if (!page) {
          console.error("Capture requested, but no open browser page was available.");
        } else {
          const capture = await capturePage(page);
          const output = join(outputDir, `${fileTimestamp(capture.capturedAt)}.json`);
          await writeFile(output, `${JSON.stringify(capture, null, 2)}\n`);
          await writePortableSession(context, page, sessionPath);
          console.log(`Captured ${capture.frames.length} frame(s) at ${capture.pageUrl}`);
          console.log(`Wrote ${output}`);
          console.log(`Refreshed portable Steel session context ${sessionPath}`);
        }
      }
      await sleep(pollMs);
    }
  } finally {
    const page = await focusedPage(context).catch(() => undefined);
    if (page) await writePortableSession(context, page, sessionPath).catch(() => {});
    await context.close().catch(() => {});
    console.log(`Chromium closed. Persistent profile remains at ${profile}`);
  }
}

/** Observation only: identifies the manually focused tab without changing focus. */
async function focusedPage(context: BrowserContext): Promise<Page | undefined> {
  const pages = context.pages().filter((page) => !page.isClosed());
  for (const page of pages) {
    const focused = await page.evaluate(() => document.hasFocus()).catch(() => false);
    if (focused) return page;
  }
  return pages.at(-1);
}

/** Observation only: Playwright's ARIA snapshot does not mutate page state. */
async function capturePage(page: Page): Promise<Capture> {
  const frames: FrameCapture[] = [];
  for (const frame of page.frames()) {
    const accessibilityTree = await frame
      .locator("body")
      .ariaSnapshot({ timeout: 10_000 })
      .catch((error) => `[accessibility snapshot unavailable: ${message(error)}]`);
    frames.push({ name: frame.name(), url: frame.url(), accessibilityTree });
  }

  return {
    capturedAt: new Date().toISOString(),
    pageUrl: page.url(),
    pageTitle: await page.title().catch(() => ""),
    frames,
  };
}

/**
 * Writes the exact shape accepted by SteelConfig.sessionContext. localStorage
 * comes from the manually focused page's origin, matching capture-session.ts.
 */
async function writePortableSession(context: BrowserContext, page: Page, path: string): Promise<void> {
  const cookies = await context.cookies();
  const localStorage = await page
    .evaluate(() =>
      Object.fromEntries(
        Array.from({ length: window.localStorage.length }, (_, index) => {
          const key = window.localStorage.key(index) ?? "";
          return [key, window.localStorage.getItem(key) ?? ""];
        }).filter(([key]) => key.length > 0)
      )
    )
    .catch(() => ({} as Record<string, string>));

  await writeFile(path, `${JSON.stringify({ cookies, localStorage }, null, 2)}\n`, { mode: 0o600 });
}

async function consumeSentinel(path: string): Promise<boolean> {
  try {
    await rm(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function parsePollMs(value: string | undefined): number {
  if (value === undefined) return 500;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 10_000) {
    throw new Error("--poll-ms must be an integer from 100 to 10000");
  }
  return parsed;
}

function fileTimestamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

const sleep = (ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

main().catch((error) => {
  console.error(`capture-only exploration failed: ${message(error)}`);
  process.exitCode = 1;
});
