import type {
  DcnCandidate,
  DcnPricingResponse,
  DcnPriorityLever,
  DcnSelectorMode,
  PppCandidate,
  PppOfferSurfacePoint,
  PppOfferSurfaceResponse,
  PppPricingResponse,
  YieldSurfaceResponse
} from "@/types";
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

export function mockPppPricingResponse(input: Record<string, unknown> = {}): PppPricingResponse {
  const investmentUsdt = Number(input.investmentUsdt ?? 1000000);
  const selectorMode =
    input.selectorMode === "closest" || input.selectorMode === "auto_protection"
      ? input.selectorMode
      : "auto_participation";
  const priorityLever =
    selectorMode === "auto_participation"
      ? input.priorityLever === "protection"
        ? "protection"
        : "duration"
      : selectorMode === "auto_protection"
        ? input.priorityLever === "participation"
          ? "participation"
          : "duration"
        : undefined;
  const protectionLevel = Number(input.protectionLevelBps ?? 8000) / 10000;
  const participationLevel = Number(input.participationLevelBps ?? 3000) / 10000;
  const targetFirmMarginBps = Number(input.targetFirmMarginBps ?? 500);
  const includeDeliveryFees = typeof input.includeDeliveryFees === "boolean" ? input.includeDeliveryFees : true;
  const participationRoundDownBps = Math.max(0, Math.round(Number(input.participationRoundDownBps ?? 0)));
  const quoteParticipation = (raw: number) => roundParticipationDown(raw, participationRoundDownBps) ?? raw;
  const expirationTimestamp =
    typeof input.expirationTimestamp === "number" && Number.isFinite(input.expirationTimestamp)
      ? input.expirationTimestamp
      : undefined;
  const autoParticipationDurationMock = selectorMode === "auto_participation" && priorityLever === "duration";
  const autoParticipationProtectionMock = selectorMode === "auto_participation" && priorityLever === "protection";
  const autoProtectionDurationMock = selectorMode === "auto_protection" && priorityLever === "duration";
  const maxParticipationQuoteMode = selectorMode === "auto_participation" || selectorMode === "closest";
  const lowerProtection = Math.max(0.1, protectionLevel - 0.05);
  const upperProtection = Math.min(1, protectionLevel + 0.05);
  const dominatedProtection = Math.max(0.1, protectionLevel - 0.01);
  const lowerParticipation = Math.max(0, participationLevel - 0.05);
  const upperParticipation = Math.min(1, participationLevel + 0.05);
  const bestProtection = selectorMode === "auto_protection" ? 0.753 : autoParticipationDurationMock ? lowerProtection : protectionLevel;
  const bestRawParticipation = autoParticipationDurationMock ? 0.612 : selectorMode === "closest" ? 0.36 : 0.239;
  const bestQuotedAutoParticipation = quoteParticipation(bestRawParticipation);
  const best = mockPppCandidate({
    investmentUsdt,
    expirationTimestamp,
    selectorMode,
    protectionLevel: bestProtection,
    protectionLevelBps: Math.round(bestProtection * 10000),
    targetFirmMarginBps,
    includeDeliveryFees,
    participationRoundDownBps,
    quotedParticipation: maxParticipationQuoteMode ? bestQuotedAutoParticipation : participationLevel,
    quotedParticipationBps: maxParticipationQuoteMode ? bestQuotedAutoParticipation * 10000 : participationLevel * 10000,
    optimizedParticipation: maxParticipationQuoteMode ? bestRawParticipation : null,
    optimizedParticipationBps: maxParticipationQuoteMode ? bestRawParticipation * 10000 : null,
    optimizedProtection: selectorMode === "auto_protection" ? 0.753 : null,
    optimizedProtectionBps: selectorMode === "auto_protection" ? 7530 : null,
    participationGapBps:
      selectorMode === "auto_protection"
        ? 0
        : selectorMode === "closest"
          ? Math.abs(bestQuotedAutoParticipation - participationLevel) * 10000
          : undefined
  });
  const bestQuotedParticipation = best.quotedParticipation ?? 0;
  const bestQuotedParticipationBps = best.quotedParticipationBps ?? bestQuotedParticipation * 10000;
  const candidates = autoParticipationDurationMock
    ? [
        best,
        mockPppCandidate({
          selectorMode,
          expirationTimestamp: best.expirationTimestamp,
          dayCount: best.dayCount,
          protectionLevel,
          protectionLevelBps: Math.round(protectionLevel * 10000),
          optimizedParticipation: 0.512,
          optimizedParticipationBps: 5120,
          quotedParticipation: quoteParticipation(0.512),
          quotedParticipationBps: quoteParticipation(0.512) * 10000,
          participationRoundDownBps,
          optimalCallContracts: 3.2,
          floorPutStrike: 62000,
          putSpreadImpliedFloor: protectionLevel,
          protectionGapBps: 0,
          minScenarioPnlUsdt: 38200,
          stressPrice: 77121
        }),
        mockPppCandidate({
          selectorMode,
          expirationTimestamp: best.expirationTimestamp,
          dayCount: best.dayCount,
          protectionLevel: upperProtection,
          protectionLevelBps: Math.round(upperProtection * 10000),
          optimizedParticipation: 0.412,
          optimizedParticipationBps: 4120,
          quotedParticipation: quoteParticipation(0.412),
          quotedParticipationBps: quoteParticipation(0.412) * 10000,
          participationRoundDownBps,
          optimalCallContracts: 2.3,
          floorPutStrike: 66000,
          putSpreadImpliedFloor: upperProtection,
          protectionGapBps: Math.abs(upperProtection - protectionLevel) * 10000,
          minScenarioPnlUsdt: 34600,
          stressPrice: 77121
        })
      ]
    : autoParticipationProtectionMock
      ? [
          best,
          mockPppCandidate({
            selectorMode,
            expirationTimestamp: expiryTimestampFromDte(Date.now(), 129),
            dayCount: 129,
            protectionLevel,
            protectionLevelBps: Math.round(protectionLevel * 10000),
            quotedProtection: protectionLevel,
            quotedProtectionBps: protectionLevel * 10000,
            optimizedParticipation: 0.186,
            optimizedParticipationBps: 1860,
            quotedParticipation: quoteParticipation(0.186),
            quotedParticipationBps: quoteParticipation(0.186) * 10000,
            participationRoundDownBps,
            optimalCallContracts: 2.4,
            floorPutStrike: 62000,
            putSpreadImpliedFloor: protectionLevel,
            protectionGapBps: 0,
            minScenarioPnlUsdt: 52500,
            stressPrice: 77121
          }),
          mockPppCandidate({
            selectorMode,
            expirationTimestamp: best.expirationTimestamp,
            dayCount: best.dayCount,
            protectionLevel: dominatedProtection,
            protectionLevelBps: Math.round(dominatedProtection * 10000),
            quotedProtection: dominatedProtection,
            quotedProtectionBps: dominatedProtection * 10000,
            optimizedParticipation: best.optimizedParticipation,
            optimizedParticipationBps: best.optimizedParticipationBps,
            quotedParticipation: bestQuotedParticipation,
            quotedParticipationBps: bestQuotedParticipationBps,
            participationRoundDownBps,
            floorPutStrike: 61000,
            putSpreadImpliedFloor: dominatedProtection,
            protectionGapBps: Math.abs(dominatedProtection - protectionLevel) * 10000,
            minScenarioPnlUsdt: 38200,
            stressPrice: 77121
          })
        ]
    : autoProtectionDurationMock
      ? [
          best,
          mockPppCandidate({
            selectorMode,
            expirationTimestamp: best.expirationTimestamp,
            dayCount: best.dayCount,
            protectionLevel: 0.812,
            protectionLevelBps: 8120,
            quotedProtection: 0.812,
            quotedProtectionBps: 8120,
            optimizedProtection: 0.812,
            optimizedProtectionBps: 8120,
            quotedParticipation: lowerParticipation,
            quotedParticipationBps: lowerParticipation * 10000,
            optimalCallContracts: 2.6,
            floorPutStrike: 62000,
            putSpreadImpliedFloor: 0.812,
            protectionGapBps: Math.abs(0.812 - protectionLevel) * 10000,
            participationGapBps: Math.abs(lowerParticipation - participationLevel) * 10000,
            minScenarioPnlUsdt: 36100,
            stressPrice: 77121
          }),
          mockPppCandidate({
            selectorMode,
            expirationTimestamp: best.expirationTimestamp,
            dayCount: best.dayCount,
            protectionLevel: 0.704,
            protectionLevelBps: 7040,
            quotedProtection: 0.704,
            quotedProtectionBps: 7040,
            optimizedProtection: 0.704,
            optimizedProtectionBps: 7040,
            quotedParticipation: upperParticipation,
            quotedParticipationBps: upperParticipation * 10000,
            optimalCallContracts: 4.5,
            floorPutStrike: 54000,
            putSpreadImpliedFloor: 0.704,
            protectionGapBps: Math.abs(0.704 - protectionLevel) * 10000,
            participationGapBps: Math.abs(upperParticipation - participationLevel) * 10000,
            minScenarioPnlUsdt: 34300,
            stressPrice: 77121
          })
        ]
    : [
        best,
        mockPppCandidate({
          selectorMode,
          expirationTimestamp: expiryTimestampFromDte(Date.now(), 180),
          dayCount: 180,
          optimizedParticipation: maxParticipationQuoteMode ? 0.212 : null,
          optimizedParticipationBps: maxParticipationQuoteMode ? 2120 : null,
          quotedParticipation: maxParticipationQuoteMode ? quoteParticipation(0.212) : participationLevel,
          quotedParticipationBps:
            maxParticipationQuoteMode ? quoteParticipation(0.212) * 10000 : participationLevel * 10000,
          participationGapBps: selectorMode === "closest" ? Math.abs(quoteParticipation(0.212) - participationLevel) * 10000 : undefined,
          participationRoundDownBps,
          optimizedProtection: selectorMode === "auto_protection" ? 0.742 : null,
          optimizedProtectionBps: selectorMode === "auto_protection" ? 7420 : null,
          protectionLevel: selectorMode === "auto_protection" ? 0.742 : protectionLevel,
          optimalCallContracts: 2.8,
          floorPutStrike: 62000,
          putSpreadImpliedFloor: 0.812,
          protectionGapBps: Math.abs(0.812 - protectionLevel) * 10000,
          minScenarioPnlUsdt: 35800,
          stressPrice: 80000
        }),
        mockPppCandidate({
          selectorMode,
          expirationTimestamp: expiryTimestampFromDte(Date.now(), 365),
          dayCount: 365,
          optimizedParticipation: maxParticipationQuoteMode ? 0.186 : null,
          optimizedParticipationBps: maxParticipationQuoteMode ? 1860 : null,
          quotedParticipation: maxParticipationQuoteMode ? quoteParticipation(0.186) : participationLevel,
          quotedParticipationBps:
            maxParticipationQuoteMode ? quoteParticipation(0.186) * 10000 : participationLevel * 10000,
          participationGapBps: selectorMode === "closest" ? Math.abs(quoteParticipation(0.186) - participationLevel) * 10000 : undefined,
          participationRoundDownBps,
          optimizedProtection: selectorMode === "auto_protection" ? 0.728 : null,
          optimizedProtectionBps: selectorMode === "auto_protection" ? 7280 : null,
          protectionLevel: selectorMode === "auto_protection" ? 0.728 : protectionLevel,
          optimalCallContracts: 2.4,
          floorPutStrike: 60000,
          putSpreadImpliedFloor: 0.798,
          protectionGapBps: Math.abs(0.798 - protectionLevel) * 10000,
          minScenarioPnlUsdt: 52500,
          stressPrice: 77121
        })
      ];

  return {
    generatedAt: Date.now(),
    input,
    candidates,
    bestCandidate: best,
    recommendation: {
      reason: "Mock PPP recommendation generated without live worker data.",
      selectorMode,
      recommendedLever:
        selectorMode === "auto_protection" ? "protection" : selectorMode === "closest" ? "none" : "participation",
      priorityLever,
      runwayGapDays: 0,
      protectionGapBps: best.protectionGapBps,
      participationGapBps: best.participationGapBps,
      optimizedParticipationBps: best.optimizedParticipationBps,
      optimizedProtectionBps: best.optimizedProtectionBps
    },
    diagnostics: {
      totalExpiriesScanned: 3,
      totalRoughPackages: Math.max(candidates.length * 3, candidates.length),
      shortlistedPackages: candidates.length,
      livePricedPackages: candidates.length,
      uniqueOrderBooksFetched: Math.max(3, candidates.length + 2),
      depthCandidateCap: selectorMode === "auto_protection" ? 36 : selectorMode === "auto_participation" ? 18 : 8,
      durationGuardrailDays: Math.min(120, Math.max(21, Math.round(Number(input.runwayDays ?? 92) * 0.25))),
      inWindowPackages: candidates.length,
      outOfWindowPackages: 0,
      durationFallbackUsed: false,
      pricingElapsedMs: 42
    },
    mock: true
  };
}

