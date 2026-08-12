#!/usr/bin/env node

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { BrowserContext, Frame, Page } from "playwright";
import { chromium } from "playwright";
import { message, parseArgs } from "./shared";

const DEFAULT_CVENT_URL = "https://app.cvent.com/";
const SURFACES = ["question-editor", "question-visibility", "registration-type"] as const;
const BLOCKED_CLICK_NAME = /\b(save|publish|delete)\b/i;
const BLOCKED_CLICK_ROLES = new Set(["checkbox", "radio", "switch", "option"]);

type Surface = (typeof SURFACES)[number];
type AriaRole = Parameters<Page["getByRole"]>[0];

interface DiscoveredElement {
  frameName: string;
  frameUrl: string;
  accessibleName: string;
  role: string;
  tag: string;
  id: string;
  dataAttributes: Record<string, string>;
  visible: boolean;
  disabled: boolean;
  suggestedSelector: string;
}

interface FrameSnapshot {
  name: string;
  url: string;
  accessibilityTree: string;
}

type ExploreCommand =
  | { action: "navigate"; url: string }
  | { action: "click"; role: string; name: string; exact?: boolean; frameUrlPattern?: string }
  | { action: "capture"; surface: Surface }
  | { action: "stop" };

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), {
    values: ["url", "target-pattern", "ready-file", "profile", "control-dir", "output-dir", "poll-ms"],
    flags: ["help"],
  });
  if (args.flags.has("help")) {
    console.log(`Usage: npx tsx bin/explore.ts [options]

Options:
  --url <url>              Initial Cvent URL (default: ${DEFAULT_CVENT_URL})
  --ready-file <path>      Ready sentinel (default: .explore/ready)
  --target-pattern <regex> Use URL polling instead of the ready sentinel
  --profile <directory>    Persistent Chromium profile (default: .playwright/cvent-explore)
  --control-dir <dir>      Sentinel and command directory (default: .explore)
  --output-dir <dir>       Discovery output directory (default: discovered)
  --poll-ms <milliseconds> Poll interval (default: 500)

The process never reads stdin. By default, log in, navigate to the target page,
then create .explore/ready. After that, create one of these empty sentinel files
to dump the currently active Cvent page:
  .explore/capture-question-editor
  .explore/capture-question-visibility
  .explore/capture-registration-type
  .explore/stop

Read-only navigate, role-based click, capture, and stop commands may also be
placed as JSON files in .explore/commands/.`);
    return;
  }

  const patternSource = args.values.get("target-pattern");
  if (patternSource && args.values.has("ready-file")) {
    throw new Error("use either --target-pattern or --ready-file, not both");
  }
  const targetPattern = patternSource ? compilePattern(patternSource, "--target-pattern") : undefined;
  const initialUrl = parseHttpUrl(args.values.get("url") ?? DEFAULT_CVENT_URL, "--url");
  const profile = resolve(args.values.get("profile") ?? ".playwright/cvent-explore");
  const controlDir = resolve(args.values.get("control-dir") ?? ".explore");
  const readyFile = resolve(args.values.get("ready-file") ?? join(controlDir, "ready"));
  const commandsDir = join(controlDir, "commands");
  const outputDir = resolve(args.values.get("output-dir") ?? "discovered");
  const pollMs = parsePollMs(args.values.get("poll-ms"));

  await Promise.all([mkdir(profile, { recursive: true }), mkdir(commandsDir, { recursive: true }), mkdir(outputDir, { recursive: true })]);

  const context = await chromium.launchPersistentContext(profile, { headless: false });
  let stopped = false;
  let activePage: Page | undefined;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  context.once("close", stop);
  context.on("page", (page) => {
    activePage = page;
  });

  try {
    activePage = context.pages().find((page) => !page.isClosed()) ?? (await context.newPage());
    await activePage.goto(initialUrl.toString(), { waitUntil: "domcontentloaded" });

    console.log(`Opened headed Chromium with persistent profile ${profile}`);
    console.log("Log in manually, then navigate in that window to the target Cvent page.");
    if (targetPattern) {
      console.log(`Waiting for an open page URL to match /${patternSource}/. No stdin is used.`);
    } else {
      console.log(`When the target page is visible, run: touch ${readyFile}`);
      console.log("Waiting for that sentinel. No stdin is used.");
    }

    const targetPage = await waitUntilReady(context, targetPattern, readyFile, pollMs, () => stopped);
    if (!targetPage) return;
    activePage = targetPage;
    await activePage.bringToFront();
    console.log(`Target matched: ${activePage.url()}`);
    printControlInstructions(controlDir, commandsDir);

    while (!stopped) {
      const pages = context.pages().filter((page) => !page.isClosed());
      if (!activePage || activePage.isClosed()) activePage = pages.at(-1);
      if (!activePage) break;

      for (const surface of SURFACES) {
        const sentinel = join(controlDir, `capture-${surface}`);
        if (await consumeSentinel(sentinel)) {
          await dump(activePage, surface, outputDir);
        }
      }
      if (await consumeSentinel(join(controlDir, "stop"))) break;

      try {
        const result = await processNextCommand(context, activePage, commandsDir, outputDir);
        if (result.page) activePage = result.page;
        if (result.stop) break;
      } catch (error) {
        console.error(`Explore command failed without closing the browser: ${message(error)}`);
      }
      await sleep(pollMs);
    }
  } finally {
    await context.close().catch(() => {});
    console.log(`Chromium closed. Session state remains in ${profile}`);
  }
}

