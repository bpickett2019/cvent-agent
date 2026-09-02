export type LegacyCell = string | number | boolean | Date | null;
export interface LegacySheet { name: string; rows: LegacyCell[][] }
export type LegacyOutcome = "exact" | "review" | "missing";
export interface LegacyProvenance { sheet: string; row: number; column: number; cell: string; header: string; source: string }
export interface LegacyField<T> { value: T; outcome: LegacyOutcome; provenance: LegacyProvenance }
export interface LegacyAdmissionItem {
  code: string; name: string; description: string; registrationTypeCodes: string[];
  outcome: LegacyOutcome; provenance: LegacyProvenance;
  fields: { code: LegacyField<string>; name: LegacyField<string>; description: LegacyField<string>; registrationTypeCodes: LegacyField<string[]> };
}
export interface LegacyPricing {
  admissionItemCode: string; registrationTypeCode: string; tierName: string; amount: number | null;
  outcome: LegacyOutcome; provenance: LegacyProvenance;
}
export interface LegacyRegistrationPath { name: string; registrationTypeCodes: string[]; outcome: LegacyOutcome; provenance: LegacyProvenance }
export interface LegacyTemplateLimits { admissionItems: number; registrationPaths: number; pricing: number }
export interface LegacyRegistrationCompilation {
  admissionItems: LegacyAdmissionItem[]; pricing: LegacyPricing[]; registrationPaths: LegacyRegistrationPath[];
  outcomes: { admissionItems: LegacyOutcome; pricing: LegacyOutcome; registrationPaths: LegacyOutcome };
  warnings: string[]; limits: LegacyTemplateLimits;
}

export const LEGACY_TEMPLATE_LIMITS: LegacyTemplateLimits = { admissionItems: 62, registrationPaths: 27, pricing: 248 };

type Header = { index: number; values: string[]; columns: Map<string, number> };
type RawItem = { code: string; name: string; description: string; regCode: string; codeP: LegacyProvenance; nameP: LegacyProvenance; descP: LegacyProvenance; regP: LegacyProvenance };

export function compileLegacyRegistration(sheets: LegacySheet[], limits: Partial<LegacyTemplateLimits> = {}): LegacyRegistrationCompilation {
  const cap = { ...LEGACY_TEMPLATE_LIMITS, ...limits };
  const warnings: string[] = [];
  const rawItems: RawItem[] = [];
  const rawPricing: LegacyPricing[] = [];
  const pathMap = new Map<string, LegacyRegistrationPath>();

  for (const source of sheets) {
    const header = findHeader(source);
    if (!header) continue;
    const regCol = column(header, "new reg code", "reg type code", "registration type code", "reg code");
    const itemCodeCol = column(header, "admission item code", "admission code", "item code");
    const itemCol = column(header, "admission item", "which admission items should this reg type see", "admission item name", "item name");
    const extraCol = column(header, "admission item additional text", "admission item description", "description", "what's included");
    const pathCol = column(header, "which registration path should this reg type appear on", "registration path", "path assignment", "reg path");
    const pricingCols = header.values.map((value, index) => ({ value, index })).filter(({ value }) => isPriceHeader(value));

    for (let ri = header.index + 1; ri < source.rows.length; ri += 1) {
      const row = source.rows[ri];
      const regCode = at(row, regCol).trim();
      const rawItemCode = at(row, itemCodeCol).trim();
      const rawItemName = at(row, itemCol).trim();
      const parsed = parseAdmission(rawItemCode, rawItemName);
      if (regCode && parsed.code) {
        const description = at(row, extraCol).trim();
        rawItems.push({ code: parsed.code, name: parsed.name, description, regCode,
          codeP: provenance(source, ri, itemCodeCol >= 0 ? itemCodeCol : itemCol, header),
          nameP: provenance(source, ri, itemCol, header), descP: provenance(source, ri, extraCol, header), regP: provenance(source, ri, regCol, header) });
        for (const price of pricingCols) {
          const raw = at(row, price.index).trim();
          if (!raw) continue;
          const amount = money(raw);
          rawPricing.push({ admissionItemCode: parsed.code, registrationTypeCode: regCode, tierName: display(price.value), amount,
            outcome: amount === null ? "review" : "exact", provenance: provenance(source, ri, price.index, header) });
        }
      }
      const pathName = at(row, pathCol).trim();
      if (regCode && pathName && !/^n\/?a$|^not needed$/i.test(pathName)) {
        const key = normalize(pathName);
        const existing = pathMap.get(key);
        if (existing) { if (!existing.registrationTypeCodes.includes(regCode)) existing.registrationTypeCodes.push(regCode); }
        else pathMap.set(key, { name: pathName, registrationTypeCodes: [regCode], outcome: "review", provenance: provenance(source, ri, pathCol, header) });
      }
    }
  }

  const items = mergeItems(rawItems);
  const paths = [...pathMap.values()];
  const pricing = dedupePricing(rawPricing);
  const limitedItems = applyLimit(items, cap.admissionItems, "admission items", warnings);
  const limitedPaths = applyLimit(paths, cap.registrationPaths, "registration paths", warnings);
  const limitedPricing = applyLimit(pricing, cap.pricing, "pricing rows", warnings);
  return {
    admissionItems: limitedItems, registrationPaths: limitedPaths, pricing: limitedPricing, warnings, limits: cap,
    outcomes: {
      admissionItems: aggregate(limitedItems, items.length > cap.admissionItems),
      registrationPaths: aggregate(limitedPaths, paths.length > cap.registrationPaths),
      pricing: aggregate(limitedPricing, pricing.length > cap.pricing),
    },
  };
}