export function mockPppOfferSurfaceResponse(input: Record<string, unknown> = {}): PppOfferSurfaceResponse {
  const generatedAt = Date.now();
  const investmentUsdt = Number(input.investmentUsdt ?? 1_000_000);
  const spotPrice = 80_000;
  const targetFirmMarginBps = Number(input.targetFirmMarginBps ?? 500);
  const minDte = Number(input.minDte ?? 1);
  const maxDte = Number(input.maxDte ?? 365);
  const minProtectionBps = Number(input.minProtectionBps ?? 6000);
  const maxProtectionBps = Number(input.maxProtectionBps ?? 9500);
  const dtes = [35, 92, 180, 300].filter((days) => days >= minDte && days <= maxDte);
  const floorStrikes = [52000, 56000, 60000, 64000, 68000, 72000, 76000].filter((strike) => {
    const bps = Math.round((strike / spotPrice) * 10000);
    return bps >= minProtectionBps && bps <= maxProtectionBps;
  });

  let points: PppOfferSurfacePoint[] = dtes.flatMap((daysToExpiry) => {
    const expirationTimestamp = expiryTimestampFromDte(generatedAt, daysToExpiry);
    return floorStrikes.map((floorPutStrike) => {
      const floorProtection = floorPutStrike / spotPrice;
      const floorProtectionBps = Math.round(floorProtection * 10000);
      const rawParticipation = Math.max(0.08, 0.72 - floorProtection * 0.42 - daysToExpiry / 1400);
      const quotedParticipation = roundParticipationDown(rawParticipation, Number(input.participationRoundDownBps ?? 0)) ?? rawParticipation;
      const quotedParticipationBps = Math.round(quotedParticipation * 10000);
      const targetProfitUsdt = investmentUsdt * (targetFirmMarginBps / 10000) * (daysToExpiry / 365);
      const marginHeadroomUsdt = investmentUsdt * (0.015 + (0.95 - floorProtection) * 0.012) * (daysToExpiry / 365);
      const eligible = quotedParticipationBps > 0 && marginHeadroomUsdt >= 0;
      const expiryLabel = formatMockExpiry(expirationTimestamp);
      return {
        id: `${expirationTimestamp}:${floorPutStrike}`,
        expirationTimestamp,
        expiryLabel,
        daysToExpiry,
        floorPutStrike,
        floorProtection,
        floorProtectionBps,
        quotedProtection: floorProtection,
        quotedProtectionBps: floorProtectionBps,
        putSpreadImpliedFloor: floorProtection + 0.006,
        quotedParticipation,
        quotedParticipationBps,
        optimizedParticipation: rawParticipation,
        optimizedParticipationBps: Math.round(rawParticipation * 10000),
        targetFirmMarginBps,
        targetProfitUsdt,
        minScenarioPnlUsdt: targetProfitUsdt + marginHeadroomUsdt,
        marginHeadroomUsdt,
        marginHeadroomBps: (marginHeadroomUsdt / investmentUsdt / daysToExpiry) * 365 * 10000,
        stressPrice: spotPrice,
        netOptionCashUsdt: 25000 + (0.95 - floorProtection) * 10000,
        quoteAgeSeconds: 3,
        maxSlippagePct: 0.002,
        eligible,
        best: false,
        frontier: false,
        checks: {
          spotValid: true,
          expiryValid: true,
          quoteFresh: true,
          sufficientDepth: true,
          slippageWithinLimit: true,
          participationPositive: quotedParticipation > 0,
          targetProfitMet: eligible,
          floorAtOrAboveProtection: true,
          callHedgeAtOrAboveParticipation: true
        },
        atmCallStrike: 80000,
        atmPutStrike: 80000,
        spotPrice,
        legs: [
          mockPppLeg("long_call", "buy", `BTC-${expiryLabel}-80000-C`, 80000, 3.2, 0.15),
          mockPppLeg("short_put", "sell", `BTC-${expiryLabel}-80000-P`, 80000, 12.5, 0.12),
          mockPppLeg("long_floor_put", "buy", `BTC-${expiryLabel}-${floorPutStrike}-P`, floorPutStrike, 12.5, 0.05)
        ].map((leg) => ({
          role: leg.role,
          side: leg.side,
          instrumentName: leg.instrumentName,
          optionType: leg.optionType,
          strike: leg.strike,
          requiredContracts: leg.requiredContracts,
          averagePrice: leg.averagePrice,
          bestPrice: leg.bestPrice,
          quoteAgeSeconds: leg.quoteAgeSeconds,
          sufficientDepth: leg.depth.sufficientDepth,
          slippagePct: leg.depth.slippagePct
        }))
      };
    });
  });

  const eligiblePoints = points.filter((point) => point.eligible);
  const bestId =
    [...eligiblePoints].sort((a, b) => {
      if ((b.quotedParticipationBps ?? 0) !== (a.quotedParticipationBps ?? 0)) {
        return (b.quotedParticipationBps ?? 0) - (a.quotedParticipationBps ?? 0);
      }
      return (b.quotedProtectionBps ?? 0) - (a.quotedProtectionBps ?? 0);
    })[0]?.id ?? null;
  const frontierIds = new Set(
    eligiblePoints
      .filter(
        (point) =>
          !eligiblePoints.some((other) => {
            if (other.id === point.id) return false;
            const protectionDominates = (other.quotedProtectionBps ?? 0) >= (point.quotedProtectionBps ?? 0);
            const participationDominates = (other.quotedParticipationBps ?? 0) >= (point.quotedParticipationBps ?? 0);
            const visiblyBetter =
              (other.quotedProtectionBps ?? 0) > (point.quotedProtectionBps ?? 0) ||
              (other.quotedParticipationBps ?? 0) > (point.quotedParticipationBps ?? 0);
            return protectionDominates && participationDominates && visiblyBetter;
          })
      )
      .map((point) => point.id)
  );
  points = points.map((point) => ({ ...point, best: point.id === bestId, frontier: frontierIds.has(point.id) }));
  const participationValues = points
    .map((point) => point.quotedParticipationBps)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const marginHeadroom = points
    .map((point) => point.marginHeadroomUsdt)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    generatedAt,
    input,
    objective: "client_terms",
    source: "mock",
    spotPrice,
    expiries: dtes.map((daysToExpiry) => {
      const expirationTimestamp = expiryTimestampFromDte(generatedAt, daysToExpiry);
      return {
        expirationTimestamp,
        label: formatMockExpiry(expirationTimestamp),
        daysToExpiry,
        pointCount: points.filter((point) => point.expirationTimestamp === expirationTimestamp).length
      };
    }),
    floorRows: floorStrikes
      .map((floorPutStrike) => ({
        floorPutStrike,
        floorProtection: floorPutStrike / spotPrice,
        floorProtectionBps: Math.round((floorPutStrike / spotPrice) * 10000),
        pointCount: points.filter((point) => point.floorPutStrike === floorPutStrike).length
      }))
      .sort((a, b) => b.floorPutStrike - a.floorPutStrike),
    points,
    bestPoint: points.find((point) => point.best) ?? null,
    highestFrontierProtectionBps:
      Math.max(...points.filter((point) => point.frontier).map((point) => point.quotedProtectionBps ?? 0)) || null,
    minParticipationBps: participationValues.length ? Math.min(...participationValues) : null,
    maxParticipationBps: participationValues.length ? Math.max(...participationValues) : null,
    minMarginHeadroomUsdt: marginHeadroom.length ? Math.min(...marginHeadroom) : null,
    maxMarginHeadroomUsdt: marginHeadroom.length ? Math.max(...marginHeadroom) : null,
    diagnostics: {
      pricingMode: "mock",
      depthValidation: "mock",
      totalExpiriesScanned: dtes.length,
      totalRoughCells: dtes.length * floorStrikes.length,
      livePricedCells: points.length,
      eligibleCells: points.filter((point) => point.eligible).length,
      frontierCells: points.filter((point) => point.frontier).length,
      uniqueOrderBooksFetched: 0,
      pricingElapsedMs: 36,
      truncated: false,
      maxCells: Number(input.maxCells ?? 180),
      latestQuoteAgeSeconds: 3
    },
    mock: true
  };
}

