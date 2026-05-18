import type { NextRequest } from "next/server";
import { mockPppPricingFromRequest, proxyToWorker, readJson } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  const clone = request.clone();
  const body = await readJson(clone);
  const fallback = mockPppPricingFromRequest(body);
  return proxyToWorker(request, "/api/admin/ppp-audit", () => ({
    ...fallback,
    calculation: fallback.bestCandidate
  }));
}
