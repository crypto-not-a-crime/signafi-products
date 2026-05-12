import {
  DCN_SELL_CALL_TEMPLATE,
  DCN_SELL_PUT_TEMPLATE,
  getDcnTemplateSummary,
  type DcnTemplateSummary
} from "./dcn-template";

export type BidAskLevel = [price: number, amount: number];
export type DcnProductType = "sell_put" | "sell_call";
export type SellPutPricingMethod = "firm_margin" | "target_firm_profit";
export type DcnSelectorMode = "closest" | "auto_yield" | "auto_runway" | "auto_strike";
export type DcnRecommendedLever = "none" | "yield" | "runway" | "strike";
export type DcnPriorityLever = "yield" | "runway" | "strike";

export interface DcnPricingRequest {
  productType?: DcnProductType;
  investmentUsdt?: number;
  investmentBtc?: number;
  targetYieldBps?: number;
  runwayDays?: number;
  strikePreference?: "any" | "five_otm" | "ten_otm";
  strikeBufferPct?: number;
  selectorMode?: DcnSelectorMode;
  priorityLever?: DcnPriorityLever;
  sellPutPricingMethod?: SellPutPricingMethod;
  firmMarginBps?: number;
  sellPutTargetFirmProfitBps?: number;
  sellCallTargetFirmProfitBps?: number;
  maxSlippageBps?: number;
  quoteFreshnessSeconds?: number;
  orderBookDepth?: number;
  scenarioExpiryPrice?: number;
  scenarioDownsidePrice?: number;
  scenarioUpsidePrice?: number;
  nowMs?: number;
}

export interface PutMarketInput {
  instrumentName: string;
  optionType?: "call" | "put";
  strike: number;
  expirationTimestamp: number;
  minTradeAmount?: number | null;
  contractSize?: number | null;
  underlyingPrice?: number | null;
  bidPrice?: number | null;
  bidAmount?: number | null;
  askPrice?: number | null;
  markPrice?: number | null;
  lastPrice?: number | null;
  bidIv?: number | null;
  askIv?: number | null;
  markIv?: number | null;
  openInterest?: number | null;
  deribitTimestamp?: number | null;
  ingestedAt?: number | null;
  bids?: BidAskLevel[];
}

export interface DepthFill {
  price: number;
  amount: number;
  notionalBtc: number;
}

export interface DepthModel {
  requiredContracts: number;
  filledContracts: number;
  grossProceedsBtc: number;
  effectiveOptionBidPrice: number | null;
  effectivePutBidPrice: number | null;
  bestBidPrice: number | null;
  bestBidAmount: number | null;
  sufficientDepth: boolean;
  remainingContracts: number;
  slippagePct: number | null;
  fills: DepthFill[];
}

export interface FormulaTraceRow {
  cell: string;
  label: string;
  formula: string;
  value: number | string | boolean | null;
}

export type DcnScenarioSide = "downside" | "upside";
export type DcnPayoutAsset = "BTC" | "USDT";

export interface DcnScenarioResult {
  expiryPrice: number;
  side: DcnScenarioSide;
  clientPayoutAsset: DcnPayoutAsset;
  clientPayoutAmount: number | null;
  clientPayoutBtc: number | null;
  clientPayoutUsdt: number | null;
  clientPrincipalInterestBtc: number | null;
  clientPrincipalInterestUsdt: number | null;
  optionSettlementBtc: number | null;
  netHedgeBtc: number | null;
  btcToPurchase: number | null;
  sellBtcProceedsUsdt: number | null;
  firmProfitUsdt: number | null;
  annualizedFirmProfit: number | null;
  formulaTrace: FormulaTraceRow[];
}

export interface DcnCalculation {
  formulaTemplate: DcnTemplateSummary;
  productType: DcnProductType;
  instrumentName: string;
  investmentUsdt: number;
  investmentBtc?: number;
  spotPrice: number;
  strike: number;
  dayCount: number;
  requiredContracts: number;
  effectiveOptionBidPrice: number | null;
  effectiveCallBidPrice?: number | null;
  effectivePutBidPrice: number | null;
  grossReferenceYield: number | null;
  sellPutPricingMethod?: SellPutPricingMethod;
  firmMarginBps: number;
  sellPutTargetFirmProfitBps?: number;
  sellCallTargetFirmProfitBps?: number;
  upsideReferencePrice?: number;
  clientYield: number | null;
  clientInterestUsdt: number | null;
  clientInterestBtc?: number | null;
  tradingFeesBtc: number | null;
  netOptionProceedsBtc: number | null;
  netOptionProceedsUsdt: number | null;
  premiumCoversInterest: boolean;
  selectedScenario: DcnScenarioResult;
  downsideScenario: DcnScenarioResult;
  upsideScenario: DcnScenarioResult;
  upsideProfitUsdt: number | null;
  upsideAnnualizedProfit: number | null;
  downsideProfitUsdt: number | null;
  downsideAnnualizedProfit: number | null;
  quoteAgeSeconds: number | null;
  depth: DepthModel;
  eligible: boolean;
  checks: Record<string, boolean>;
  formulaTrace: FormulaTraceRow[];
}

export interface DcnRankableCandidate {
  eligible: boolean;
  clientYield: number | null;
  upsideProfitUsdt: number | null;
  downsideProfitUsdt?: number | null;
  quoteAgeSeconds: number | null;
  depth: Pick<DepthModel, "slippagePct">;
  dayCount?: number;
  strike?: number;
  spotPrice?: number;
  score?: number;
}

export interface DcnRecommendation {
  selectorMode: DcnSelectorMode;
  recommendedLever: DcnRecommendedLever;
  priorityLever?: DcnPriorityLever;
  reason: string;
  targetYieldGapBps: number | null;
  runwayGapDays: number | null;
  strikeMoneynessGapBps: number | null;
}

export function roundContracts(rawContracts: number, minTradeAmount = 0.1): number {
  if (!Number.isFinite(rawContracts) || rawContracts <= 0) {
    return 0;
  }
  const roundedDown = Math.floor(rawContracts * 10) / 10;
  return Math.max(roundedDown, minTradeAmount);
}

export function roundYieldToOneDecimalPercent(yieldDecimal: number): number {
  if (!Number.isFinite(yieldDecimal)) return 0;
  return Math.round(yieldDecimal * 1000) / 1000;
}

export function dayCountFromExpiry(expirationTimestamp: number, nowMs = Date.now()): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const todayUtc = new Date(nowMs);
  const expiryUtc = new Date(expirationTimestamp);
  const todayDate = Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate());
  const expiryDate = Date.UTC(expiryUtc.getUTCFullYear(), expiryUtc.getUTCMonth(), expiryUtc.getUTCDate());
  return Math.max(0, Math.round((expiryDate - todayDate) / msPerDay));
}

