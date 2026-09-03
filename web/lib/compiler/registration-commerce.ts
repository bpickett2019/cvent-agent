export type RRCell = string | number | boolean | Date | null;
export interface RRSheet { name: string; rows: RRCell[][] }
export type Confidence = "exact" | "review";
export interface FieldEvidence<T> { value: T; confidence: Confidence; source: string }
export interface CompilerAssignment { sheet: "4. Reg Types" | "5. Admission Items" | "6. Pricing"; cell: string; field: string; value: string | number | boolean; confidence: Confidence; source: string }

type RegistrationField = "code" | "passDescription" | "name" | "appearsOn" | "description" | "admissionItemCodes" | "pathAssignment" | "openForRegistration" | "autoOpensOn" | "autoClosesOn" | "capacity" | "canAddGuest";
type AdmissionField = "name" | "code" | "description" | "regTypeCodes" | "openForRegistration" | "autoOpensOn" | "autoClosesOn" | "capacity" | "chargeFee";
export interface CompiledRegistrationType {
  code: string; passDescription: string; name: string; appearsOn: string; description: string; admissionItemCodes: string[]; pathAssignment: string; openForRegistration: boolean; autoOpensOn: string; autoClosesOn: string; capacity: number | null; canAddGuest: boolean;
  confidence: Confidence; fields: Record<RegistrationField, FieldEvidence<unknown>>;
}
export interface CompiledAdmissionItem {
  name: string; code: string; description: string; regTypeCodes: string[]; openForRegistration: boolean; autoOpensOn: string; autoClosesOn: string; capacity: number | null; chargeFee: boolean;
  confidence: Confidence; fields: Record<AdmissionField, FieldEvidence<unknown>>;
}
export interface CompiledPriceTier { name: "Super Saver" | "Early Bird" | "Advance" | "Onsite"; starts: string; ends: string; memberPrice: number | null; nonMemberPrice: number | null; confidence: Confidence; fields: Record<string, FieldEvidence<unknown>> }
export interface CompiledFee { name: string; active: boolean; processingNote: string; confidence: Confidence; fields: Record<string, FieldEvidence<unknown>> }
export interface RegistrationCommerceCompilation { registrationTypes: CompiledRegistrationType[]; admissionItems: CompiledAdmissionItem[]; pricing: { tiers: CompiledPriceTier[]; fee: CompiledFee }; assignments: CompilerAssignment[]; warnings: string[] }

const FIRST_REAL_TEMPLATE_ROW = 8;
const TIERS = ["Super Saver", "Early Bird", "Advance", "Onsite"] as const;

export function compileRegistrationCommerce(sheets: RRSheet[]): RegistrationCommerceCompilation {
  const warnings: string[] = [];
  const modernReg = sheet(sheets, "4. Reg Types");
  const legacyReg = sheet(sheets, "NEW Reg Types & Pricing") ?? sheet(sheets, "NEW REG MAPPING");
  const registrationTypes = modernReg ? registrationRows(modernReg, true) : legacyReg ? registrationRows(legacyReg, false) : [];
  const modernAdmission = sheet(sheets, "5. Admission Items");
  const legacyPricing = sheet(sheets, "Registration Types & Pricing");
  const addOns = sheet(sheets, "Sessions_Add-Ons") ?? sheet(sheets, "Sessions/Optional Items");
  const admissionItems = modernAdmission ? admissionRows(modernAdmission, true) : mergeAdmissionRows(legacyPricing ? admissionRows(legacyPricing, false) : [], addOns ? admissionRows(addOns, false) : []);
  const modernPricing = sheet(sheets, "6. Pricing");
  const pricing = modernPricing ? modernPricingRows(modernPricing) : legacyPricingRows(legacyPricing);
  if (!registrationTypes.length) warnings.push("No registration types were recognized.");
  if (!admissionItems.length) warnings.push("No admission items were recognized.");
  const assignments = assignmentsFor(registrationTypes, admissionItems, pricing);
  return { registrationTypes, admissionItems, pricing, assignments, warnings };
}

