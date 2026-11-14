import { NextRequest, NextResponse } from "next/server";
import { projectSessionId, rejectCrossOriginWrite } from "@/lib/projects/http";
import { boqApiError } from "@/lib/boq/http";
import { duplicateBoq } from "@/lib/boq/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ boqId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  const originError = rejectCrossOriginWrite(request);
  if (originError) return originError;
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to duplicate BOQs." }, { status: 401 });
  try {
    const { boqId } = await params;
    const record = await duplicateBoq(sessionId, boqId);
    return record ? NextResponse.json(record, { status: 201 }) : NextResponse.json({ error: "BOQ was not found." }, { status: 404 });
  } catch (error) {
    return boqApiError(error);
  }
}
