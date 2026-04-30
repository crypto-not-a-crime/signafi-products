import type { NextRequest } from "next/server";
import { mockDcnCandidate } from "@/lib/mock-data";
import { proxyToWorker } from "@/lib/server/backend";

export async function GET(request: NextRequest) {
  return proxyToWorker(request, "/api/market/options", () =>
    ({
      mock: true,
      options: [
        {
          instrument_name: mockDcnCandidate().instrumentName,
          option_type: "put",
          strike: mockDcnCandidate().strike,
          expiration_timestamp: Date.now() + 92 * 24 * 60 * 60 * 1000,
          bid_price: mockDcnCandidate().depth.bestBidPrice,
          bid_amount: mockDcnCandidate().depth.bestBidAmount,
          ask_price: null,
          ask_amount: null,
          mark_price: mockDcnCandidate().effectivePutBidPrice,
          last_price: null,
          mark_iv: null,
          open_interest: null,
          underlying_price: mockDcnCandidate().spotPrice,
          deribit_timestamp: Date.now(),
          ingested_at: Date.now()
        }
      ]
    })
  );
}
