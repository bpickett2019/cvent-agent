export type LegacyQuestionCell = string | number | boolean | Date | null | undefined;
export type ExtractionStatus = "explicit" | "missing" | "review";
export interface CellProvenance { sheet: string; row: number; column: number; header: string }
export interface ExtractedValue<T> { value: T | null; status: ExtractionStatus; raw: string | null; provenance: CellProvenance }
export interface LegacyAnswer { code: string; text: string; provenance: { sheet: string; row: number; codeColumn: number; textColumn: number } }
export interface LegacyTrigger {
  raw: string; source: "trigger-column" | "notes" | "registration-type-visibility";
  status: "explicit" | "review"; provenance: CellProvenance;
  referencedQuestion: string | null; referencedAnswer: { code: string; text: string } | null;
  targetQuestion: string | null;
}
export interface RegistrationTypeOutcome { answer: LegacyAnswer; registrationType: string; provenance: CellProvenance }
export interface LegacyQuestionVisibility {
  registrationTypeCodes: string[]; registrationTypesStatus: ExtractionStatus;
  registrationTypesRaw: string | null; registrationTypesProvenance: CellProvenance;
  online: boolean | null; onlineStatus: ExtractionStatus; onlineRaw: string | null; onlineProvenance: CellProvenance;
}
export interface CompiledLegacyQuestion {
  sourceRow: number; internalName: string; answers: LegacyAnswer[];
  required: ExtractedValue<boolean>; visibility: LegacyQuestionVisibility;
  determinesRegistrationType: ExtractedValue<boolean>; registrationTypeOutcomes: RegistrationTypeOutcome[];
  triggers: LegacyTrigger[]; triggerStatus: ExtractionStatus;
}
export interface CompileLegacyQuestionsInput { sheetName?: string; rows: LegacyQuestionCell[][] }

const YES = /^(?:y|yes|true|required|1)$/i;
const NO = /^(?:n|no|false|optional|0)$/i;
const CONDITIONAL = /\b(?:if|when|only\s+(?:ask|show|display)|respondent answers|selects?|choose[sn]?)\b|[A-Za-z][\w -]*\s*=\s*\S/i;

