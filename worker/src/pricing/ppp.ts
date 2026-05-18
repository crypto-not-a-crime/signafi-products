import { dayCountFromExpiry, type BidAskLevel, type FormulaTraceRow } from "./dcn";

export type PppLegRole = "long_call" | "short_put" | "long_floor_put";
export type PppLegSide = "buy" | "sell";
export type PppSelectorMode = "closest" | "auto_participation" | "auto_protection";
export type PppRecommendedLever = "none" | "participation" | "protection";

export interface PppPricingRequest {
  investmentUsdt?: number;
  runwayDays?: number;
  protectionLevelBps?: number;
  participationLevelBps?: number;
  selectorMode?: PppSelectorMode;
  targetFirmMarginBps?: number;
  includeDeliveryFees?: boolean;
  maxSlippageBps?: number;
  quoteFreshnessSeconds?: number;
  orderBookDepth?: number;
  nowMs?: number;
}

export interface PppMarketLegInput {
  instrumentName: string;
  optionType: "call" | "put";
  strike: number;
  expirationTimestamp: number;
  minTradeAmount?: number | null;
  bidPrice?: number | null;
  bidAmount?: number | null;
  askPrice?: number | null;
  askAmount?: number | null;
  deribitTimestamp?: number | null;
  ingestedAt?: number | null;
  bids?: BidAskLevel[];
  asks?: BidAskLevel[];
}

export interface PppMarketPackageInput {
  expirationTimestamp: number;
  spotPrice: number;
  atmCall: PppMarketLegInput;
  atmPut: PppMarketLegInput;
  floorPut: PppMarketLegInput;
  candidateProtectionLevel?: number;
}

export interface PppDepthFill {
  price: number;
  amount: number;
  notionalBtc: number;
}

export interface PppDepthModel {
  side: PppLegSide;
  requiredContracts: number;
  filledContracts: number;
  grossPremiumBtc: number;
  averagePrice: number | null;
  bestPrice: number | null;
  bestAmount: number | null;
  sufficientDepth: boolean;
  remainingContracts: number;
  slippagePct: number | null;
  fills: PppDepthFill[];
}

export interface PppHedgeLeg {
  role: PppLegRole;
  side: PppLegSide;
  instrumentName: string;
  optionType: "call" | "put";
  strike: number;
  requiredContracts: number;
  averagePrice: number | null;
  bestPrice: number | null;
  grossPremiumBtc: number | null;
  tradingFeeBtc: number | null;
  netCashBtc: number | null;
  quoteAgeSeconds: number | null;
  depth: PppDepthModel;
}

export interface PppScenarioResult {
  expiryPrice: number;
  clientPayoutUsdt: number;
  callPayoffUsdt: number;
  shortPutPayoffUsdt: number;
  floorPutPayoffUsdt: number;
  grossHedgePayoffUsdt: number;
  deliveryFeesUsdt: number;
  issuerPnlUsdt: number;
}

export interface PppCandidate {
  formulaTemplate: {
    id: string;
    version: string;
    label: string;
    sourceWorkbook: string;
    sourceSheets: string[];
    targetFirmMarginBps: number;
  };
  productType: "ppp";
  expirationTimestamp: number;
  dayCount: number;
  investmentUsdt: number;
  spotPrice: number;
  protectionLevel: number;
  protectionLevelBps: number;
  floorStrikeTarget: number;
  targetFirmMarginBps: number;
  targetProfitUsdt: number;
  optimizedParticipation: number | null;
  optimizedParticipationBps: number | null;
  optimalCallContracts: number;
  putSpreadContracts: number;
  atmCallStrike: number;
  atmPutStrike: number;
  floorPutStrike: number;
  putSpreadImpliedFloor: number | null;
  protectionGapBps: number | null;
  minScenarioPnlUsdt: number | null;
  stressPrice: number | null;
  netOptionCashBtc: number | null;
  netOptionCashUsdt: number | null;
  quoteAgeSeconds: number | null;
  maxSlippagePct: number | null;
  eligible: boolean;
  checks: Record<string, boolean>;
  legs: PppHedgeLeg[];
  selectedScenario: PppScenarioResult | null;
  scenarios: PppScenarioResult[];
  formulaTrace: FormulaTraceRow[];
  selectorMode: PppSelectorMode;
  recommendedLever: PppRecommendedLever;
  includeDeliveryFees: boolean;
  quotedParticipation: number | null;
  quotedParticipationBps: number | null;
  quotedProtection: number | null;
  quotedProtectionBps: number | null;
  optimizedProtection: number | null;
  optimizedProtectionBps: number | null;
  participationGapBps: number | null;
}

export interface PppPricingResponse {
  generatedAt: number;
  input: Record<string, unknown>;
  candidates: PppCandidate[];
  bestCandidate: PppCandidate | null;
  recommendation: {
    reason: string;
    selectorMode: PppSelectorMode;
    recommendedLever: PppRecommendedLever;
    runwayGapDays: number | null;
    protectionGapBps: number | null;
    participationGapBps: number | null;
    optimizedParticipationBps: number | null;
    optimizedProtectionBps: number | null;
  };
  mock?: boolean;
}

export const PPP_TEMPLATE = {
  id: "ppp-robust-model-v1",
  version: "2026-05-18",
  label: "Partial Principal Protected Robust Model",
  sourceWorkbook: "Partial_Prin_Protected.xlsx",
  sourceSheets: ["Robust Model", "Scenario PnL", "Optimization"],
  defaultTargetFirmMarginBps: 500,
  cells: {
    investmentUsdt: "Robust Model!B4",
    spotPrice: "Robust Model!B5",
    protectionLevel: "Robust Model!B7",
    selectedParticipation: "Robust Model!B8",
    clientParticipation: "Robust Model!B43",
    maxProtection: "Robust Model!B46",
    maxProtectionMinPnl: "Robust Model!B47",
    maxProtectionFloorStrike: "Optimization!B218",
    maxProtectionFloorAsk: "Optimization!C218",
    targetFirmMargin: "Robust Model!B9",
    targetProfit: "Robust Model!B10",
    includeDeliveryFees: "Robust Model!B12",
    atmCallAsk: "Robust Model!F5",
    atmPutBid: "Robust Model!F7",
    floorPutAsk: "Robust Model!F9",
    putSpreadContracts: "Robust Model!B20",
    callContracts: "Robust Model!B44",
    minScenarioPnl: "Robust Model!B45"
  }
} as const;

