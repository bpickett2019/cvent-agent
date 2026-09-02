"use client";

import { useRef, useState } from "react";
import type { RRNormalizedPreview } from "../lib/rr-normalize";
import type { EventSpec } from "../../src/spec/eventSpec";
import type { OperatorReview } from "../lib/operator-review";
import { OperatorReviewSummary } from "./operator-review-summary";

interface RRPreviewResponse {
  file: { name: string; size: number; type: "xlsx" | "csv" };
  preview: RRNormalizedPreview;
  normalizedSpec: EventSpec;
  compiler?: { summary: { contractFields: number; coveredContractFields: number; destinationTabs: number; assignedCells: number; reviewItems: number } };
  operatorReview: OperatorReview;
}

export function RRDocumentImport({ onApply }: { onApply?: (spec: EventSpec) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RRPreviewResponse | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState("");

  const inspect = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    setError("");
    setResult(null);
    setSourceFile(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/rr-preview", { method: "POST", body: form });
      const body = (await response.json()) as RRPreviewResponse & { error?: string };
      if (!response.ok || !body.preview) throw new Error(body.error || "The RR document could not be read.");
      setResult(body);
      setSourceFile(file);
    } catch (inspectError) {
      setError(inspectError instanceof Error ? inspectError.message : "The RR document could not be read.");
    } finally {
      setLoading(false);
      if (input.current) input.current.value = "";
    }
  };

  const convert = async () => {
    if (!sourceFile) return;
    setConverting(true); setError("");
    try {
      const form = new FormData(); form.set("file", sourceFile);
      const response = await fetch("/api/rr-convert", { method: "POST", body: form });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error || "Legacy RR conversion failed."); }
      const blob = await response.blob(); const disposition = response.headers.get("content-disposition") ?? "";
      const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? "Converted_New_RR.xlsx";
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Legacy RR conversion failed."); }
    finally { setConverting(false); }
  };

  return (
    <section className="rr-import-card">
      <div className="rr-import-copy">
        <span className="eyebrow">Document intake</span>
        <h2>Start from an RR document</h2>
        <p>Upload the approved Excel workbook or CSV. Only build-related sheets are allowlisted; access/report personnel data is excluded from the extraction preview.</p>
      </div>
      <div
        className={`rr-dropzone ${dragging ? "dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void inspect(event.dataTransfer.files[0]); }}
      >
        <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void inspect(event.target.files?.[0])} />
        <span>▤</span><div><strong>{loading ? "Inspecting document…" : "Drop RR workbook or CSV"}</strong><small>Maximum 20 MB · no Cvent action occurs on upload</small></div>
        <button type="button" disabled={loading} onClick={() => input.current?.click()}>Choose file</button>
      </div>
      {error && <div className="rr-import-error" role="alert">{error}</div>}
      {result && (
        <div className="rr-preview" role="status">
          <header><div><strong>{result.file.name}</strong><small>{result.file.type.toUpperCase()} · {(result.file.size / 1024).toFixed(0)} KB</small></div><span>Preview ready</span></header>
          <div className="rr-preview-grid">
            <div><small>Event</small><strong>{result.preview.event.name ?? "Needs normalization"}</strong><span>{result.preview.event.location ?? "Location not found"}</span></div>
            <div><small>Registration types</small><strong>{result.normalizedSpec.registrationTypes.length}</strong><span>compiled EventSpec mappings</span></div>
            <div><small>Questions</small><strong>{result.normalizedSpec.questions.length}</strong><span>compiled EventSpec definitions</span></div>
            <div><small>Allowed sheets used</small><strong>{result.preview.recognizedSheets.length}</strong><span>{result.preview.ignoredSheets.length} sheets excluded</span></div>
          </div>
          {result.compiler && <p><b>Compiler coverage:</b> {result.compiler.summary.coveredContractFields} of {result.compiler.summary.contractFields} contract fields currently populated across {result.compiler.summary.destinationTabs} tabs ({result.compiler.summary.assignedCells} destination cells). {result.compiler.summary.reviewItems} item(s) require review.</p>}
          <OperatorReviewSummary review={result.operatorReview} />
          <p><b>Next gate:</b> apply recognized values to the EventSpec, review every field, then queue. The raw workbook can never execute directly.</p>
          <div className="rr-convert-actions">{onApply && <button className="primary-small rr-apply" type="button" disabled={!result.operatorReview.canProceed} title={result.operatorReview.canProceed ? undefined : "Resolve required missing or overflow issues before applying."} onClick={() => onApply(result.normalizedSpec)}>Apply recognized values to EventSpec</button>}<button className="secondary-button" type="button" disabled={!sourceFile || converting || result.file.type !== "xlsx"} onClick={() => void convert()}>{converting ? "Converting…" : "Download converted new RR workbook"}</button></div>
        </div>
      )}
    </section>
  );
}