export function modelSellIntoBidDepth(
  bids: BidAskLevel[] | undefined,
  requiredContracts: number,
  fallbackBestBid?: number | null,
  fallbackBestAmount?: number | null
): DepthModel {
  const usableBids = (bids && bids.length > 0 ? bids : fallbackBestBid ? [[fallbackBestBid, fallbackBestAmount ?? 0]] : [])
    .filter(([price, amount]) => Number.isFinite(price) && price > 0 && Number.isFinite(amount) && amount > 0)
    .sort((a, b) => b[0] - a[0]);

  const bestBidPrice = usableBids[0]?.[0] ?? fallbackBestBid ?? null;
  const bestBidAmount = usableBids[0]?.[1] ?? fallbackBestAmount ?? null;

  let remaining = requiredContracts;
  let filled = 0;
  let proceeds = 0;
  const fills: DepthFill[] = [];

  for (const [price, amount] of usableBids) {
    if (remaining <= 0) break;
    const fillAmount = Math.min(remaining, amount);
    const notionalBtc = fillAmount * price;
    fills.push({ price, amount: fillAmount, notionalBtc });
    filled += fillAmount;
    proceeds += notionalBtc;
    remaining -= fillAmount;
  }

  const sufficientDepth = remaining <= 1e-9;
  const effectivePutBidPrice = sufficientDepth && requiredContracts > 0 ? proceeds / requiredContracts : null;
  const slippagePct =
    effectivePutBidPrice !== null && bestBidPrice && bestBidPrice > 0
      ? (bestBidPrice - effectivePutBidPrice) / bestBidPrice
      : null;

  return {
    requiredContracts,
    filledContracts: filled,
    grossProceedsBtc: proceeds,
    effectiveOptionBidPrice: effectivePutBidPrice,
    effectivePutBidPrice,
    bestBidPrice,
    bestBidAmount,
    sufficientDepth,
    remainingContracts: Math.max(0, remaining),
    slippagePct,
    fills
  };
}

type AutoSelectionPlan = {
  fixed: [DcnPriorityLever, DcnPriorityLever];
  solved: DcnPriorityLever;
  priorityLever: DcnPriorityLever;
};

interface DcnScenarioInput {
  productType?: DcnProductType;
  investmentUsdt: number;
  investmentBtc?: number;
  spotPrice?: number;
  strike: number;
  dayCount: number;
  requiredContracts: number;
  clientYield: number | null;
  clientPrincipalInterestBtc: number | null;
  clientPrincipalInterestUsdt: number | null;
  netOptionProceedsBtc: number | null;
}

export function calculateDcnScenario(expiryPrice: number, input: DcnScenarioInput): DcnScenarioResult {
  if (input.productType === "sell_call") {
    return calculateDcnSellCallScenario(expiryPrice, input);
  }

  const side: DcnScenarioSide = expiryPrice < input.strike ? "downside" : "upside";
  const clientPayoutBtc = side === "downside" ? input.clientPrincipalInterestBtc : null;
  const clientPayoutUsdt = side === "upside" ? input.clientPrincipalInterestUsdt : null;
  const clientPayoutAsset: DcnPayoutAsset = side === "downside" ? "BTC" : "USDT";
  const clientPayoutAmount = side === "downside" ? clientPayoutBtc : clientPayoutUsdt;
  const optionSettlementBtc =
    side === "downside" && expiryPrice > 0
      ? -((input.strike - expiryPrice) / expiryPrice) * input.requiredContracts
      : side === "downside"
        ? null
        : 0;
  const netHedgeBtc =
    input.netOptionProceedsBtc === null || optionSettlementBtc === null
      ? null
      : input.netOptionProceedsBtc + optionSettlementBtc;
  const btcToPurchase =
    side === "downside" && netHedgeBtc !== null && input.clientPrincipalInterestBtc !== null
      ? input.clientPrincipalInterestBtc - netHedgeBtc
      : null;
  const sellBtcProceedsUsdt =
    side === "upside" && input.netOptionProceedsBtc !== null ? input.netOptionProceedsBtc * expiryPrice : null;
  const firmProfitUsdt =
    side === "downside"
      ? btcToPurchase === null
        ? null
        : input.investmentUsdt - btcToPurchase * expiryPrice
      : sellBtcProceedsUsdt === null || input.clientPrincipalInterestUsdt === null
        ? null
        : input.investmentUsdt + sellBtcProceedsUsdt - input.clientPrincipalInterestUsdt;
  const annualizedFirmProfit =
    firmProfitUsdt === null || input.dayCount <= 0
      ? null
      : (firmProfitUsdt / input.investmentUsdt / input.dayCount) * 365;

  const formulaTrace: FormulaTraceRow[] =
    side === "downside"
      ? [
          {
            cell: DCN_SELL_PUT_TEMPLATE.cells.downsideExpiryPrice,
            label: "Final BTC level",
            formula: "scenario expiry price",
            value: expiryPrice
          },
          {
            cell: DCN_SELL_PUT_TEMPLATE.cells.downsideOptionSettlementBtc,
            label: "Option settlement BTC",
            formula: DCN_SELL_PUT_TEMPLATE.formulas.downsideOptionSettlementBtc,
            value: optionSettlementBtc
          },
          {
            cell: DCN_SELL_PUT_TEMPLATE.cells.downsideNetHedgeBtc,
            label: "Net hedge BTC",
            formula: "netOptionProceedsBTC + optionSettlementBTC",
            value: netHedgeBtc
          },
          {
            cell: DCN_SELL_PUT_TEMPLATE.cells.downsideClientPayoutBtc,
            label: "Client payout BTC",
            formula: DCN_SELL_PUT_TEMPLATE.formulas.clientPayoutBtc,
            value: clientPayoutBtc
          },
          {
            cell: DCN_SELL_PUT_TEMPLATE.cells.downsideBtcToPurchase,
            label: "BTC to purchase",
            formula: "clientPayoutBTC - netHedgeBTC",
            value: btcToPurchase
          },
          {
            cell: DCN_SELL_PUT_TEMPLATE.cells.downsideFirmProfitUsdt,
            label: "Downside firm profit USDT",
            formula: DCN_SELL_PUT_TEMPLATE.formulas.downsideFirmProfitUsdt,
            value: firmProfitUsdt
          }
        ]
      : [
          {
            cell: DCN_SELL_PUT_TEMPLATE.cells.upsideExpiryPrice,
            label: "Final BTC level",
            formula: "scenario expiry price",
            value: expiryPrice
          },
          {
            cell: DCN_SELL_PUT_TEMPLATE.cells.upsideSellBtcProceedsUsdt,
            label: "Sell BTC proceeds USDT",
            formula: "netOptionProceedsBTC * expiryPrice",
            value: sellBtcProceedsUsdt
          },
          {
            cell: DCN_SELL_PUT_TEMPLATE.cells.upsideClientPayoutUsdt,
            label: "Client payout USDT",
            formula: DCN_SELL_PUT_TEMPLATE.formulas.clientPayoutUsdt,
            value: clientPayoutUsdt
          },
          {
            cell: DCN_SELL_PUT_TEMPLATE.cells.upsideFirmProfitUsdt,
            label: "Upside firm profit USDT",
            formula: DCN_SELL_PUT_TEMPLATE.formulas.upsideFirmProfitUsdt,
            value: firmProfitUsdt
          }
        ];

  return {
    expiryPrice,
    side,
    clientPayoutAsset,
    clientPayoutAmount,
    clientPayoutBtc,
    clientPayoutUsdt,
    clientPrincipalInterestBtc: input.clientPrincipalInterestBtc,
    clientPrincipalInterestUsdt: input.clientPrincipalInterestUsdt,
    optionSettlementBtc,
    netHedgeBtc,
    btcToPurchase,
    sellBtcProceedsUsdt,
    firmProfitUsdt,
    annualizedFirmProfit,
    formulaTrace
  };
}