const CONTRACT_INCREMENT = 0.1;
const TRADING_FEE_CAP_BTC = 0.0003;
const DELIVERY_FEE_CAP_BTC = 0.00015;
const FEE_CAP_RATIO = 0.125;
const USE_COMBO_FEE_DISCOUNT = false;
const MAX_STRESS_MULTIPLIER = 3;
const MIN_PROTECTION_LEVEL = 0.1;
const AUTO_PROTECTION_MIN_BPS = 5000;
const AUTO_PROTECTION_MAX_BPS = 9500;
const AUTO_PROTECTION_STEP_BPS = 10;

export function normalizePppPricingRequest(
  request: PppPricingRequest,
  config: {
    pppTargetFirmMarginBps?: number;
    pppIncludeDeliveryFees?: boolean;
    quoteFreshnessSeconds: number;
    defaultOrderBookDepth: number;
    maxSlippageBps: number;
  }
): Required<Omit<PppPricingRequest, "nowMs">> & { nowMs?: number } {
  const selectorMode = normalizePppSelectorMode(request.selectorMode);
  return {
    investmentUsdt: positiveOr(request.investmentUsdt, 1_000_000),
    runwayDays: positiveOr(request.runwayDays, 92),
    protectionLevelBps: clamp(Math.round(Number(request.protectionLevelBps ?? 8000)), MIN_PROTECTION_LEVEL * 10000, 10000),
    participationLevelBps: clamp(Math.round(Number(request.participationLevelBps ?? 3000)), 0, 10000),
    selectorMode,
    targetFirmMarginBps: clamp(
      Math.round(Number(request.targetFirmMarginBps ?? config.pppTargetFirmMarginBps ?? PPP_TEMPLATE.defaultTargetFirmMarginBps)),
      0,
      10_000
    ),
    includeDeliveryFees:
      typeof request.includeDeliveryFees === "boolean"
        ? request.includeDeliveryFees
        : config.pppIncludeDeliveryFees !== false,
    maxSlippageBps: clamp(Math.round(Number(request.maxSlippageBps ?? config.maxSlippageBps)), 0, 10_000),
    quoteFreshnessSeconds: positiveOr(request.quoteFreshnessSeconds, config.quoteFreshnessSeconds),
    orderBookDepth: Math.max(1, Math.round(positiveOr(request.orderBookDepth, config.defaultOrderBookDepth))),
    nowMs: request.nowMs
  };
}

export function modelExecutableDepth({
  side,
  levels,
  requiredContracts,
  fallbackBestPrice,
  fallbackBestAmount
}: {
  side: PppLegSide;
  levels: BidAskLevel[] | undefined;
  requiredContracts: number;
  fallbackBestPrice?: number | null;
  fallbackBestAmount?: number | null;
}): PppDepthModel {
  if (!Number.isFinite(requiredContracts) || requiredContracts <= 0) {
    return {
      side,
      requiredContracts: 0,
      filledContracts: 0,
      grossPremiumBtc: 0,
      averagePrice: 0,
      bestPrice: null,
      bestAmount: null,
      sufficientDepth: true,
      remainingContracts: 0,
      slippagePct: 0,
      fills: []
    };
  }

  const usableLevels = (levels && levels.length > 0 ? levels : fallbackBestPrice ? [[fallbackBestPrice, fallbackBestAmount ?? 0]] : [])
    .filter(([price, amount]) => Number.isFinite(price) && price > 0 && Number.isFinite(amount) && amount > 0)
    .sort((a, b) => (side === "buy" ? a[0] - b[0] : b[0] - a[0]));

  const bestPrice = usableLevels[0]?.[0] ?? fallbackBestPrice ?? null;
  const bestAmount = usableLevels[0]?.[1] ?? fallbackBestAmount ?? null;
  let remaining = requiredContracts;
  let filled = 0;
  let premium = 0;
  const fills: PppDepthFill[] = [];

  for (const [price, amount] of usableLevels) {
    if (remaining <= 1e-9) break;
    const fillAmount = Math.min(remaining, amount);
    const notionalBtc = fillAmount * price;
    fills.push({ price, amount: fillAmount, notionalBtc });
    filled += fillAmount;
    premium += notionalBtc;
    remaining -= fillAmount;
  }

  const sufficientDepth = remaining <= 1e-9;
  const averagePrice = sufficientDepth && requiredContracts > 0 ? premium / requiredContracts : null;
  const slippagePct =
    averagePrice !== null && bestPrice && bestPrice > 0
      ? side === "buy"
        ? (averagePrice - bestPrice) / bestPrice
        : (bestPrice - averagePrice) / bestPrice
      : null;

  return {
    side,
    requiredContracts,
    filledContracts: filled,
    grossPremiumBtc: premium,
    averagePrice,
    bestPrice,
    bestAmount,
    sufficientDepth,
    remainingContracts: Math.max(0, remaining),
    slippagePct,
    fills
  };
}