export function mockPppCandidate(overrides: Partial<PppCandidate> = {}): PppCandidate {
  const generatedAt = Date.now();
  const selectorMode = overrides.selectorMode ?? "auto_participation";
  const includeDeliveryFees = overrides.includeDeliveryFees ?? true;
  const investmentUsdt = overrides.investmentUsdt ?? 1000000;
  const spotPrice = overrides.spotPrice ?? 77121;
  const protectionLevel = overrides.protectionLevel ?? 0.8;
  const participationRoundDownBps = overrides.participationRoundDownBps ?? 0;
  const optimizedParticipation =
    overrides.optimizedParticipation ?? (selectorMode === "auto_participation" ? 0.239 : null);
  const quotedParticipation =
    overrides.quotedParticipation ??
    (selectorMode === "auto_participation" ? roundParticipationDown(optimizedParticipation, participationRoundDownBps) : 0.3);
  const targetFirmMarginBps = overrides.targetFirmMarginBps ?? 500;
  const dayCount = overrides.dayCount ?? 92;
  const targetProfitUsdt = investmentUsdt * (targetFirmMarginBps / 10000) * (dayCount / 365);
  const minScenarioPnlUsdt = overrides.minScenarioPnlUsdt ?? 31097;
  const stressPrice = overrides.stressPrice ?? 77121;
  const optimalCallContracts = overrides.optimalCallContracts ?? 3.1;
  const putSpreadContracts = overrides.putSpreadContracts ?? 12.9;
  const atmCallStrike = overrides.atmCallStrike ?? 76000;
  const atmPutStrike = overrides.atmPutStrike ?? 76000;
  const floorPutStrike = overrides.floorPutStrike ?? 62000;
  const putSpreadImpliedFloor = overrides.putSpreadImpliedFloor ?? 0.8194;
  const netOptionCashBtc = overrides.netOptionCashBtc ?? 0.3586;
  const netOptionCashUsdt = overrides.netOptionCashUsdt ?? 27655;
  const optimizedProtection = overrides.optimizedProtection ?? (selectorMode === "auto_protection" ? protectionLevel : null);
  const legs = [
    mockPppLeg("long_call", "buy", "BTC-25DEC26-76000-C", atmCallStrike, optimalCallContracts, 0.152),
    mockPppLeg("short_put", "sell", "BTC-25DEC26-76000-P", atmPutStrike, putSpreadContracts, 0.1185),
    mockPppLeg("long_floor_put", "buy", "BTC-25DEC26-62000-P", floorPutStrike, putSpreadContracts, 0.0535)
  ] satisfies PppCandidate["legs"];
  const selectedScenario = overrides.selectedScenario ?? {
    expiryPrice: spotPrice,
    clientPayoutUsdt: investmentUsdt,
    callPayoffUsdt: 3475,
    shortPutPayoffUsdt: 0,
    floorPutPayoffUsdt: 0,
    grossHedgePayoffUsdt: 3475,
    deliveryFeesUsdt: 36,
    issuerPnlUsdt: minScenarioPnlUsdt
  };
  return {
    formulaTemplate: {
      id: "ppp-robust-model-v1",
      version: "2026-05-18",
      label: "Partial Principal Protected Robust Model",
      sourceWorkbook: "Partial_Prin_Protected.xlsx",
      sourceSheets: ["Robust Model", "Scenario PnL", "Optimization"]
    },
    productType: "ppp",
    expirationTimestamp: overrides.expirationTimestamp ?? expiryTimestampFromDte(generatedAt, dayCount),
    dayCount,
    investmentUsdt,
    spotPrice,
    protectionLevel,
    protectionLevelBps: Math.round(protectionLevel * 10000),
    floorStrikeTarget: spotPrice * protectionLevel,
    targetFirmMarginBps,
    targetProfitUsdt,
    participationRoundDownBps,
    optimizedParticipation,
    optimizedParticipationBps:
      overrides.optimizedParticipationBps ?? (optimizedParticipation === null ? null : optimizedParticipation * 10000),
    optimalCallContracts,
    putSpreadContracts,
    atmCallStrike,
    atmPutStrike,
    floorPutStrike,
    putSpreadImpliedFloor,
    protectionGapBps: Math.abs(putSpreadImpliedFloor - protectionLevel) * 10000,
    minScenarioPnlUsdt,
    stressPrice,
    netOptionCashBtc,
    netOptionCashUsdt,
    quoteAgeSeconds: 3,
    maxSlippagePct: 0,
    eligible: true,
    checks: {
      spotValid: true,
      expiryValid: true,
      quoteFresh: true,
      sufficientDepth: true,
      slippageWithinLimit: true,
      participationPositive: true,
      targetProfitMet: true,
      floorAtOrAboveProtection: true
    },
    legs,
    selectedScenario,
    scenarios: [],
    selectorMode,
    recommendedLever:
      overrides.recommendedLever ??
      (selectorMode === "auto_protection" ? "protection" : selectorMode === "closest" ? "none" : "participation"),
    includeDeliveryFees,
    quotedParticipation,
    quotedParticipationBps:
      overrides.quotedParticipationBps ?? (quotedParticipation === null ? null : quotedParticipation * 10000),
    quotedProtection: overrides.quotedProtection ?? protectionLevel,
    quotedProtectionBps: overrides.quotedProtectionBps ?? protectionLevel * 10000,
    optimizedProtection,
    optimizedProtectionBps:
      overrides.optimizedProtectionBps ?? (optimizedProtection === null ? null : optimizedProtection * 10000),
    participationGapBps: overrides.participationGapBps ?? (selectorMode === "auto_participation" ? null : 8.5),
    formulaTrace: mockPppFormulaTrace({
      selectorMode,
      includeDeliveryFees,
      investmentUsdt,
      spotPrice,
      protectionLevel,
      selectedParticipation: quotedParticipation ?? 0,
      participationRoundDownBps,
      optimizedParticipation: optimizedParticipation ?? quotedParticipation ?? 0,
      targetFirmMarginBps,
      targetProfitUsdt,
      minScenarioPnlUsdt,
      stressPrice,
      optimalCallContracts,
      putSpreadContracts,
      atmCallStrike,
      atmPutStrike,
      floorPutStrike,
      putSpreadImpliedFloor,
      netOptionCashBtc,
      netOptionCashUsdt,
      optimizedProtection,
      legs,
      selectedScenario
    }),
    ...overrides
  };
}