function registrationRows(source: RRSheet, modern: boolean): CompiledRegistrationType[] {
  const table = findHeader(source, [/reg.*code|new reg code/]);
  if (!table) return [];
  const c = columns(table.header);
  const rows: CompiledRegistrationType[] = [];
  for (const row of source.rows.slice(table.index + 1)) {
    const code = get(row, c.find(/reg.*code|new reg code/));
    const name = get(row, c.find(/new reg type name|reg type name/));
    if (!code || !name || /^example$/i.test(code) || isInstructional(code) || isInstructional(name)) continue;
    const src = `${source.name} > row ${source.rows.indexOf(row) + 1}`;
    const exact = (value: unknown, field: string): FieldEvidence<unknown> => ({ value, confidence: "exact", source: `${src} > ${field}` });
    const review = (value: unknown, field: string): FieldEvidence<unknown> => ({ value, confidence: "review", source: value === "" || value === null ? `default (${field})` : `${src} > ${field}` });
    const passDescription = get(row, c.find(/pass description/));
    const appearsOn = get(row, c.find(/appears on/));
    const description = get(row, c.find(/web page description/));
    const admissionItemCodes = list(get(row, c.find(/admission items?/)));
    const pathAssignment = get(row, c.find(/path assignment/));
    const openRaw = get(row, c.find(/open for registration|activate/));
    const openForRegistration = /activate/i.test(openRaw) || bool(openRaw, true);
    const autoOpensOn = get(row, c.find(/auto opens on/));
    const autoClosesOn = get(row, c.find(/auto closes on/));
    const capacity = number(get(row, c.find(/^capacity/)));
    const canAddGuest = bool(get(row, c.find(/guest/)), false);
    const fields = {
      code: exact(code, "code"), passDescription: exact(passDescription, "pass description"), name: exact(name, "name"), appearsOn: review(appearsOn, "appears on"), description: review(description, "description"), admissionItemCodes: review(admissionItemCodes, "admission items"), pathAssignment: review(pathAssignment, "path assignment"), openForRegistration: review(openForRegistration, "open for registration"), autoOpensOn: review(autoOpensOn, "auto opens on"), autoClosesOn: review(autoClosesOn, "auto closes on"), capacity: review(capacity, "capacity"), canAddGuest: review(canAddGuest, "guest eligibility"),
    } satisfies Record<RegistrationField, FieldEvidence<unknown>>;
    rows.push({ code, passDescription, name, appearsOn, description, admissionItemCodes, pathAssignment, openForRegistration, autoOpensOn, autoClosesOn, capacity, canAddGuest, confidence: modern && Object.values(fields).every((x) => x.confidence === "exact") ? "exact" : "review", fields });
  }
  return dedupe(rows, (row) => row.code);
}

function admissionRows(source: RRSheet, modern: boolean): CompiledAdmissionItem[] {
  const table = findHeader(source, [/admission item|item name|^name$/], [/code/]);
  if (!table) return [];
  const c = columns(table.header);
  const output: CompiledAdmissionItem[] = [];
  for (const row of source.rows.slice(table.index + 1)) {
    const name = get(row, c.find(/^name$|admission item|item name/));
    const code = get(row, c.find(/admission code|item code|^code$/));
    if (!name || !code || /^example$/i.test(code) || isInstructional(code) || isInstructional(name)) continue;
    const src = `${source.name} > row ${source.rows.indexOf(row) + 1}`;
    const evidence = (value: unknown, field: string, confidence: Confidence): FieldEvidence<unknown> => ({ value, confidence, source: `${src} > ${field}` });
    const description = get(row, c.find(/description/));
    const regTypeCodes = list(get(row, c.find(/reg types/)));
    const openForRegistration = bool(get(row, c.find(/open for registration/)), true);
    const autoOpensOn = get(row, c.find(/auto opens on/));
    const autoClosesOn = get(row, c.find(/auto closes on/));
    const capacity = number(get(row, c.find(/^capacity/)));
    const feeColumn = c.find(/charge a fee|^fee$/);
    const chargeFee = feeColumn >= 0 ? (modern ? bool(get(row, feeColumn), true) : number(get(row, feeColumn)) !== 0) : true;
    const fields = { name: evidence(name, "name", "exact"), code: evidence(code, "code", "exact"), description: evidence(description, "description", "exact"), regTypeCodes: evidence(regTypeCodes, "reg types", "exact"), openForRegistration: evidence(openForRegistration, "open", "review"), autoOpensOn: evidence(autoOpensOn, "opens", "review"), autoClosesOn: evidence(autoClosesOn, "closes", "review"), capacity: evidence(capacity, "capacity", "review"), chargeFee: evidence(chargeFee, "fee", "review") } satisfies Record<AdmissionField, FieldEvidence<unknown>>;
    output.push({ name, code, description, regTypeCodes, openForRegistration, autoOpensOn, autoClosesOn, capacity, chargeFee, confidence: "review", fields });
  }
  return dedupe(output, (row) => row.code);
}