export function calculatePppCandidate(request: PppPricingRequest, market: PppMarketPackageInput): PppCandidate {
  const nowMs = request.nowMs ?? Date.now();
  const selectorMode = normalizePppSelectorMode(request.selectorMode);
  const includeDeliveryFees = request.includeDeliveryFees !== false;
  const investmentUsdt = positiveOr(request.investmentUsdt, 1_000_000);
  const spotPrice = positiveOr(market.spotPrice, 0);
  const requestedProtectionLevel = clamp(Number(request.protectionLevelBps ?? 8000) / 10000, MIN_PROTECTION_LEVEL, 1);
  const selectedParticipation = clamp(Number(request.participationLevelBps ?? 3000) / 10000, 0, 1);
  const protectionLevel =
    selectorMode === "auto_protection"
      ? clamp(Number(market.candidateProtectionLevel ?? requestedProtectionLevel), 0.5, 0.95)
      : requestedProtectionLevel;
  const targetFirmMarginBps = clamp(Math.round(Number(request.targetFirmMarginBps ?? PPP_TEMPLATE.defaultTargetFirmMarginBps)), 0, 10_000);
  const targetFirmMargin = targetFirmMarginBps / 10000;
  const maxSlippageBps = clamp(Math.round(Number(request.maxSlippageBps ?? 500)), 0, 10_000);
  const quoteFreshnessSeconds = positiveOr(request.quoteFreshnessSeconds, 10);
  const dayCount = dayCountFromExpiry(market.expirationTimestamp, nowMs);
  const targetProfitUsdt = dayCount > 0 ? (dayCount / 365) * targetFirmMargin * investmentUsdt : 0;
  const putSpreadContracts = floorToIncrement(spotPrice > 0 ? investmentUsdt / spotPrice : 0, CONTRACT_INCREMENT);
  const putBidDepth = modelLegDepth("sell", putSpreadContracts, market.atmPut);
  const floorPutAskDepth = modelLegDepth("buy", putSpreadContracts, market.floorPut);
  const basePutLeg = buildLeg("short_put", "sell", market.atmPut, putSpreadContracts, putBidDepth, nowMs);
  const baseFloorLeg = buildLeg("long_floor_put", "buy", market.floorPut, putSpreadContracts, floorPutAskDepth, nowMs);
  let bestOptimization: OptimizationRow | null = null;

  if (selectorMode === "auto_participation") {
    const maxCallContracts = getMaxCallContracts(investmentUsdt, spotPrice);
    for (let callContracts = 0; callContracts <= maxCallContracts + 1e-9; callContracts = roundToDecimals(callContracts + CONTRACT_INCREMENT, 10)) {
      const callDepth = modelLegDepth("buy", callContracts, market.atmCall);
      if (!callDepth.sufficientDepth || callDepth.averagePrice === null) continue;
      const row = calculateOptimizationRow({
        callContracts,
        callAskPrice: callDepth.averagePrice,
        putBidPrice: putBidDepth.averagePrice,
        floorPutAskPrice: floorPutAskDepth.averagePrice,
        investmentUsdt,
        spotPrice,
        protectionLevel,
        targetProfitUsdt,
        putSpreadContracts,
        atmCallStrike: market.atmCall.strike,
        atmPutStrike: market.atmPut.strike,
        floorPutStrike: market.floorPut.strike,
        includeDeliveryFees
      });
      if (row.minScenarioPnlUsdt >= targetProfitUsdt) {
        bestOptimization = row;
      }
    }
  } else {
    const fixedCallContracts = ceilToIncrement(
      spotPrice > 0 ? (investmentUsdt * selectedParticipation) / spotPrice : 0,
      CONTRACT_INCREMENT
    );
    const callDepth = modelLegDepth("buy", fixedCallContracts, market.atmCall);
    if (callDepth.sufficientDepth && callDepth.averagePrice !== null) {
      bestOptimization = calculateFixedOptimizationRow({
        callContracts: fixedCallContracts,
        participation: selectedParticipation,
        callAskPrice: callDepth.averagePrice,
        putBidPrice: putBidDepth.averagePrice,
        floorPutAskPrice: floorPutAskDepth.averagePrice,
        investmentUsdt,
        spotPrice,
        protectionLevel,
        targetProfitUsdt,
        putSpreadContracts,
        atmCallStrike: market.atmCall.strike,
        atmPutStrike: market.atmPut.strike,
        floorPutStrike: market.floorPut.strike,
        includeDeliveryFees,
        includeProductFloorScenario: true
      });
    }
  }

  const optimalCallContracts = bestOptimization?.callContracts ?? 0;
  const callDepth = modelLegDepth("buy", optimalCallContracts, market.atmCall);
  const callLeg = buildLeg("long_call", "buy", market.atmCall, optimalCallContracts, callDepth, nowMs);
  const legs = [callLeg, basePutLeg, baseFloorLeg];
  const quoteAgeSeconds = maxNullable(legs.map((leg) => leg.quoteAgeSeconds));
  const maxSlippagePct = maxNullable(legs.map((leg) => leg.depth.slippagePct));
  const slippageWithinLimit = maxSlippagePct !== null && maxSlippagePct <= maxSlippageBps / 10000;
  const allDepthSufficient = legs.every((leg) => leg.depth.sufficientDepth);
  const quotesFresh = legs.every((leg) => leg.quoteAgeSeconds !== null && leg.quoteAgeSeconds <= quoteFreshnessSeconds);
  const participation = bestOptimization?.participation ?? null;
  const quotedParticipation = selectorMode === "auto_participation" ? participation : selectedParticipation;
  const actualCallHedgeParticipation =
    investmentUsdt > 0
      ? (optimalCallContracts * spotPrice) / investmentUsdt * (1 - (includeDeliveryFees ? DELIVERY_FEE_CAP_BTC : 0))
      : null;
  const participationGapBps =
    selectorMode === "auto_participation" || quotedParticipation === null || actualCallHedgeParticipation === null
      ? null
      : Math.abs(actualCallHedgeParticipation - quotedParticipation) * 10000;
  const minScenarioPnlUsdt = bestOptimization?.minScenarioPnlUsdt ?? null;
  const stressPrice = bestOptimization?.stressPrice ?? null;
  const netOptionCashBtc = bestOptimization?.netOptionCashBtc ?? null;
  const netOptionCashUsdt = bestOptimization?.netOptionCashUsdt ?? null;
  const selectedScenario =
    bestOptimization && quotedParticipation !== null
      ? calculatePppScenario(market.atmPut.strike, {
          investmentUsdt,
          spotPrice,
          protectionLevel,
          participation: quotedParticipation,
          callContracts: optimalCallContracts,
          putSpreadContracts,
          atmCallStrike: market.atmCall.strike,
          atmPutStrike: market.atmPut.strike,
          floorPutStrike: market.floorPut.strike,
          initialOptionCashUsdt: netOptionCashUsdt ?? 0,
          includeDeliveryFees
        })
      : null;
  const scenarios = bestOptimization?.scenarios ?? [];
  const putSpreadImpliedFloor =
    investmentUsdt > 0 ? 1 - (putSpreadContracts * (market.atmPut.strike - market.floorPut.strike)) / investmentUsdt : null;
  const protectionGapBps = putSpreadImpliedFloor === null ? null : Math.abs(putSpreadImpliedFloor - protectionLevel) * 10000;

  const checks = {
    spotValid: spotPrice > 0,
    expiryValid: dayCount > 0,
    quoteFresh: quotesFresh,
    sufficientDepth: allDepthSufficient,
    slippageWithinLimit,
    participationPositive: quotedParticipation !== null && quotedParticipation > 0,
    targetProfitMet: minScenarioPnlUsdt !== null && minScenarioPnlUsdt >= targetProfitUsdt,
    floorAtOrAboveProtection: putSpreadImpliedFloor !== null && putSpreadImpliedFloor >= protectionLevel,
    callHedgeAtOrAboveParticipation:
      selectorMode === "auto_participation" ||
      (quotedParticipation !== null && actualCallHedgeParticipation !== null && actualCallHedgeParticipation + 1e-12 >= quotedParticipation)
  };
  const eligible = Object.values(checks).every(Boolean);
  const recommendedLever = getPppRecommendedLever(selectorMode);

  return {
    formulaTemplate: {
      id: PPP_TEMPLATE.id,
      version: PPP_TEMPLATE.version,
      label: PPP_TEMPLATE.label,
      sourceWorkbook: PPP_TEMPLATE.sourceWorkbook,
      sourceSheets: [...PPP_TEMPLATE.sourceSheets],
      targetFirmMarginBps
    },
    productType: "ppp",
    expirationTimestamp: market.expirationTimestamp,
    dayCount,
    investmentUsdt,
    spotPrice,
    protectionLevel,
    protectionLevelBps: Math.round(protectionLevel * 10000),
    floorStrikeTarget: spotPrice * protectionLevel,
    targetFirmMarginBps,
    targetProfitUsdt,
    optimizedParticipation: selectorMode === "auto_participation" ? participation : null,
    optimizedParticipationBps: selectorMode === "auto_participation" && participation !== null ? participation * 10000 : null,
    optimalCallContracts,
    putSpreadContracts,
    atmCallStrike: market.atmCall.strike,
    atmPutStrike: market.atmPut.strike,
    floorPutStrike: market.floorPut.strike,
    putSpreadImpliedFloor,
    protectionGapBps,
    minScenarioPnlUsdt,
    stressPrice,
    netOptionCashBtc,
    netOptionCashUsdt,
    quoteAgeSeconds,
    maxSlippagePct,
    eligible,
    checks,
    legs,
    selectedScenario,
    scenarios,
    selectorMode,
    recommendedLever,
    includeDeliveryFees,
    quotedParticipation,
    quotedParticipationBps: quotedParticipation === null ? null : quotedParticipation * 10000,
    quotedProtection: protectionLevel,
    quotedProtectionBps: protectionLevel * 10000,
    optimizedProtection: selectorMode === "auto_protection" ? protectionLevel : null,
    optimizedProtectionBps: selectorMode === "auto_protection" ? protectionLevel * 10000 : null,
    participationGapBps,
    formulaTrace: buildFormulaTrace({
      selectorMode,
      includeDeliveryFees,
      investmentUsdt,
      spotPrice,
      protectionLevel,
      selectedParticipation,
      targetFirmMargin,
      targetProfitUsdt,
      callLeg,
      putLeg: basePutLeg,
      floorPutLeg: baseFloorLeg,
      participation: quotedParticipation,
      optimalCallContracts,
      putSpreadContracts,
      putSpreadImpliedFloor,
      minScenarioPnlUsdt,
      stressPrice,
      netOptionCashBtc,
      netOptionCashUsdt,
      optimizedProtection: selectorMode === "auto_protection" ? protectionLevel : null,
      autoProtectionFloorStrike: selectorMode === "auto_protection" ? market.floorPut.strike : null,
      autoProtectionFloorAsk: selectorMode === "auto_protection" ? baseFloorLeg.averagePrice : null,
      selectedScenario
    })
  };
}

