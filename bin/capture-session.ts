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
    values: ["url", "output"],
    flags: ["help"],
  });
  if (args.flags.has("help")) {
    console.log("Usage: npx tsx bin/capture-session.ts [--url <cvent-url>] [--output session.json]");
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
    const prompt = createInterface({ input: stdin, output: stdout });
    try {
      await prompt.question("When login is complete and the Cvent app is visible, press Enter to capture the session. ");
    } finally {
      prompt.close();
    }

    const cookies = await context.cookies();
    const localStorage = await page.evaluate(() =>
      Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, index) => {
        const key = window.localStorage.key(index) ?? "";
        return [key, window.localStorage.getItem(key) ?? ""];
      }).filter(([key]) => key.length > 0))
    );

    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify({ cookies, localStorage }, null, 2)}\n`, { mode: 0o600 });
    console.log(`Captured ${cookies.length} cookies and ${Object.keys(localStorage).length} localStorage entries to ${output}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`session capture failed: ${message(error)}`);
  process.exitCode = 1;
});
