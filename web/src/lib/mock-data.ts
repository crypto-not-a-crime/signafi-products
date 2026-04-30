import type { DcnCandidate, DcnPricingResponse } from "@/types";
import { calculateScenario } from "./dcn-scenario";

export function mockDcnCandidate(overrides: Partial<DcnCandidate> = {}): DcnCandidate {
  const base: DcnCandidate = {
    formulaTemplate: {
      id: "dcn-sell-put-workbook-v1",
      version: "2026-04-30",
      label: "DCN Sell Put workbook template",
      sourceWorkbook: "SP_Sell_Put_Calc_with_Scenario_Analysis.xlsx",
      sourceSheets: ["Product 3 - Sell Put", "Scenario Analysis"],
      firmMarginBps: 200
    },
    instrumentName: "BTC-31JUL26-75000-P",
    investmentUsdt: 500000,
    spotPrice: 78500,
    strike: 75000,
    dayCount: 92,
    requiredContracts: 6.4,
    effectivePutBidPrice: 0.0641,
    grossReferenceYield: (0.0641 / 92) * 365,
    firmMarginBps: 200,
    clientYield: (0.0641 / 92) * 365 - 0.02,
    clientInterestUsdt: 500000 * (((0.0641 / 92) * 365 - 0.02) * (92 / 365)),
    tradingFeesBtc: -0.00192,
    netOptionProceedsBtc: 0.40832,
    netOptionProceedsUsdt: 32053.12,
    premiumCoversInterest: true,
    selectedScenario: undefined,
    downsideScenario: undefined,
    upsideScenario: undefined,
    upsideProfitUsdt: 17900,
    upsideAnnualizedProfit: 0.1415,
    downsideProfitUsdt: 11420,
    downsideAnnualizedProfit: 0.0905,
    quoteAgeSeconds: 3,
    eligible: true,
    checks: {
      quoteFresh: true,
      usableBid: true,
      sufficientDepth: true,
      premiumCoversInterest: true,
      clientYieldPositive: true,
      firmMarginPositive: true,
      upsideProfitPositive: true,
      downsideProfitPositive: true
    },
    formulaTrace: [
      { cell: "C4", label: "Initial Investment (USDT)", formula: "user input", value: 500000 },
      { cell: "C15", label: "Put Bid Price", formula: "depth-weighted bid", value: 0.0641 },
      { cell: "C17", label: "Option Baseline Premium", formula: "C15/C11*365", value: (0.0641 / 92) * 365 },
      { cell: "Client Yield", label: "Client target yield", formula: "C17 - 2.0% p.a.", value: (0.0641 / 92) * 365 - 0.02 },
      { cell: "Selected Payout", label: "Client payout", formula: "scenario analysis", value: 522000 }
    ],
    depth: {
      requiredContracts: 6.4,
      filledContracts: 6.4,
      grossProceedsBtc: 0.41024,
      effectivePutBidPrice: 0.0641,
      bestBidPrice: 0.0645,
      bestBidAmount: 3.1,
      sufficientDepth: true,
      remainingContracts: 0,
      slippagePct: 0.0062,
      fills: [
        { price: 0.0645, amount: 3.1, notionalBtc: 0.19995 },
        { price: 0.0638, amount: 3.3, notionalBtc: 0.21054 }
      ]
    }
  };
  const candidate = { ...base, ...overrides };
  candidate.selectedScenario = candidate.selectedScenario ?? calculateScenario(candidate, candidate.strike);
  candidate.downsideScenario = candidate.downsideScenario ?? calculateScenario(candidate, candidate.strike * (2 / 3));
  candidate.upsideScenario = candidate.upsideScenario ?? calculateScenario(candidate, candidate.strike * 1.2);
  candidate.downsideProfitUsdt = candidate.downsideScenario.firmProfitUsdt;
  candidate.downsideAnnualizedProfit = candidate.downsideScenario.annualizedFirmProfit;
  candidate.upsideProfitUsdt = candidate.upsideScenario.firmProfitUsdt;
  candidate.upsideAnnualizedProfit = candidate.upsideScenario.annualizedFirmProfit;
  return { ...candidate, ...overrides };
}

export function mockPricingResponse(input: Record<string, unknown> = {}): DcnPricingResponse {
  const investmentUsdt = Number(input.investmentUsdt ?? 500000);
  const best = mockDcnCandidate({
    investmentUsdt,
    requiredContracts: Math.round((investmentUsdt / 78500) * 10) / 10
  });
  return {
    generatedAt: Date.now(),
    input,
    candidates: [
      best,
      mockDcnCandidate({
        instrumentName: "BTC-31JUL26-70000-P",
        strike: 70000,
        effectivePutBidPrice: 0.044,
        clientYield: (0.044 / 92) * 365 - 0.02,
        grossReferenceYield: (0.044 / 92) * 365,
        upsideProfitUsdt: 9700,
        downsideProfitUsdt: 8400
      })
    ],
    bestCandidate: best,
    mock: true
  };
}
