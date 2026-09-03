export interface EventDetailInput {
  question: string;
  answer: string | number | Date | null | undefined;
  source?: string;
}

export interface CompilerReview {
  code: "ambiguous-event-name" | "combined-venue" | "invalid-date" | "incomplete-range" | "reversed-range";
  field: string;
  message: string;
  source?: string;
}

export interface EventDetailsValue {
  existingEventName: string | null;
  newEventName: string | null;
  displayName: string | null;
  venue: { name: string; city: string; state: string } | null;
  expoDates: { start: string; end: string } | null;
  conferenceDates: { start: string; end: string } | null;
}

export interface EventDetailsCompilation {
  value: EventDetailsValue;
  outcome: "exact" | "review";
  review: CompilerReview[];
  /** A compiler result is data for operator review, never authorization to mutate Cvent. */
  safeToExecute: false;
}

type Entry = { value: string | Date; source?: string };

/**
 * Compiles only allowlisted event-detail fields. It performs no I/O and grants no
 * execution authority. Unknown rows are deliberately ignored.
 */
export function compileEventDetails(rows: readonly EventDetailInput[]): EventDetailsCompilation {
  const entries = new Map<string, Entry>();
  for (const row of rows) {
    const key = normalizeLabel(row.question);
    if (!key || row.answer === null || row.answer === undefined || String(row.answer).trim() === "") continue;
    if (!entries.has(key)) entries.set(key, { value: row.answer instanceof Date ? row.answer : String(row.answer).trim(), source: row.source });
  }

  const review: CompilerReview[] = [];
  const existing = get(entries, "existing event name template the agent copies");
  const newName = get(entries, "new event name");
  const genericName = get(entries, "event name");
  if (genericName && !newName) {
    review.push({ code: "ambiguous-event-name", field: "newEventName", message: "Legacy Event Name does not identify the copied template; it is retained only as the proposed new name.", source: genericName.source });
  }

  const venueName = get(entries, "venue name");
  const city = get(entries, "city");
  const state = get(entries, "state");
  const combinedVenue = get(entries, "event location");
  let venue: EventDetailsValue["venue"] = null;
  if (venueName && city && state) {
    venue = { name: asText(venueName), city: asText(city), state: asText(state) };
  } else if (combinedVenue) {
    review.push({ code: "combined-venue", field: "venue", message: "Legacy Event Location combines venue, city, and state; supply each structured field before execution.", source: combinedVenue.source });
  } else if (venueName || city || state) {
    review.push({ code: "combined-venue", field: "venue", message: "Venue requires separate nonblank venue name, city, and state values.", source: (venueName ?? city ?? state)?.source });
  }

  const expoDates = compileRange(entries, "expo hall dates start", "expo hall dates end", "expoDates", review)
    ?? compileLegacyRange(entries, "event dates", "expoDates", review);
  const conferenceDates = compileRange(entries, "conference dates start", "conference dates end", "conferenceDates", review);

  const value: EventDetailsValue = {
    existingEventName: existing ? asText(existing) : null,
    newEventName: newName ? asText(newName) : genericName ? asText(genericName) : null,
    displayName: get(entries, "display short name") ? asText(get(entries, "display short name")!) : null,
    venue,
    expoDates,
    conferenceDates,
  };
  return { value, outcome: review.length ? "review" : "exact", review, safeToExecute: false };
}

function compileRange(entries: Map<string, Entry>, startKey: string, endKey: string, field: string, review: CompilerReview[]): { start: string; end: string } | null {
  const startEntry = get(entries, startKey);
  const endEntry = get(entries, endKey);
  if (!startEntry && !endEntry) return null;
  if (!startEntry || !endEntry) {
    review.push({ code: "incomplete-range", field, message: `${field} requires separate start and end dates.`, source: (startEntry ?? endEntry)?.source });
    return null;
  }
  const start = normalizeDate(startEntry.value);
  const end = normalizeDate(endEntry.value);
  if (!start || !end) {
    review.push({ code: "invalid-date", field, message: `${field} contains an ambiguous or invalid date; no date was guessed.`, source: (!start ? startEntry : endEntry).source });
    return null;
  }
  if (start > end) {
    review.push({ code: "reversed-range", field, message: `${field} start date is after its end date.`, source: startEntry.source });
    return null;
  }
  return { start, end };
}

function compileLegacyRange(entries: Map<string, Entry>, key: string, field: string, review: CompilerReview[]): { start: string; end: string } | null {
  const entry = get(entries, key);
  if (!entry) return null;
  const parsed = parseLegacyRange(asText(entry));
  if (!parsed) {
    review.push({ code: "invalid-date", field, message: "Legacy Event Dates could not be normalized deterministically.", source: entry.source });
  }
  return parsed;
}

function normalizeDate(value: string | Date): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (iso) return validDate(+iso[1], +iso[2], +iso[3]);
  const named = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(value.trim());
  if (!named) return null;
  const month = MONTHS[named[1].toLowerCase()];
  return month ? validDate(+named[3], month, +named[2]) : null;
}

function parseLegacyRange(value: string): { start: string; end: string } | null {
  const match = /^([A-Za-z]+)\s+(\d{1,2})\s*[-–]\s*(\d{1,2}),\s*(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  const start = validDate(+match[4], month, +match[2]);
  const end = validDate(+match[4], month, +match[3]);
  return start && end && start <= end ? { start, end } : null;
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
function normalizeLabel(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function get(entries: Map<string, Entry>, key: string): Entry | undefined { return entries.get(key); }
function asText(entry: Entry): string { return entry.value instanceof Date ? entry.value.toISOString() : entry.value; }
