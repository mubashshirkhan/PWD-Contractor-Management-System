import { NextRequest, NextResponse } from "next/server";
import { projectApiError, projectSessionId, rejectCrossOriginWrite } from "@/lib/projects/http";
import { initializeProjectWorkbook } from "@/lib/projects/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originError = rejectCrossOriginWrite(request);
  if (originError) return originError;
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to initialize Project Tracking." }, { status: 401 });
  try {
    const result = await initializeProjectWorkbook(sessionId);
    return NextResponse.json({ status: "ready", workbook: "ProjectTracking.xlsx", ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return projectApiError(error);
  }
}