export function selectPppCandidate(
  request: Required<Omit<PppPricingRequest, "nowMs">> & { nowMs?: number },
  candidates: PppCandidate[]
): PppPricingResponse["recommendation"] & { candidates: PppCandidate[]; bestCandidate: PppCandidate | null } {
  const sorted = [...candidates].sort((a, b) => comparePppCandidates(request, a, b));
  const bestCandidate = sorted.find((candidate) => candidate.eligible) ?? null;
  const selectorMode = normalizePppSelectorMode(request.selectorMode);
  const recommendedLever = getPppRecommendedLever(selectorMode);
  return {
    candidates: sorted,
    bestCandidate,
    reason: bestCandidate
      ? selectorMode === "auto_protection"
        ? "Closest executable PPP package by duration, with max client protection quoted for the selected participation."
        : selectorMode === "closest"
          ? "Closest executable PPP package by duration, protection, and participation."
          : "Closest executable PPP package by duration and protection, with max client participation quoted."
      : selectorMode === "auto_protection"
        ? "No PPP package passed the duration, participation, depth, freshness, slippage, and target margin checks."
        : "No PPP package passed the duration, protection, depth, freshness, slippage, and target margin checks.",
    selectorMode,
    recommendedLever,
    runwayGapDays: bestCandidate ? Math.abs(bestCandidate.dayCount - request.runwayDays) : null,
    protectionGapBps: bestCandidate?.protectionGapBps ?? null,
    participationGapBps: bestCandidate?.participationGapBps ?? null,
    optimizedParticipationBps: bestCandidate?.optimizedParticipationBps ?? null,
    optimizedProtectionBps: bestCandidate?.optimizedProtectionBps ?? null
  };
}

export function scorePppPackageForShortlist(
  request: Pick<PppPricingRequest, "runwayDays" | "protectionLevelBps" | "selectorMode">,
  market: PppMarketPackageInput,
  nowMs = Date.now()
): number {
  const dayCount = dayCountFromExpiry(market.expirationTimestamp, nowMs);
  const runwayDays = positiveOr(request.runwayDays, 92);
  const selectorMode = normalizePppSelectorMode(request.selectorMode);
  const protection = clamp(Number(request.protectionLevelBps ?? 8000) / 10000, MIN_PROTECTION_LEVEL, 1);
  const durationGap = Math.abs(dayCount - runwayDays) / Math.max(runwayDays, 1);
  if (selectorMode === "auto_protection") {
    const candidateProtection = finiteOr(market.candidateProtectionLevel, 0);
    const atmGap = market.spotPrice > 0 ? Math.abs(market.atmCall.strike / market.spotPrice - 1) : Infinity;
    return 1_000_000 - durationGap * 100_000 + candidateProtection * 50_000 - atmGap * 10_000;
  }
  const floorStrikeGap = market.spotPrice > 0 ? Math.abs(market.floorPut.strike / market.spotPrice - protection) : Infinity;
  const atmGap = market.spotPrice > 0 ? Math.abs(market.atmCall.strike / market.spotPrice - 1) : Infinity;
  return 1_000_000 - durationGap * 100_000 - floorStrikeGap * 80_000 - atmGap * 10_000;
}

function comparePppCandidates(
  request: Required<Omit<PppPricingRequest, "nowMs">> & { nowMs?: number },
  a: PppCandidate,
  b: PppCandidate
): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  const selectorMode = normalizePppSelectorMode(request.selectorMode);
  const aDurationGap = Math.abs(a.dayCount - request.runwayDays);
  const bDurationGap = Math.abs(b.dayCount - request.runwayDays);
  if (aDurationGap !== bDurationGap) return aDurationGap - bDurationGap;
  if (selectorMode === "auto_protection") {
    const protection = compareDesc(a.optimizedProtection ?? a.quotedProtection, b.optimizedProtection ?? b.quotedProtection);
    if (protection !== 0) return protection;
    const participationGap = compareAsc(a.participationGapBps, b.participationGapBps);
    if (participationGap !== 0) return participationGap;
  }
  const protectionGap = compareAsc(a.protectionGapBps, b.protectionGapBps);
  if (protectionGap !== 0) return protectionGap;
  if (selectorMode === "closest") {
    const participationGap = compareAsc(a.participationGapBps, b.participationGapBps);
    if (participationGap !== 0) return participationGap;
  }
  const participation = compareDesc(a.optimizedParticipation, b.optimizedParticipation);
  if (participation !== 0) return participation;
  const quoteAge = compareAsc(a.quoteAgeSeconds, b.quoteAgeSeconds);
  if (quoteAge !== 0) return quoteAge;
  return compareAsc(a.maxSlippagePct, b.maxSlippagePct);
}

