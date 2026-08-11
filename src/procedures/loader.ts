import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { z } from "zod";
import { parse } from "yaml";

const ProcedureStepSchema = z
  .object({
    description: z.string().min(1),
    selectorHint: z.string().min(1).optional(),
    verify: z.string().min(1).optional(),
    value: z.string().optional(),
    onMiss: z.string().min(1).optional(),
  })
  .strict();

const FailureModeSchema = z
  .object({
    symptom: z.string().min(1),
    action: z.string().min(1),
  })
  .strict();

export const ProcedureSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    goal: z.string().min(1),
    preconditions: z.array(z.string().min(1)).default([]),
    steps: z.array(ProcedureStepSchema).min(1),
    idempotency: z
      .object({
        check: z.string().min(1),
      })
      .strict()
      .optional(),
    failureModes: z.array(FailureModeSchema).default([]),
    provenance: z
      .object({
        authoredBy: z.enum(["human", "agent-proposed"]),
        validatedAgainst: z.string().nullable(),
        lastReviewed: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export type Procedure = z.infer<typeof ProcedureSchema>;

const SLOT = /{{([A-Za-z0-9_.]+)}}/g;

function lookup(payload: Record<string, unknown>, path: string): unknown {
  let value: unknown = payload;
  for (const segment of path.split(".")) {
    if (typeof value !== "object" || value === null || !(segment in value)) {
      throw new Error(`procedure interpolation failed: payload has no value at "${path}"`);
    }
    value = (value as Record<string, unknown>)[segment];
  }
  if (value === undefined) {
    throw new Error(`procedure interpolation failed: payload value at "${path}" is undefined`);
  }
  return value;
}

function interpolateString(value: string, payload: Record<string, unknown>): string {
  return value.replace(SLOT, (_slot, path: string) => {
    const replacement = lookup(payload, path);
    if (typeof replacement === "string" || typeof replacement === "number" || typeof replacement === "boolean") {
      return String(replacement);
    }
    if (replacement === null) return "null";
    return JSON.stringify(replacement);
  });
}

function interpolate(value: unknown, payload: Record<string, unknown>): unknown {
  if (typeof value === "string") return interpolateString(value, payload);
  if (Array.isArray(value)) return value.map((item) => interpolate(item, payload));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, interpolate(child, payload)])
    );
  }
  return value;
}

export function parseProcedure(source: string, payload: Record<string, unknown>, sourceName = "procedure"): Procedure {
  let document: unknown;
  try {
    document = parse(source);
  } catch (error) {
    throw new Error(`${sourceName}: malformed YAML: ${error instanceof Error ? error.message : String(error)}`);
  }

  const parsed = ProcedureSchema.safeParse(document);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`${sourceName}: invalid procedure: ${issues}`);
  }

  const stubStep = parsed.data.steps.findIndex(
    (step) => step.selectorHint !== undefined && /\bTODO\b/i.test(step.selectorHint)
  );
  if (stubStep !== -1) {
    throw new Error(
      `${sourceName}: unresolved TODO selectorHint at steps.${stubStep}.selectorHint; validate this procedure against Cvent before running it`
    );
  }

  try {
    return ProcedureSchema.parse(interpolate(parsed.data, payload));
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      throw new Error(`${sourceName}: interpolated procedure is invalid: ${issues}`);
    }
    throw error;
  }
}

export async function loadProcedure(
  id: string,
  payload: Record<string, unknown>,
  root = new URL("./", import.meta.url).pathname
): Promise<Procedure> {
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(id)) {
    throw new Error(`invalid procedure id "${id}"`);
  }
  const base = resolve(root);
  const path = resolve(base, `${id}.yaml`);
  if (path !== base && !path.startsWith(`${base}${sep}`)) {
    throw new Error(`procedure path escapes procedure root: "${id}"`);
  }

  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`could not read procedure "${id}": ${error instanceof Error ? error.message : String(error)}`);
  }
  const procedure = parseProcedure(source, payload, path);
  if (procedure.id !== id) {
    throw new Error(`${path}: procedure id "${procedure.id}" does not match requested id "${id}"`);
  }
  return procedure;
}