async function waitUntilReady(
  context: BrowserContext,
  pattern: RegExp | undefined,
  readyFile: string,
  pollMs: number,
  stopped: () => boolean
): Promise<Page | undefined> {
  while (!stopped()) {
    const pages = context.pages().filter((page) => !page.isClosed());
    if (pattern) {
      const matched = pages.find((page) => matches(pattern, page.url()));
      if (matched) return matched;
    } else if (await consumeSentinel(readyFile)) {
      return pages.at(-1);
    }
    await sleep(pollMs);
  }
  return undefined;
}

async function processNextCommand(
  context: BrowserContext,
  activePage: Page,
  commandsDir: string,
  outputDir: string
): Promise<{ page?: Page; stop?: boolean }> {
  const names = (await readdir(commandsDir))
    .filter((name) => name.endsWith(".json") && !name.includes(".done.") && !name.includes(".processing."))
    .sort();
  const name = names[0];
  if (!name) return {};

  const sourcePath = join(commandsDir, name);
  const processingPath = join(commandsDir, `${name.slice(0, -5)}.processing.json`);
  await rename(sourcePath, processingPath);
  try {
    const command = parseCommand(JSON.parse(await readFile(processingPath, "utf8")));
    switch (command.action) {
      case "navigate": {
        const url = parseHttpUrl(command.url, "navigate command URL");
        await activePage.goto(url.toString(), { waitUntil: "domcontentloaded" });
        console.log(`Navigated read-only to ${activePage.url()}`);
        break;
      }
      case "click": {
        await clickReadOnly(context, command);
        console.log(`Clicked observed role=${JSON.stringify(command.role)} name=${JSON.stringify(command.name)}`);
        break;
      }
      case "capture":
        await dump(activePage, command.surface, outputDir);
        break;
      case "stop":
        return { stop: true };
    }
    return { page: activePage };
  } finally {
    const donePath = join(commandsDir, `${basename(name, ".json")}.done.json`);
    await rename(processingPath, donePath).catch(() => {});
  }
}

async function clickReadOnly(context: BrowserContext, command: Extract<ExploreCommand, { action: "click" }>): Promise<void> {
  if (BLOCKED_CLICK_NAME.test(command.name)) {
    throw new Error(`read-only exploration blocked click on ${JSON.stringify(command.name)}`);
  }
  if (BLOCKED_CLICK_ROLES.has(command.role)) {
    throw new Error(`read-only exploration blocked state-changing role ${JSON.stringify(command.role)}`);
  }

  const framePattern = command.frameUrlPattern
    ? compilePattern(command.frameUrlPattern, "click frameUrlPattern")
    : undefined;
  const matches: Array<{ frame: Frame; count: number }> = [];
  for (const page of context.pages()) {
    for (const frame of page.frames()) {
      if (framePattern && !matchesRegex(framePattern, frame.url())) continue;
      const locator = frame.getByRole(command.role as AriaRole, {
        name: command.name,
        exact: command.exact ?? true,
      });
      const count = await locator.count();
      if (count > 0) matches.push({ frame, count });
    }
  }

  const total = matches.reduce((sum, match) => sum + match.count, 0);
  if (total !== 1) {
    throw new Error(`read-only click requires exactly one role/name match; found ${total}`);
  }
  const match = matches[0];
  await match.frame
    .getByRole(command.role as AriaRole, { name: command.name, exact: command.exact ?? true })
    .click();
}

