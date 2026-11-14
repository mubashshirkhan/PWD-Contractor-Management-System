import { NextRequest, NextResponse } from "next/server";
import { projectSessionId, rejectCrossOriginWrite } from "@/lib/projects/http";
import { boqApiError } from "@/lib/boq/http";
import { reopenBoq } from "@/lib/boq/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ boqId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  const originError = rejectCrossOriginWrite(request);
  if (originError) return originError;
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to reopen BOQs." }, { status: 401 });
  try {
    const { boqId } = await params;
    const record = await reopenBoq(sessionId, boqId);
    return record ? NextResponse.json(record, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "BOQ was not found." }, { status: 404 });
  } catch (error) {
    return boqApiError(error);
  }
}
