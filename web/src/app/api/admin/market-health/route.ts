import type { NextRequest } from "next/server";
import { proxyToWorker } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  return proxyToWorker(request, "/api/admin/market-health", () => ({
    mock: true,
    activeInstrumentCount: 128,
    quoteCount: 128,
    latestQuoteAt: Date.now() - 3000,
    latestSyncAt: Date.now() - 3000,
    catalogSyncAgeSeconds: 3,
    summaryFreshnessSeconds: 180,
    summaryStaleCount: 0,
    liveFreshnessSeconds: 10,
    liveTickerFreshCount: 128,
    staleQuoteCount: 0,
    streamStatus: { connected: false, memoryQuoteCount: 0 },
    d1FreeTierGuard: {
      quotePersistence: "mock",
      depthStorage: "mock",
      rowsWrittenDailyLimit: 100000
    }
  }));
}
