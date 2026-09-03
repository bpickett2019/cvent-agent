export interface EventSourceRow {
  sheet: string;
  label: string;
  value: string | number | Date | null | undefined;
  source?: string;
}

export interface EventSourceReview {
  code: "invalid-venue" | "invalid-range" | "reversed-range";
  field: "venue" | "expo" | "conference";
  message: string;
  source?: string;
}

export interface EventSourceValue {
  existingEventName: string | null;
  newEventName: string | null;
  venue: { name: string; city: string; state: string } | null;
  expo: { start: string; end: string } | null;
  conference: { start: string; end: string } | null;
}

export interface EventSourceNormalization {
  value: EventSourceValue;
  outcome: "exact" | "review";
  review: EventSourceReview[];
  /** Source normalization is pure preview data and never mutation authority. */
  safeToExecute: false;
}

type Entry = { text: string; source?: string };
type Range = { start: string; end: string };

const SHEET_ALIASES = new Set(["event details", "event detail", "event setup", "1 event setup"]);
const LABELS: Record<string, keyof EventSourceValue> = {
  "existing event name": "existingEventName",
  "existing event name template the agent copies": "existingEventName",
  "new event name": "newEventName",
  "event name": "newEventName",
  "event location": "venue",
  "location": "venue",
  "venue": "venue",
  "venue location": "venue",
  "expo hall dates": "expo",
  "expo hall date time": "expo",
  "expo dates times": "expo",
  "expo date time": "expo",
  "conference dates": "conference",
  "conference date time": "conference",
  "conference dates times": "conference",
};

/** Normalize allowlisted legacy event sheets without I/O or locale-dependent Date parsing. */
export function normalizeEventSource(rows: readonly EventSourceRow[]): EventSourceNormalization {
  const entries = new Map<keyof EventSourceValue, Entry>();
  for (const row of rows) {
    if (!SHEET_ALIASES.has(normalize(row.sheet))) continue;
    const field = LABELS[normalize(row.label)];
    if (!field || row.value === null || row.value === undefined) continue;
    const text = row.value instanceof Date ? formatDate(row.value) : String(row.value).trim();
    if (text && !entries.has(field)) entries.set(field, { text, source: row.source });
  }

  const review: EventSourceReview[] = [];
  const venueEntry = entries.get("venue");
  const venue = venueEntry ? parseVenue(venueEntry.text) : null;
  if (venueEntry && !venue) review.push({ code: "invalid-venue", field: "venue", message: "Combined location must contain a venue name, city, and two-letter state.", source: venueEntry.source });
  const expo = range(entries.get("expo"), "expo", review);
  const conference = range(entries.get("conference"), "conference", review);
  const value: EventSourceValue = {
    existingEventName: entries.get("existingEventName")?.text ?? null,
    newEventName: entries.get("newEventName")?.text ?? null,
    venue,
    expo,
    conference,
  };
  return { value, outcome: review.length ? "review" : "exact", review, safeToExecute: false };
}

function parseVenue(value: string): EventSourceValue["venue"] {
  const pipe = /^(.+?)\s*\|\s*([^,|]+),\s*([A-Za-z]{2})$/.exec(value);
  const comma = /^(.+),\s*([^,]+),\s*([A-Za-z]{2})$/.exec(value);
  const match = pipe ?? comma;
  if (!match) return null;
  const name = match[1].trim();
  const city = match[2].trim();
  const state = match[3].toUpperCase();
  return name && city ? { name, city, state } : null;
}

function range(entry: Entry | undefined, field: "expo" | "conference", review: EventSourceReview[]): Range | null {
  if (!entry) return null;
  const parsed = parseRange(entry.text);
  if (!parsed) {
    review.push({ code: "invalid-range", field, message: `${field} date/time range could not be normalized deterministically.`, source: entry.source });
    return null;
  }
  if (parsed.start > parsed.end) {
    review.push({ code: "reversed-range", field, message: `${field} starts after it ends.`, source: entry.source });
    return null;
  }
  return parsed;
}

function parseRange(value: string): Range | null {
  const text = value.trim().replace(/[–—]/g, "-");

  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+?)\s+(?:to|-)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+)$/i.exec(text);
  if (numeric) return buildRange(+numeric[3], +numeric[1], +numeric[2], numeric[4], +numeric[7], +numeric[5], +numeric[6], numeric[8]);

  const fullNamed = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4}),?\s+(.+?)\s+-\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4}),?\s+(.+)$/.exec(text);
  if (fullNamed) {
    const m1 = month(fullNamed[1]); const m2 = month(fullNamed[5]);
    return m1 && m2 ? buildRange(+fullNamed[3], m1, +fullNamed[2], fullNamed[4], +fullNamed[7], m2, +fullNamed[6], fullNamed[8]) : null;
  }

  const shorthand = /^([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2}),\s*(\d{4})\s*[;|,]\s*(.+?)\s*-\s*(.+)$/.exec(text);
  if (shorthand) {
    const m = month(shorthand[1]);
    return m ? buildRange(+shorthand[4], m, +shorthand[2], shorthand[5], +shorthand[4], m, +shorthand[3], shorthand[6]) : null;
  }
  return null;
}

function buildRange(y1: number, m1: number, d1: number, t1: string, y2: number, m2: number, d2: number, t2: string): Range | null {
  const date1 = date(y1, m1, d1); const date2 = date(y2, m2, d2);
  const time1 = time(t1); const time2 = time(t2);
  return date1 && date2 && time1 && time2 ? { start: `${date1}T${time1}:00`, end: `${date2}T${time2}:00` } : null;
}

function time(value: string): string | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i.exec(value.trim());
  if (!match) return null;
  let hour = +match[1]; const minute = +(match[2] ?? "0");
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (match[3].toUpperCase() === "AM") hour %= 12; else hour = hour % 12 + 12;
  return `${pad(hour)}:${pad(minute)}`;
}

function date(year: number, monthValue: number, day: number): string | null {
  const candidate = new Date(Date.UTC(year, monthValue - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === monthValue - 1 && candidate.getUTCDate() === day
    ? `${String(year).padStart(4, "0")}-${pad(monthValue)}-${pad(day)}` : null;
}
function month(value: string): number | null { return MONTHS[value.toLowerCase()] ?? null; }
function formatDate(value: Date): string { return Number.isNaN(value.getTime()) ? "" : value.toISOString(); }
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function pad(value: number): string { return String(value).padStart(2, "0"); }
const MONTHS: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
