import { NextRequest, NextResponse } from "next/server";
import { projectSessionId, rejectCrossOriginWrite } from "@/lib/projects/http";
import { initializeWorkOrders } from "@/lib/work-orders/service";
import { workOrderApiError } from "@/lib/work-orders/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) { const originError = rejectCrossOriginWrite(request); if (originError) return originError; const sessionId = projectSessionId(request); if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to initialize Work Orders." }, { status: 401 }); try { return NextResponse.json(await initializeWorkOrders(sessionId), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return workOrderApiError(error); } }
