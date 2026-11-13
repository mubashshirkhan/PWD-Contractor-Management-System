import { NextRequest, NextResponse } from "next/server";
import { projectApiError, projectSessionId, readJsonBody, rejectCrossOriginWrite } from "@/lib/projects/http";
import { createProject, listProjects } from "@/lib/projects/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to view projects." }, { status: 401 });
  try {
    return NextResponse.json(await listProjects(sessionId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return projectApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const originError = rejectCrossOriginWrite(request);
  if (originError) return originError;
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to create projects." }, { status: 401 });
  try {
    return NextResponse.json(await createProject(sessionId, await readJsonBody(request)), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return projectApiError(error);
  }
}
