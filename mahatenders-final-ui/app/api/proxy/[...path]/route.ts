import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_API_BASE_URL } from "@/lib/api";

export const dynamic = "force-dynamic";

async function forward(request: NextRequest, path: string[]) {
  const upstreamBase = (process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  const upstreamUrl = `${upstreamBase}/${path.join("/")}${request.nextUrl.search}`;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("accept", "application/json");
  const init: RequestInit = { method: request.method, headers, cache: "no-store" };
  if (!["GET", "HEAD"].includes(request.method)) init.body = await request.arrayBuffer();
  const response = await fetch(upstreamUrl, init);
  const body = await response.arrayBuffer();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await context.params).path);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await context.params).path);
}
