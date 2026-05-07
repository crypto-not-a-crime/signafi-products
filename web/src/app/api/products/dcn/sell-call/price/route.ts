import type { NextRequest } from "next/server";
import { mockPricingFromRequest, proxyToWorker, readJson } from "@/lib/server/backend";

export async function POST(request: NextRequest) {
  const clone = request.clone();
  const body = await readJson(clone);
  const input = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
  return proxyToWorker(request, "/api/products/dcn/sell-call/price", () =>
    mockPricingFromRequest({ ...input, productType: "sell_call" })
  );
}
