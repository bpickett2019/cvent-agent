import { NextResponse } from "next/server";
import readXlsxFile from "read-excel-file/node";
import { previewRRDocument, type RRCell, type RRSheet } from "../../../../src/intake/rrDocument";
import { compileFullRR, compileFullRRToEventSpec } from "../../../lib/compiler/full-rr";
import { buildOperatorReview } from "../../../lib/operator-review";
import { initialSpec } from "../../../lib/fixtures";
import { assertSameOrigin } from "../../../lib/request-security";
import { requireRole } from "../../../lib/require-role";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PARSED_CELLS = 500_000;

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireRole("Operator");
  if (denied) return denied;
  try {
    assertSameOrigin(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose an RR workbook or CSV file." }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "RR documents must be between 1 byte and 20 MB." }, { status: 413 });
    }
    const lowerName = file.name.toLowerCase();
    let sheets: RRSheet[];
    if (lowerName.endsWith(".csv") || file.type === "text/csv") {
      sheets = [{ name: "CSV", rows: parseCsv(await file.text()) }];
    } else if (lowerName.endsWith(".xlsx")) {
      const workbook = await readXlsxFile(Buffer.from(await file.arrayBuffer()));
      sheets = workbook.map((sheet) => ({ name: sheet.sheet, rows: sheet.data as RRCell[][] }));
    } else {
      return NextResponse.json({ error: "Only .xlsx and .csv RR documents are supported." }, { status: 415 });
    }
    const cells = sheets.reduce(
      (total, sheet) => total + sheet.rows.reduce((sheetTotal, row) => sheetTotal + row.length, 0),
      0
    );
    if (cells > MAX_PARSED_CELLS) throw new Error("RR document is too large to review safely.");
    const preview = previewRRDocument(sheets);
    const compiler = compileFullRR(sheets);
    const operatorReview = buildOperatorReview(compiler);
    const normalizedSpec = compileFullRRToEventSpec(initialSpec, compiler);
    return NextResponse.json({
      file: { name: safeName(file.name), size: file.size, type: lowerName.endsWith(".csv") ? "csv" : "xlsx" },
      preview,
      compiler: { summary: compiler.summary },
      normalizedSpec,
      operatorReview,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The RR document could not be read." },
      { status: 400 }
    );
  }
}

function parseCsv(source: string): RRCell[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.slice(0, 10_000);
}

function safeName(name: string): string {
  return name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "rr-document";
}