function calculateDcnSellCallScenario(expiryPrice: number, input: DcnScenarioInput): DcnScenarioResult {
  const side: DcnScenarioSide = expiryPrice > input.strike ? "upside" : "downside";
  const investmentBtc =
    typeof input.investmentBtc === "number" && Number.isFinite(input.investmentBtc)
      ? input.investmentBtc
      : input.spotPrice && input.spotPrice > 0
        ? input.investmentUsdt / input.spotPrice
        : 0;
  const investmentNotionalUsdt = input.spotPrice && input.spotPrice > 0 ? investmentBtc * input.spotPrice : input.investmentUsdt;
  const clientPrincipalInterestBtc =
    input.clientYield === null ? null : investmentBtc * (1 + input.clientYield * (input.dayCount / 365));
  const clientPrincipalInterestUsdt =
    clientPrincipalInterestBtc === null ? null : clientPrincipalInterestBtc * input.strike;
  const clientPayoutBtc = side === "downside" ? clientPrincipalInterestBtc : null;
  const clientPayoutUsdt = side === "upside" ? clientPrincipalInterestUsdt : null;
  const clientPayoutAsset: DcnPayoutAsset = side === "downside" ? "BTC" : "USDT";
  const clientPayoutAmount = side === "downside" ? clientPayoutBtc : clientPayoutUsdt;
  const optionSettlementBtc =
    side === "upside" && expiryPrice > 0
      ? -((expiryPrice - input.strike) / expiryPrice) * input.requiredContracts
      : 0;
  const netHedgeBtc =
    input.netOptionProceedsBtc === null
      ? null
      : investmentBtc + input.netOptionProceedsBtc + optionSettlementBtc;
  const sellBtcProceedsUsdt =
    side === "upside" && netHedgeBtc !== null ? (investmentBtc + optionSettlementBtc) * expiryPrice : null;
  const firmProfitUsdt =
    netHedgeBtc === null || clientPrincipalInterestBtc === null || clientPrincipalInterestUsdt === null
      ? null
      : side === "downside"
        ? input.netOptionProceedsBtc! * (input.spotPrice ?? expiryPrice) + (investmentBtc - clientPrincipalInterestBtc) * expiryPrice
        : input.netOptionProceedsBtc! * (input.spotPrice ?? expiryPrice) +
          (investmentBtc + optionSettlementBtc) * expiryPrice -
          clientPrincipalInterestUsdt;
  const annualizedFirmProfit =
    firmProfitUsdt === null || input.dayCount <= 0 || investmentNotionalUsdt <= 0
      ? null
      : (firmProfitUsdt / investmentNotionalUsdt / input.dayCount) * 365;

  const formulaTrace: FormulaTraceRow[] =
    side === "downside"
      ? [
          { cell: DCN_SELL_CALL_TEMPLATE.cells.downsideExpiryPrice, label: "Final BTC level", formula: "scenario expiry price", value: expiryPrice },
          {
            cell: DCN_SELL_CALL_TEMPLATE.cells.clientBtcPayout,
            label: "Client payout BTC",
            formula: DCN_SELL_CALL_TEMPLATE.formulas.clientBtcPayout,
            value: clientPayoutBtc
          },
          {
            cell: DCN_SELL_CALL_TEMPLATE.cells.downsideProfitUsdt,
            label: "Downside firm profit USDT",
            formula: "net premium USDT + (initialBTC - clientPayoutBTC) * expiryPrice",
            value: firmProfitUsdt
          }
        ]
      : [
          { cell: DCN_SELL_CALL_TEMPLATE.cells.upsideExpiryPrice, label: "Final BTC level", formula: "scenario expiry price", value: expiryPrice },
          {
            cell: "Call Settlement",
            label: "Option settlement BTC",
            formula: DCN_SELL_CALL_TEMPLATE.formulas.upsideOptionSettlementBtc,
            value: optionSettlementBtc
          },
          {
            cell: DCN_SELL_CALL_TEMPLATE.cells.clientBtcPayout,
            label: "Client payout USDT",
            formula: DCN_SELL_CALL_TEMPLATE.formulas.clientUsdtPayout,
            value: clientPayoutUsdt
          },
          {
            cell: DCN_SELL_CALL_TEMPLATE.cells.upsideProfitUsdt,
            label: "Upside firm profit USDT",
            formula: "net premium USDT + (initialBTC - callSettlementBTC) * expiryPrice - clientPayoutUSDT",
            value: firmProfitUsdt
          }
        ];

  return {
    expiryPrice,
    side,
    clientPayoutAsset,
    clientPayoutAmount,
    clientPayoutBtc,
    clientPayoutUsdt,
    clientPrincipalInterestBtc,
    clientPrincipalInterestUsdt,
    optionSettlementBtc,
    netHedgeBtc,
    btcToPurchase: null,
    sellBtcProceedsUsdt,
    firmProfitUsdt,
    annualizedFirmProfit,
    formulaTrace
  };
}

export function calculateSellPutClientYield({
  pricingMethod,
  grossReferenceYield,
  netOptionProceedsUsdt,
  investmentUsdt,
  dayCount,
  firmMarginBps,
  targetFirmAnnualizedProfit
}: {
  pricingMethod: SellPutPricingMethod;
  grossReferenceYield: number | null;
  netOptionProceedsUsdt: number | null;
  investmentUsdt: number;
  dayCount: number;
  firmMarginBps: number;
  targetFirmAnnualizedProfit: number;
}): number | null {
  if (pricingMethod === "target_firm_profit") {
    if (
      !isPositiveFinite(netOptionProceedsUsdt) ||
      !isPositiveFinite(investmentUsdt) ||
      !isPositiveFinite(dayCount) ||
      !Number.isFinite(targetFirmAnnualizedProfit)
    ) {
      return null;
    }
    return (netOptionProceedsUsdt / investmentUsdt) * (365 / dayCount) - targetFirmAnnualizedProfit;
  }

  if (grossReferenceYield === null || !Number.isFinite(grossReferenceYield) || !Number.isFinite(firmMarginBps)) {
    return null;
  }

  return roundYieldToOneDecimalPercent(Math.max(0, grossReferenceYield - firmMarginBps / 10000));
}

