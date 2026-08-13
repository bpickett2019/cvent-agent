import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { z } from "zod";
import type { EventSpec } from "../spec/eventSpec";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const AssetMetadata = z
  .object({
    version: z.literal(1),
    assetId: z.string().regex(/^img_[0-9a-f]{24}$/),
    mediaType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
    extension: z.enum(["png", "jpg", "gif", "webp"]),
    displayName: z.string().min(1).max(255),
    size: z.number().int().positive().max(MAX_IMAGE_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: z.string().datetime(),
  })
  .strict();

export type AssetMetadata = z.infer<typeof AssetMetadata>;

export class AssetStore {
  constructor(private readonly root: string) {}

  async saveImage(input: {
    bytes: Uint8Array;
    mediaType?: string;
    originalName: string;
  }): Promise<AssetMetadata> {
    if (input.bytes.byteLength === 0) throw new Error("image file is empty");
    if (input.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("image exceeds the 10 MB limit");
    const detected = detectImage(input.bytes);
    if (!detected) throw new Error("file is not a supported PNG, JPEG, GIF, or WebP image");
    if (input.mediaType && input.mediaType !== "application/octet-stream" && input.mediaType !== detected.mediaType) {
      throw new Error(`file content is ${detected.mediaType}, not declared type ${input.mediaType}`);
    }

    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const assetId = `img_${sha256.slice(0, 24)}`;
    const metadata: AssetMetadata = {
      version: 1,
      assetId,
      mediaType: detected.mediaType,
      extension: detected.extension,
      displayName: safeDisplayName(input.originalName),
      size: input.bytes.byteLength,
      sha256,
      createdAt: new Date().toISOString(),
    };

    await mkdir(resolve(this.root), { recursive: true });
    const existing = await this.metadata(assetId).catch(() => null);
    if (existing) {
      if (existing.sha256 !== sha256) throw new Error(`asset id collision for ${assetId}`);
      return existing;
    }

    await atomicWrite(this.assetPath(metadata), input.bytes);
    await atomicWrite(this.metadataPath(assetId), Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`));
    return metadata;
  }

  async metadata(assetId: string): Promise<AssetMetadata> {
    assertAssetId(assetId);
    let source: string;
    try {
      source = await readFile(this.metadataPath(assetId), "utf8");
    } catch (error) {
      throw new Error(`uploaded image ${assetId} was not found: ${message(error)}`);
    }
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new Error(`uploaded image metadata for ${assetId} is invalid JSON: ${message(error)}`);
    }
    const parsed = AssetMetadata.safeParse(value);
    if (!parsed.success || parsed.data.assetId !== assetId) {
      throw new Error(`uploaded image metadata for ${assetId} is invalid`);
    }
    return parsed.data;
  }

  async resolve(assetId: string): Promise<string> {
    const metadata = await this.metadata(assetId);
    const path = this.assetPath(metadata);
    await readFile(path);
    return path;
  }

  async resolveSpec(spec: EventSpec): Promise<Record<string, string>> {
    const ids = uploadedAssetIds(spec);
    const resolved = await Promise.all(ids.map(async (assetId) => [assetId, await this.resolve(assetId)] as const));
    return Object.fromEntries(resolved);
  }

  private metadataPath(assetId: string): string {
    assertAssetId(assetId);
    return resolve(this.root, `${assetId}.json`);
  }

  private assetPath(metadata: AssetMetadata): string {
    return resolve(this.root, `${metadata.assetId}.${metadata.extension}`);
  }
}

export function uploadedAssetIds(spec: EventSpec): string[] {
  const ids = new Set<string>();
  const add = (ref: { source: "upload"; assetId: string } | { source: "sharepoint"; path: string } | undefined) => {
    if (ref?.source === "upload") ids.add(ref.assetId);
  };
  add(spec.header?.logo);
  add(spec.header?.bannerImage);
  for (const page of spec.pages ?? []) {
    for (const widget of page.widgets) if (widget.type === "image") add(widget.image);
  }
  return [...ids].sort();
}

export function sharePointAssetPaths(spec: EventSpec): string[] {
  const paths = new Set<string>();
  const add = (ref: { source: "upload"; assetId: string } | { source: "sharepoint"; path: string } | undefined) => {
    if (ref?.source === "sharepoint") paths.add(ref.path);
  };
  add(spec.header?.logo);
  add(spec.header?.bannerImage);
  for (const page of spec.pages ?? []) {
    for (const widget of page.widgets) if (widget.type === "image") add(widget.image);
  }
  return [...paths].sort();
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, path);
}

function assertAssetId(assetId: string): void {
  if (!/^img_[0-9a-f]{24}$/.test(assetId)) throw new Error(`invalid uploaded image id "${assetId}"`);
}

function safeDisplayName(name: string): string {
  const safe = basename(name).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  return safe || "uploaded-image";
}

function detectImage(bytes: Uint8Array): Pick<AssetMetadata, "mediaType" | "extension"> | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mediaType: "image/png", extension: "png" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mediaType: "image/jpeg", extension: "jpg" };
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return { mediaType: "image/gif", extension: "gif" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { mediaType: "image/webp", extension: "webp" };
  }
  return null;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
