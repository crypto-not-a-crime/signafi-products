import type { NextRequest } from "next/server";
import { mockYieldSurface } from "@/lib/mock-data";
import { proxyToWorker } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";
import { fetchLiveDeribitYieldSurface } from "@/lib/server/yield-surface";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  const optionType = request.nextUrl.searchParams.get("type") === "call" ? "call" : "put";
  if (!process.env.WORKER_API_BASE_URL) {
    try {
      return Response.json(await fetchLiveDeribitYieldSurface(request));
    } catch (error) {
      return Response.json({
        ...mockYieldSurface(optionType),
        source: "mock",
        fallbackReason: error instanceof Error ? error.message : "Live Deribit fetch failed"
      });
    }
  }
  return proxyToWorker(request, "/api/admin/yield-surface", () => mockYieldSurface(optionType));
}
