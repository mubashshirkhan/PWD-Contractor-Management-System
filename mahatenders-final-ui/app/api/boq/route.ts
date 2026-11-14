import { NextRequest, NextResponse } from "next/server";
import { projectSessionId, rejectCrossOriginWrite } from "@/lib/projects/http";
import { listProjects } from "@/lib/projects/service";
import { boqApiError, readBoqRequestBody } from "@/lib/boq/http";
import { createBoq, listBoqs } from "@/lib/boq/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to view BOQs." }, { status: 401 });
  try {
    const [boqData, projectData] = await Promise.all([listBoqs(sessionId), listProjects(sessionId)]);
    return NextResponse.json({ ...boqData, projects: projectData.projects.filter((project) => !project.isArchived).map(({ projectId, projectName }) => ({ projectId, projectName })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return boqApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const originError = rejectCrossOriginWrite(request);
  if (originError) return originError;
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to create BOQs." }, { status: 401 });
  try {
    return NextResponse.json(await createBoq(sessionId, await readBoqRequestBody(request)), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return boqApiError(error);
  }
}