function mockPppFormulaTrace(input: {
  selectorMode: PppCandidate["selectorMode"];
  includeDeliveryFees: boolean;
  investmentUsdt: number;
  spotPrice: number;
  protectionLevel: number;
  selectedParticipation: number;
  participationRoundDownBps: number;
  optimizedParticipation: number;
  targetFirmMarginBps: number;
  targetProfitUsdt: number;
  minScenarioPnlUsdt: number;
  stressPrice: number;
  optimalCallContracts: number;
  putSpreadContracts: number;
  atmCallStrike: number;
  atmPutStrike: number;
  floorPutStrike: number;
  putSpreadImpliedFloor: number;
  netOptionCashBtc: number;
  netOptionCashUsdt: number;
  optimizedProtection: number | null;
  legs: PppCandidate["legs"];
  selectedScenario: NonNullable<PppCandidate["selectedScenario"]>;
}): PppCandidate["formulaTrace"] {
  const [callLeg, putLeg, floorPutLeg] = input.legs;
  const exactPutContracts = input.spotPrice > 0 ? input.investmentUsdt / input.spotPrice : null;
  const exactCallContracts = input.spotPrice > 0 ? (input.investmentUsdt * input.optimizedParticipation) / input.spotPrice : null;
  const actualCallHedgeParticipation =
    input.investmentUsdt > 0 ? (input.optimalCallContracts * input.spotPrice) / input.investmentUsdt : null;
  const buyFeesBtc = (callLeg.tradingFeeBtc ?? 0) + (floorPutLeg.tradingFeeBtc ?? 0);
  const sellFeesBtc = putLeg.tradingFeeBtc ?? 0;
  const grossPutSpreadCreditBtc =
    input.putSpreadContracts * ((putLeg.averagePrice ?? 0) - (floorPutLeg.averagePrice ?? 0));
  const callPremiumCostBtc = input.optimalCallContracts * (callLeg.averagePrice ?? 0);

  return [
    { cell: "Robust Model!B4", label: "Notional invested", formula: "user input", value: input.investmentUsdt },
    { cell: "Robust Model!B5", label: "Product reference spot S0", formula: "Deribit BTC_USDC spot mid", value: input.spotPrice },
    { cell: "Robust Model!B7", label: "Product floor return", formula: "selected protectionLevelBps / 10000", value: input.protectionLevel },
    {
      cell: "Robust Model!B8",
      label: "Client participation quote",
      formula: input.selectorMode === "auto_participation" ? "rounded max participation quote" : "selected participationLevelBps / 10000",
      value: input.selectedParticipation
    },
    {
      cell: "pricing_config.ppp_participation_round_down_bps",
      label: "Participation rounding increment",
      formula: "saved PPP participation quote rounding increment / 10000",
      value: input.participationRoundDownBps / 10000
    },
    { cell: "Robust Model!B9", label: "Target firm margin", formula: "saved PPP targetFirmMarginBps / 10000", value: input.targetFirmMarginBps / 10000 },
    { cell: "Robust Model!B10", label: "Target profit amount", formula: "dayCount / 365 * targetFirmMargin * notional", value: input.targetProfitUsdt },
    { cell: "Robust Model!B12", label: "Include delivery fees", formula: "saved/admin PPP delivery-fee checkbox", value: input.includeDeliveryFees },
    { cell: "Robust Model!F4", label: "ATM call strike", formula: "closest listed call strike to S0", value: input.atmCallStrike },
    { cell: "Robust Model!F5", label: "ATM call ask premium", formula: "depth-weighted executable ask", value: callLeg.averagePrice },
    { cell: "Robust Model!F6", label: "ATM put strike", formula: "closest listed put strike to S0", value: input.atmPutStrike },
    { cell: "Robust Model!F7", label: "ATM put bid premium", formula: "depth-weighted executable bid", value: putLeg.averagePrice },
    { cell: "Robust Model!F8", label: "Floor put strike", formula: "closest listed put strike to S0 * protection", value: input.floorPutStrike },
    { cell: "Robust Model!F9", label: "Floor put ask premium", formula: "depth-weighted executable ask", value: floorPutLeg.averagePrice },
    { cell: "Robust Model!B19", label: "Put-spread contracts exact", formula: "notional / S0", value: exactPutContracts },
    { cell: "Robust Model!B20", label: "Put-spread contracts used", formula: "FLOOR(notional / S0 / 0.1, 1) * 0.1", value: input.putSpreadContracts },
    { cell: "Robust Model!B21", label: "Call contracts exact", formula: "notional * maxParticipation / S0", value: exactCallContracts },
    { cell: "Robust Model!B44", label: "Optimal call contracts", formula: "last Optimization row where min PnL >= target profit", value: input.optimalCallContracts },
    { cell: "Robust Model!B23", label: "Actual call hedge participation", formula: "optimalCallContracts * S0 / notional", value: actualCallHedgeParticipation },
    { cell: "Robust Model!B43", label: "Max client participation", formula: "callContracts * S0 / notional * (1 - delivery fee cap)", value: input.optimizedParticipation },
    { cell: "Robust Model!B24", label: "Put-spread implied floor", formula: "1 - putContracts * (atmPutStrike - floorPutStrike) / notional", value: input.putSpreadImpliedFloor },
    { cell: "Robust Model!B25", label: "Protection gap", formula: "(putSpreadImpliedFloor - selectedFloorReturn) * 10000", value: (input.putSpreadImpliedFloor - input.protectionLevel) * 10000 },
    { cell: "Robust Model!B30", label: "Buy-leg trading fees BTC", formula: "ATM call fee + floor put fee", value: buyFeesBtc },
    { cell: "Robust Model!B31", label: "Sell-leg trading fees BTC", formula: "ATM put fee", value: sellFeesBtc },
    { cell: "Robust Model!B32", label: "Total trading fees BTC", formula: "buy fees + sell fees", value: buyFeesBtc + sellFeesBtc },
    { cell: "Robust Model!B33", label: "Gross put-spread credit BTC", formula: "putContracts * (atmPutBid - floorPutAsk)", value: grossPutSpreadCreditBtc },
    { cell: "Robust Model!B34", label: "Call premium cost BTC", formula: "optimalCallContracts * atmCallAsk", value: callPremiumCostBtc },
    { cell: "Robust Model!B35", label: "Net inception option cash", formula: "put spread credit - call cost - trading fees", value: input.netOptionCashBtc },
    { cell: "Robust Model!B36", label: "Net inception option cash", formula: "netOptionCashBTC * BTC_USDC spot mid", value: input.netOptionCashUsdt },
    { cell: "Robust Model!B45", label: "Minimum PnL at optimum", formula: "MIN(Optimization scenario checks)", value: input.minScenarioPnlUsdt },
    { cell: "Robust Model!B38", label: "Stress price at minimum PnL", formula: "price where optimized scenario PnL is lowest", value: input.stressPrice },
    { cell: "Robust Model!B39", label: "Target profit check", formula: "minimum scenario PnL >= target profit", value: input.minScenarioPnlUsdt >= input.targetProfitUsdt ? "PASS" : "FAIL" },
    ...(input.selectorMode === "auto_protection"
      ? [
          { cell: "Robust Model!B46", label: "Given current participation: max floor", formula: "Optimization!B216", value: input.optimizedProtection },
          { cell: "Robust Model!B47", label: "Given current participation: minimum PnL", formula: "Optimization!B217", value: input.minScenarioPnlUsdt },
          { cell: "Optimization!B218", label: "Selected floor put strike at optimum", formula: "INDEX(Optimization!Q220:Q670, MATCH(B46, A220:A670, 0))", value: input.floorPutStrike },
          { cell: "Optimization!C218", label: "Selected floor put ask at optimum", formula: "INDEX(Optimization!R220:R670, MATCH(B46, A220:A670, 0))", value: floorPutLeg.averagePrice },
          { cell: "Optimization!A220:A670", label: "Candidate floor grid", formula: "50.0% to 95.0% in 0.1% steps", value: "grid" }
        ]
      : []),
    { cell: "Scenario PnL!C59", label: "Final BTC level", formula: "selected verification scenario expiry price", value: input.selectedScenario.expiryPrice },
    { cell: "Scenario PnL!C70", label: "Client payout USDT", formula: "principal floor or upside participation payoff", value: input.selectedScenario.clientPayoutUsdt },
    { cell: "Scenario PnL!C62", label: "ATM call payoff USDT", formula: "callContracts * MAX(expiryPrice - atmCallStrike, 0)", value: input.selectedScenario.callPayoffUsdt },
    { cell: "Scenario PnL!C64", label: "Short ATM put payoff USDT", formula: "-putContracts * MAX(atmPutStrike - expiryPrice, 0)", value: input.selectedScenario.shortPutPayoffUsdt },
    { cell: "Scenario PnL!C65", label: "Long floor put payoff USDT", formula: "putContracts * MAX(floorPutStrike - expiryPrice, 0)", value: input.selectedScenario.floorPutPayoffUsdt },
    { cell: "Scenario PnL!C66", label: "Gross hedge payoff USDT", formula: "call payoff + short put payoff + floor put payoff", value: input.selectedScenario.grossHedgePayoffUsdt },
    { cell: "Scenario PnL!C69", label: "Delivery fees USDT", formula: "Deribit delivery fee cap on exercised options", value: input.selectedScenario.deliveryFeesUsdt },
    { cell: "Scenario PnL!C72", label: "Issuer PnL USDT", formula: "notional + net option cash + hedge payoff - delivery fees - client payout", value: input.selectedScenario.issuerPnlUsdt }
  ];
}

