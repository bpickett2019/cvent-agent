export type RRCell = string | number | boolean | Date | null;
export interface RRSheet {
  name: string;
  rows: RRCell[][];
}

export interface RRQuestionPreview {
  key: string;
  text: string;
  page: "personal-information" | "show-questions";
  answerType: string;
  answerValues: string[];
  required: boolean;
  visibilitySource: string;
}

export interface RRDocumentPreview {
  event: {
    name: string | null;
    location: string | null;
    timezoneSource: string | null;
    expoDatesSource: string | null;
    conferenceDatesSource: string | null;
    themeSource: string | null;
  };
  registrationTypes: Array<{ key: string; name: string; code: string }>;
  questions: RRQuestionPreview[];
  recognizedSheets: string[];
  ignoredSheets: string[];
  warnings: string[];
}

const ALLOWED_SHEETS = new Set([
  "Event Details",
  "Registration Types & Pricing",
  "NEW REG MAPPING",
  "Sessions_Add-Ons",
  "Show Questions",
  "Discount Code Template",
]);

/**
 * Deterministic, allowlisted RR extraction. It intentionally returns a preview,
 * not an EventSpec: free-form dates, pricing tiers, and conditional rules need
 * constrained normalization and operator review before they can enter a plan.
 */
export function previewRRDocument(sheets: RRSheet[]): RRDocumentPreview {
  const allowed = sheets.filter((sheet) => ALLOWED_SHEETS.has(sheet.name));
  // A CSV has no workbook sheet name. It is allowed only as one isolated table.
  const csvSheet = sheets.length === 1 && sheets[0]?.name === "CSV" ? sheets[0] : undefined;
  const sourceSheets = csvSheet ? [csvSheet] : allowed;
  const eventSheet = findSheet(sourceSheets, "Event Details") ?? detectKeyValueSheet(sourceSheets);
  const questionSheet = findSheet(sourceSheets, "Show Questions") ?? detectQuestionSheet(sourceSheets);
  const mappingSheet = findSheet(sourceSheets, "NEW REG MAPPING") ?? detectRegistrationTypeSheet(sourceSheets);
  const eventValues = eventSheet ? keyValueRows(eventSheet.rows) : new Map<string, string>();
  const questions = questionSheet ? extractQuestions(questionSheet.rows) : [];
  const registrationTypes = mappingSheet ? extractRegistrationTypes(mappingSheet.rows) : [];
  const recognized = new Set<string>();
  if (eventSheet) recognized.add(eventSheet.name);
  if (questionSheet) recognized.add(questionSheet.name);
  if (mappingSheet) recognized.add(mappingSheet.name);

  const warnings = [
    "RR import is a review preview only; it cannot execute until a complete EventSpec passes validation.",
  ];
  if (!eventSheet) warnings.push("No recognizable Event Details table was found.");
  if (!questionSheet) warnings.push("No recognizable Show Questions table was found.");
  if (questions.some((question) => question.visibilitySource)) {
    warnings.push("Question visibility text requires constrained normalization and operator confirmation.");
  }
  warnings.push("Free-form dates and tiered pricing are not applied automatically.");

  return {
    event: {
      name: lookup(eventValues, "event name"),
      location: lookup(eventValues, "event location"),
      timezoneSource: lookup(eventValues, "time zone for event location", "timezone"),
      expoDatesSource: lookup(eventValues, "expo hall dates"),
      conferenceDatesSource: lookup(eventValues, "conference dates"),
      themeSource: lookup(eventValues, "event theme"),
    },
    registrationTypes,
    questions,
    recognizedSheets: [...recognized],
    ignoredSheets: sheets.map((sheet) => sheet.name).filter((name) => !recognized.has(name)),
    warnings,
  };
}

