import { NextRequest, NextResponse } from "next/server";
import { projectSessionId } from "@/lib/projects/http";
import { boqApiError } from "@/lib/boq/http";
import { exportBoq } from "@/lib/boq/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ boqId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to export BOQs." }, { status: 401 });
  try {
    const { boqId } = await params;
    const result = await exportBoq(sessionId, boqId);
    if (!result) return NextResponse.json({ error: "BOQ was not found." }, { status: 404 });
    return new NextResponse(new Uint8Array(result.contents), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return boqApiError(error);
  }
}
