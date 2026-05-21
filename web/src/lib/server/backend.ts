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

  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers: {
        "content-type": request.headers.get("content-type") ?? "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body,
      cache: "no-store"
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Worker request failed",
        upstreamStatus: 502,
        upstreamPreview: error instanceof Error ? error.message : String(error ?? "Unknown worker proxy error")
      },
      { status: 502 }
    );
  }

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (!isJsonContentType(contentType)) {
    return NextResponse.json(
      {
        error: `Worker returned a non-JSON response${response.ok ? "" : ` with HTTP ${response.status}`}`,
        upstreamStatus: response.status,
        upstreamContentType: contentType || null,
        upstreamPreview: previewResponseText(text)
      },
      { status: response.ok ? 502 : response.status }
    );
  }

  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": contentType || "application/json"
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

function isJsonContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
}

function previewResponseText(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}
