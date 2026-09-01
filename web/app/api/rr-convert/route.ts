import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import readXlsxFile from "read-excel-file/node";
import { previewRRDocument, type RRCell, type RRSheet } from "../../../../src/intake/rrDocument";
import { legacyPreviewAssignments } from "../../../lib/legacy-rr-converter";

export const runtime = "nodejs";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Choose a legacy RR .xlsx workbook." }, { status: 400 });
    if (!file.size || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "RR workbooks must be between 1 byte and 20 MB." }, { status: 413 });
    const source = Buffer.from(await file.arrayBuffer());
    const parsed = await readXlsxFile(source);
    const sheets: RRSheet[] = parsed.map((sheet) => ({ name: sheet.sheet, rows: sheet.data as RRCell[][] }));
    const preview = previewRRDocument(sheets); const assignments = legacyPreviewAssignments(preview);
    const templatePath = resolve(/*turbopackIgnore: true*/ process.cwd(), "templates", "Emerald_Cvent_Intake_Form.xlsx");
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await readFile(templatePath) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    for (const item of assignments) { const sheet = workbook.getWorksheet(item.sheet); if (!sheet) throw new Error(`New RR template is missing ${item.sheet}`); sheet.getCell(item.cell).value = item.value; }
    const prior = workbook.getWorksheet("Conversion Report"); if (prior) workbook.removeWorksheet(prior.id);
    const report = workbook.addWorksheet("Conversion Report", { views: [{ state: "frozen", ySplit: 1 }] });
    report.columns = [{ header: "Destination", key: "destination", width: 28 }, { header: "Source", key: "source", width: 48 }, { header: "Confidence", key: "confidence", width: 14 }, { header: "Converted value", key: "value", width: 60 }];
    report.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; report.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173F35" } };
    assignments.forEach((item) => report.addRow({ destination: `${item.sheet}!${item.cell}`, source: item.source, confidence: item.confidence, value: String(item.value) }));
    for (const warning of preview.warnings) report.addRow({ destination: "REVIEW", source: "Legacy converter", confidence: "review", value: warning });
    report.autoFilter = `A1:D${Math.max(2, report.rowCount)}`;
    const start = workbook.getWorksheet("Start Here"); if (start) start.getCell("A33").value = `Converted from ${safeName(file.name)}. Review yellow cells and the Conversion Report before submission.`;
    const output = Buffer.from(await workbook.xlsx.writeBuffer()); const name = `${safeBase(file.name)}_Converted_New_RR.xlsx`;
    return new Response(output, { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Legacy RR conversion failed." }, { status: 400 }); }
}
function safeName(name: string): string { return name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || "legacy-rr.xlsx"; }
function safeBase(name: string): string { return safeName(name).replace(/\.xlsx$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120); }
