export type CompilerOutcome = "exact" | "review" | "unsupported";

export interface FooterLinkContractField {
  key: string;
  sourceLabel: string;
  cventField: string;
  outcome: Exclude<CompilerOutcome, "unsupported">;
}

export const FOOTER_LINK_CONTRACT: FooterLinkContractField[] = [
  { key: "show-hours", sourceLabel: "Show Hours", cventField: "Show Hours link", outcome: "exact" },
  { key: "show-policy", sourceLabel: "Show Policy", cventField: "Show Policy link", outcome: "exact" },
  { key: "emerald-privacy-policy", sourceLabel: "Emerald Privacy Policy", cventField: "Emerald Privacy Policy link", outcome: "exact" },
  { key: "browse-sessions", sourceLabel: "Browse Sessions", cventField: "Browse Sessions link", outcome: "exact" },
  { key: "review-pricing", sourceLabel: "Review Pricing", cventField: "Review Pricing link", outcome: "exact" },
  { key: "registration-status", sourceLabel: "Registration Status", cventField: "Registration Status link", outcome: "exact" },
  { key: "faq", sourceLabel: "FAQ", cventField: "FAQ link", outcome: "exact" },
  { key: "contact-us-button", sourceLabel: "Contact Us button", cventField: "Contact Us button", outcome: "exact" },
  { key: "exhibitor-resource-center", sourceLabel: "Exhibitor Resource Center", cventField: "Exhibitor Resource Center link", outcome: "exact" },
  { key: "hotel-info", sourceLabel: "Hotel Info", cventField: "Hotel Info link", outcome: "review" },
];

export interface FooterLinkSourceRow {
  include: boolean | string | null | undefined;
  destination?: string | null;
  label: string;
}

export interface CompiledFooterLink {
  slice: "footer-link";
  key: string;
  sourceLabel: string;
  cventField: string | null;
  include: boolean;
  destination?: string;
  outcome: CompilerOutcome;
  reason: string;
}

export function compileFooterLinks(rows: FooterLinkSourceRow[]): CompiledFooterLink[] {
  return rows.map((row) => {
    const contract = FOOTER_LINK_CONTRACT.find((field) => normalized(field.sourceLabel) === normalized(row.label));
    const include = parseInclude(row.include);
    const destination = include && row.destination?.trim() ? row.destination.trim() : undefined;
    if (!contract) {
      return {
        slice: "footer-link",
        key: `unsupported:${slug(row.label)}`,
        sourceLabel: row.label,
        cventField: null,
        include,
        ...(destination ? { destination } : {}),
        outcome: "unsupported",
        reason: "The footer label is not part of the authoritative intake contract.",
      };
    }
    return {
      slice: "footer-link",
      key: contract.key,
      sourceLabel: contract.sourceLabel,
      cventField: contract.cventField,
      include,
      ...(destination ? { destination } : {}),
      outcome: contract.outcome,
      reason: contract.outcome === "exact"
        ? "Confirmed by the authoritative Cvent field map."
        : "Hotel Info needs confirmation in the authoritative Cvent field map.",
    };
  });
}

export interface RegistrationPathContractField {
  sourceField: "name" | "privacy" | "status" | "redirectUrl";
  cventField: string;
  outcome: Exclude<CompilerOutcome, "unsupported">;
}

export const REGISTRATION_PATH_CONTRACT: RegistrationPathContractField[] = [
  { sourceField: "name", cventField: "Path list", outcome: "review" },
  { sourceField: "privacy", cventField: "Path Privacy", outcome: "review" },
  { sourceField: "status", cventField: "Path Status", outcome: "review" },
  { sourceField: "redirectUrl", cventField: "Post-registration redirect URL", outcome: "exact" },
];

export interface RegistrationPathSourceRow {
  name: string;
  privacy?: string | null;
  status?: string | null;
  redirectUrl?: string | null;
  /** The legacy contract permits linking an existing path, not creating one. */
  create?: boolean;
}

export interface CompiledRegistrationPathField {
  slice: "registration-path";
  pathName: string;
  sourceField: RegistrationPathContractField["sourceField"];
  cventField: string;
  value: string | null;
  outcome: CompilerOutcome;
  reason: string;
}

export function compileRegistrationPaths(rows: RegistrationPathSourceRow[]): CompiledRegistrationPathField[] {
  return rows.flatMap((row) => REGISTRATION_PATH_CONTRACT.map((field) => {
    if (row.create) {
      return {
        slice: "registration-path" as const,
        pathName: row.name,
        sourceField: field.sourceField,
        cventField: field.cventField,
        value: pathValue(row, field.sourceField),
        outcome: "unsupported" as const,
        reason: "The legacy contract can link to an existing path but cannot create one.",
      };
    }
    return {
      slice: "registration-path" as const,
      pathName: row.name,
      sourceField: field.sourceField,
      cventField: field.cventField,
      value: pathValue(row, field.sourceField),
      outcome: field.outcome,
      reason: field.outcome === "exact"
        ? "Confirmed by the authoritative Cvent field map."
        : field.sourceField === "name"
          ? "The path name needs confirmation and must match an existing path verbatim."
          : `${field.cventField} needs confirmation in the authoritative Cvent field map.`,
    };
  }));
}

function pathValue(row: RegistrationPathSourceRow, field: RegistrationPathContractField["sourceField"]): string | null {
  const value = row[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseInclude(value: FooterLinkSourceRow["include"]): boolean {
  if (typeof value === "boolean") return value;
  return /^yes$/i.test(value?.trim() ?? "");
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function slug(value: string): string {
  return normalized(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unnamed";
}
