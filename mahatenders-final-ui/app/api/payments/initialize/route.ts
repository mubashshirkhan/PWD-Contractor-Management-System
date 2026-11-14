import { NextRequest, NextResponse } from "next/server";
import { projectSessionId, rejectCrossOriginWrite } from "@/lib/projects/http";
import { initializePaymentsWorkbook } from "@/lib/payments/service";
import { paymentsApiError } from "@/lib/payments/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) { const originError = rejectCrossOriginWrite(request); if (originError) return originError; const sessionId = projectSessionId(request); if (!sessionId) return NextResponse.json({ error: "Connect OneDrive to initialize Payments & Expenses." }, { status: 401 }); try { return NextResponse.json(await initializePaymentsWorkbook(sessionId), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return paymentsApiError(error); } }