function calculateOptimizationRow({
  callContracts,
  callAskPrice,
  putBidPrice,
  floorPutAskPrice,
  investmentUsdt,
  spotPrice,
  protectionLevel,
  targetProfitUsdt,
  putSpreadContracts,
  atmCallStrike,
  atmPutStrike,
  floorPutStrike,
  includeDeliveryFees
}: {
  callContracts: number;
  callAskPrice: number | null;
  putBidPrice: number | null;
  floorPutAskPrice: number | null;
  investmentUsdt: number;
  spotPrice: number;
  protectionLevel: number;
  targetProfitUsdt: number;
  putSpreadContracts: number;
  atmCallStrike: number;
  atmPutStrike: number;
  floorPutStrike: number;
  includeDeliveryFees: boolean;
}): OptimizationRow {
  const buyFees =
    tradingFeeBtc(callAskPrice) * callContracts + tradingFeeBtc(floorPutAskPrice) * putSpreadContracts;
  const sellFees = tradingFeeBtc(putBidPrice) * putSpreadContracts;
  const tradingFeesBtc = USE_COMBO_FEE_DISCOUNT ? Math.max(buyFees, sellFees) : buyFees + sellFees;
  const grossPutSpreadCreditBtc = putSpreadContracts * ((putBidPrice ?? 0) - (floorPutAskPrice ?? 0));
  const callPremiumCostBtc = callContracts * (callAskPrice ?? 0);
  const netOptionCashBtc = grossPutSpreadCreditBtc - callPremiumCostBtc - tradingFeesBtc;
  const netOptionCashUsdt = netOptionCashBtc * spotPrice;
  const participation =
    investmentUsdt > 0 ? callContracts * spotPrice / investmentUsdt * (1 - (includeDeliveryFees ? DELIVERY_FEE_CAP_BTC : 0)) : 0;
  const scenarioPrices = getOptimizationScenarioPrices({ spotPrice, atmCallStrike, atmPutStrike, floorPutStrike, includeDeliveryFees });
  const scenarioInputs = {
    investmentUsdt,
    spotPrice,
    protectionLevel,
    participation,
    callContracts,
    putSpreadContracts,
    atmCallStrike,
    atmPutStrike,
    floorPutStrike,
    initialOptionCashUsdt: netOptionCashUsdt,
    includeDeliveryFees
  };
  const scenarios = scenarioPrices.map((expiryPrice) => calculatePppScenario(expiryPrice, scenarioInputs));
  const minScenario = scenarios.reduce((min, scenario) => (scenario.issuerPnlUsdt < min.issuerPnlUsdt ? scenario : min), scenarios[0]);

  return {
    callContracts,
    participation,
    netOptionCashBtc,
    netOptionCashUsdt,
    minScenarioPnlUsdt: minScenario?.issuerPnlUsdt ?? -Infinity,
    stressPrice: minScenario?.expiryPrice ?? null,
    targetPass: (minScenario?.issuerPnlUsdt ?? -Infinity) >= targetProfitUsdt,
    upsideSlopeSafe: true,
    scenarios
  };
}

function calculateFixedOptimizationRow({
  callContracts,
  participation,
  callAskPrice,
  putBidPrice,
  floorPutAskPrice,
  investmentUsdt,
  spotPrice,
  protectionLevel,
  targetProfitUsdt,
  putSpreadContracts,
  atmCallStrike,
  atmPutStrike,
  floorPutStrike,
  includeDeliveryFees,
  includeProductFloorScenario
}: {
  callContracts: number;
  participation: number;
  callAskPrice: number | null;
  putBidPrice: number | null;
  floorPutAskPrice: number | null;
  investmentUsdt: number;
  spotPrice: number;
  protectionLevel: number;
  targetProfitUsdt: number;
  putSpreadContracts: number;
  atmCallStrike: number;
  atmPutStrike: number;
  floorPutStrike: number;
  includeDeliveryFees: boolean;
  includeProductFloorScenario: boolean;
}): OptimizationRow {
  const buyFees =
    tradingFeeBtc(callAskPrice) * callContracts + tradingFeeBtc(floorPutAskPrice) * putSpreadContracts;
  const sellFees = tradingFeeBtc(putBidPrice) * putSpreadContracts;
  const tradingFeesBtc = USE_COMBO_FEE_DISCOUNT ? Math.max(buyFees, sellFees) : buyFees + sellFees;
  const grossPutSpreadCreditBtc = putSpreadContracts * ((putBidPrice ?? 0) - (floorPutAskPrice ?? 0));
  const callPremiumCostBtc = callContracts * (callAskPrice ?? 0);
  const netOptionCashBtc = grossPutSpreadCreditBtc - callPremiumCostBtc - tradingFeesBtc;
  const netOptionCashUsdt = netOptionCashBtc * spotPrice;
  const actualCallHedgeParticipation =
    investmentUsdt > 0 ? (callContracts * spotPrice) / investmentUsdt * (1 - (includeDeliveryFees ? DELIVERY_FEE_CAP_BTC : 0)) : 0;
  const upsideSlopeSafe = participation <= actualCallHedgeParticipation + 1e-12;
  const scenarioPrices = getOptimizationScenarioPrices({
    spotPrice,
    atmCallStrike,
    atmPutStrike,
    floorPutStrike,
    protectionLevel,
    includeDeliveryFees,
    includeProductFloorScenario
  });
  const scenarioInputs = {
    investmentUsdt,
    spotPrice,
    protectionLevel,
    participation,
    callContracts,
    putSpreadContracts,
    atmCallStrike,
    atmPutStrike,
    floorPutStrike,
    initialOptionCashUsdt: netOptionCashUsdt,
    includeDeliveryFees
  };
  const scenarios = scenarioPrices.map((expiryPrice) => calculatePppScenario(expiryPrice, scenarioInputs));
  const minScenario = scenarios.reduce((min, scenario) => (scenario.issuerPnlUsdt < min.issuerPnlUsdt ? scenario : min), scenarios[0]);
  const minScenarioPnlUsdt = upsideSlopeSafe ? minScenario?.issuerPnlUsdt ?? -Infinity : -Infinity;

  return {
    callContracts,
    participation,
    netOptionCashBtc,
    netOptionCashUsdt,
    minScenarioPnlUsdt,
    stressPrice: minScenario?.expiryPrice ?? null,
    targetPass: minScenarioPnlUsdt >= targetProfitUsdt,
    upsideSlopeSafe,
    scenarios
  };
}

