import type { NextRequest } from "next/server";
import { mockDcnCallCandidate, mockDcnCandidate } from "@/lib/mock-data";
import { proxyToWorker } from "@/lib/server/backend";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const candidate = type === "call" ? mockDcnCallCandidate() : mockDcnCandidate();
  const optionType = type === "call" ? "call" : "put";
  const mockExpiry = Date.UTC(2026, 6, 31, 8, 0);
  if (url.searchParams.get("summary") === "expiries") {
    return proxyToWorker(request, "/api/market/options", () => ({
      mock: true,
      expiries: [
        {
          option_type: "put",
          expiration_timestamp: mockExpiry,
          instrument_count: 2
        },
        {
          option_type: "call",
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
        option_type: optionType,
        strike: candidate.strike,
        expiration_timestamp: mockExpiry,
        bid_price: candidate.depth.bestBidPrice,
        bid_amount: candidate.depth.bestBidAmount,
        ask_price: null,
        ask_amount: null,
        mark_price: candidate.effectiveOptionBidPrice ?? candidate.effectivePutBidPrice,
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
