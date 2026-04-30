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
          bid_price: mockDcnCandidate().depth.bestBidPrice,
          bid_amount: mockDcnCandidate().depth.bestBidAmount,
          underlying_price: mockDcnCandidate().spotPrice,
          ingested_at: Date.now()
        }
      ]
    })
  );
}
