import { NextRequest, NextResponse } from "next/server";
import { projectApiError, projectSessionId, readJsonBody, rejectCrossOriginWrite } from "@/lib/projects/http";
import { updateProjectMilestone } from "@/lib/projects/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string; milestoneId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  const originError = rejectCrossOriginWrite(request);
  if (originError) return originError;
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to update milestones." }, { status: 401 });
  try {
    const { projectId, milestoneId } = await params;
    const milestone = await updateProjectMilestone(sessionId, projectId, milestoneId, await readJsonBody(request));
    return milestone ? NextResponse.json(milestone, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Milestone not found." }, { status: 404 });
  } catch (error) {
    return projectApiError(error);
  }
}
