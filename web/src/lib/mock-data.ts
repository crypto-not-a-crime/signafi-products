import type { DcnCandidate, DcnPricingResponse } from "@/types";
import { calculateScenario } from "./dcn-scenario";

function roundYieldToOneDecimalPercent(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function mockDcnCandidate(overrides: Partial<DcnCandidate> = {}): DcnCandidate {
  const grossReferenceYield = (0.0641 / 92) * 365;
  const clientYield = roundYieldToOneDecimalPercent(grossReferenceYield - 0.02);
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
    requiredContracts: 6.7,
    effectivePutBidPrice: 0.0641,
    grossReferenceYield,
    firmMarginBps: 200,
    clientYield,
    clientInterestUsdt: 500000 * (clientYield * (92 / 365)),
    tradingFeesBtc: -0.00201,
    netOptionProceedsBtc: 0.42746,
    netOptionProceedsUsdt: 33555.61,
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
      { cell: "C17", label: "Option Baseline Premium", formula: "C15/C11*365", value: grossReferenceYield },
      { cell: "Signafi Margin", label: "Firm margin", formula: "admin firm margin input / 100", value: 0.02 },
      {
        cell: "Client Yield",
        label: "Client target yield",
        formula: "ROUND(MAX(C17 - Signafi Margin, 0) * 100, 1) / 100",
        value: clientYield
      },
      { cell: "Selected Payout", label: "Client payout", formula: "scenario analysis", value: 522000 }
    ],
    depth: {
      requiredContracts: 6.7,
      filledContracts: 6.7,
      grossProceedsBtc: 0.42947,
      effectivePutBidPrice: 0.0641,
      bestBidPrice: 0.0641,
      bestBidAmount: 6.7,
      sufficientDepth: true,
      remainingContracts: 0,
      slippagePct: 0,
      fills: [{ price: 0.0641, amount: 6.7, notionalBtc: 0.42947 }]
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
  const selectorMode =
    input.selectorMode === "auto_yield" || input.selectorMode === "auto_runway" || input.selectorMode === "auto_strike"
      ? input.selectorMode
      : "closest";
  const best = mockDcnCandidate({
    investmentUsdt,
    requiredContracts: Math.round((investmentUsdt / 75000) * 10) / 10
  });
  const alternativeGrossYield = (0.044 / 92) * 365;
  const alternativeClientYield = roundYieldToOneDecimalPercent(alternativeGrossYield - 0.02);
  return {
    generatedAt: Date.now(),
    input,
    candidates: [
      best,
      mockDcnCandidate({
        instrumentName: "BTC-31JUL26-70000-P",
        strike: 70000,
        effectivePutBidPrice: 0.044,
        clientYield: alternativeClientYield,
        grossReferenceYield: alternativeGrossYield,
        upsideProfitUsdt: 9700,
        downsideProfitUsdt: 8400
      })
    ],
    bestCandidate: best,
    recommendation: {
      selectorMode,
      recommendedLever: selectorMode === "auto_yield" ? "yield" : selectorMode === "auto_runway" ? "runway" : selectorMode === "auto_strike" ? "strike" : "none",
      reason: "Mock recommendation generated without live worker data.",
      targetYieldGapBps: best.clientYield === null ? null : best.clientYield * 10000 - Number(input.targetYieldBps ?? 1000),
      runwayGapDays: 0,
      strikeMoneynessGapBps: null
    },
    mock: true
  };
}
