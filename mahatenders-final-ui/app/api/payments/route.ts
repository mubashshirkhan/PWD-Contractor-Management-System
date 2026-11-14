import { NextRequest, NextResponse } from "next/server";
import { projectSessionId, rejectCrossOriginWrite } from "@/lib/projects/http";
import { listProjects } from "@/lib/projects/service";
import { createTransaction, getTransactionRegister } from "@/lib/payments/service";
import { PAYMENT_METHODS, TRANSACTION_TYPES } from "@/lib/payments/model";
import { paymentsApiError, readTransactionBody } from "@/lib/payments/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const sessionId = projectSessionId(request); if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to view transactions." }, { status: 401 });
  try {
    const [register, projectData] = await Promise.all([getTransactionRegister(sessionId), listProjects(sessionId)]);
    return NextResponse.json({ ...register, projects: projectData.projects.filter((project) => !project.isArchived).map(({ projectId, projectName }) => ({ projectId, projectName })), projectsAvailable: projectData.initialized, types: TRANSACTION_TYPES, paymentMethods: PAYMENT_METHODS }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return paymentsApiError(error); }
}
export async function POST(request: NextRequest) {
  const originError = rejectCrossOriginWrite(request); if (originError) return originError;
  const sessionId = projectSessionId(request); if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to add transactions." }, { status: 401 });
  try { return NextResponse.json(await createTransaction(sessionId, await readTransactionBody(request)), { status: 201, headers: { "Cache-Control": "no-store" } }); } catch (error) { return paymentsApiError(error); }
}