export function calculateDcnSellPut(request: DcnPricingRequest, market: PutMarketInput): DcnCalculation {
  const nowMs = request.nowMs ?? Date.now();
  const sellPutPricingMethod = normalizeSellPutPricingMethod(request.sellPutPricingMethod);
  const firmMarginBps = request.firmMarginBps ?? DCN_SELL_PUT_TEMPLATE.firmMarginBps;
  const sellPutTargetFirmProfitBps =
    request.sellPutTargetFirmProfitBps ?? DCN_SELL_PUT_TEMPLATE.sellPutTargetFirmProfitBps;
  const targetFirmAnnualizedProfit = sellPutTargetFirmProfitBps / 10000;
  const maxSlippageBps = request.maxSlippageBps ?? 500;
  const quoteFreshnessSeconds = request.quoteFreshnessSeconds ?? 10;
  const investmentUsdt = Number(request.investmentUsdt ?? 0);
  const spotPrice = market.underlyingPrice ?? 0;
  const dayCount = dayCountFromExpiry(market.expirationTimestamp, nowMs);
  const requiredContracts = market.strike > 0 ? roundContracts(investmentUsdt / market.strike, market.minTradeAmount ?? 0.1) : 0;
  const depth = modelSellIntoBidDepth(market.bids, requiredContracts, market.bidPrice, market.bidAmount);
  const effectivePutBidPrice = depth.effectivePutBidPrice;
  const quoteTime = market.deribitTimestamp ?? market.ingestedAt ?? null;
  const quoteAgeSeconds = quoteTime ? Math.max(0, (nowMs - quoteTime) / 1000) : null;

  const grossReferenceYield =
    effectivePutBidPrice === null || dayCount <= 0 ? null : (effectivePutBidPrice / dayCount) * 365;
  const tradingFeePerContractBtc =
    effectivePutBidPrice === null ? null : -Math.min(0.0003, 0.125 * effectivePutBidPrice);
  const tradingFeesBtc = tradingFeePerContractBtc === null ? null : tradingFeePerContractBtc * requiredContracts;
  const grossOptionProceedsBtc = effectivePutBidPrice === null ? null : requiredContracts * effectivePutBidPrice;
  const netOptionProceedsBtc =
    grossOptionProceedsBtc === null || tradingFeesBtc === null ? null : grossOptionProceedsBtc + tradingFeesBtc;
  const netOptionProceedsUsdt = netOptionProceedsBtc === null ? null : netOptionProceedsBtc * spotPrice;
  const clientYield = calculateSellPutClientYield({
    pricingMethod: sellPutPricingMethod,
    grossReferenceYield,
    netOptionProceedsUsdt,
    investmentUsdt,
    dayCount,
    firmMarginBps,
    targetFirmAnnualizedProfit
  });
  const clientInterestUsdt = clientYield === null ? null : investmentUsdt * clientYield * (dayCount / 365);

  const premiumCoversInterest =
    netOptionProceedsUsdt !== null && clientInterestUsdt !== null && netOptionProceedsUsdt >= clientInterestUsdt;

  const clientPrincipalInterestUsdt =
    clientYield === null ? null : investmentUsdt * (1 + clientYield * (dayCount / 365));
  const scenarioUpsidePrice = request.scenarioUpsidePrice ?? spotPrice;
  const scenarioDownsidePrice = request.scenarioDownsidePrice ?? market.strike * (2 / 3);
  const clientPrincipalInterestBtc =
    clientYield === null || market.strike <= 0
      ? null
      : (investmentUsdt / market.strike) * (1 + clientYield * (dayCount / 365));

  const baseScenarioInput = {
    productType: "sell_put" as const,
    investmentUsdt,
    strike: market.strike,
    dayCount,
    requiredContracts,
    clientYield,
    clientPrincipalInterestBtc,
    clientPrincipalInterestUsdt,
    netOptionProceedsBtc
  };
  const selectedScenario = calculateDcnScenario(
    request.scenarioExpiryPrice ?? market.strike,
    baseScenarioInput
  );
  const downsideScenario = calculateDcnScenario(scenarioDownsidePrice, baseScenarioInput);
  const upsideScenario = calculateDcnScenario(scenarioUpsidePrice, baseScenarioInput);
  const upsideProfitUsdt = upsideScenario.firmProfitUsdt;
  const upsideAnnualizedProfit = upsideScenario.annualizedFirmProfit;
  const downsideProfitUsdt = downsideScenario.firmProfitUsdt;
  const downsideAnnualizedProfit = downsideScenario.annualizedFirmProfit;

  const checks = {
    spotPricePositive: spotPrice > 0,
    strikePositive: market.strike > 0,
    strikeBelowSpot: market.strike < spotPrice,
    quoteFresh: quoteAgeSeconds !== null && quoteAgeSeconds <= quoteFreshnessSeconds,
    usableBid: effectivePutBidPrice !== null && effectivePutBidPrice > 0,
    sufficientDepth: depth.sufficientDepth,
    slippageWithinLimit: depth.slippagePct !== null && depth.slippagePct * 10000 <= maxSlippageBps,
    premiumCoversInterest,
    clientYieldFormulaValid: clientYield !== null && Number.isFinite(clientYield),
    clientYieldPositive: clientYield !== null && clientYield > 0,
    firmMarginPositive: sellPutPricingMethod !== "firm_margin" || firmMarginBps > 0,
    targetFirmProfitNonNegative: sellPutPricingMethod !== "target_firm_profit" || sellPutTargetFirmProfitBps >= 0,
    selectedScenarioProfitPositive: selectedScenario.firmProfitUsdt !== null && selectedScenario.firmProfitUsdt > 0,
    upsideProfitPositive: upsideProfitUsdt !== null && upsideProfitUsdt > 0,
    downsideProfitPositive: downsideProfitUsdt !== null && downsideProfitUsdt > 0
  };
  const eligible = Object.values(checks).every(Boolean);

  const pricingMethodTrace: FormulaTraceRow[] =
    sellPutPricingMethod === "target_firm_profit"
      ? [
          {
            cell: "Input Dashboard - Sell Put!C15",
            label: "Put target firm profit",
            formula: "admin sellPutTargetFirmProfitBps / 10000",
            value: targetFirmAnnualizedProfit
          },
          {
            cell: "Input Dashboard - Sell Put!C9",
            label: "Client target yield",
            formula: DCN_SELL_PUT_TEMPLATE.formulas.clientYieldTargetFirmProfit,
            value: clientYield
          }
        ]
      : [
          {
            cell: "Signafi Margin",
            label: "Firm margin",
            formula: "request firmMarginBps / 10000",
            value: firmMarginBps / 10000
          },
          {
            cell: "Client Yield",
            label: "Client target yield",
            formula: DCN_SELL_PUT_TEMPLATE.formulas.clientYieldFirmMargin,
            value: clientYield
          }
        ];

  const formulaTrace: FormulaTraceRow[] = [
    { cell: "C4", label: "Initial Investment (USDT)", formula: "user input", value: investmentUsdt },
    { cell: "C5", label: "BTC Spot Price", formula: "Deribit BTC_USDC spot mid", value: spotPrice },
    { cell: "C7", label: "Strike Price", formula: "selected Deribit put strike", value: market.strike },
    { cell: "C11", label: "Day Count", formula: DCN_SELL_PUT_TEMPLATE.formulas.dayCount, value: dayCount },
    { cell: "C14", label: "Contracts", formula: DCN_SELL_PUT_TEMPLATE.formulas.contracts, value: requiredContracts },
    {
      cell: "C15",
      label: "Put Bid Price",
      formula: "SUM(filled contracts * bid level price) / required contracts",
      value: effectivePutBidPrice
    },
    {
      cell: "C17",
      label: "Option Baseline Premium",
      formula: DCN_SELL_PUT_TEMPLATE.formulas.grossReferenceYield,
      value: grossReferenceYield
    },
    {
      cell: "C20",
      label: "Trading Fees (BTC)",
      formula: "-MIN(0.0003, 0.125*C15) * C14",
      value: tradingFeesBtc
    },
    {
      cell: "C22",
      label: "Net Put Proceeds (BTC)",
      formula: "C14*C15 + C20",
      value: netOptionProceedsBtc
    },
    {
      cell: "C23",
      label: "Net Put Proceeds (USDT)",
      formula: "C22*C5",
      value: netOptionProceedsUsdt
    },
    {
      cell: "Put Pricing Method",
      label: "Put pricing basis",
      formula: "admin sellPutPricingMethod",
      value: sellPutPricingMethod
    },
    ...pricingMethodTrace,
    {
      cell: "Premium Check",
      label: "Premium covers client interest",
      formula: "C23 >= C4*ClientYield*C11/365",
      value: premiumCoversInterest
    },
    {
      cell: "Selected Scenario",
      label: "Selected BTC expiry price",
      formula: "scenarioExpiryPrice",
      value: selectedScenario.expiryPrice
    },
    {
      cell: "Selected Payout",
      label: `Client receives ${selectedScenario.clientPayoutAsset}`,
      formula:
        selectedScenario.clientPayoutAsset === "BTC"
          ? DCN_SELL_PUT_TEMPLATE.formulas.clientPayoutBtc
          : DCN_SELL_PUT_TEMPLATE.formulas.clientPayoutUsdt,
      value: selectedScenario.clientPayoutAmount
    }
  ];

  return {
    formulaTemplate: { ...getDcnTemplateSummary(), sellPutPricingMethod, firmMarginBps, sellPutTargetFirmProfitBps },
    productType: "sell_put",
    instrumentName: market.instrumentName,
    investmentUsdt,
    spotPrice,
    strike: market.strike,
    dayCount,
    requiredContracts,
    effectiveOptionBidPrice: effectivePutBidPrice,
    effectivePutBidPrice,
    grossReferenceYield,
    sellPutPricingMethod,
    firmMarginBps,
    sellPutTargetFirmProfitBps,
    clientYield,
    clientInterestUsdt,
    tradingFeesBtc,
    netOptionProceedsBtc,
    netOptionProceedsUsdt,
    premiumCoversInterest,
    selectedScenario,
    downsideScenario,
    upsideScenario,
    upsideProfitUsdt,
    upsideAnnualizedProfit,
    downsideProfitUsdt,
    downsideAnnualizedProfit,
    quoteAgeSeconds,
    depth,
    eligible,
    checks,
    formulaTrace
  };
}

