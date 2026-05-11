import type { NextRequest } from "next/server";
import { proxyToWorker, readJson } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";

const mockPricingConfig = {
  sellPutPricingMethod: "firm_margin",
  firmMarginBps: 200,
  sellPutTargetFirmProfitBps: 500,
  sellCallTargetFirmProfitBps: 500,
  quoteFreshnessSeconds: 10,
  defaultOrderBookDepth: 100,
  maxDepthCandidates: 12,
  maxSlippageBps: 500
};

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  return proxyToWorker(request, "/api/admin/pricing-config", () => ({
    mock: true,
    pricingConfig: mockPricingConfig
  }));
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  const body = (await readJson(request.clone())) as {
    sellPutPricingMethod?: string;
    firmMarginBps?: number;
    sellPutTargetFirmProfitBps?: number;
    sellCallTargetFirmProfitBps?: number;
  };
  return proxyToWorker(request, "/api/admin/pricing-config", () => ({
    mock: true,
    pricingConfig: {
      ...mockPricingConfig,
      sellPutPricingMethod:
        body.sellPutPricingMethod === "target_firm_profit" || body.sellPutPricingMethod === "firm_margin"
          ? body.sellPutPricingMethod
          : mockPricingConfig.sellPutPricingMethod,
      firmMarginBps:
        typeof body.firmMarginBps === "number" && Number.isFinite(body.firmMarginBps)
          ? Math.max(0, Math.round(body.firmMarginBps))
          : mockPricingConfig.firmMarginBps,
      sellPutTargetFirmProfitBps:
        typeof body.sellPutTargetFirmProfitBps === "number" && Number.isFinite(body.sellPutTargetFirmProfitBps)
          ? Math.max(0, Math.round(body.sellPutTargetFirmProfitBps))
          : mockPricingConfig.sellPutTargetFirmProfitBps,
      sellCallTargetFirmProfitBps:
        typeof body.sellCallTargetFirmProfitBps === "number" && Number.isFinite(body.sellCallTargetFirmProfitBps)
          ? Math.max(0, Math.round(body.sellCallTargetFirmProfitBps))
          : mockPricingConfig.sellCallTargetFirmProfitBps
    }
  }));
}
