import { NextResponse } from "next/server";
import { captureGoldenLogin, goldenStatus, resetLoginMaintenance, startLoginMaintenance } from "../../../lib/steel-auth";
import { assertSameOrigin } from "../../../lib/request-security";
import { requireRole } from "../../../lib/require-role";

export const dynamic = "force-dynamic";

export async function GET() { return NextResponse.json(await goldenStatus()); }

export async function POST(request: Request) {
  const denied = await requireRole("Operator");
  if (denied) return denied;
  try {
    assertSameOrigin(request);
    const body = await request.json() as { action?: string };
    if (body.action === "start") return NextResponse.json({ maintenance: await startLoginMaintenance() }, { status: 201 });
    if (body.action === "restart") { await resetLoginMaintenance(); return NextResponse.json({ maintenance: await startLoginMaintenance() }, { status: 201 }); }
    if (body.action === "capture") {
      await captureGoldenLogin();
      return NextResponse.json({ status: "ready", purpose: "default-seed-for-new-document-scopes" });
    }
    return NextResponse.json({ error: "action must be start, restart, or capture" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