function mergeItems(rows: RawItem[]): LegacyAdmissionItem[] {
  const map = new Map<string, LegacyAdmissionItem>();
  for (const row of rows) {
    const key = normalize(row.code);
    const old = map.get(key);
    if (!old) {
      const code = field(row.code, "exact", row.codeP), name = field(row.name, row.name ? "exact" : "missing", row.nameP);
      const description = field(row.description, row.description ? "exact" : "missing", row.descP);
      const registrationTypeCodes = field([row.regCode], "exact", row.regP);
      const fields = { code, name, description, registrationTypeCodes };
      map.set(key, { code: row.code, name: row.name, description: row.description, registrationTypeCodes: [row.regCode], outcome: itemOutcome(fields), provenance: row.codeP, fields });
    } else {
      if (!old.registrationTypeCodes.includes(row.regCode)) old.registrationTypeCodes.push(row.regCode);
      old.fields.registrationTypeCodes.value = old.registrationTypeCodes;
      if ((!old.name && row.name) || (!old.description && row.description)) {
        if (!old.name && row.name) { old.name = row.name; old.fields.name = field(row.name, "exact", row.nameP); }
        if (!old.description && row.description) { old.description = row.description; old.fields.description = field(row.description, "exact", row.descP); }
      }
      if ((row.name && normalize(row.name) !== normalize(old.name)) || (row.description && old.description && normalize(row.description) !== normalize(old.description))) old.outcome = "review";
      else old.outcome = itemOutcome(old.fields);
    }
  }
  return [...map.values()];
}

