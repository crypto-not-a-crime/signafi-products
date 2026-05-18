import type { NextRequest } from "next/server";
import { mockPppPricingFromRequest, proxyToWorker, readJson } from "@/lib/server/backend";

export async function POST(request: NextRequest) {
  const clone = request.clone();
  const body = await readJson(clone);
  const fallback = mockPppPricingFromRequest(body);
  return proxyToWorker(request, "/api/admin/ppp-audit", () => ({
    ...fallback,
    calculation: fallback.bestCandidate
  }));
}
