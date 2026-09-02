export type LegacyFooterCell = string | number | boolean | Date | null | undefined;
export interface LegacyFooterSheet { name: string; rows: readonly (readonly LegacyFooterCell[])[] }
export type FooterApplicabilityKind = "attendee" | "exhibitor" | "internal" | "path";
export interface FooterApplicability { kind: FooterApplicabilityKind; paths: string[] }
export interface FooterProvenance {
  sheet: string; row: number; labelCell: string; includeCell: string; destinationCell: string; blockHeadingCell: string;
}
export interface LegacyFooterBlock { heading: string; applicability: FooterApplicability; headingRow: number; headerRow: number; provenance: { sheet: string; cell: string } }
export interface LegacyFooterLink {
  key: string; label: string; canonicalLabel: string | null; include: boolean; destination?: string;
  /** True means the destination is retained verbatim as intake text, not resolved or rewritten. */
  literalDestination: boolean; applicability: FooterApplicability; outcome: "exact" | "review"; provenance: FooterProvenance;
}
export type LegacyFooterReviewCode = "unknown-label" | "unknown-include" | "missing-destination" | "hidden-destination" | "contract-review";
export interface LegacyFooterReview { code: LegacyFooterReviewCode; message: string; key?: string; provenance: FooterProvenance }
export interface LegacyFooterConflict { code: "conflicting-duplicate"; key: string; message: string; applicability: FooterApplicability; provenance: FooterProvenance[] }
export interface LegacyFooterCompilation {
  blocks: LegacyFooterBlock[]; links: LegacyFooterLink[]; review: LegacyFooterReview[]; conflicts: LegacyFooterConflict[];
  outcome: "exact" | "review"; safeToExecute: false;
}

type Contract = { key: string; label: string; aliases: string[]; review?: boolean; requiresDestination?: boolean };
const CONTRACT: Contract[] = [
  item("show-hours", "Show Hours", ["show hours link"]),
  item("show-policy", "Show Policy", ["show policy link"]),
  item("emerald-privacy-policy", "Emerald Privacy Policy", ["privacy policy", "emerald privacy policy link"]),
  item("hotel-info", "Hotel Info", ["hotel information", "hotel info link"], true),
  item("browse-sessions", "Browse Sessions", ["sessions", "browse sessions link"]),
  item("review-pricing", "Review Pricing", ["pricing", "review pricing link"]),
  item("registration-status", "Registration Status", ["registration status link"]),
  item("faq", "FAQ", ["faq link", "frequently asked questions"]),
  item("contact-us", "Contact Us Button", ["contact us", "contact us link"]),
  item("exhibitor-resource-center", "Exhibitor Resource Center", ["exhibitor resource centre", "exhibitor resource center link", "exhibitor resource centre link"]),
];
function item(key: string, label: string, aliases: string[], review = false): Contract { return { key, label, aliases, review, requiresDestination: true }; }

/** Pure legacy parser. It compiles workbook intent and provenance, never mutation authority. */
export function compileLegacyFooter(sheet: LegacyFooterSheet): LegacyFooterCompilation {
  const blocks: LegacyFooterBlock[] = [], links: LegacyFooterLink[] = [], review: LegacyFooterReview[] = [];
  let active: LegacyFooterBlock | undefined;
  for (let index = 0; index < sheet.rows.length; index++) {
    const row = sheet.rows[index];
    const first = text(row[0]);
    if (isBlockHeading(first)) {
      const headerIndex = findHeader(sheet.rows, index + 1);
      active = { heading: first, applicability: parseApplicability(first), headingRow: index + 1, headerRow: headerIndex + 1, provenance: { sheet: sheet.name, cell: `A${index + 1}` } };
      blocks.push(active); index = headerIndex; continue;
    }
    if (!active || index < active.headerRow) continue;
    if (isBoundary(first)) { active = undefined; continue; }
    if (!first) continue;
    const header = sheet.rows[active.headerRow - 1] ?? [];
    const columns = headerColumns(header);
    const label = text(row[columns.label]);
    if (!label || isInstruction(label)) continue;
    const includeRaw = row[columns.include];
    const parsed = parseInclude(includeRaw);
    const destinationText = text(row[columns.destination]);
    const destination = parsed.value && destinationText ? destinationText : undefined;
    const provenance: FooterProvenance = { sheet: sheet.name, row: index + 1, labelCell: cell(columns.label, index), includeCell: cell(columns.include, index), destinationCell: cell(columns.destination, index), blockHeadingCell: active.provenance.cell };
    const contract = contractFor(label);
    const key = contract?.key ?? `unknown:${slug(label)}`;
    const entry: LegacyFooterLink = { key, label, canonicalLabel: contract?.label ?? null, include: parsed.value, ...(destination ? { destination } : {}), literalDestination: Boolean(destination), applicability: active.applicability, outcome: contract?.review || !contract || !parsed.known || (parsed.value && !destination) ? "review" : "exact", provenance };
    links.push(entry);
    if (!contract) review.push({ code: "unknown-label", key, message: `Unknown legacy footer label: ${label}`, provenance });
    if (!parsed.known) review.push({ code: "unknown-include", key, message: `Include/Visible value is not a recognized Yes/No value: ${text(includeRaw) || "(blank)"}`, provenance });
    if (parsed.value && contract?.requiresDestination && !destination) review.push({ code: "missing-destination", key, message: `${contract.label} is visible but has no destination.`, provenance });
    if (!parsed.value && destinationText) review.push({ code: "hidden-destination", key, message: `${contract?.label ?? label} is hidden but contains a destination; the destination was not activated.`, provenance });
    if (contract?.review) review.push({ code: "contract-review", key, message: `${contract.label} requires operator confirmation under the legacy field contract.`, provenance });
  }
  const conflicts = detectConflicts(links);
  return { blocks, links, review, conflicts, outcome: review.length || conflicts.length ? "review" : "exact", safeToExecute: false };
}