export function calculateDcnSellCall(request: DcnPricingRequest, market: PutMarketInput): DcnCalculation {
  const nowMs = request.nowMs ?? Date.now();
  const maxSlippageBps = request.maxSlippageBps ?? 500;
  const quoteFreshnessSeconds = request.quoteFreshnessSeconds ?? 10;
  const sellCallTargetFirmProfitBps =
    request.sellCallTargetFirmProfitBps ?? DCN_SELL_CALL_TEMPLATE.sellCallTargetFirmProfitBps;
  const targetFirmAnnualizedProfit = sellCallTargetFirmProfitBps / 10000;
  const investmentBtc = Number(request.investmentBtc ?? 10);
  const spotPrice = market.underlyingPrice ?? 0;
  const investmentUsdt = spotPrice > 0 ? investmentBtc * spotPrice : 0;
  const dayCount = dayCountFromExpiry(market.expirationTimestamp, nowMs);
  const requiredContracts = roundContracts(investmentBtc, market.minTradeAmount ?? 0.1);
  const depth = modelSellIntoBidDepth(market.bids, requiredContracts, market.bidPrice, market.bidAmount);
  const effectiveCallBidPrice = depth.effectiveOptionBidPrice;
  const quoteTime = market.deribitTimestamp ?? market.ingestedAt ?? null;
  const quoteAgeSeconds = quoteTime ? Math.max(0, (nowMs - quoteTime) / 1000) : null;
  const grossReferenceYield =
    effectiveCallBidPrice === null || dayCount <= 0 ? null : (effectiveCallBidPrice / dayCount) * 365;
  const tradingFeePerContractBtc =
    effectiveCallBidPrice === null ? null : -Math.min(0.0003, 0.125 * effectiveCallBidPrice);
  const tradingFeesBtc = tradingFeePerContractBtc === null ? null : tradingFeePerContractBtc * requiredContracts;
  const grossOptionProceedsBtc = effectiveCallBidPrice === null ? null : requiredContracts * effectiveCallBidPrice;
  const netOptionProceedsBtc =
    grossOptionProceedsBtc === null || tradingFeesBtc === null ? null : grossOptionProceedsBtc + tradingFeesBtc;
  const netOptionProceedsUsdt = netOptionProceedsBtc === null ? null : netOptionProceedsBtc * spotPrice;
  const upsideReferencePrice = request.scenarioUpsidePrice ?? market.strike * DCN_SELL_CALL_TEMPLATE.upsideReferenceMultiplier;
  const clientYield =
    netOptionProceedsUsdt === null || dayCount <= 0
      ? null
      : calculateSellCallClientYield({
          upsidePrice: upsideReferencePrice,
          strike: market.strike,
          investmentBtc,
          spotPrice,
          dayCount,
          requiredContracts,
          premiumUsdt: netOptionProceedsUsdt,
          targetFirmAnnualizedProfit
        });
  const clientInterestBtc = clientYield === null ? null : investmentBtc * clientYield * (dayCount / 365);
  const clientInterestUsdt = clientInterestBtc === null ? null : clientInterestBtc * market.strike;
  const clientPrincipalInterestBtc =
    clientYield === null ? null : investmentBtc * (1 + clientYield * (dayCount / 365));
  const clientPrincipalInterestUsdt =
    clientPrincipalInterestBtc === null ? null : clientPrincipalInterestBtc * market.strike;
  const scenarioDownsidePrice = request.scenarioDownsidePrice ?? market.strike * 0.75;
  const scenarioUpsidePrice = request.scenarioUpsidePrice ?? upsideReferencePrice;

  const baseScenarioInput = {
    productType: "sell_call" as const,
    investmentUsdt,
    investmentBtc,
    spotPrice,
    strike: market.strike,
    dayCount,
    requiredContracts,
    clientYield,
    clientPrincipalInterestBtc,
    clientPrincipalInterestUsdt,
    netOptionProceedsBtc
  };
  const selectedScenario = calculateDcnScenario(request.scenarioExpiryPrice ?? market.strike, baseScenarioInput);
  const downsideScenario = calculateDcnScenario(scenarioDownsidePrice, baseScenarioInput);
  const upsideScenario = calculateDcnScenario(scenarioUpsidePrice, baseScenarioInput);
  const upsideProfitUsdt = upsideScenario.firmProfitUsdt;
  const upsideAnnualizedProfit = upsideScenario.annualizedFirmProfit;
  const downsideProfitUsdt = downsideScenario.firmProfitUsdt;
  const downsideAnnualizedProfit = downsideScenario.annualizedFirmProfit;
  const premiumCoversInterest =
    netOptionProceedsUsdt !== null && clientInterestUsdt !== null && netOptionProceedsUsdt >= clientInterestUsdt;

  const checks = {
    spotPricePositive: spotPrice > 0,
    strikePositive: market.strike > 0,
    strikeAboveSpot: market.strike > spotPrice,
    quoteFresh: quoteAgeSeconds !== null && quoteAgeSeconds <= quoteFreshnessSeconds,
    usableBid: effectiveCallBidPrice !== null && effectiveCallBidPrice > 0,
    sufficientDepth: depth.sufficientDepth,
    slippageWithinLimit: depth.slippagePct !== null && depth.slippagePct * 10000 <= maxSlippageBps,
    clientYieldFormulaValid: clientYield !== null && Number.isFinite(clientYield),
    clientYieldPositive: clientYield !== null && clientYield > 0,
    targetFirmProfitNonNegative: sellCallTargetFirmProfitBps >= 0,
    selectedScenarioProfitPositive: selectedScenario.firmProfitUsdt !== null && selectedScenario.firmProfitUsdt > 0,
    upsideProfitPositive: upsideProfitUsdt !== null && upsideProfitUsdt > 0,
    downsideProfitPositive: downsideProfitUsdt !== null && downsideProfitUsdt > 0
  };
  const eligible = Object.values(checks).every(Boolean);

  const formulaTrace: FormulaTraceRow[] = [
    { cell: "C4", label: "Initial Investment (BTC)", formula: "user input", value: investmentBtc },
    { cell: "C5", label: "BTC Spot Price", formula: "Deribit BTC_USDC spot mid", value: spotPrice },
    { cell: "C7", label: "Strike Price", formula: "selected Deribit call strike", value: market.strike },
    { cell: "C11", label: "Day Count", formula: DCN_SELL_CALL_TEMPLATE.formulas.dayCount, value: dayCount },
    { cell: "C13", label: "Firm annualized profit margin", formula: "admin sellCallTargetFirmProfitBps / 10000", value: targetFirmAnnualizedProfit },
    { cell: "C16", label: "Contracts", formula: DCN_SELL_CALL_TEMPLATE.formulas.contracts, value: requiredContracts },
    {
      cell: "C17",
      label: "Call Bid Price",
      formula: "SUM(filled contracts * bid level price) / required contracts",
      value: effectiveCallBidPrice
    },
    {
      cell: "C19",
      label: "Option Baseline Premium",
      formula: DCN_SELL_CALL_TEMPLATE.formulas.grossReferenceYield,
      value: grossReferenceYield
    },
    {
      cell: "C22",
      label: "Trading Fees (BTC)",
      formula: DCN_SELL_CALL_TEMPLATE.formulas.tradingFeesBtc,
      value: tradingFeesBtc
    },
    {
      cell: "C24",
      label: "Net Call Proceeds (BTC)",
      formula: DCN_SELL_CALL_TEMPLATE.formulas.netCallProceedsBtc,
      value: netOptionProceedsBtc
    },
    {
      cell: "C25",
      label: "Net Call Proceeds (USDT)",
      formula: DCN_SELL_CALL_TEMPLATE.formulas.netCallProceedsUsdt,
      value: netOptionProceedsUsdt
    },
    {
      cell: "Scenario Analysis - Sell Call!D27",
      label: "Upside reference price",
      formula: "selected scenarioUpsidePrice or strike * 1.30",
      value: upsideReferencePrice
    },
    {
      cell: "Input Dashboard - Sell Call!C9",
      label: "Client target yield",
      formula: DCN_SELL_CALL_TEMPLATE.formulas.clientYield,
      value: clientYield
    },
    {
      cell: "Selected Payout",
      label: `Client receives ${selectedScenario.clientPayoutAsset}`,
      formula:
        selectedScenario.clientPayoutAsset === "BTC"
          ? DCN_SELL_CALL_TEMPLATE.formulas.clientBtcPayout
          : DCN_SELL_CALL_TEMPLATE.formulas.clientUsdtPayout,
      value: selectedScenario.clientPayoutAmount
    }
  ];

  return {
    formulaTemplate: {
      ...getDcnTemplateSummary("sell_call"),
      sellCallTargetFirmProfitBps,
      upsideReferenceMultiplier: DCN_SELL_CALL_TEMPLATE.upsideReferenceMultiplier
    },
    productType: "sell_call",
    instrumentName: market.instrumentName,
    investmentUsdt,
    investmentBtc,
    spotPrice,
    strike: market.strike,
    dayCount,
    requiredContracts,
    effectiveOptionBidPrice: effectiveCallBidPrice,
    effectiveCallBidPrice,
    effectivePutBidPrice: effectiveCallBidPrice,
    grossReferenceYield,
    firmMarginBps: 0,
    sellCallTargetFirmProfitBps,
    upsideReferencePrice,
    clientYield,
    clientInterestUsdt,
    clientInterestBtc,
    tradingFeesBtc,
    netOptionProceedsBtc,
    netOptionProceedsUsdt,
    premiumCoversInterest,
    selectedScenario,
    downsideScenario,
    upsideScenario,
    upsideProfitUsdt,
    upsideAnnualizedProfit,
    downsideProfitUsdt,
    downsideAnnualizedProfit,
    quoteAgeSeconds,
    depth,
    eligible,
    checks,
    formulaTrace
  };
}

