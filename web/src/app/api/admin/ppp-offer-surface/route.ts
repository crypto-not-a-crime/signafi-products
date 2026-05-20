import type { NextRequest } from "next/server";
import { mockPppOfferSurfaceFromRequest, proxyToWorker, readJson } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  const clone = request.clone();
  const body = await readJson(clone);
  return proxyToWorker(request, "/api/admin/ppp-offer-surface", () => mockPppOfferSurfaceFromRequest(body));
}
