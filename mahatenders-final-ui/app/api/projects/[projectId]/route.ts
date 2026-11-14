import { NextRequest, NextResponse } from "next/server";
import { projectApiError, projectSessionId, readJsonBody, rejectCrossOriginWrite } from "@/lib/projects/http";
import { archiveProject, deleteProject, getProject, updateProject } from "@/lib/projects/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to view projects." }, { status: 401 });
  try {
    const { projectId } = await params;
    const project = await getProject(sessionId, projectId);
    return project ? NextResponse.json(project, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Project not found." }, { status: 404 });
  } catch (error) {
    return projectApiError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const originError = rejectCrossOriginWrite(request);
  if (originError) return originError;
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to update projects." }, { status: 401 });
  try {
    const { projectId } = await params;
    const body = await readJsonBody(request);
    if (body && typeof body === "object" && !Array.isArray(body) && (body as Record<string, unknown>).action === "archive") {
      const archived = await archiveProject(sessionId, projectId);
      return archived ? NextResponse.json(archived, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    const project = await updateProject(sessionId, projectId, body);
    return project ? NextResponse.json(project, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Project not found." }, { status: 404 });
  } catch (error) {
    return projectApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const originError = rejectCrossOriginWrite(request);
  if (originError) return originError;
  const sessionId = projectSessionId(request);
  if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to delete projects." }, { status: 401 });
  try {
    const { projectId } = await params;
    const deleted = await deleteProject(sessionId, projectId);
    return deleted ? NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Project not found." }, { status: 404 });
  } catch (error) {
    return projectApiError(error);
  }
}