function findHeader(sheet: LegacySheet): Header | undefined {
  for (let index = 0; index < sheet.rows.length; index += 1) {
    const values = sheet.rows[index].map((x) => normalize(text(x)));
    const joined = values.join(" | ");
    const previous = index > 0 ? sheet.rows[index - 1].map((x) => normalize(text(x))) : [];
    const combined = `${previous.join(" | ")} | ${joined}`;
    if (/(admission item|admission code)/.test(combined) && /(new reg code|reg type code|registration type code|reg code)/.test(combined)) {
      const merged = values.map((value, column) => value || previous[column] || "");
      return { index, values: merged, columns: new Map(merged.map((v, i) => [v, i])) };
    }
  }
  return undefined;
}
function column(header: Header, ...aliases: string[]): number {
  for (const alias of aliases) { const exact = header.columns.get(alias); if (exact !== undefined) return exact; }
  for (const alias of aliases) { const found = header.values.findIndex((value) => value.includes(alias)); if (found >= 0) return found; }
  return -1;
}
function parseAdmission(code: string, name: string): { code: string; name: string } {
  if (code) return { code: code.trim(), name: name.trim() || code.trim() };
  const match = /^([A-Z0-9][A-Z0-9_-]*)\s+(.+)$/.exec(name.trim());
  return match ? { code: match[1], name: match[2].trim() } : { code: "", name: name.trim() };
}
function isPriceHeader(value: string): boolean {
  if (/reprint|processing|gl code/.test(value)) return false;
  return /^price tier\s*\d+/.test(value) || /^(?:super saver|early bird|advance|onsite)(?: price)?$/.test(value) || /^open(?:\s*[-–]|\s+\d)/.test(value) || /^\d{1,2}\/\d{1,2}(?:\s*[-–]|\s+)\d{1,2}\/\d{1,2}/.test(value);
}
function dedupePricing(rows: LegacyPricing[]): LegacyPricing[] { const seen = new Set<string>(); return rows.filter((row) => { const key = [normalize(row.registrationTypeCode), normalize(row.admissionItemCode), normalize(row.tierName)].join("|"); if (seen.has(key)) return false; seen.add(key); return true; }); }
function aggregate<T extends { outcome: LegacyOutcome }>(rows: T[], overflow: boolean): LegacyOutcome { if (!rows.length) return "missing"; return overflow || rows.some((x) => x.outcome !== "exact") ? "review" : "exact"; }
function applyLimit<T>(rows: T[], limit: number, label: string, warnings: string[]): T[] { const safe = Math.max(0, Math.floor(limit)); if (rows.length > safe) warnings.push(`Template capacity for ${label} is ${safe}; ${rows.length - safe} source row(s) require review and were not assigned.`); return rows.slice(0, safe); }
function itemOutcome(fields: LegacyAdmissionItem["fields"]): LegacyOutcome { return Object.values(fields).some((x) => x.outcome === "missing") ? "review" : "exact"; }
function field<T>(value: T, outcome: LegacyOutcome, provenanceValue: LegacyProvenance): LegacyField<T> { return { value, outcome, provenance: provenanceValue }; }
function provenance(sheet: LegacySheet, row: number, col: number, header: Header): LegacyProvenance { const c = Math.max(0, col); const cell = `${columnName(c + 1)}${row + 1}`; const label = header.values[c] ?? "missing column"; return { sheet: sheet.name, row: row + 1, column: c + 1, cell, header: display(label), source: `${sheet.name}!${cell} (${display(label)})` }; }
function isLegacyRegistrationSheet(sheet: LegacySheet): boolean { return /(?:new )?(?:reg(?:istration)? types?|reg mapping).*pricing|new reg mapping/i.test(sheet.name); }
function money(value: string): number | null { if (/^(?:free|comp(?:limentary)?)$/i.test(value)) return 0; const parsed = Number(value.replace(/[$,%\s,]/g, "")); return Number.isFinite(parsed) ? parsed : null; }
function at(row: LegacyCell[], index: number): string { return index < 0 ? "" : text(row[index]); }
function text(value: LegacyCell | undefined): string { if (value == null) return ""; return value instanceof Date ? value.toISOString() : String(value); }
function normalize(value: string): string { return value.replace(/\u00a0/g, " ").toLowerCase().replace(/[_–—-]+/g, " ").replace(/\s+/g, " ").trim(); }
function display(value: string): string { return value.replace(/\b\w/g, (x) => x.toUpperCase()); }
function columnName(index: number): string { let out = ""; for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out; return out; }
