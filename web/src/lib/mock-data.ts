import type { DcnCandidate, DcnPricingResponse, DcnPriorityLever, DcnSelectorMode, YieldSurfaceResponse } from "@/types";
import { calculateScenario } from "./dcn-scenario";

function roundYieldToOneDecimalPercent(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function mockSelectorMode(input: Record<string, unknown>): DcnSelectorMode {
  return input.selectorMode === "auto_yield" || input.selectorMode === "auto_runway" || input.selectorMode === "auto_strike"
    ? input.selectorMode
    : "closest";
}

function mockPriorityLever(input: Record<string, unknown>, selectorMode: DcnSelectorMode): DcnPriorityLever | undefined {
  if (selectorMode === "auto_yield") return input.priorityLever === "strike" ? "strike" : "runway";
  if (selectorMode === "auto_runway") return input.priorityLever === "strike" ? "strike" : "yield";
  if (selectorMode === "auto_strike") return input.priorityLever === "runway" ? "runway" : "yield";
  return undefined;
}

export function mockDcnCandidate(overrides: Partial<DcnCandidate> = {}): DcnCandidate {
  const sellPutPricingMethod = overrides.sellPutPricingMethod ?? "firm_margin";
  const sellPutTargetFirmProfitBps = overrides.sellPutTargetFirmProfitBps ?? 500;
  const grossReferenceYield = (0.0641 / 92) * 365;
  const defaultClientYield =
    sellPutPricingMethod === "target_firm_profit"
      ? (33054.78 / Number(overrides.investmentUsdt ?? 500000)) * (365 / 92) - sellPutTargetFirmProfitBps / 10000
      : roundYieldToOneDecimalPercent(grossReferenceYield - 0.02);
  const clientYield = overrides.clientYield ?? defaultClientYield;
  const base: DcnCandidate = {
    formulaTemplate: {
      id: "dcn-sell-put-workbook-v1",
      version: "2026-05-11",
      label: "DCN Sell Put workbook template",
      sourceWorkbook: "DCN Calcs.xlsx",
      sourceSheets: ["Input Dashboard - Sell Put", "DCN - Sell Put", "Scenario Analysis - Sell Put"],
      sellPutPricingMethod,
      firmMarginBps: 200,
      sellPutTargetFirmProfitBps
    },
    productType: "sell_put",
    instrumentName: "BTC-31JUL26-75000-P",
    investmentUsdt: 500000,
    spotPrice: 78500,
    strike: 75000,
    dayCount: 92,
    requiredContracts: 6.6,
    effectivePutBidPrice: 0.0641,
    grossReferenceYield,
    sellPutPricingMethod,
    firmMarginBps: 200,
    sellPutTargetFirmProfitBps,
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
      clientYieldFormulaValid: true,
      clientYieldPositive: true,
      firmMarginPositive: true,
      targetFirmProfitNonNegative: true,
      upsideProfitPositive: true,
      downsideProfitPositive: true
    },
    formulaTrace: [
      { cell: "C4", label: "Initial Investment (USDT)", formula: "user input", value: 500000 },
      { cell: "C15", label: "Put Bid Price", formula: "depth-weighted bid", value: 0.0641 },
      { cell: "C17", label: "Option Baseline Premium", formula: "C15/C11*365", value: grossReferenceYield },
      {
        cell: "Put Pricing Method",
        label: "Put pricing basis",
        formula: "admin sellPutPricingMethod",
        value: sellPutPricingMethod
      },
      sellPutPricingMethod === "target_firm_profit"
        ? {
            cell: "Input Dashboard - Sell Put!C15",
            label: "Put target firm profit",
            formula: "admin sellPutTargetFirmProfitBps / 10000",
            value: sellPutTargetFirmProfitBps / 10000
          }
        : { cell: "Signafi Margin", label: "Firm margin", formula: "admin firm margin input / 100", value: 0.02 },
      {
        cell: sellPutPricingMethod === "target_firm_profit" ? "Input Dashboard - Sell Put!C9" : "Client Yield",
        label: "Client target yield",
        formula:
          sellPutPricingMethod === "target_firm_profit"
            ? "NetPremiumUSDT/InitialInvestment*365/DayCount-TargetFirmAnnualizedProfit"
            : "ROUND(MAX(C17 - Signafi Margin, 0) * 100, 1) / 100",
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

export function mockDcnCallCandidate(overrides: Partial<DcnCandidate> = {}): DcnCandidate {
  const clientYield = 0.096;
  const investmentBtc = 10;
  const spotPrice = 78500;
  const strike = 88000;
  const dayCount = 92;
  const clientInterestBtc = investmentBtc * clientYield * (dayCount / 365);
  const base: DcnCandidate = {
    formulaTemplate: {
      id: "dcn-sell-call-workbook-v1",
      version: "2026-05-07",
      label: "DCN Sell Call workbook template",
      sourceWorkbook: "DCN Calcs.xlsx",
      sourceSheets: ["Input Dashboard - Sell Call", "DCN - Sell Call", "Scenario Analysis - Sell Call"],
      sellCallTargetFirmProfitBps: 500,
      upsideReferenceMultiplier: 1.3
    },
    productType: "sell_call",
    instrumentName: "BTC-31JUL26-88000-C",
    investmentUsdt: investmentBtc * spotPrice,
    investmentBtc,
    spotPrice,
    strike,
    dayCount,
    requiredContracts: 10,
    effectiveOptionBidPrice: 0.026,
    effectiveCallBidPrice: 0.026,
    effectivePutBidPrice: 0.026,
    grossReferenceYield: (0.026 / dayCount) * 365,
    firmMarginBps: 0,
    sellCallTargetFirmProfitBps: 500,
    upsideReferencePrice: strike * 1.3,
    clientYield,
    clientInterestUsdt: clientInterestBtc * strike,
    clientInterestBtc,
    tradingFeesBtc: -0.003,
    netOptionProceedsBtc: 0.257,
    netOptionProceedsUsdt: 20174.5,
    premiumCoversInterest: true,
    selectedScenario: undefined,
    downsideScenario: undefined,
    upsideScenario: undefined,
    upsideProfitUsdt: 21000,
    upsideAnnualizedProfit: 0.106,
    downsideProfitUsdt: 14000,
    downsideAnnualizedProfit: 0.071,
    quoteAgeSeconds: 3,
    eligible: true,
    checks: {
      quoteFresh: true,
      usableBid: true,
      sufficientDepth: true,
      clientYieldFormulaValid: true,
      clientYieldPositive: true,
      targetFirmProfitNonNegative: true,
      upsideProfitPositive: true,
      downsideProfitPositive: true
    },
    formulaTrace: [
      { cell: "C4", label: "Initial Investment (BTC)", formula: "user input", value: investmentBtc },
      { cell: "C17", label: "Call Bid Price", formula: "depth-weighted bid", value: 0.026 },
      { cell: "C25", label: "Net Call Proceeds (USDT)", formula: "C24*C5", value: 20174.5 },
      {
        cell: "Input Dashboard - Sell Call!C9",
        label: "Client target yield",
        formula: "Sell Call workbook C9 formula",
        value: clientYield
      }
    ],
    depth: {
      requiredContracts: 10,
      filledContracts: 10,
      grossProceedsBtc: 0.26,
      effectiveOptionBidPrice: 0.026,
      effectivePutBidPrice: 0.026,
      bestBidPrice: 0.026,
      bestBidAmount: 10,
      sufficientDepth: true,
      remainingContracts: 0,
      slippagePct: 0,
      fills: [{ price: 0.026, amount: 10, notionalBtc: 0.26 }]
    }
  };
  const candidate = { ...base, ...overrides };
  candidate.selectedScenario = candidate.selectedScenario ?? calculateScenario(candidate, candidate.strike);
  candidate.downsideScenario = candidate.downsideScenario ?? calculateScenario(candidate, candidate.strike * 0.8);
  candidate.upsideScenario = candidate.upsideScenario ?? calculateScenario(candidate, candidate.strike * 1.3);
  candidate.downsideProfitUsdt = candidate.downsideScenario.firmProfitUsdt;
  candidate.downsideAnnualizedProfit = candidate.downsideScenario.annualizedFirmProfit;
  candidate.upsideProfitUsdt = candidate.upsideScenario.firmProfitUsdt;
  candidate.upsideAnnualizedProfit = candidate.upsideScenario.annualizedFirmProfit;
  return { ...candidate, ...overrides };
}

export function mockPricingResponse(input: Record<string, unknown> = {}): DcnPricingResponse {
  if (input.productType === "sell_call") {
    return mockCallPricingResponse(input);
  }

  const investmentUsdt = Number(input.investmentUsdt ?? 500000);
  const sellPutPricingMethod = input.sellPutPricingMethod === "target_firm_profit" ? "target_firm_profit" : "firm_margin";
  const sellPutTargetFirmProfitBps =
    typeof input.sellPutTargetFirmProfitBps === "number" && Number.isFinite(input.sellPutTargetFirmProfitBps)
      ? input.sellPutTargetFirmProfitBps
      : 500;
  const strikeBufferPct = typeof input.strikeBufferPct === "number" ? Number(input.strikeBufferPct) : null;
  const selectorMode = mockSelectorMode(input);
  const priorityLever = mockPriorityLever(input, selectorMode);
  const best = mockDcnCandidate({
    sellPutPricingMethod,
    sellPutTargetFirmProfitBps,
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
        sellPutPricingMethod,
        sellPutTargetFirmProfitBps,
        instrumentName: "BTC-31JUL26-70000-P",
        strike: 70000,
        effectivePutBidPrice: 0.044,
        clientYield: alternativeClientYield,
        grossReferenceYield: alternativeGrossYield,
        upsideProfitUsdt: 9700,
        downsideProfitUsdt: 8400
      }),
      mockDcnCandidate({
        sellPutPricingMethod,
        sellPutTargetFirmProfitBps,
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
      priorityLever,
      reason: "Mock recommendation generated without live worker data.",
      targetYieldGapBps: best.clientYield === null ? null : best.clientYield * 10000 - Number(input.targetYieldBps ?? 1000),
      runwayGapDays: 0,
      strikeMoneynessGapBps:
        strikeBufferPct === null ? null : Math.abs(best.strike / best.spotPrice - (1 - strikeBufferPct / 100)) * 10000
    },
    mock: true
  };
}

function mockCallPricingResponse(input: Record<string, unknown> = {}): DcnPricingResponse {
  const investmentBtc = Number(input.investmentBtc ?? 10);
  const strikeBufferPct = typeof input.strikeBufferPct === "number" ? Number(input.strikeBufferPct) : null;
  const selectorMode = mockSelectorMode(input);
  const priorityLever = mockPriorityLever(input, selectorMode);
  const best = mockDcnCallCandidate({ investmentBtc, investmentUsdt: investmentBtc * 78500, requiredContracts: Math.floor(investmentBtc * 10) / 10 });
  return {
    generatedAt: Date.now(),
    input,
    candidates: [
      best,
      mockDcnCallCandidate({
        instrumentName: "BTC-31JUL26-92000-C",
        strike: 92000,
        effectiveOptionBidPrice: 0.019,
        effectiveCallBidPrice: 0.019,
        effectivePutBidPrice: 0.019,
        clientYield: 0.074
      }),
      mockDcnCallCandidate({
        instrumentName: "BTC-25SEP26-98000-C",
        strike: 98000,
        dayCount: 150,
        effectiveOptionBidPrice: 0.024,
        effectiveCallBidPrice: 0.024,
        effectivePutBidPrice: 0.024,
        clientYield: 0.082
      })
    ],
    bestCandidate: best,
    recommendation: {
      selectorMode,
      recommendedLever:
        selectorMode === "auto_yield" ? "yield" : selectorMode === "auto_runway" ? "runway" : selectorMode === "auto_strike" ? "strike" : "none",
      priorityLever,
      reason: "Mock call recommendation generated without live worker data.",
      targetYieldGapBps: best.clientYield === null ? null : best.clientYield * 10000 - Number(input.targetYieldBps ?? 1000),
      runwayGapDays: 0,
      strikeMoneynessGapBps:
        strikeBufferPct === null ? null : Math.abs(best.strike / best.spotPrice - (1 + strikeBufferPct / 100)) * 10000
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
