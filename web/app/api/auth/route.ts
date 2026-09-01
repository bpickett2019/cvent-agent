import { NextResponse } from "next/server";
import { captureGoldenLogin, goldenStatus, startLoginMaintenance } from "../../../lib/steel-auth";

export const dynamic = "force-dynamic";

export async function GET() { return NextResponse.json(await goldenStatus()); }

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string };
    if (body.action === "start") return NextResponse.json({ maintenance: await startLoginMaintenance() }, { status: 201 });
    if (body.action === "capture") { await captureGoldenLogin(); return NextResponse.json({ status: "ready" }); }
    return NextResponse.json({ error: "action must be start or capture" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
