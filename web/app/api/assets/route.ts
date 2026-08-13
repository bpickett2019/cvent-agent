import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { AssetStore } from "../../../../src/assets/store";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_REQUEST_BYTES + 1_000_000) {
      return NextResponse.json({ error: "Image exceeds the 10 MB limit." }, { status: 413 });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
    }
    if (file.size > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Image exceeds the 10 MB limit." }, { status: 413 });
    }
    const metadata = await new AssetStore(assetRoot()).saveImage({
      bytes: new Uint8Array(await file.arrayBuffer()),
      mediaType: file.type,
      originalName: file.name,
    });
    return NextResponse.json({ asset: metadata }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The image could not be uploaded." },
      { status: 400 }
    );
  }
}

function assetRoot(): string {
  const projectRoot = resolve(process.cwd(), "..");
  return resolve(/*turbopackIgnore: true*/ projectRoot, process.env.EMERALDX_ASSET_DIR ?? ".assets");
}
