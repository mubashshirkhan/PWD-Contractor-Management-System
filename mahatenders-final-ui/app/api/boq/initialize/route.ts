import { NextRequest, NextResponse } from "next/server";
import { projectSessionId, rejectCrossOriginWrite } from "@/lib/projects/http";
import { boqApiError } from "@/lib/boq/http";
import { initializeBoqWorkbook } from "@/lib/boq/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originError = rejectCrossOriginWrite(request);
  if (originError) return originError;
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to set up BOQ storage." }, { status: 401 });
  try {
    return NextResponse.json(await initializeBoqWorkbook(sessionId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return boqApiError(error);
  }
}
