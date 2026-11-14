import { NextRequest, NextResponse } from "next/server";
import { projectSessionId, rejectCrossOriginWrite } from "@/lib/projects/http";
import { listProjects } from "@/lib/projects/service";
import { listBoqs } from "@/lib/boq/service";
import { createWorkOrder, listWorkOrders, nextWorkOrderNumber } from "@/lib/work-orders/service";
import { WORK_ORDER_STATUSES } from "@/lib/work-orders/model";
import { readWorkOrderBody, workOrderApiError } from "@/lib/work-orders/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const sessionId = projectSessionId(request); if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to view work orders." }, { status: 401 });
  try {
    const [data, projectData] = await Promise.all([listWorkOrders(sessionId), listProjects(sessionId)]);
    let boqs: { boqId: string; boqNumber: string; title: string; projectId: string }[] = []; let boqUnavailableReason: string | null = null;
    try { const result = await listBoqs(sessionId); if (result.initialized) boqs = result.boqs.map(({ boqId, boqNumber, title, projectId }) => ({ boqId, boqNumber, title, projectId })); else boqUnavailableReason = "The BOQ workbook has not been initialized."; }
    catch { boqUnavailableReason = "Saved BOQs are currently unavailable."; }
    return NextResponse.json({ ...data, nextWorkOrderNumber: nextWorkOrderNumber(data.workOrders), projects: projectData.projects.filter((project) => !project.isArchived).map(({ projectId, projectName }) => ({ projectId, projectName })), boqs, boqUnavailableReason, statuses: WORK_ORDER_STATUSES }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return workOrderApiError(error); }
}
export async function POST(request: NextRequest) {
  const originError = rejectCrossOriginWrite(request); if (originError) return originError;
  const sessionId = projectSessionId(request); if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to create work orders." }, { status: 401 });
  try { return NextResponse.json(await createWorkOrder(sessionId, await readWorkOrderBody(request)), { status: 201, headers: { "Cache-Control": "no-store" } }); } catch (error) { return workOrderApiError(error); }
}