function calculatePppScenario(
  expiryPrice: number,
  input: {
    investmentUsdt: number;
    spotPrice: number;
    protectionLevel: number;
    participation: number;
    callContracts: number;
    putSpreadContracts: number;
    atmCallStrike: number;
    atmPutStrike: number;
    floorPutStrike: number;
    initialOptionCashUsdt: number;
    includeDeliveryFees: boolean;
  }
): PppScenarioResult {
  const clientPayoutUsdt =
    expiryPrice > input.spotPrice
      ? input.investmentUsdt * (1 + input.participation * (expiryPrice / input.spotPrice - 1))
      : input.investmentUsdt * Math.max(expiryPrice / input.spotPrice, input.protectionLevel);
  const callPayoffUsdt = input.callContracts * Math.max(expiryPrice - input.atmCallStrike, 0);
  const shortPutPayoffUsdt = -input.putSpreadContracts * Math.max(input.atmPutStrike - expiryPrice, 0);
  const floorPutPayoffUsdt = input.putSpreadContracts * Math.max(input.floorPutStrike - expiryPrice, 0);
  const grossHedgePayoffUsdt = callPayoffUsdt + shortPutPayoffUsdt + floorPutPayoffUsdt;
  const deliveryFeesUsdt = input.includeDeliveryFees
    ? deliveryFeeUsdt("call", expiryPrice, input.atmCallStrike, input.callContracts) +
      deliveryFeeUsdt("put", expiryPrice, input.atmPutStrike, input.putSpreadContracts) +
      deliveryFeeUsdt("put", expiryPrice, input.floorPutStrike, input.putSpreadContracts)
    : 0;
  const issuerPnlUsdt =
    input.investmentUsdt + input.initialOptionCashUsdt + grossHedgePayoffUsdt - deliveryFeesUsdt - clientPayoutUsdt;
  return {
    expiryPrice,
    clientPayoutUsdt,
    callPayoffUsdt,
    shortPutPayoffUsdt,
    floorPutPayoffUsdt,
    grossHedgePayoffUsdt,
    deliveryFeesUsdt,
    issuerPnlUsdt
  };
}

function getOptimizationScenarioPrices({
  spotPrice,
  atmCallStrike,
  atmPutStrike,
  floorPutStrike,
  protectionLevel,
  includeDeliveryFees,
  includeProductFloorScenario = false
}: {
  spotPrice: number;
  atmCallStrike: number;
  atmPutStrike: number;
  floorPutStrike: number;
  protectionLevel?: number;
  includeDeliveryFees: boolean;
  includeProductFloorScenario?: boolean;
}): number[] {
  const prices = [
    0,
    includeProductFloorScenario && protectionLevel !== undefined ? protectionLevel * spotPrice : null,
    includeDeliveryFees ? floorPutStrike / (1 + DELIVERY_FEE_CAP_BTC / FEE_CAP_RATIO) : floorPutStrike,
    floorPutStrike,
    includeDeliveryFees ? atmPutStrike / (1 + DELIVERY_FEE_CAP_BTC / FEE_CAP_RATIO) : atmPutStrike,
    atmPutStrike,
    includeDeliveryFees ? atmCallStrike / (1 - DELIVERY_FEE_CAP_BTC / FEE_CAP_RATIO) : atmCallStrike,
    spotPrice,
    MAX_STRESS_MULTIPLIER * spotPrice
  ];
  return Array.from(
    new Set(
      prices
        .filter((price): price is number => typeof price === "number" && Number.isFinite(price))
        .map((price) => roundToDecimals(Math.max(0, price), 8))
    )
  ).sort((a, b) => a - b);
}

function modelLegDepth(side: PppLegSide, requiredContracts: number, leg: PppMarketLegInput): PppDepthModel {
  return modelExecutableDepth({
    side,
    levels: side === "buy" ? leg.asks : leg.bids,
    requiredContracts,
    fallbackBestPrice: side === "buy" ? leg.askPrice : leg.bidPrice,
    fallbackBestAmount: side === "buy" ? leg.askAmount : leg.bidAmount
  });
}

function buildLeg(
  role: PppLegRole,
  side: PppLegSide,
  leg: PppMarketLegInput,
  requiredContracts: number,
  depth: PppDepthModel,
  nowMs: number
): PppHedgeLeg {
  const fee = tradingFeeBtc(depth.averagePrice) * requiredContracts;
  const grossPremiumBtc = depth.averagePrice === null ? null : requiredContracts * depth.averagePrice;
  const quoteTime = leg.deribitTimestamp ?? leg.ingestedAt ?? null;
  const quoteAgeSeconds = quoteTime ? Math.max(0, (nowMs - quoteTime) / 1000) : null;
  return {
    role,
    side,
    instrumentName: leg.instrumentName,
    optionType: leg.optionType,
    strike: leg.strike,
    requiredContracts,
    averagePrice: depth.averagePrice,
    bestPrice: depth.bestPrice,
    grossPremiumBtc,
    tradingFeeBtc: Number.isFinite(fee) ? fee : null,
    netCashBtc: grossPremiumBtc === null ? null : side === "buy" ? -grossPremiumBtc - fee : grossPremiumBtc - fee,
    quoteAgeSeconds,
    depth
  };
}

