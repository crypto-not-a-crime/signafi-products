import type { DcnCandidate, DcnPricingResponse, YieldSurfaceResponse } from "@/types";
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
    requiredContracts: 6.6,
    effectivePutBidPrice: 0.0641,
    grossReferenceYield,
    firmMarginBps: 200,
    clientYield,
    clientInterestUsdt: 500000 * (clientYield * (92 / 365)),
    tradingFeesBtc: -0.00198,
    netOptionProceedsBtc: 0.42108,
    netOptionProceedsUsdt: 33054.78,
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
      requiredContracts: 6.6,
      filledContracts: 6.6,
      grossProceedsBtc: 0.42306,
      effectivePutBidPrice: 0.0641,
      bestBidPrice: 0.0641,
      bestBidAmount: 6.6,
      sufficientDepth: true,
      remainingContracts: 0,
      slippagePct: 0,
      fills: [{ price: 0.0641, amount: 6.6, notionalBtc: 0.42306 }]
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
  const strikeBufferPct = typeof input.strikeBufferPct === "number" ? Number(input.strikeBufferPct) : null;
  const selectorMode =
    input.selectorMode === "auto_yield" || input.selectorMode === "auto_runway" || input.selectorMode === "auto_strike"
      ? input.selectorMode
      : "closest";
  const best = mockDcnCandidate({
    investmentUsdt,
    requiredContracts: Math.floor((investmentUsdt / 75000) * 10) / 10
  });
  const alternativeGrossYield = (0.044 / 92) * 365;
  const alternativeClientYield = roundYieldToOneDecimalPercent(alternativeGrossYield - 0.02);
  const thirdGrossYield = (0.035 / 150) * 365;
  const thirdClientYield = roundYieldToOneDecimalPercent(thirdGrossYield - 0.02);
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
      }),
      mockDcnCandidate({
        instrumentName: "BTC-25SEP26-65000-P",
        strike: 65000,
        dayCount: 150,
        effectivePutBidPrice: 0.035,
        clientYield: thirdClientYield,
        grossReferenceYield: thirdGrossYield,
        clientInterestUsdt: investmentUsdt * (thirdClientYield * (150 / 365)),
        upsideProfitUsdt: 7200,
        downsideProfitUsdt: 6900
      })
    ],
    bestCandidate: best,
    recommendation: {
      selectorMode,
      recommendedLever: selectorMode === "auto_yield" ? "yield" : selectorMode === "auto_runway" ? "runway" : selectorMode === "auto_strike" ? "strike" : "none",
      reason: "Mock recommendation generated without live worker data.",
      targetYieldGapBps: best.clientYield === null ? null : best.clientYield * 10000 - Number(input.targetYieldBps ?? 1000),
      runwayGapDays: 0,
      strikeMoneynessGapBps:
        strikeBufferPct === null ? null : Math.abs(best.strike / best.spotPrice - (1 - strikeBufferPct / 100)) * 10000
    },
    mock: true
  };
}

export function mockYieldSurface(optionType: "call" | "put" = "put"): YieldSurfaceResponse {
  const generatedAt = Date.now();
  const dtes = [35, 85, 140, 220];
  const strikes = [62000, 68000, 73000, 78000, 84000, 90000, 98000];
  const latestQuoteAt = generatedAt - 4000;
  const points = dtes.flatMap((daysToExpiry, expiryIndex) => {
    const expirationTimestamp = expiryTimestampFromDte(generatedAt, daysToExpiry);
    return strikes
      .filter((strike) => !(expiryIndex === 2 && strike === 62000))
      .map((strike, strikeIndex) => {
        const moneyness = strike / 80000;
        const skew = optionType === "put" ? Math.max(0, 1.08 - moneyness) : Math.max(0, moneyness - 0.92);
        const annualizedYield = 0.055 + skew * 0.18 + expiryIndex * 0.018 + strikeIndex * 0.002;
        const bidPrice = annualizedYield * daysToExpiry / 365;
        return {
          instrumentName: `BTC-${formatMockExpiry(expirationTimestamp)}-${strike}-${optionType === "put" ? "P" : "C"}`,
          optionType,
          strike,
          expirationTimestamp,
          expiryLabel: formatMockExpiry(expirationTimestamp),
          daysToExpiry,
          bidPrice,
          bidAmount: 8 + strikeIndex * 3,
          askPrice: bidPrice + 0.001,
          askAmount: 12 + strikeIndex * 2,
          markPrice: bidPrice + 0.0005,
          lastPrice: null,
          markIv: 38 + expiryIndex * 3 + strikeIndex,
          openInterest: 20 + strikeIndex * 4,
          underlyingPrice: 80000,
          deribitTimestamp: latestQuoteAt,
          ingestedAt: latestQuoteAt,
          annualizedYield
        };
      });
  });

  return {
    generatedAt,
    optionType,
    source: "mock",
    formula: {
      label: "Annualized Premium Yield",
      expression: "bidPrice / daysToExpiry * 365",
      annualizationDays: 365,
      dayCount: "UTC calendar days from today to expiry date"
    },
    filters: {
      minDte: 1,
      maxDte: Number.MAX_SAFE_INTEGER,
      minStrike: 0,
      maxStrike: Number.MAX_SAFE_INTEGER
    },
    latestQuoteAt,
    latestQuoteAgeSeconds: 4,
    minAnnualizedYield: Math.min(...points.map((point) => point.annualizedYield)),
    maxAnnualizedYield: Math.max(...points.map((point) => point.annualizedYield)),
    strikes,
    expiries: dtes.map((daysToExpiry) => {
      const expirationTimestamp = expiryTimestampFromDte(generatedAt, daysToExpiry);
      return {
        expirationTimestamp,
        label: formatMockExpiry(expirationTimestamp),
        daysToExpiry,
        pointCount: points.filter((point) => point.expirationTimestamp === expirationTimestamp).length
      };
    }),
    points,
    mock: true
  };
}

function expiryTimestampFromDte(nowMs: number, daysToExpiry: number): number {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysToExpiry, 8, 0);
}

function formatMockExpiry(timestamp: number): string {
  const date = new Date(timestamp);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(date.getUTCDate()).padStart(2, "0")}${months[date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(-2)}`;
}
