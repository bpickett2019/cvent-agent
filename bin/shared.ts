import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const SessionContextSchema = z
  .object({
    cookies: z.array(z.record(z.unknown())),
    localStorage: z.union([z.record(z.string()), z.record(z.record(z.string()))]).optional(),
    localStorageOrigin: z.string().url().optional(),
    sessionStorage: z.record(z.record(z.string())).optional(),
    indexedDB: z.record(z.array(z.unknown())).optional(),
    userAgent: z.string().optional(),
  })
  .strict();

export type CapturedSession = z.infer<typeof SessionContextSchema>;

export async function loadCapturedSession(path: string): Promise<CapturedSession> {
  const absolute = resolve(path);
  let source: string;
  try {
    source = await readFile(absolute, "utf8");
  } catch (error) {
    throw new Error(`could not read captured session ${absolute}: ${message(error)}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`captured session ${absolute} is not valid JSON: ${message(error)}`);
  }

  const parsed = SessionContextSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`captured session ${absolute} is invalid: ${issues}`);
  }
  return parsed.data;
}

export interface ParsedArgs {
  values: Map<string, string>;
  flags: Set<string>;
}

export function parseArgs(
  argv: string[],
  options: { values?: string[]; flags?: string[] } = {}
): ParsedArgs {
  const valueNames = new Set(options.values ?? []);
  const flagNames = new Set(options.flags ?? []);
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument "${token}"`);

    const equals = token.indexOf("=");
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    if (flagNames.has(name)) {
      if (equals !== -1) throw new Error(`--${name} does not take a value`);
      flags.add(name);
      continue;
    }
    if (!valueNames.has(name)) throw new Error(`unknown option --${name}`);

    const value = equals === -1 ? argv[index + 1] : token.slice(equals + 1);
    if (!value || (equals === -1 && value.startsWith("--"))) {
      throw new Error(`--${name} requires a value`);
    }
    values.set(name, value);
    if (equals === -1) index += 1;
  }

  return { values, flags };
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
