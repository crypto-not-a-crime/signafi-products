import type { NextRequest } from "next/server";
import { mockPricingFromRequest, proxyToWorker, readJson } from "@/lib/server/backend";

export async function POST(request: NextRequest) {
  const clone = request.clone();
  const body = await readJson(clone);
  return proxyToWorker(request, "/api/products/dcn/sell-put/price", () => mockPricingFromRequest(body));
}
