"use client";

import { useRef, useState } from "react";
import type { EventSpec } from "../../src/spec/eventSpec";

type ImageRef = NonNullable<NonNullable<EventSpec["header"]>["logo"]>;

export function ImageRefField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: ImageRef;
  onChange(value: ImageRef | undefined): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"upload" | "sharepoint">(value?.source ?? "upload");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState(value?.source === "upload" ? value.assetId : "");

  const upload = async (file?: File) => {
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/assets", { method: "POST", body: form });
      const body = (await response.json()) as { asset?: { assetId: string; displayName: string }; error?: string };
      if (!response.ok || !body.asset) throw new Error(body.error || "The image could not be uploaded.");
      setDisplayName(body.asset.displayName);
      onChange({ source: "upload", assetId: body.asset.assetId, alt: value?.alt ?? "" });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The image could not be uploaded.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  const switchMode = (next: "upload" | "sharepoint") => {
    setMode(next);
    setError("");
    if (next === "sharepoint") {
      onChange({ source: "sharepoint", path: value?.source === "sharepoint" ? value.path : "", alt: value?.alt ?? "" });
    } else if (value?.source === "sharepoint") {
      onChange(undefined);
    }
  };

  return (
    <div className="asset-field">
      <div className="asset-field-head"><strong>{label}</strong>{value && <button type="button" onClick={() => { onChange(undefined); setDisplayName(""); }}>Remove</button>}</div>
      <div className="asset-tabs" role="tablist" aria-label={`${label} image source`}>
        <button type="button" role="tab" aria-selected={mode === "upload"} className={mode === "upload" ? "active" : ""} onClick={() => switchMode("upload")}>Upload</button>
        <button type="button" role="tab" aria-selected={mode === "sharepoint"} className={mode === "sharepoint" ? "active" : ""} onClick={() => switchMode("sharepoint")}>SharePoint</button>
      </div>

      {mode === "upload" ? (
        <div
          className={`asset-dropzone ${dragging ? "dragging" : ""} ${value?.source === "upload" ? "has-asset" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={(event) => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files[0]); }}
        >
          <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => void upload(event.target.files?.[0])} />
          <span className="asset-upload-icon">↥</span>
          <div>
            <strong>{uploading ? "Uploading…" : value?.source === "upload" ? displayName || "Image uploaded" : "Drop an image here"}</strong>
            <small>{value?.source === "upload" ? value.assetId : "PNG, JPEG, GIF, or WebP · 10 MB max"}</small>
          </div>
          <button type="button" disabled={uploading} onClick={() => input.current?.click()}>{value?.source === "upload" ? "Replace" : "Browse"}</button>
        </div>
      ) : (
        <label className="field sharepoint-field">
          <span>SharePoint file path or sharing URL</span>
          <input
            value={value?.source === "sharepoint" ? value.path : ""}
            placeholder="/Events/Brand Assets/header-banner.png"
            onChange={(event) => onChange({ source: "sharepoint", path: event.target.value, alt: value?.alt ?? "" })}
          />
          <small>Saved as an exact reference. Execution stays blocked until approved Microsoft Graph access is configured.</small>
        </label>
      )}

      {value && (
        <label className="field asset-alt-field">
          <span>Alternative text</span>
          <input
            value={value.alt}
            placeholder="Describe the image for screen readers"
            onChange={(event) => onChange({ ...value, alt: event.target.value } as ImageRef)}
          />
        </label>
      )}
      {error && <small className="inline-error" role="alert">{error}</small>}
    </div>
  );
}