function mergeAdmissionRows(first: CompiledAdmissionItem[], second: CompiledAdmissionItem[]): CompiledAdmissionItem[] { return dedupe([...first, ...second], (row) => row.code); }

function modernPricingRows(source: RRSheet): { tiers: CompiledPriceTier[]; fee: CompiledFee } {
  const header = findHeader(source, [/price tier/]);
  const c = header ? columns(header.header) : columns([]);
  const tiers = TIERS.map((name) => {
    const row = source.rows.find((candidate) => norm(get(candidate, 0)) === norm(name)) ?? [];
    return tier(name, get(row, c.find(/^starts$/)), get(row, c.find(/^ends$/)), number(get(row, c.find(/(?<!non )member price/))), number(get(row, c.find(/non.?member price/))), `${source.name} > ${name}`);
  });
  const value = (label: RegExp) => { const row = source.rows.find((r) => label.test(get(r, 0))); return row ? get(row, 2) : ""; };
  return { tiers, fee: fee(value(/^fee name$/i) || "Registration Fee", bool(value(/^fee active/i), true), value(/^processing fee note/i), source.name) };
}

function legacyPricingRows(source?: RRSheet): { tiers: CompiledPriceTier[]; fee: CompiledFee } {
  const table = source ? findHeader(source, [/super saver member/]) : undefined;
  const c = table ? columns(table.header) : columns([]);
  const data = table ? source!.rows.slice(table.index + 1).find((row) => get(row, c.find(/super saver member/)) !== "") ?? [] : [];
  const tiers = TIERS.map((name) => tier(name, "", "", number(get(data, c.find(new RegExp(`${name} member`, "i")))), number(get(data, c.find(new RegExp(`${name} non.?member`, "i")))), source?.name ?? "missing legacy pricing"));
  return { tiers, fee: fee("Registration Fee", true, get(data, c.find(/processing fee note/)), source?.name ?? "default") };
}

function tier(name: typeof TIERS[number], starts: string, ends: string, memberPrice: number | null, nonMemberPrice: number | null, source: string): CompiledPriceTier {
  const confidence: Confidence = starts && ends && memberPrice !== null && nonMemberPrice !== null ? "exact" : "review";
  return { name, starts, ends, memberPrice, nonMemberPrice, confidence, fields: { starts: { value: starts, confidence, source }, ends: { value: ends, confidence, source }, memberPrice: { value: memberPrice, confidence: memberPrice === null ? "review" : "exact", source }, nonMemberPrice: { value: nonMemberPrice, confidence: nonMemberPrice === null ? "review" : "exact", source } } };
}
function fee(name: string, active: boolean, processingNote: string, source: string): CompiledFee { return { name, active, processingNote, confidence: "review", fields: { name: { value: name, confidence: "review", source }, active: { value: active, confidence: "review", source }, processingNote: { value: processingNote, confidence: processingNote ? "exact" : "review", source } } }; }

