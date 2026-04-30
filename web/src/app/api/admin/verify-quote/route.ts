import type { NextRequest } from "next/server";
import { mockDcnCandidate } from "@/lib/mock-data";
import { proxyToWorker } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  const candidate = mockDcnCandidate();
  return proxyToWorker(request, "/api/admin/verify-quote", () => ({
    mock: true,
    instrumentName: candidate.instrumentName,
    stored: {
      bid_price: candidate.depth.bestBidPrice,
      bid_amount: candidate.depth.bestBidAmount,
      ingested_at: Date.now() - 3000
    },
    memory: null,
    live: {
      ticker: { best_bid_price: candidate.depth.bestBidPrice },
      book: { bids: candidate.depth.fills.map((fill) => [fill.price, fill.amount]) }
    },
    checks: {
      storedExists: true,
      liveExists: true,
      storedFresh: true,
      bidDriftUnder10Bps: true,
      depthAvailable: true
    },
    drift: {
      storedBid: candidate.depth.bestBidPrice,
      liveBid: candidate.depth.bestBidPrice,
      bidDriftPct: 0
    }
  }));
}
