import type { NextRequest } from "next/server";
import { mockDcnCallCandidate, mockDcnCandidate } from "@/lib/mock-data";
import { proxyToWorker, readJson } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  const body = (await readJson(request.clone())) as { productType?: string };
  const candidate = body.productType === "sell_call" ? mockDcnCallCandidate() : mockDcnCandidate();
  return proxyToWorker(request, "/api/admin/refresh-selected-market", () => ({
    mock: true,
    auditId: 1,
    snapshotId: 1,
    calculation: candidate,
    refreshed: {
      instrumentName: candidate.instrumentName,
      instrumentTickerTimestamp: Date.now(),
      instrumentIngestedAt: Date.now(),
      spotInstrumentName: "BTC_USDC",
      spotTickerTimestamp: Date.now(),
      spotPrice: candidate.spotPrice,
      orderBookTimestamp: Date.now(),
      orderBookDepth: 100
    }
  }));
}
