import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { proxyToWorker } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  return proxyToWorker(request, "/api/admin/market-health", () =>
    NextResponse.json({
      mock: true,
      activeInstrumentCount: 128,
      quoteCount: 128,
      staleQuoteCount: 0,
      latestQuoteAt: Date.now() - 3000,
      streamStatus: { connected: false, memoryQuoteCount: 0 },
      d1FreeTierGuard: {
        quotePersistence: "mock",
        depthStorage: "mock",
        rowsWrittenDailyLimit: 100000
      }
    })
  );
}
