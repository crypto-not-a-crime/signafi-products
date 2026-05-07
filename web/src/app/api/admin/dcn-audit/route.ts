import type { NextRequest } from "next/server";
import { mockDcnCallCandidate, mockDcnCandidate } from "@/lib/mock-data";
import { proxyToWorker, readJson } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  const clone = request.clone();
  const body = (await readJson(clone)) as { productType?: string };
  return proxyToWorker(request, "/api/admin/dcn-audit", () => ({
    mock: true,
    auditId: 1,
    snapshotId: 1,
    calculation: body.productType === "sell_call" ? mockDcnCallCandidate() : mockDcnCandidate()
  }));
}
