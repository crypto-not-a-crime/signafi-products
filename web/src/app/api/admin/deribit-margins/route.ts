import type { NextRequest } from "next/server";
import { mockDcnCandidate } from "@/lib/mock-data";
import { proxyToWorker } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  const candidate = mockDcnCandidate();
  return proxyToWorker(request, "/api/admin/deribit-margins", () => ({
    mock: true,
    instrumentName: candidate.instrumentName,
    amount: candidate.requiredContracts,
    price: candidate.effectivePutBidPrice,
    result: {
      buy: 0.01142,
      sell: 0.18693,
      min_price: 0.0001,
      max_price: 0.2500
    }
  }));
}