function assignmentsFor(regs: CompiledRegistrationType[], items: CompiledAdmissionItem[], pricing: { tiers: CompiledPriceTier[]; fee: CompiledFee }): CompilerAssignment[] {
  const out: CompilerAssignment[] = [];
  const add = (sheetName: CompilerAssignment["sheet"], cell: string, field: string, value: unknown, evidence: FieldEvidence<unknown>) => { if (value !== "" && value !== null && value !== undefined) out.push({ sheet: sheetName, cell, field, value: Array.isArray(value) ? value.join(", ") : value as string | number | boolean, confidence: evidence.confidence, source: evidence.source }); };
  const regCols: Array<[RegistrationField, string]> = [["code","A"],["passDescription","B"],["name","C"],["appearsOn","D"],["description","E"],["admissionItemCodes","F"],["pathAssignment","G"],["openForRegistration","H"],["autoOpensOn","I"],["autoClosesOn","J"],["capacity","K"],["canAddGuest","L"]];
  regs.forEach((r, i) => regCols.forEach(([field, col]) => add("4. Reg Types", `${col}${FIRST_REAL_TEMPLATE_ROW + i}`, field, r[field], r.fields[field])));
  const itemCols: Array<[AdmissionField, string]> = [["name","A"],["code","B"],["description","C"],["regTypeCodes","D"],["openForRegistration","E"],["autoOpensOn","F"],["autoClosesOn","G"],["capacity","H"],["chargeFee","I"]];
  items.forEach((r, i) => itemCols.forEach(([field, col]) => add("5. Admission Items", `${col}${FIRST_REAL_TEMPLATE_ROW + i}`, field, r[field], r.fields[field])));
  pricing.tiers.forEach((t, i) => { add("6. Pricing", `C${5+i}`, "starts", t.starts, t.fields.starts); add("6. Pricing", `D${5+i}`, "ends", t.ends, t.fields.ends); add("6. Pricing", `E${5+i}`, "memberPrice", t.memberPrice, t.fields.memberPrice); add("6. Pricing", `F${5+i}`, "nonMemberPrice", t.nonMemberPrice, t.fields.nonMemberPrice); });
  return out;
}

function sheet(sheets: RRSheet[], name: string): RRSheet | undefined { return sheets.find((s) => norm(s.name) === norm(name)); }
function findHeader(source: RRSheet, ...requirements: RegExp[][]): { index: number; header: string[] } | undefined { for (let i=0;i<source.rows.length;i++) { const h=source.rows[i].map(text); const searchable=h.filter((value)=>!/^\s*->/.test(value)); if (requirements.every((group) => group.some((re) => searchable.some((v) => re.test(norm(v)))))) return { index:i, header:h }; } return undefined; }
function columns(header: string[]) { return { find(pattern: RegExp) { return header.findIndex((value) => pattern.test(norm(value))); } }; }
function get(row: RRCell[], index: number): string { return index < 0 ? "" : text(row[index]).trim(); }
function text(value: RRCell | undefined): string { if (value === null || value === undefined) return ""; if (value instanceof Date) return value.toISOString(); return String(value); }
function norm(value: string): string { return value.toLowerCase().replace(/[_–—-]+/g, " ").replace(/\s+/g, " ").trim(); }
function list(value: string): string[] { return value.split(/[,;\n]+/).map((v) => v.trim()).filter(Boolean); }
function bool(value: string, fallback: boolean): boolean { if (/^(?:yes|y|true|active|activate|1)$/i.test(value.trim())) return true; if (/^(?:no|n|false|inactive|not needed|0)$/i.test(value.trim())) return false; return fallback; }
function number(value: string): number | null { if (!value.trim()) return null; const parsed = Number(value.replace(/[$,%\s,]/g, "")); return Number.isFinite(parsed) ? parsed : null; }
function isInstructional(value: string): boolean { return /^(?:default:|column notes|->)|\|\s*(?:needs confirmation|confirmed|gap)/i.test(value.trim()); }
function dedupe<T>(values: T[], key: (value: T) => string): T[] { const seen = new Set<string>(); return values.filter((v) => { const k=norm(key(v)); if (!k || seen.has(k)) return false; seen.add(k); return true; }); }