function findHeader(rows: LegacyFooterSheet["rows"], from: number): number {
  for (let i = from; i < Math.min(rows.length, from + 4); i++) if (isHeader(rows[i])) return i;
  return from;
}
function isHeader(row: readonly LegacyFooterCell[] | undefined): boolean { const values = row?.map((v) => norm(text(v))) ?? []; return values.some((v) => /^(footer options?|footer links?|link)$/.test(v)) && values.some((v) => /^(visible|visible yes no|include|include yes no)$/.test(v)); }
function headerColumns(row: readonly LegacyFooterCell[]): { label: number; include: number; destination: number } {
  const h = row.map((v) => norm(text(v)));
  const locate = (re: RegExp, fallback: number) => { const i = h.findIndex((v) => re.test(v)); return i < 0 ? fallback : i; };
  return { label: locate(/footer option|footer link|^link$/, 0), include: locate(/visible|include/, 1), destination: locate(/url|destination|provide link|email/, 2) };
}
function isBlockHeading(value: string): boolean { return /^footer\s+(?:options?|links?)\s*[-–:]/i.test(value); }
function isBoundary(value: string): boolean { return /^(countdown clock|social media urls?)\b/i.test(value); }
function isInstruction(value: string): boolean { return /^for all\b/i.test(value) || /^footer options?$/i.test(value); }
function parseApplicability(heading: string): FooterApplicability {
  const suffix = heading.replace(/^footer\s+(?:options?|links?)\s*[-–:]\s*/i, "").trim();
  if (/^exhibitor(?:\b|\/)/i.test(suffix)) return { kind: "exhibitor", paths: splitPaths(suffix || "Exhibitor") };
  if (/^internal(?:\b|\/)/i.test(suffix)) return { kind: "internal", paths: splitPaths(suffix || "Internal") };
  const path = /^(?:registration\s+)?path\s*[:\-]?\s*(.+)$/i.exec(suffix);
  if (path) return { kind: "path", paths: splitPaths(path[1]) };
  return { kind: "attendee", paths: splitPaths(suffix || "Attendee") };
}
function splitPaths(value: string): string[] { return value.split(/\s*[/,|]\s*/).map((v) => v.trim()).filter(Boolean).map((v) => /^attendee\s*press$/i.test(v) ? "Attendee" : title(v)).flatMap((v, i, all) => i === 0 && /attendee.*press/i.test(value) && all.length === 1 ? ["Attendee", "Press"] : [v]); }
function contractFor(label: string): Contract | undefined { const candidate = norm(label.replace(/\([^)]*(?:flow|path)[^)]*\)/gi, "")); return CONTRACT.find((c) => [c.label, ...c.aliases].some((a) => norm(a) === candidate)); }
function parseInclude(value: LegacyFooterCell): { value: boolean; known: boolean } { if (typeof value === "boolean") return { value, known: true }; const v = norm(text(value)); if (["yes", "y", "true", "include", "visible", "1"].includes(v)) return { value: true, known: true }; if (["no", "n", "false", "exclude", "hidden", "0"].includes(v)) return { value: false, known: true }; return { value: false, known: false }; }
function detectConflicts(links: LegacyFooterLink[]): LegacyFooterConflict[] {
  const groups = new Map<string, LegacyFooterLink[]>();
  for (const link of links) { const id = `${link.applicability.kind}:${link.applicability.paths.map(norm).join("|")}:${link.key}`; groups.set(id, [...(groups.get(id) ?? []), link]); }
  const out: LegacyFooterConflict[] = [];
  for (const group of groups.values()) { const values = new Set(group.map((v) => `${v.include}\u0000${v.destination ?? ""}`)); if (values.size > 1) out.push({ code: "conflicting-duplicate", key: group[0].key, message: `Conflicting values for ${group[0].canonicalLabel ?? group[0].label} in the same footer applicability.`, applicability: group[0].applicability, provenance: group.map((v) => v.provenance) }); }
  return out;
}
function text(value: LegacyFooterCell): string { return value == null ? "" : value instanceof Date ? value.toISOString() : String(value).trim(); }
function norm(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function slug(value: string): string { return norm(value).replace(/ /g, "-") || "unnamed"; }
function cell(column: number, zeroBasedRow: number): string { return `${columnName(column + 1)}${zeroBasedRow + 1}`; }
function columnName(index: number): string { let out = ""; for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out; return out; }
function title(value: string): string { return value.replace(/\b\w/g, (c) => c.toUpperCase()); }
