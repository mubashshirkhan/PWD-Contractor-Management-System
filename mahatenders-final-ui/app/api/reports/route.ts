import { NextRequest, NextResponse } from "next/server";
import { projectSessionId } from "@/lib/projects/http";
import { getReportData } from "@/lib/reports/service";
export const runtime = "nodejs";
export async function GET(request: NextRequest) { const sessionId = projectSessionId(request); if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to view reports." }, { status: 401 }); try { return NextResponse.json(await getReportData(sessionId), { headers: { "Cache-Control": "no-store" } }); } catch { return NextResponse.json({ error: "Saved OneDrive report sources could not be read." }, { status: 502 }); } }