export function calculateSellCallClientYield({
  upsidePrice,
  strike,
  investmentBtc,
  spotPrice,
  dayCount,
  requiredContracts,
  premiumUsdt,
  targetFirmAnnualizedProfit
}: {
  upsidePrice: number;
  strike: number;
  investmentBtc: number;
  spotPrice: number;
  dayCount: number;
  requiredContracts: number;
  premiumUsdt: number;
  targetFirmAnnualizedProfit: number;
}): number | null {
  if (
    !isPositiveFinite(upsidePrice) ||
    !isPositiveFinite(strike) ||
    !isPositiveFinite(investmentBtc) ||
    !isPositiveFinite(spotPrice) ||
    !isPositiveFinite(dayCount) ||
    !Number.isFinite(requiredContracts) ||
    !Number.isFinite(premiumUsdt) ||
    !Number.isFinite(targetFirmAnnualizedProfit) ||
    upsidePrice <= strike
  ) {
    return null;
  }

  const targetFirmProfitUsdt = targetFirmAnnualizedProfit * investmentBtc * spotPrice * dayCount / 365;
  const callSettlementBtc = ((upsidePrice - strike) / upsidePrice) * requiredContracts;
  const profitBeforeClientInterest = premiumUsdt + (investmentBtc - callSettlementBtc) * upsidePrice;
  const rawYield =
    ((profitBeforeClientInterest - targetFirmProfitUsdt) / (investmentBtc * strike) - 1) * 365 / dayCount;
  return roundDownToDecimals(rawYield, 4);
}

export function priceCandidateAtSize(request: DcnPricingRequest, market: PutMarketInput): DcnCalculation {
  return calculateDcnSellPut(request, market);
}

export function priceCallCandidateAtSize(request: DcnPricingRequest, market: PutMarketInput): DcnCalculation {
  return calculateDcnSellCall(request, market);
}

export function scorePutCandidate(request: DcnPricingRequest, market: PutMarketInput): number {
  const spot = market.underlyingPrice ?? 0;
  if (!spot || !market.bidPrice || market.bidPrice <= 0) return -Infinity;
  if (market.strike >= spot) return -Infinity;

  const dayCount = dayCountFromExpiry(market.expirationTimestamp, request.nowMs ?? Date.now());
  if (dayCount <= 0) return -Infinity;
  const investmentUsdt = Number(request.investmentUsdt ?? 500000);
  const requiredContracts = market.strike > 0 ? roundContracts(investmentUsdt / market.strike, market.minTradeAmount ?? 0.1) : 0;
  const tradingFeePerContractBtc = -Math.min(0.0003, 0.125 * market.bidPrice);
  const netOptionProceedsBtc = requiredContracts * market.bidPrice + tradingFeePerContractBtc * requiredContracts;
  const netOptionProceedsUsdt = netOptionProceedsBtc * spot;
  const roughClientYield = calculateSellPutClientYield({
    pricingMethod: normalizeSellPutPricingMethod(request.sellPutPricingMethod),
    grossReferenceYield: (market.bidPrice / dayCount) * 365,
    netOptionProceedsUsdt,
    investmentUsdt,
    dayCount,
    firmMarginBps: request.firmMarginBps ?? DCN_SELL_PUT_TEMPLATE.firmMarginBps,
    targetFirmAnnualizedProfit:
      (request.sellPutTargetFirmProfitBps ?? DCN_SELL_PUT_TEMPLATE.sellPutTargetFirmProfitBps) / 10000
  });
  if (roughClientYield === null) return -Infinity;
  const roughCandidate: DcnRankableCandidate = {
    eligible: true,
    clientYield: roughClientYield,
    upsideProfitUsdt: null,
    downsideProfitUsdt: null,
    quoteAgeSeconds: null,
    depth: { slippagePct: null },
    dayCount,
    strike: market.strike,
    spotPrice: spot
  };
  const fit = getCandidateFitMetrics(request, roughCandidate);
  const autoScore = scoreAutoCandidate(request, roughCandidate, fit);
  if (autoScore !== null) return autoScore;

  const targetBonus = fit.targetMet ? 1000 : 0;
  return (
    1000 +
    targetBonus -
    fit.normalizedRunwayGap * 250 -
    fit.strikeMoneynessGap * 250 -
    (fit.targetMet ? fit.yieldExcess * 150 : fit.yieldShortfall * 1000)
  );
}

