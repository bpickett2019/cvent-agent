/** Uploaded image asset checks. No browser, model, or network. */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssetStore, sharePointAssetPaths, uploadedAssetIds } from "./src/assets/store";
import { EventSpec } from "./src/spec/eventSpec";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const root = await mkdtemp(join(tmpdir(), "emeraldx-assets-"));
const store = new AssetStore(root);
// Signature is enough for the store's content-type gate; browser decoding is not part of this unit.
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

try {
  console.log("\n[1] Validated storage");
  const saved = await store.saveImage({ bytes: png, mediaType: "image/png", originalName: "../brand-logo.png" });
  check("content-addressed id returned", /^img_[0-9a-f]{24}$/.test(saved.assetId));
  check("unsafe client path is removed", saved.displayName === "brand-logo.png");
  const resolved = await store.resolve(saved.assetId);
  check("asset resolves to private local file", (await stat(resolved)).isFile());
  const duplicate = await store.saveImage({ bytes: png, mediaType: "image/png", originalName: "other.png" });
  check("identical content deduplicates", duplicate.assetId === saved.assetId);

  console.log("\n[2] Content validation");
  let fakeRejected = false;
  try {
    await store.saveImage({ bytes: Buffer.from("not an image"), mediaType: "image/png", originalName: "fake.png" });
  } catch {
    fakeRejected = true;
  }
  check("fake image is rejected", fakeRejected);
  let mismatchRejected = false;
  try {
    await store.saveImage({ bytes: png, mediaType: "image/jpeg", originalName: "wrong.jpg" });
  } catch {
    mismatchRejected = true;
  }
  check("MIME mismatch is rejected", mismatchRejected);

  console.log("\n[3] EventSpec asset collection");
  const spec = EventSpec.parse({
    specVersion: "1.0",
    details: {
      name: "Asset test",
      timezone: "America/New_York",
      start: "2027-01-01T10:00:00-05:00",
      end: "2027-01-01T11:00:00-05:00",
      format: "inPerson",
    },
    header: {
      logo: { source: "upload", assetId: saved.assetId, alt: "Logo" },
      bannerImage: { source: "sharepoint", path: "/Events/banner.png", alt: "Banner" },
    },
    registration: {},
  });
  check("uploaded refs are collected", uploadedAssetIds(spec)[0] === saved.assetId);
  check("SharePoint refs remain isolated", sharePointAssetPaths(spec)[0] === "/Events/banner.png");
  check("trusted resolver maps id to path", (await store.resolveSpec(spec))[saved.assetId] === resolved);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? `ALL ASSET CHECKS PASSED (${checks} checks)` : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
