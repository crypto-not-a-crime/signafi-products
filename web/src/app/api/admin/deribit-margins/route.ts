import type { NextRequest } from "next/server";
import { mockDcnCallCandidate, mockDcnCandidate } from "@/lib/mock-data";
import { proxyToWorker, readJson } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  const body = (await readJson(request.clone())) as { instrumentName?: string };
  const candidate = body.instrumentName?.endsWith("-C") ? mockDcnCallCandidate() : mockDcnCandidate();
  return proxyToWorker(request, "/api/admin/deribit-margins", () => ({
    mock: true,
    instrumentName: candidate.instrumentName,
    amount: candidate.requiredContracts,
    price: candidate.effectiveOptionBidPrice ?? candidate.effectivePutBidPrice,
    result: {
      buy: 0.01142,
      sell: 0.18693,
      min_price: 0.0001,
      max_price: 0.2500
    }
  }));
}
