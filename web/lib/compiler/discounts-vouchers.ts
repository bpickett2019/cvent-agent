export type CompilerCell = string | number | boolean | Date | null | undefined;
export interface CompilerSheet { name: string; rows: CompilerCell[][] }

export interface SourceRef { sheet: string; row: number }
export interface NormalizedDiscount {
  name: string;
  code: string;
  method: "percent" | "amount";
  amount: number;
  effectiveFrom?: string;
  effectiveTo?: string;
  capacity?: number;
  stackable?: boolean;
  usableBy?: string;
  countGuestsTowardCapacity?: boolean;
  active?: boolean;
  admissionItemCodes: string[];
  optionalItemCodes: string[];
  source: SourceRef;
}
export interface NormalizedVoucher {
  code: string;
  alertEmail?: string;
  description?: string;
  capacity?: number;
  source: SourceRef;
}
export interface ReconciliationOutcome {
  status: "compiled" | "review" | "unsupported";
  reason: string;
  sourceSheet?: string;
  sourceRow?: number;
}
export interface DiscountsVouchersCompilation {
  discounts: NormalizedDiscount[];
  vouchers: NormalizedVoucher[];
  discountOutcomes: ReconciliationOutcome[];
  voucherOutcome: ReconciliationOutcome;
}

const DISCOUNT_SHEETS = new Set(["discount code template", "group discounts", "7. discounts"]);
const VOUCHER_SHEETS = new Set(["8. vouchers", "vouchers", "event vouchers"]);

/** Pure reconciliation only: this compiler performs no Cvent or network operations. */
export function compileDiscountsAndVouchers(sheets: CompilerSheet[]): DiscountsVouchersCompilation {
  const discountSheets = sheets.filter((sheet) => DISCOUNT_SHEETS.has(normalize(sheet.name)));
  const voucherSheets = sheets.filter((sheet) => VOUCHER_SHEETS.has(normalize(sheet.name)));
  const discounts: NormalizedDiscount[] = [];
  const vouchers: NormalizedVoucher[] = [];
  const discountOutcomes: ReconciliationOutcome[] = [];

  for (const sheet of discountSheets) {
    const table = locateTable(sheet.rows, ["discount code", "code"]);
    if (!table) {
      discountOutcomes.push({ status: "review", reason: "No recognizable discount header was found.", sourceSheet: sheet.name });
      continue;
    }
    for (let index = table.headerIndex + 1; index < sheet.rows.length; index += 1) {
      const row = sheet.rows[index] ?? [];
      const code = value(row, table.columns, "discount code", "code").toUpperCase();
      if (!code || isInstruction(code) || /^(DISCOUNT )?CODE$/i.test(code)) continue;
      const methodSource = value(row, table.columns, "method", "discount type");
      const amountSource = value(row, table.columns, "amount / percentage", "discount amount", "amount", "percentage");
      const method = parseMethod(methodSource, amountSource);
      const amount = parseAmount(amountSource);
      if (!method || amount === undefined || amount < 0 || (method === "percent" && amount > 100)) {
        discountOutcomes.push({ status: "review", reason: `Discount ${code} has an unsupported method or amount.`, sourceSheet: sheet.name, sourceRow: index + 1 });
        continue;
      }
      const capacity = parseNonNegativeInteger(value(row, table.columns, "capacity"));
      discounts.push(compact({
        name: value(row, table.columns, "name / description", "description", "name") || code,
        code, method, amount,
        effectiveFrom: optional(value(row, table.columns, "effective from")),
        effectiveTo: optional(value(row, table.columns, "effective to")),
        capacity,
        stackable: parseBoolean(value(row, table.columns, "stackable")),
        usableBy: optional(value(row, table.columns, "usable by")),
        countGuestsTowardCapacity: parseBoolean(value(row, table.columns, "count guests toward capacity")),
        active: parseBoolean(value(row, table.columns, "active")),
        admissionItemCodes: codes(value(row, table.columns, "applicable admission items", "admission item codes")),
        optionalItemCodes: codes(value(row, table.columns, "applicable optional items", "optional item codes")),
        source: { sheet: sheet.name, row: index + 1 },
      }));
      discountOutcomes.push({ status: "compiled", reason: `Discount ${code} normalized.`, sourceSheet: sheet.name, sourceRow: index + 1 });
    }
  }

  for (const sheet of voucherSheets) {
    const table = locateTable(sheet.rows, ["voucher code"]);
    if (!table) continue;
    for (let index = table.headerIndex + 1; index < sheet.rows.length; index += 1) {
      const row = sheet.rows[index] ?? [];
      const code = value(row, table.columns, "voucher code").toUpperCase();
      if (!code || isInstruction(code) || /^VOUCHER CODE$/i.test(code)) continue;
      vouchers.push(compact({
        code,
        alertEmail: optional(value(row, table.columns, "alert email address", "alert email")),
        description: optional(value(row, table.columns, "description")),
        capacity: parseNonNegativeInteger(value(row, table.columns, "capacity")),
        source: { sheet: sheet.name, row: index + 1 },
      }));
    }
  }

  const voucherOutcome: ReconciliationOutcome = voucherSheets.length === 0
    ? { status: "unsupported", reason: "No voucher source exists; voucher data cannot be inferred or invented." }
    : vouchers.length === 0
      ? { status: "review", reason: "Voucher source exists but contains no usable voucher rows; operator review is required.", sourceSheet: voucherSheets[0].name }
      : { status: "compiled", reason: `${vouchers.length} voucher row(s) normalized from an explicit source.`, sourceSheet: voucherSheets[0].name };

  return { discounts, vouchers, discountOutcomes, voucherOutcome };
}