export function scoreCallCandidate(request: DcnPricingRequest, market: PutMarketInput): number {
  const spot = market.underlyingPrice ?? 0;
  if (!spot || !market.bidPrice || market.bidPrice <= 0) return -Infinity;
  if (market.strike <= spot) return -Infinity;

  const dayCount = dayCountFromExpiry(market.expirationTimestamp, request.nowMs ?? Date.now());
  if (dayCount <= 0) return -Infinity;
  const investmentBtc = Number(request.investmentBtc ?? 10);
  const requiredContracts = roundContracts(investmentBtc, market.minTradeAmount ?? 0.1);
  const premiumUsdt = requiredContracts * market.bidPrice * spot;
  const roughClientYield = calculateSellCallClientYield({
    upsidePrice: request.scenarioUpsidePrice ?? market.strike * DCN_SELL_CALL_TEMPLATE.upsideReferenceMultiplier,
    strike: market.strike,
    investmentBtc,
    spotPrice: spot,
    dayCount,
    requiredContracts,
    premiumUsdt,
    targetFirmAnnualizedProfit:
      (request.sellCallTargetFirmProfitBps ?? DCN_SELL_CALL_TEMPLATE.sellCallTargetFirmProfitBps) / 10000
  });
  if (roughClientYield === null) return -Infinity;

  const roughCandidate: DcnRankableCandidate = {
    eligible: true,
    clientYield: roughClientYield,
    upsideProfitUsdt: null,
    downsideProfitUsdt: null,
    quoteAgeSeconds: null,
    depth: { slippagePct: null },
    dayCount,
    strike: market.strike,
    spotPrice: spot
  };
  const fit = getCandidateFitMetrics({ ...request, productType: "sell_call" }, roughCandidate);
  const autoScore = scoreAutoCandidate({ ...request, productType: "sell_call" }, roughCandidate, fit);
  if (autoScore !== null) return autoScore;

  const targetBonus = fit.targetMet ? 1000 : 0;
  return (
    1000 +
    targetBonus -
    fit.normalizedRunwayGap * 250 -
    fit.strikeMoneynessGap * 250 -
    (fit.targetMet ? fit.yieldExcess * 150 : fit.yieldShortfall * 1000)
  );
}

export function compareDcnCandidatesForClientMandate(
  request: DcnPricingRequest,
  a: DcnRankableCandidate,
  b: DcnRankableCandidate
): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;

  const mode = request.selectorMode ?? "closest";
  const af = getCandidateFitMetrics(request, a);
  const bf = getCandidateFitMetrics(request, b);
  const plan = getAutoSelectionPlan(request);

  if (plan) {
    return compareBy([
      () => compareFixedLever(plan.fixed[0], af, bf),
      () => compareFixedLever(plan.fixed[1], af, bf),
      () => compareSolvedLever(request, plan.solved, a, b, af, bf),
      () => compareAsc(a.depth.slippagePct, b.depth.slippagePct),
      () => compareAsc(a.quoteAgeSeconds, b.quoteAgeSeconds),
      () => compareDesc(a.upsideProfitUsdt, b.upsideProfitUsdt),
      () => compareDesc(a.score, b.score)
    ]);
  }

  if (mode === "auto_yield" || mode === "auto_runway" || mode === "auto_strike") {
    return compareDesc(a.score, b.score);
  }

  return compareBy([
    () => compareBooleanDesc(af.targetMet, bf.targetMet),
    () => compareAsc(af.normalizedRunwayGap, bf.normalizedRunwayGap),
    () => compareAsc(af.strikeMoneynessGap, bf.strikeMoneynessGap),
    () => (af.targetMet && bf.targetMet ? compareAsc(af.yieldExcess, bf.yieldExcess) : compareAsc(af.yieldShortfall, bf.yieldShortfall)),
    () => compareAsc(a.depth.slippagePct, b.depth.slippagePct),
    () => compareAsc(a.quoteAgeSeconds, b.quoteAgeSeconds),
    () => compareDesc(a.upsideProfitUsdt, b.upsideProfitUsdt),
    () => compareDesc(a.score, b.score)
  ]);
}

export function selectDcnCandidate<T extends DcnRankableCandidate>(
  request: DcnPricingRequest,
  candidates: T[]
): { candidates: T[]; bestCandidate: T | null; recommendation: DcnRecommendation } {
  const sorted = [...candidates].sort((a, b) => compareDcnCandidatesForClientMandate(request, a, b));
  const bestCandidate = sorted.find((candidate) => candidate.eligible) ?? null;
  return {
    candidates: sorted,
    bestCandidate,
    recommendation: buildRecommendation(request, bestCandidate)
  };
}

interface CandidateFitMetrics {
  targetMet: boolean;
  targetYieldGap: number | null;
  targetYieldGapBps: number | null;
  yieldShortfall: number;
  yieldExcess: number;
  normalizedRunwayGap: number;
  runwayGapDays: number | null;
  strikeMoneyness: number;
  strikeMoneynessGap: number;
  strikeMoneynessGapBps: number | null;
}

function buildRecommendation(request: DcnPricingRequest, candidate: DcnRankableCandidate | null): DcnRecommendation {
  const selectorMode = request.selectorMode ?? "closest";
  const fit = candidate ? getCandidateFitMetrics(request, candidate) : null;
  const plan = getAutoSelectionPlan(request);
  const recommendedLever: DcnRecommendedLever =
    selectorMode === "auto_yield"
      ? "yield"
      : selectorMode === "auto_runway"
        ? "runway"
        : selectorMode === "auto_strike"
          ? "strike"
          : "none";
  const reason =
    selectorMode === "auto_yield"
      ? `Highest executable client yield after prioritizing ${formatPriorityLever(plan?.priorityLever)}.`
      : selectorMode === "auto_runway"
        ? `Shortest eligible runway after prioritizing ${formatPriorityLever(plan?.priorityLever)}.`
        : selectorMode === "auto_strike"
          ? `Safest eligible strike after prioritizing ${formatPriorityLever(plan?.priorityLever)}.`
          : "Closest eligible product to the requested target yield, runway, and strike buffer.";

  return {
    selectorMode,
    recommendedLever,
    priorityLever: plan?.priorityLever,
    reason,
    targetYieldGapBps: fit?.targetYieldGapBps ?? null,
    runwayGapDays: fit?.runwayGapDays ?? null,
    strikeMoneynessGapBps: fit?.strikeMoneynessGapBps ?? null
  };
}