export function compileLegacyQuestions(input: CompileLegacyQuestionsInput | LegacyQuestionCell[][]): CompiledLegacyQuestion[] {
  const rows = Array.isArray(input) ? input : input.rows;
  const sheet = Array.isArray(input) ? "Show Questions" : input.sheetName ?? "Show Questions";
  const hi = rows.findIndex(r => r.some(c => /question text/i.test(text(c))));
  if (hi < 0) return [];
  const headers = rows[hi].map(text);
  const col = (re: RegExp) => headers.findIndex(h => re.test(h));
  const c = { name: col(/demo name|internal name/i), question: col(/question text/i), answerCode: col(/answer code/i), answerText: col(/answer text/i), required: col(/required.*answer/i), visibility: col(/list reg types|which reg types/i), online: col(/visible online|online visibility/i), determines: col(/determine.*reg type/i), trigger: col(/trigger question|conditional logic/i), notes: col(/^notes\b|notes\s*\(/i) };
  const prov = (row: number, column: number): CellProvenance => ({ sheet, row, column: column + 1, header: column < 0 ? "" : headers[column] });
  const out: CompiledLegacyQuestion[] = [];
  let current: CompiledLegacyQuestion | undefined;
  for (let i = hi + 1; i < rows.length; i++) {
    const row = rows[i];
    const name = at(row, c.name), question = at(row, c.question);
    if (name && (question || at(row, c.required) || at(row, c.visibility) || at(row, c.notes))) {
      const required = booleanValue(row[c.required], prov(i + 1, c.required));
      const determines = booleanValue(row[c.determines], prov(i + 1, c.determines), true);
      const visibilityRaw = at(row, c.visibility);
      const registrationConditional = !!visibilityRaw && CONDITIONAL.test(visibilityRaw);
      const online = booleanValue(row[c.online], prov(i + 1, c.online), true);
      current = {
        sourceRow: i + 1, internalName: name, answers: [], required,
        visibility: {
          registrationTypeCodes: registrationConditional ? [] : parseRegistrationTypes(visibilityRaw),
          registrationTypesStatus: !visibilityRaw ? "missing" : registrationConditional ? "review" : "explicit",
          registrationTypesRaw: visibilityRaw || null, registrationTypesProvenance: prov(i + 1, c.visibility),
          online: online.value, onlineStatus: online.status, onlineRaw: online.raw, onlineProvenance: online.provenance,
        },
        determinesRegistrationType: determines, registrationTypeOutcomes: [], triggers: [], triggerStatus: "missing",
      };
      if (registrationConditional) addTrigger(current, visibilityRaw, "registration-type-visibility", prov(i + 1, c.visibility));
      addTrigger(current, at(row, c.trigger), "trigger-column", prov(i + 1, c.trigger));
      addTrigger(current, at(row, c.notes), "notes", prov(i + 1, c.notes));
      current.triggerStatus = current.triggers.length ? (current.triggers.some(t => t.status === "review") ? "review" : "explicit") : "missing";
      out.push(current);
    }
    if (!current) continue;
    const code = at(row, c.answerCode), answerText = at(row, c.answerText);
    let answer: LegacyAnswer | undefined;
    if (code || answerText) {
      answer = { code, text: answerText, provenance: { sheet, row: i + 1, codeColumn: c.answerCode + 1, textColumn: c.answerText + 1 } };
      current.answers.push(answer);
    }
    const outcome = at(row, c.determines);
    if (answer && outcome && !YES.test(outcome) && !NO.test(outcome)) {
      for (const registrationType of parseRegistrationTypes(outcome)) current.registrationTypeOutcomes.push({ answer, registrationType, provenance: prov(i + 1, c.determines) });
      current.determinesRegistrationType = { ...current.determinesRegistrationType, value: true, status: "explicit" };
    }
  }
  return out;
}

/** Compatibility alias for callers that use extraction terminology. */
export const extractLegacyQuestions = compileLegacyQuestions;

function booleanValue(source: LegacyQuestionCell, provenance: CellProvenance, allowAll = false): ExtractedValue<boolean> {
  const raw = text(source);
  if (!raw) return { value: null, status: "missing", raw: null, provenance };
  if (YES.test(raw) || (allowAll && /^all$/i.test(raw))) return { value: true, status: "explicit", raw, provenance };
  if (NO.test(raw)) return { value: false, status: "explicit", raw, provenance };
  return { value: null, status: "review", raw, provenance };
}
function parseRegistrationTypes(raw: string): string[] {
  if (!raw || /^(?:all|everyone|any)$/i.test(raw)) return [];
  return raw.split(/[,;/\n]+/).map(v => v.trim()).filter(Boolean).map(v => v.split(/\s+-\s+/, 1)[0].trim()).filter(Boolean);
}
function addTrigger(q: CompiledLegacyQuestion, raw: string, source: LegacyTrigger["source"], provenance: CellProvenance): void {
  if (!raw || NO.test(raw)) return;
  const parsed = parseConditional(raw, q.internalName);
  q.triggers.push({ raw, source, status: parsed.referencedQuestion || parsed.targetQuestion ? "explicit" : "review", provenance, ...parsed });
}
function parseConditional(raw: string, currentName: string): Pick<LegacyTrigger, "referencedQuestion" | "referencedAnswer" | "targetQuestion"> {
  const equality = raw.match(/(?:\bif\s+|\bwhen\s+|\bshow\s+when\s+)?([A-Za-z][A-Za-z0-9_-]*)\s*=\s*([A-Za-z0-9_-]+)(?:\s*\|\s*([^,;]+))?/i);
  const answers = raw.match(/(?:answers?|choose[sn]?|selects?)\s+([A-Za-z0-9_-]+)(?:\s*:\s*([^,;]+))?/i);
  const ask = raw.match(/(?:ask|show|display)\s+["']?([A-Za-z][A-Za-z0-9 _-]*)["']?\s*$/i);
  const namedSource = raw.match(/(?:in\s+)?question\s+([A-Za-z][A-Za-z0-9_-]*)\b/i);
  const referencedQuestion = equality?.[1].trim() ?? namedSource?.[1] ?? (answers ? currentName : null);
  const code = equality?.[2] ?? answers?.[1] ?? null;
  const label = equality?.[3]?.trim() ?? answers?.[2]?.trim() ?? "";
  return { referencedQuestion, referencedAnswer: code ? { code, text: label } : null, targetQuestion: ask?.[1].trim() ?? null };
}
function at(row: LegacyQuestionCell[], index: number): string { return index < 0 ? "" : text(row[index]); }
function text(value: LegacyQuestionCell): string { if (value == null) return ""; return value instanceof Date ? value.toISOString() : String(value).trim(); }