function buildFormulaTrace(input: {
  selectorMode: PppSelectorMode;
  includeDeliveryFees: boolean;
  investmentUsdt: number;
  spotPrice: number;
  protectionLevel: number;
  selectedParticipation: number;
  targetFirmMargin: number;
  targetProfitUsdt: number;
  callLeg: PppHedgeLeg;
  putLeg: PppHedgeLeg;
  floorPutLeg: PppHedgeLeg;
  participation: number | null;
  optimalCallContracts: number;
  putSpreadContracts: number;
  putSpreadImpliedFloor: number | null;
  minScenarioPnlUsdt: number | null;
  stressPrice: number | null;
  netOptionCashBtc: number | null;
  netOptionCashUsdt: number | null;
  optimizedProtection: number | null;
  autoProtectionFloorStrike: number | null;
  autoProtectionFloorAsk: number | null;
  selectedScenario: PppScenarioResult | null;
}): FormulaTraceRow[] {
  const exactPutSpreadContracts = input.spotPrice > 0 ? input.investmentUsdt / input.spotPrice : null;
  const exactCallContracts =
    input.spotPrice > 0 && input.participation !== null ? (input.investmentUsdt * input.participation) / input.spotPrice : null;
  const actualCallHedgeParticipation =
    input.investmentUsdt > 0 ? (input.optimalCallContracts * input.spotPrice) / input.investmentUsdt : null;
  const protectionGap =
    input.putSpreadImpliedFloor === null ? null : (input.putSpreadImpliedFloor - input.protectionLevel) * 10000;
  const buyLegTradingFeesBtc = addNullable(input.callLeg.tradingFeeBtc, input.floorPutLeg.tradingFeeBtc);
  const sellLegTradingFeesBtc = input.putLeg.tradingFeeBtc;
  const totalTradingFeesBtc =
    buyLegTradingFeesBtc === null || sellLegTradingFeesBtc === null
      ? null
      : USE_COMBO_FEE_DISCOUNT
        ? Math.max(buyLegTradingFeesBtc, sellLegTradingFeesBtc)
        : buyLegTradingFeesBtc + sellLegTradingFeesBtc;
  const grossPutSpreadCreditBtc =
    input.putLeg.averagePrice === null || input.floorPutLeg.averagePrice === null
      ? null
      : input.putSpreadContracts * (input.putLeg.averagePrice - input.floorPutLeg.averagePrice);
  const callPremiumCostBtc =
    input.callLeg.averagePrice === null ? null : input.optimalCallContracts * input.callLeg.averagePrice;
  const targetProfitMet =
    input.minScenarioPnlUsdt === null ? false : input.minScenarioPnlUsdt >= input.targetProfitUsdt;
  const rows: FormulaTraceRow[] = [
    { cell: PPP_TEMPLATE.cells.investmentUsdt, label: "Notional invested", formula: "user input", value: input.investmentUsdt },
    { cell: PPP_TEMPLATE.cells.spotPrice, label: "Product reference spot S0", formula: "Deribit BTC_USDC spot mid", value: input.spotPrice },
    { cell: PPP_TEMPLATE.cells.protectionLevel, label: "Product floor return", formula: "selected protectionLevelBps / 10000", value: input.protectionLevel },
    { cell: PPP_TEMPLATE.cells.selectedParticipation, label: "Client participation quote", formula: "selected participationLevelBps / 10000", value: input.selectedParticipation },
    { cell: PPP_TEMPLATE.cells.targetFirmMargin, label: "Target firm margin", formula: "saved PPP targetFirmMarginBps / 10000", value: input.targetFirmMargin },
    { cell: PPP_TEMPLATE.cells.targetProfit, label: "Target profit amount", formula: "dayCount / 365 * targetFirmMargin * notional", value: input.targetProfitUsdt },
    { cell: PPP_TEMPLATE.cells.includeDeliveryFees, label: "Include delivery fees", formula: "saved/admin PPP delivery-fee checkbox", value: input.includeDeliveryFees },
    { cell: "Robust Model!F4", label: "ATM call strike", formula: "closest listed call strike to S0", value: input.callLeg.strike },
    { cell: PPP_TEMPLATE.cells.atmCallAsk, label: "ATM call ask premium", formula: "depth-weighted executable ask", value: input.callLeg.averagePrice },
    { cell: "Robust Model!F6", label: "ATM put strike", formula: "closest listed put strike to S0", value: input.putLeg.strike },
    { cell: PPP_TEMPLATE.cells.atmPutBid, label: "ATM put bid premium", formula: "depth-weighted executable bid", value: input.putLeg.averagePrice },
    { cell: "Robust Model!F8", label: "Floor put strike", formula: "closest listed put strike to S0 * protection", value: input.floorPutLeg.strike },
    { cell: PPP_TEMPLATE.cells.floorPutAsk, label: "Floor put ask premium", formula: "depth-weighted executable ask", value: input.floorPutLeg.averagePrice },
    { cell: "Robust Model!B19", label: "Put-spread contracts exact", formula: "notional / S0", value: exactPutSpreadContracts },
    { cell: PPP_TEMPLATE.cells.putSpreadContracts, label: "Put-spread contracts used", formula: "FLOOR(notional / S0 / 0.1, 1) * 0.1", value: input.putSpreadContracts },
    { cell: "Robust Model!B21", label: "Call contracts exact", formula: "notional * maxParticipation / S0", value: exactCallContracts },
    { cell: PPP_TEMPLATE.cells.callContracts, label: "Optimal call contracts", formula: "last Optimization row where min PnL >= target profit", value: input.optimalCallContracts },
    { cell: "Robust Model!B23", label: "Actual call hedge participation", formula: "optimalCallContracts * S0 / notional", value: actualCallHedgeParticipation },
    { cell: PPP_TEMPLATE.cells.clientParticipation, label: "Max client participation", formula: "callContracts * S0 / notional * (1 - delivery fee cap)", value: input.participation },
    { cell: "Robust Model!B24", label: "Put-spread implied floor", formula: "1 - putContracts * (atmPutStrike - floorPutStrike) / notional", value: input.putSpreadImpliedFloor },
    { cell: "Robust Model!B25", label: "Protection gap", formula: "(putSpreadImpliedFloor - selectedFloorReturn) * 10000", value: protectionGap },
    { cell: "Robust Model!B30", label: "Buy-leg trading fees BTC", formula: "ATM call fee + floor put fee", value: buyLegTradingFeesBtc },
    { cell: "Robust Model!B31", label: "Sell-leg trading fees BTC", formula: "ATM put fee", value: sellLegTradingFeesBtc },
    { cell: "Robust Model!B32", label: "Total trading fees BTC", formula: "buy fees + sell fees", value: totalTradingFeesBtc },
    { cell: "Robust Model!B33", label: "Gross put-spread credit BTC", formula: "putContracts * (atmPutBid - floorPutAsk)", value: grossPutSpreadCreditBtc },
    { cell: "Robust Model!B34", label: "Call premium cost BTC", formula: "optimalCallContracts * atmCallAsk", value: callPremiumCostBtc },
    { cell: "Robust Model!B35", label: "Net inception option cash", formula: "put spread credit - call cost - trading fees", value: input.netOptionCashBtc },
    { cell: "Robust Model!B36", label: "Net inception option cash", formula: "netOptionCashBTC * BTC_USDC spot mid", value: input.netOptionCashUsdt },
    { cell: PPP_TEMPLATE.cells.minScenarioPnl, label: "Minimum PnL at optimum", formula: "MIN(Optimization scenario checks)", value: input.minScenarioPnlUsdt },
    { cell: "Robust Model!B38", label: "Stress price at minimum PnL", formula: "price where optimized scenario PnL is lowest", value: input.stressPrice },
    { cell: "Robust Model!B39", label: "Target profit check", formula: "minimum scenario PnL >= target profit", value: targetProfitMet ? "PASS" : "FAIL" }
  ];

  if (input.selectorMode === "auto_protection") {
    rows.push(
      {
        cell: PPP_TEMPLATE.cells.maxProtection,
        label: "Given current participation: max floor",
        formula: "Optimization!B216",
        value: input.optimizedProtection
      },
      {
        cell: PPP_TEMPLATE.cells.maxProtectionMinPnl,
        label: "Given current participation: minimum PnL",
        formula: "Optimization!B217",
        value: input.minScenarioPnlUsdt
      },
      {
        cell: PPP_TEMPLATE.cells.maxProtectionFloorStrike,
        label: "Selected floor put strike at optimum",
        formula: "INDEX(Optimization!Q220:Q670, MATCH(B46, A220:A670, 0))",
        value: input.autoProtectionFloorStrike
      },
      {
        cell: PPP_TEMPLATE.cells.maxProtectionFloorAsk,
        label: "Selected floor put ask at optimum",
        formula: "INDEX(Optimization!R220:R670, MATCH(B46, A220:A670, 0))",
        value: input.autoProtectionFloorAsk
      },
      {
        cell: "Optimization!A220:A670",
        label: "Candidate floor grid",
        formula: "50.0% to 95.0% in 0.1% steps",
        value: "grid"
      },
      {
        cell: "Optimization!O220:O670",
        label: "Auto-protection PnL pass range",
        formula: "row min PnL, gated by call hedge participation safety",
        value: targetProfitMet ? "PASS" : "FAIL"
      }
    );
  }

  if (input.selectedScenario) {
    rows.push(
      { cell: "Scenario PnL!C59", label: "Final BTC level", formula: "selected verification scenario expiry price", value: input.selectedScenario.expiryPrice },
      {
        cell: "Scenario PnL!C70",
        label: "Client payout USDT",
        formula: "principal floor or upside participation payoff",
        value: input.selectedScenario.clientPayoutUsdt
      },
      { cell: "Scenario PnL!C62", label: "ATM call payoff USDT", formula: "callContracts * MAX(expiryPrice - atmCallStrike, 0)", value: input.selectedScenario.callPayoffUsdt },
      { cell: "Scenario PnL!C64", label: "Short ATM put payoff USDT", formula: "-putContracts * MAX(atmPutStrike - expiryPrice, 0)", value: input.selectedScenario.shortPutPayoffUsdt },
      { cell: "Scenario PnL!C65", label: "Long floor put payoff USDT", formula: "putContracts * MAX(floorPutStrike - expiryPrice, 0)", value: input.selectedScenario.floorPutPayoffUsdt },
      { cell: "Scenario PnL!C66", label: "Gross hedge payoff USDT", formula: "call payoff + short put payoff + floor put payoff", value: input.selectedScenario.grossHedgePayoffUsdt },
      { cell: "Scenario PnL!C69", label: "Delivery fees USDT", formula: "Deribit delivery fee cap on exercised options", value: input.selectedScenario.deliveryFeesUsdt },
      {
        cell: "Scenario PnL!C72",
        label: "Issuer PnL USDT",
        formula: "notional + net option cash + hedge payoff - delivery fees - client payout",
        value: input.selectedScenario.issuerPnlUsdt
      }
    );
  }

  return rows;
}

