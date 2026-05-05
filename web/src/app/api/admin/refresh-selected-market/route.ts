import type { NextRequest } from "next/server";
import { mockDcnCandidate } from "@/lib/mock-data";
import { proxyToWorker } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  const candidate = mockDcnCandidate();
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
