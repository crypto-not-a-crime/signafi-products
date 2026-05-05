import type { NextRequest } from "next/server";
import { mockDcnCandidate } from "@/lib/mock-data";
import { proxyToWorker } from "@/lib/server/backend";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const candidate = mockDcnCandidate();
  const mockExpiry = Date.UTC(2026, 6, 31, 8, 0);
  if (url.searchParams.get("summary") === "expiries") {
    return proxyToWorker(request, "/api/market/options", () => ({
      mock: true,
      expiries: [
        {
          option_type: "put",
          expiration_timestamp: mockExpiry,
          instrument_count: 2
        }
      ]
    }));
  }

  return proxyToWorker(request, "/api/market/options", () => ({
    mock: true,
    options: [
      {
        instrument_name: candidate.instrumentName,
        option_type: "put",
        strike: candidate.strike,
        expiration_timestamp: mockExpiry,
        bid_price: candidate.depth.bestBidPrice,
        bid_amount: candidate.depth.bestBidAmount,
        ask_price: null,
        ask_amount: null,
        mark_price: candidate.effectivePutBidPrice,
        last_price: null,
        mark_iv: null,
        open_interest: null,
        underlying_price: candidate.spotPrice,
        deribit_timestamp: Date.now(),
        ingested_at: Date.now()
      }
    ]
  }));
}
