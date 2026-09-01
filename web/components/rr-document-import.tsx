"use client";

import { useRef, useState } from "react";
import type { RRNormalizedPreview } from "../lib/rr-normalize";

interface RRPreviewResponse {
  file: { name: string; size: number; type: "xlsx" | "csv" };
  preview: {
    event: {
      name: string | null;
      location: string | null;
      timezoneSource: string | null;
      expoDatesSource: string | null;
      conferenceDatesSource: string | null;
      themeSource: string | null;
    };
    registrationTypes: Array<{ key: string; name: string; code: string }>;
    questions: Array<{ key: string; text: string; answerType: string }>;
    recognizedSheets: string[];
    ignoredSheets: string[];
    warnings: string[];
  };
}

export function RRDocumentImport({ onApply }: { onApply?: (preview: RRNormalizedPreview) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RRPreviewResponse | null>(null);
  const [error, setError] = useState("");

  const inspect = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/rr-preview", { method: "POST", body: form });
      const body = (await response.json()) as RRPreviewResponse & { error?: string };
      if (!response.ok || !body.preview) throw new Error(body.error || "The RR document could not be read.");
      setResult(body);
    } catch (inspectError) {
      setError(inspectError instanceof Error ? inspectError.message : "The RR document could not be read.");
    } finally {
      setLoading(false);
      if (input.current) input.current.value = "";
    }
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
            <div><small>Registration types</small><strong>{result.preview.registrationTypes.length}</strong><span>recognized mappings</span></div>
            <div><small>Questions</small><strong>{result.preview.questions.length}</strong><span>recognized definitions</span></div>
            <div><small>Allowed sheets used</small><strong>{result.preview.recognizedSheets.length}</strong><span>{result.preview.ignoredSheets.length} sheets excluded</span></div>
          </div>
          <p><b>Next gate:</b> apply recognized values to the EventSpec, review every field, then queue. The raw workbook can never execute directly.</p>
          {onApply && <button className="primary-small rr-apply" type="button" onClick={() => onApply(result.preview)}>Apply recognized values to EventSpec</button>}
        </div>
      )}
    </section>
  );
}