function getCandidateFitMetrics(request: DcnPricingRequest, candidate: DcnRankableCandidate): CandidateFitMetrics {
  const targetYield = (request.targetYieldBps ?? 0) / 10000;
  const clientYield = finiteOr(candidate.clientYield, -Infinity);
  const targetYieldGap = Number.isFinite(clientYield) && targetYield > 0 ? clientYield - targetYield : null;
  const targetMet = targetYield <= 0 || clientYield >= targetYield;
  const runwayDays = request.runwayDays ?? candidate.dayCount ?? 0;
  const runwayGapDays =
    typeof candidate.dayCount === "number" && Number.isFinite(candidate.dayCount)
      ? Math.abs(candidate.dayCount - runwayDays)
      : null;
  const normalizedRunwayGap = runwayGapDays === null ? Infinity : runwayGapDays / Math.max(runwayDays, 1);
  const preferredMoneyness = getPreferredMoneyness(request);
  const strikeMoneyness =
    typeof candidate.strike === "number" && typeof candidate.spotPrice === "number" && candidate.spotPrice > 0
      ? candidate.strike / candidate.spotPrice
      : Infinity;
  const strikeMoneynessGap =
    preferredMoneyness === null || !Number.isFinite(strikeMoneyness)
      ? 0
      : Math.abs(strikeMoneyness - preferredMoneyness);

  return {
    targetMet,
    targetYieldGap,
    targetYieldGapBps: targetYieldGap === null ? null : targetYieldGap * 10000,
    yieldShortfall: targetYieldGap === null ? Infinity : Math.max(0, -targetYieldGap),
    yieldExcess: targetYieldGap === null ? Infinity : Math.max(0, targetYieldGap),
    normalizedRunwayGap,
    runwayGapDays,
    strikeMoneyness,
    strikeMoneynessGap,
    strikeMoneynessGapBps: preferredMoneyness === null ? null : strikeMoneynessGap * 10000
  };
}

function getPreferredMoneyness(
  request: Pick<DcnPricingRequest, "productType" | "strikePreference" | "strikeBufferPct">
): number | null {
  if (typeof request.strikeBufferPct === "number" && Number.isFinite(request.strikeBufferPct)) {
    const maxBufferPct = request.productType === "sell_call" ? 200 : 99;
    const buffer = Math.min(maxBufferPct, Math.max(0, request.strikeBufferPct)) / 100;
    return request.productType === "sell_call" ? 1 + buffer : 1 - buffer;
  }
  if (request.strikePreference === "ten_otm") return request.productType === "sell_call" ? 1.1 : 0.9;
  if (request.strikePreference === "five_otm") return request.productType === "sell_call" ? 1.05 : 0.95;
  return null;
}

function getAutoSelectionPlan(request: DcnPricingRequest): AutoSelectionPlan | null {
  const mode = request.selectorMode ?? "closest";
  const priority = request.priorityLever;

  if (mode === "auto_yield") {
    const priorityLever = priority === "strike" ? "strike" : "runway";
    return {
      fixed: priorityLever === "strike" ? ["strike", "runway"] : ["runway", "strike"],
      solved: "yield",
      priorityLever
    };
  }

  if (mode === "auto_runway") {
    const priorityLever = priority === "strike" ? "strike" : "yield";
    return {
      fixed: priorityLever === "strike" ? ["strike", "yield"] : ["yield", "strike"],
      solved: "runway",
      priorityLever
    };
  }

  if (mode === "auto_strike") {
    const priorityLever = priority === "runway" ? "runway" : "yield";
    return {
      fixed: priorityLever === "runway" ? ["runway", "yield"] : ["yield", "runway"],
      solved: "strike",
      priorityLever
    };
  }

  return null;
}

function scoreAutoCandidate(
  request: DcnPricingRequest,
  candidate: DcnRankableCandidate,
  fit: CandidateFitMetrics
): number | null {
  const plan = getAutoSelectionPlan(request);
  if (!plan) return null;

  const primaryPenalty = getFixedLeverPenalty(plan.fixed[0], fit);
  const secondaryPenalty = getFixedLeverPenalty(plan.fixed[1], fit);
  const solvedScore = getSolvedLeverScore(request, plan.solved, candidate, fit);

  return 1_000_000_000 - primaryPenalty * 100_000_000 - secondaryPenalty * 10_000 + solvedScore;
}

function getFixedLeverPenalty(lever: DcnPriorityLever, fit: CandidateFitMetrics): number {
  if (lever === "yield") {
    return fit.targetMet ? Math.min(fit.yieldExcess, 1) : 1 + Math.min(fit.yieldShortfall, 1);
  }
  if (lever === "runway") return Math.min(fit.normalizedRunwayGap, 10);
  return Math.min(fit.strikeMoneynessGap, 10);
}

function getSolvedLeverScore(
  request: DcnPricingRequest,
  lever: DcnPriorityLever,
  candidate: DcnRankableCandidate,
  fit: CandidateFitMetrics
): number {
  if (lever === "yield") return Math.min(Math.max(finiteOr(candidate.clientYield, 0), 0), 1) * 1000;
  if (lever === "runway") return -finiteOr(candidate.dayCount, Infinity);
  return request.productType === "sell_call" ? fit.strikeMoneyness * 100 : -fit.strikeMoneyness * 100;
}

function compareFixedLever(lever: DcnPriorityLever, af: CandidateFitMetrics, bf: CandidateFitMetrics): number {
  if (lever === "yield") {
    return compareBy([
      () => compareBooleanDesc(af.targetMet, bf.targetMet),
      () => (af.targetMet && bf.targetMet ? compareAsc(af.yieldExcess, bf.yieldExcess) : compareAsc(af.yieldShortfall, bf.yieldShortfall))
    ]);
  }
  if (lever === "runway") return compareAsc(af.normalizedRunwayGap, bf.normalizedRunwayGap);
  return compareAsc(af.strikeMoneynessGap, bf.strikeMoneynessGap);
}

function compareSolvedLever(
  request: DcnPricingRequest,
  lever: DcnPriorityLever,
  a: DcnRankableCandidate,
  b: DcnRankableCandidate,
  af: CandidateFitMetrics,
  bf: CandidateFitMetrics
): number {
  if (lever === "yield") return compareDesc(a.clientYield, b.clientYield);
  if (lever === "runway") return compareAsc(a.dayCount, b.dayCount);
  return request.productType === "sell_call"
    ? compareDesc(af.strikeMoneyness, bf.strikeMoneyness)
    : compareAsc(af.strikeMoneyness, bf.strikeMoneyness);
}

function formatPriorityLever(lever: DcnPriorityLever | undefined): string {
  if (lever === "yield") return "return";
  if (lever === "runway") return "runway";
  if (lever === "strike") return "strike buffer";
  return "the selected fixed inputs";
}

function compareBy(comparators: Array<() => number>): number {
  for (const comparator of comparators) {
    const result = comparator();
    if (result !== 0) return result;
  }
  return 0;
}

function compareBooleanDesc(a: boolean, b: boolean): number {
  if (a === b) return 0;
  return a ? -1 : 1;
}

function compareAsc(a: number | null | undefined, b: number | null | undefined): number {
  const av = finiteOr(a, Infinity);
  const bv = finiteOr(b, Infinity);
  if (av === bv) return 0;
  return av - bv;
}

function compareDesc(a: number | null | undefined, b: number | null | undefined): number {
  const av = finiteOr(a, -Infinity);
  const bv = finiteOr(b, -Infinity);
  if (av === bv) return 0;
  return bv - av;
}

function finiteOr(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeSellPutPricingMethod(value: DcnPricingRequest["sellPutPricingMethod"]): SellPutPricingMethod {
  return value === "target_firm_profit" ? "target_firm_profit" : "firm_margin";
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundDownToDecimals(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.trunc(value * factor) / factor;
}