function locateTable(rows: CompilerCell[][], requiredAliases: string[]): { headerIndex: number; columns: Map<string, number> } | undefined {
  for (let headerIndex = 0; headerIndex < rows.length; headerIndex += 1) {
    const headers = (rows[headerIndex] ?? []).map((cell) => normalize(text(cell)).replace(/^->\s*/, ""));
    if (!requiredAliases.some((alias) => headers.includes(alias))) continue;
    return { headerIndex, columns: new Map(headers.map((header, index) => [header, index])) };
  }
  return undefined;
}
function value(row: CompilerCell[], columns: Map<string, number>, ...aliases: string[]): string {
  for (const alias of aliases) {
    const exact = columns.get(alias);
    if (exact !== undefined) return text(row[exact]).trim();
    for (const [header, index] of columns) if (header.includes(alias)) return text(row[index]).trim();
  }
  return "";
}
function parseMethod(method: string, amount: string): "percent" | "amount" | undefined {
  if (/percent|percentage|%/i.test(method) || (!method && amount.includes("%"))) return "percent";
  if (/amount|fixed|currency|\$/i.test(method) || (!method && /^\s*[$£€]/.test(amount))) return "amount";
  return undefined;
}
function parseAmount(source: string): number | undefined {
  const normalized = source.replace(/[$£€,%\s,]/g, "");
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : undefined;
}
function parseNonNegativeInteger(source: string): number | undefined {
  if (!/^\d+$/.test(source.trim())) return undefined;
  return Number(source);
}
function parseBoolean(source: string): boolean | undefined {
  if (/^(yes|y|true|active|1)$/i.test(source)) return true;
  if (/^(no|n|false|inactive|0)$/i.test(source)) return false;
  return undefined;
}
function codes(source: string): string[] {
  return [...new Set(source.split(/[;,|\n]+/).map((item) => item.trim().toUpperCase()).filter(Boolean))];
}
function isInstruction(source: string): boolean { return /^(?:default:|column notes|->)|\|\s*(?:needs confirmation|confirmed|gap)/i.test(source.trim()); }
function optional(source: string): string | undefined { return source || undefined; }
function normalize(source: string): string { return source.trim().toLowerCase().replace(/\s+/g, " "); }
function text(value: CompilerCell): string { return value == null ? "" : value instanceof Date ? value.toISOString() : String(value); }
function compact<T extends object>(record: T): T {
  for (const key of Object.keys(record) as Array<keyof T>) if (record[key] === undefined) delete record[key];
  return record;
}
