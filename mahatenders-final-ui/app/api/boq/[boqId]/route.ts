import { NextRequest, NextResponse } from "next/server";
import { projectSessionId, rejectCrossOriginWrite } from "@/lib/projects/http";
import { boqApiError, readBoqRequestBody } from "@/lib/boq/http";
import { deleteBoq, listBoqs, updateBoq } from "@/lib/boq/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ boqId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to view BOQs." }, { status: 401 });
  try {
    const { boqId } = await params;
    const result = await listBoqs(sessionId);
    const boq = result.boqs.find((record) => record.boqId === boqId);
    return boq ? NextResponse.json(boq, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "BOQ was not found." }, { status: 404 });
  } catch (error) {
    return boqApiError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const originError = rejectCrossOriginWrite(request);
  if (originError) return originError;
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to update BOQs." }, { status: 401 });
  try {
    const { boqId } = await params;
    const record = await updateBoq(sessionId, boqId, await readBoqRequestBody(request));
    return record ? NextResponse.json(record, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "BOQ was not found." }, { status: 404 });
  } catch (error) {
    return boqApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const originError = rejectCrossOriginWrite(request);
  if (originError) return originError;
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to delete BOQs." }, { status: 401 });
  try {
    const { boqId } = await params;
    const deleted = await deleteBoq(sessionId, boqId);
    return deleted ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: "BOQ was not found." }, { status: 404 });
  } catch (error) {
    return boqApiError(error);
  }
}
