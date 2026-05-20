import { NextResponse, type NextRequest } from "next/server";
import { mockPppOfferSurfaceResponse, mockPppPricingResponse, mockPricingResponse } from "@/lib/mock-data";

export async function proxyToWorker(request: NextRequest, workerPath: string, fallback?: () => unknown) {
  const baseUrl = process.env.WORKER_API_BASE_URL;
  const token = process.env.BACKEND_API_TOKEN;
  const body = request.method === "GET" ? undefined : await request.text();

  if (!baseUrl) {
    if (fallback) return NextResponse.json(fallback());
    return NextResponse.json({ mock: true, message: "WORKER_API_BASE_URL is not configured." });
  }

  const incomingUrl = new URL(request.url);
  const target = new URL(workerPath, baseUrl);
  target.search = incomingUrl.search;

  const response = await fetch(target, {
    method: request.method,
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body,
    cache: "no-store"
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json"
    }
  });
}

export function mockPricingFromRequest(body: unknown) {
  return mockPricingResponse(typeof body === "object" && body ? (body as Record<string, unknown>) : {});
}

export function mockPppPricingFromRequest(body: unknown) {
  return mockPppPricingResponse(typeof body === "object" && body ? (body as Record<string, unknown>) : {});
}

export function mockPppOfferSurfaceFromRequest(body: unknown) {
  return mockPppOfferSurfaceResponse(typeof body === "object" && body ? (body as Record<string, unknown>) : {});
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