async function dump(page: Page, surface: Surface, outputDir: string): Promise<void> {
  const elements: DiscoveredElement[] = [];
  const frames: FrameSnapshot[] = [];
  for (const frame of page.frames()) {
    const accessibilityTree = await frame.locator("body").ariaSnapshot({ timeout: 5_000 }).catch((error) =>
      `[accessibility snapshot unavailable: ${message(error)}]`
    );
    frames.push({ name: frame.name(), url: frame.url(), accessibilityTree });

    const raw = await frame
      .locator("button, a[href], input:not([type='hidden']), select, textarea, summary, [role], [tabindex], [contenteditable='true']")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const element = node as HTMLElement;
          const tag = element.tagName.toLowerCase();
          const input = element instanceof HTMLInputElement ? element : null;
          const select = element instanceof HTMLSelectElement ? element : null;
          const formControl =
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement
              ? element
              : null;
          const explicitRole = (element.getAttribute("role") ?? "").split(/\s+/)[0];
          let role = explicitRole;
          if (!role) {
            if (tag === "button" || tag === "summary") role = "button";
            else if (tag === "a" && element.hasAttribute("href")) role = "link";
            else if (tag === "textarea" || element.isContentEditable) role = "textbox";
            else if (select) role = select.multiple ? "listbox" : "combobox";
            else if (input) {
              const type = input.type.toLowerCase();
              if (["button", "submit", "reset", "image"].includes(type)) role = "button";
              else if (type === "checkbox") role = "checkbox";
              else if (type === "radio") role = "radio";
              else if (type === "range") role = "slider";
              else if (type === "number") role = "spinbutton";
              else role = "textbox";
            } else role = "generic";
          }

          const labelledBy = element
            .getAttribute("aria-labelledby")
            ?.split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .filter(Boolean)
            .join(" ");
          const labels = formControl
            ? Array.from(formControl.labels ?? [])
                .map((label) => label.textContent?.trim() ?? "")
                .filter(Boolean)
                .join(" ")
            : "";
          const accessibleName = (
            element.getAttribute("aria-label") ||
            labelledBy ||
            labels ||
            (input && ["button", "submit", "reset"].includes(input.type) ? input.value : "") ||
            (input?.type === "image" ? input.alt : "") ||
            (tag === "img" ? element.getAttribute("alt") : "") ||
            element.textContent?.trim() ||
            input?.placeholder ||
            element.getAttribute("title") ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim();
          const dataAttributes = Object.fromEntries(
            Array.from(element.attributes)
              .filter((attribute) => attribute.name.startsWith("data-"))
              .map((attribute) => [attribute.name, attribute.value])
          );
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            accessibleName,
            role,
            tag,
            id: element.id,
            dataAttributes,
            visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0,
            disabled:
              ("disabled" in element && Boolean((element as HTMLButtonElement).disabled)) ||
              element.getAttribute("aria-disabled") === "true",
          };
        })
      )
      .catch(() => []);

    const frameLabel = frame === page.mainFrame() ? "page" : "frame";
    elements.push(
      ...raw.map((element) => ({
        ...element,
        frameName: frame.name(),
        frameUrl: frame.url(),
        suggestedSelector: element.accessibleName
          ? `${frameLabel}.getByRole(${JSON.stringify(element.role)}, { name: ${JSON.stringify(element.accessibleName)}, exact: true })`
          : `${frameLabel}.getByRole(${JSON.stringify(element.role)})`,
      }))
    );
  }

  const capturedAt = new Date().toISOString();
  const discovery = { surface, url: page.url(), capturedAt, frames, elements };
  const jsonPath = join(outputDir, `${surface}.json`);
  const summaryPath = join(outputDir, `${surface}.txt`);
  await mkdir(dirname(jsonPath), { recursive: true });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(discovery, null, 2)}\n`),
    writeFile(summaryPath, renderSummary(discovery)),
  ]);
  console.log(`Captured ${elements.length} interactive elements across ${frames.length} frame(s).`);
  console.log(`Wrote ${jsonPath} and ${summaryPath}`);
}

function renderSummary(discovery: {
  surface: Surface;
  url: string;
  capturedAt: string;
  frames: FrameSnapshot[];
  elements: DiscoveredElement[];
}): string {
  const lines = [
    `Surface: ${discovery.surface}`,
    `URL: ${discovery.url}`,
    `Captured: ${discovery.capturedAt}`,
    `Interactive elements: ${discovery.elements.length}`,
    "",
    ...discovery.elements.flatMap((element, index) => [
      `${index + 1}. [${element.role}] ${element.accessibleName || "(no accessible name)"}`,
      `   frame: ${element.frameUrl}`,
      `   tag: ${element.tag}  id: ${element.id || "(none)"}  visible: ${element.visible}  disabled: ${element.disabled}`,
      `   data-*: ${JSON.stringify(element.dataAttributes)}`,
      `   selector: ${element.suggestedSelector}`,
    ]),
    "",
    "Accessibility trees",
    "===================",
    ...discovery.frames.flatMap((frame) => [
      "",
      `Frame: ${frame.url}${frame.name ? ` (${frame.name})` : ""}`,
      frame.accessibilityTree,
    ]),
    "",
  ];
  return lines.join("\n");
}

function parseCommand(value: unknown): ExploreCommand {
  if (typeof value !== "object" || value === null) throw new Error("explore command must be a JSON object");
  const command = value as Record<string, unknown>;
  switch (command.action) {
    case "navigate":
      if (typeof command.url !== "string") throw new Error("navigate command requires string url");
      return { action: "navigate", url: command.url };
    case "click":
      if (typeof command.role !== "string" || typeof command.name !== "string") {
        throw new Error("click command requires string role and name");
      }
      if (command.exact !== undefined && typeof command.exact !== "boolean") {
        throw new Error("click command exact must be boolean");
      }
      if (command.frameUrlPattern !== undefined && typeof command.frameUrlPattern !== "string") {
        throw new Error("click command frameUrlPattern must be string");
      }
      return {
        action: "click",
        role: command.role,
        name: command.name,
        exact: command.exact,
        frameUrlPattern: command.frameUrlPattern,
      };
    case "capture":
      if (typeof command.surface !== "string" || !isSurface(command.surface)) {
        throw new Error(`capture command surface must be one of: ${SURFACES.join(", ")}`);
      }
      return { action: "capture", surface: command.surface };
    case "stop":
      return { action: "stop" };
    default:
      throw new Error("explore command action must be navigate, click, capture, or stop");
  }
}

function printControlInstructions(controlDir: string, commandsDir: string): void {
  console.log("Exploration is ready. Use the browser normally to open a read-only panel, then run one of:");
  for (const surface of SURFACES) console.log(`  touch ${join(controlDir, `capture-${surface}`)}`);
  console.log(`  touch ${join(controlDir, "stop")}`);
  console.log(`Agent read-only JSON commands are watched in ${commandsDir}`);
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

function compilePattern(source: string, label: string): RegExp {
  try {
    return new RegExp(source);
  } catch (error) {
    throw new Error(`${label} is not a valid regular expression: ${message(error)}`);
  }
}

function matches(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function matchesRegex(pattern: RegExp, value: string): boolean {
  return matches(pattern, value);
}

function parseHttpUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} must use http or https`);
  }
  return url;
}

function parsePollMs(value: string | undefined): number {
  if (value === undefined) return 500;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 10_000) {
    throw new Error("--poll-ms must be an integer from 100 to 10000");
  }
  return parsed;
}

function isSurface(value: string): value is Surface {
  return (SURFACES as readonly string[]).includes(value);
}

const sleep = (ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

main().catch((error) => {
  console.error(`exploration failed: ${message(error)}`);
  process.exitCode = 1;
});