function roundParticipationDown(participation: number | null, roundDownBps: number): number | null {
  if (participation === null || !Number.isFinite(participation)) return null;
  const incrementBps = Math.round(roundDownBps);
  if (incrementBps <= 0) return participation;
  return Math.floor((participation * 10000) / incrementBps) * incrementBps / 10000;
}

function mockPppLeg(
  role: PppCandidate["legs"][number]["role"],
  side: PppCandidate["legs"][number]["side"],
  instrumentName: string,
  strike: number,
  requiredContracts: number,
  averagePrice: number
): PppCandidate["legs"][number] {
  return {
    role,
    side,
    instrumentName,
    optionType: role === "long_call" ? "call" : "put",
    strike,
    requiredContracts,
    averagePrice,
    bestPrice: averagePrice,
    grossPremiumBtc: requiredContracts * averagePrice,
    tradingFeeBtc: requiredContracts * 0.0003,
    netCashBtc:
      side === "buy"
        ? -(requiredContracts * averagePrice + requiredContracts * 0.0003)
        : requiredContracts * averagePrice - requiredContracts * 0.0003,
    quoteAgeSeconds: 3,
    depth: {
      side,
      requiredContracts,
      filledContracts: requiredContracts,
      grossPremiumBtc: requiredContracts * averagePrice,
      averagePrice,
      bestPrice: averagePrice,
      bestAmount: requiredContracts,
      sufficientDepth: true,
      remainingContracts: 0,
      slippagePct: 0,
      fills: [{ price: averagePrice, amount: requiredContracts, notionalBtc: requiredContracts * averagePrice }]
    }
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
    spotPrice: 80000,
    spotInstrumentName: "BTC_USDC",
    spotTickerTimestamp: latestQuoteAt,
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
