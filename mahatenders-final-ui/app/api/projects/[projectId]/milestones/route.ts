import { NextRequest, NextResponse } from "next/server";
import { projectApiError, projectSessionId, readJsonBody, rejectCrossOriginWrite } from "@/lib/projects/http";
import { addProjectMilestone } from "@/lib/projects/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  const originError = rejectCrossOriginWrite(request);
  if (originError) return originError;
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to add milestones." }, { status: 401 });
  try {
    const { projectId } = await params;
    const milestone = await addProjectMilestone(sessionId, projectId, await readJsonBody(request));
    return NextResponse.json(milestone, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return projectApiError(error);
  }
}
