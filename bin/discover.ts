#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { loadCapturedSession, message, parseArgs } from "./shared";

interface DiscoveredElement {
  accessibleName: string;
  role: string;
  tag: string;
  id: string;
  dataAttributes: Record<string, string>;
  suggestedSelector: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), {
    values: ["url", "session", "output"],
    flags: ["watch", "help"],
  });
  if (args.flags.has("help")) {
    console.log("Usage: npx tsx bin/discover.ts --url <cvent-url> [--session session.json] [--output discovered.json] [--watch]");
    return;
  }

  const url = args.values.get("url");
  if (!url) throw new Error("--url is required");
  const output = resolve(args.values.get("output") ?? "discovered.json");
  const session = await loadCapturedSession(args.values.get("session") ?? "session.json");
  const browser = await chromium.launch({ headless: false });

  try {
    const context = await browser.newContext();
    const cookies = session.cookies as unknown as Parameters<BrowserContext["addCookies"]>[0];
    if (cookies.length) await context.addCookies(cookies);
    const capturedStorage = session.localStorage;
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
          // Ignore browser-internal origins; Cvent origins receive the script too.
        }
      }, localStorage);
    }

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await dump(page, output);

    if (args.flags.has("watch")) {
      console.log("\nWatching top-level navigation. Press Ctrl+C to stop.");
      let timer: NodeJS.Timeout | undefined;
      page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame()) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void page
            .waitForLoadState("domcontentloaded")
            .catch(() => {})
            .then(() => dump(page, output))
            .catch((error) => console.error(`watch dump failed: ${message(error)}`));
        }, 250);
      });
      await new Promise<void>((done) => {
        process.once("SIGINT", done);
        browser.once("disconnected", () => done());
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

async function dump(page: Page, output: string): Promise<void> {
  const raw = await page.locator("button, a, input, select, textarea, [role]").evaluateAll((nodes) =>
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
        if (tag === "button") role = "button";
        else if (tag === "a") role = "link";
        else if (tag === "textarea") role = "textbox";
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

      const labelledBy = element.getAttribute("aria-labelledby")
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      const labels = formControl
        ? Array.from(formControl.labels ?? []).map((label) => label.textContent?.trim() ?? "").filter(Boolean).join(" ")
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
      ).replace(/\s+/g, " ").trim();

      const dataAttributes = Object.fromEntries(
        Array.from(element.attributes)
          .filter((attribute) => attribute.name.startsWith("data-"))
          .map((attribute) => [attribute.name, attribute.value])
      );
      return { accessibleName, role, tag, id: element.id, dataAttributes };
    })
  );

  const elements: DiscoveredElement[] = raw.map((element) => ({
    ...element,
    suggestedSelector: element.accessibleName
      ? `page.getByRole(${JSON.stringify(element.role)}, { name: ${JSON.stringify(element.accessibleName)}, exact: true })`
      : `page.getByRole(${JSON.stringify(element.role)})`,
  }));
  const discovery = {
    url: page.url(),
    capturedAt: new Date().toISOString(),
    elements,
  };

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(discovery, null, 2)}\n`);
  console.log(`\n${discovery.capturedAt} — ${elements.length} interactive elements at ${discovery.url}`);
  console.table(elements.map((element, index) => ({
    "#": index + 1,
    name: element.accessibleName,
    role: element.role,
    tag: element.tag,
    id: element.id,
    "data-*": JSON.stringify(element.dataAttributes),
    selector: element.suggestedSelector,
  })));
  console.log(`Wrote ${output}`);
}

main().catch((error) => {
  console.error(`selector discovery failed: ${message(error)}`);
  process.exitCode = 1;
});