function extractQuestions(rows: RRCell[][]): RRQuestionPreview[] {
  const headerIndex = rows.findIndex((row) => row.some((cell) => text(cell).toLowerCase().includes("question text")));
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map((cell) => text(cell).toLowerCase());
  const column = (fragment: string) => header.findIndex((value) => value.includes(fragment));
  const pageColumn = column("page displayed");
  const nameColumn = column("demo name");
  const textColumn = column("question text");
  const answerColumn = column("answer text");
  const appearanceColumn = column("question appearance");
  const requiredColumn = column("required for registrant");
  const visibilityColumn = column("list reg types");
  if (textColumn < 0) return [];

  const questions: RRQuestionPreview[] = [];
  let current: RRQuestionPreview | undefined;
  for (const row of rows.slice(headerIndex + 1)) {
    const questionText = at(row, textColumn);
    const internalName = at(row, nameColumn);
    const answerText = at(row, answerColumn);
    if (questionText && (internalName || at(row, appearanceColumn))) {
      current = {
        key: uniqueKey(slug(internalName || questionText), questions.map((question) => question.key)),
        text: questionText,
        page: /profile|personal/i.test(at(row, pageColumn)) ? "personal-information" : "show-questions",
        answerType: mapAnswerType(at(row, appearanceColumn)),
        answerValues: [],
        required: /^y(?:es)?$/i.test(at(row, requiredColumn)),
        visibilitySource: at(row, visibilityColumn),
      };
      questions.push(current);
      // Some compact CSVs place the first answer on the question's own row.
      if (answerText) current.answerValues.push(answerText);
    } else if (current && answerText) {
      current.answerValues.push(answerText);
    }
  }
  return questions.slice(0, 500);
}

function extractRegistrationTypes(rows: RRCell[][]): Array<{ key: string; name: string; code: string }> {
  const headerIndex = rows.findIndex((row) => row.some((cell) => /new\s*-?\s*reg codes?|reg type code/i.test(text(cell))));
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map((cell) => text(cell).toLowerCase());
  const codeColumn = header.findIndex((value) => /new\s*-?\s*reg codes?|reg type code/.test(value));
  const nameColumn = header.findIndex((value) => /new\s*-?\s*reg type|registration.*name|reg type$/.test(value));
  if (codeColumn < 0 || nameColumn < 0) return [];
  const seen = new Set<string>();
  const output: Array<{ key: string; name: string; code: string }> = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const code = at(row, codeColumn);
    const name = at(row, nameColumn);
    if (!code || !name || seen.has(code.toLowerCase())) continue;
    seen.add(code.toLowerCase());
    output.push({ key: slug(code), name, code });
  }
  return output.slice(0, 250);
}

function keyValueRows(rows: RRCell[][]): Map<string, string> {
  const values = new Map<string, string>();
  for (const row of rows) {
    for (let index = 0; index < Math.min(row.length - 1, 5); index += 1) {
      const key = text(row[index]).toLowerCase().trim();
      const value = text(row[index + 1]).trim();
      if (key && value && !values.has(key)) values.set(key, value);
    }
  }
  return values;
}

function findSheet(sheets: RRSheet[], name: string): RRSheet | undefined {
  return sheets.find((sheet) => sheet.name.toLowerCase() === name.toLowerCase());
}
function detectKeyValueSheet(sheets: RRSheet[]): RRSheet | undefined {
  return sheets.find((sheet) => sheet.rows.some((row) => row.some((cell) => /^event name$/i.test(text(cell)))));
}
function detectQuestionSheet(sheets: RRSheet[]): RRSheet | undefined {
  return sheets.find((sheet) => sheet.rows.some((row) => row.some((cell) => /question text/i.test(text(cell)))));
}
function detectRegistrationTypeSheet(sheets: RRSheet[]): RRSheet | undefined {
  return sheets.find((sheet) => sheet.rows.some((row) => row.some((cell) => /new\s*-?\s*reg codes?|reg type code/i.test(text(cell)))));
}
function lookup(values: Map<string, string>, ...keys: string[]): string | null {
  for (const key of keys) if (values.has(key)) return values.get(key)!;
  return null;
}
function at(row: RRCell[], index: number): string {
  return index < 0 ? "" : text(row[index]).trim();
}
function text(value: RRCell | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "question";
}
function uniqueKey(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let suffix = 2;
  while (existing.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
function mapAnswerType(source: string): string {
  const value = source.toLowerCase();
  if (/multi|multiple/.test(value)) return "multiSelect";
  if (/single|radio|pick one|drop.?down/.test(value)) return "singleSelect";
  if (/date.*time/.test(value)) return "datetime";
  if (/date/.test(value)) return "date";
  if (/number|numeric/.test(value)) return "number";
  if (/long|paragraph|comment/.test(value)) return "textarea";
  if (/yes.?no|boolean/.test(value)) return "boolean";
  return "text";
}