function getMaxCallContracts(investmentUsdt: number, spotPrice: number): number {
  const notionalContracts = spotPrice > 0 ? investmentUsdt / spotPrice : 0;
  return ceilToIncrement(Math.max(20, notionalContracts * 2), CONTRACT_INCREMENT);
}

function tradingFeeBtc(optionPrice: number | null): number {
  return optionPrice !== null && Number.isFinite(optionPrice) && optionPrice > 0
    ? Math.min(TRADING_FEE_CAP_BTC, FEE_CAP_RATIO * optionPrice)
    : 0;
}

function deliveryFeeUsdt(optionType: "call" | "put", expiryPrice: number, strike: number, contracts: number): number {
  if (expiryPrice <= 0 || contracts <= 0) return 0;
  const intrinsicBtc =
    optionType === "call"
      ? Math.max(expiryPrice - strike, 0) / expiryPrice
      : Math.max(strike - expiryPrice, 0) / expiryPrice;
  return Math.min(DELIVERY_FEE_CAP_BTC, FEE_CAP_RATIO * intrinsicBtc) * contracts * expiryPrice;
}

function floorToIncrement(value: number, increment: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return roundToDecimals(Math.floor(value / increment) * increment, 10);
}

function ceilToIncrement(value: number, increment: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return roundToDecimals(Math.ceil(value / increment) * increment, 10);
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizePppSelectorMode(mode: PppPricingRequest["selectorMode"]): PppSelectorMode {
  return mode === "closest" || mode === "auto_protection" ? mode : "auto_participation";
}

function getPppRecommendedLever(selectorMode: PppSelectorMode): PppRecommendedLever {
  if (selectorMode === "auto_participation") return "participation";
  if (selectorMode === "auto_protection") return "protection";
  return "none";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function maxNullable(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length > 0 ? Math.max(...finite) : null;
}

function addNullable(...values: Array<number | null>): number | null {
  return values.every((value): value is number => typeof value === "number" && Number.isFinite(value))
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

function compareAsc(a: number | null | undefined, b: number | null | undefined): number {
  const av = typeof a === "number" && Number.isFinite(a) ? a : Infinity;
  const bv = typeof b === "number" && Number.isFinite(b) ? b : Infinity;
  return av === bv ? 0 : av - bv;
}

function compareDesc(a: number | null | undefined, b: number | null | undefined): number {
  const av = typeof a === "number" && Number.isFinite(a) ? a : -Infinity;
  const bv = typeof b === "number" && Number.isFinite(b) ? b : -Infinity;
  return av === bv ? 0 : bv - av;
}

interface OptimizationRow {
  callContracts: number;
  participation: number;
  netOptionCashBtc: number;
  netOptionCashUsdt: number;
  minScenarioPnlUsdt: number;
  stressPrice: number | null;
  targetPass: boolean;
  upsideSlopeSafe: boolean;
  scenarios: PppScenarioResult[];
}
