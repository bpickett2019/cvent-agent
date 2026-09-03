export type QuestionCell = string | number | boolean | Date | null | undefined;

export interface QuestionAnswerOption {
  code: string;
  text: string;
}

export interface QuestionVisibility {
  /** Empty means all registration types. */
  registrationTypeCodes: string[];
  /** null means the source format did not specify online visibility. */
  online: boolean | null;
}

export interface QuestionTrigger {
  raw: string;
  questionInternalName: string | null;
  answer: QuestionAnswerOption | null;
}

export interface CompiledQuestionSemantics {
  sourceRow: number;
  internalName: string;
  questionText: string;
  answers: QuestionAnswerOption[];
  visibility: QuestionVisibility;
  determinesRegistrationType: string | null;
  trigger: QuestionTrigger | null;
}

export interface CompileQuestionSemanticsInput {
  sheetName: "Show Questions" | "9. Questions" | string;
  rows: QuestionCell[][];
}

export function normalizeQuestionVisibility(
  registrationTypesSource: QuestionCell,
  onlineSource?: QuestionCell,
): QuestionVisibility {
  const registrationTypes = value(registrationTypesSource);
  const registrationTypeCodes = /^(?:all|everyone|any|visible to all)$/i.test(registrationTypes)
    ? []
    : registrationTypes.split(/[,;\n]+/).map((code) => code.trim()).filter(Boolean);
  const online = value(onlineSource);
  return {
    registrationTypeCodes,
    online: online ? !/^(?:no|n|false|hidden|not visible|offline)$/i.test(online) : null,
  };
}

export function compileQuestionSemantics(input: CompileQuestionSemanticsInput): CompiledQuestionSemantics[] {
  return input.sheetName.toLowerCase() === "9. questions"
    ? compileAuthoritative(input.rows)
    : compileLegacy(input.rows);
}

function compileAuthoritative(rows: QuestionCell[][]): CompiledQuestionSemantics[] {
  // Rows 1–7 are title, guidance, headers, defaults, and the reserved example row.
  return rows.slice(7).flatMap((row, offset) => {
    const internalName = at(row, 0);
    if (!internalName || isInstructional(internalName)) return [];
    return [{
      sourceRow: offset + 8,
      internalName,
      questionText: at(row, 3) || internalName,
      answers: parseAnswerOptions(at(row, 5)),
      visibility: normalizeQuestionVisibility(row[7], row[8]),
      determinesRegistrationType: nullable(at(row, 9)),
      trigger: parseTrigger(at(row, 10)),
    }];
  });
}

function compileLegacy(rows: QuestionCell[][]): CompiledQuestionSemantics[] {
  const headerIndex = rows.findIndex((row) => row.some((cell) => /question text/i.test(value(cell))));
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map((cell) => value(cell).toLowerCase());
  const column = (pattern: RegExp) => header.findIndex((name) => pattern.test(name));
  const nameColumn = column(/demo name|internal name/);
  const textColumn = column(/question text/);
  const answerCodeColumn = column(/answer code/);
  const answerTextColumn = column(/answer text/);
  const visibilityColumn = column(/list reg types|which reg types/);
  const output: CompiledQuestionSemantics[] = [];
  let current: CompiledQuestionSemantics | undefined;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const questionText = at(row, textColumn);
    const internalName = at(row, nameColumn);
    if (questionText && internalName) {
      current = {
        sourceRow: index + 1,
        internalName,
        questionText,
        answers: [],
        visibility: normalizeQuestionVisibility(row[visibilityColumn]),
        determinesRegistrationType: null,
        trigger: null,
      };
      output.push(current);
    }
    if (current) {
      const code = at(row, answerCodeColumn);
      const text = at(row, answerTextColumn);
      if (code || text) current.answers.push({ code, text });
    }
  }
  return output;
}

export function parseAnswerOptions(source: QuestionCell): QuestionAnswerOption[] {
  return value(source).split(/\s*;\s*/).map((option) => option.trim()).filter(Boolean).map((option) => {
    const separator = option.indexOf("|");
    return separator < 0
      ? { code: "", text: option }
      : { code: option.slice(0, separator).trim(), text: option.slice(separator + 1).trim() };
  });
}

function parseTrigger(source: QuestionCell): QuestionTrigger | null {
  const raw = value(source);
  if (!raw) return null;
  const match = raw.match(/(?:show\s+when\s+)?([A-Za-z0-9_-]+)\s*(?:=|is)\s*(.+)$/i);
  return {
    raw,
    questionInternalName: match?.[1] ?? null,
    answer: match ? parseAnswerOptions(match[2])[0] ?? null : null,
  };
}

function at(row: QuestionCell[], index: number): string {
  return index < 0 ? "" : value(row[index]);
}
function nullable(source: QuestionCell): string | null {
  return value(source) || null;
}
function value(source: QuestionCell): string {
  if (source === null || source === undefined) return "";
  if (source instanceof Date) return source.toISOString();
  return String(source).trim();
}

function isInstructional(value: string): boolean {
  return /^(?:default:|column notes|->)|\|\s*(?:needs confirmation|confirmed|gap)/i.test(value.trim());
}
