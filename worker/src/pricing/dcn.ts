import { DCN_SELL_PUT_TEMPLATE, getDcnTemplateSummary, type DcnTemplateSummary } from "./dcn-template";

export type BidAskLevel = [price: number, amount: number];
export type DcnSelectorMode = "closest" | "auto_yield" | "auto_runway" | "auto_strike";
export type DcnRecommendedLever = "none" | "yield" | "runway" | "strike";

export interface DcnPricingRequest {
  investmentUsdt: number;
  targetYieldBps?: number;
  runwayDays?: number;
  strikePreference?: "any" | "five_otm" | "ten_otm";
  selectorMode?: DcnSelectorMode;
  firmMarginBps?: number;
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
  instrumentName: string;
  investmentUsdt: number;
  spotPrice: number;
  strike: number;
  dayCount: number;
  requiredContracts: number;
  effectivePutBidPrice: number | null;
  grossReferenceYield: number | null;
  firmMarginBps: number;
  clientYield: number | null;
  clientInterestUsdt: number | null;
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
  reason: string;
  targetYieldGapBps: number | null;
  runwayGapDays: number | null;
  strikeMoneynessGapBps: number | null;
}

export function roundContracts(rawContracts: number, minTradeAmount = 0.1): number {
  if (!Number.isFinite(rawContracts) || rawContracts <= 0) {
    return minTradeAmount;
  }
  const rounded = Math.round(rawContracts * 10) / 10;
  return Math.max(rounded, minTradeAmount);
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
    effectivePutBidPrice,
    bestBidPrice,
    bestBidAmount,
    sufficientDepth,
    remainingContracts: Math.max(0, remaining),
    slippagePct,
    fills
  };
}

interface DcnScenarioInput {
  investmentUsdt: number;
  strike: number;
  dayCount: number;
  requiredContracts: number;
  clientYield: number | null;
  clientPrincipalInterestBtc: number | null;
  clientPrincipalInterestUsdt: number | null;
  netOptionProceedsBtc: number | null;
}

export function calculateDcnScenario(expiryPrice: number, input: DcnScenarioInput): DcnScenarioResult {
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

export function calculateDcnSellPut(request: DcnPricingRequest, market: PutMarketInput): DcnCalculation {
  const nowMs = request.nowMs ?? Date.now();
  const firmMarginBps = request.firmMarginBps ?? 200;
  const maxSlippageBps = request.maxSlippageBps ?? 500;
  const quoteFreshnessSeconds = request.quoteFreshnessSeconds ?? 10;
  const investmentUsdt = request.investmentUsdt;
  const spotPrice = market.underlyingPrice ?? 0;
  const dayCount = dayCountFromExpiry(market.expirationTimestamp, nowMs);
  const requiredContracts = roundContracts(investmentUsdt / market.strike, market.minTradeAmount ?? 0.1);
  const depth = modelSellIntoBidDepth(market.bids, requiredContracts, market.bidPrice, market.bidAmount);
  const effectivePutBidPrice = depth.effectivePutBidPrice;
  const quoteTime = market.deribitTimestamp ?? market.ingestedAt ?? null;
  const quoteAgeSeconds = quoteTime ? Math.max(0, (nowMs - quoteTime) / 1000) : null;

  const grossReferenceYield =
    effectivePutBidPrice === null || dayCount <= 0 ? null : (effectivePutBidPrice / dayCount) * 365;
  const rawClientYield = grossReferenceYield === null ? null : Math.max(0, grossReferenceYield - firmMarginBps / 10000);
  const clientYield = rawClientYield === null ? null : roundYieldToOneDecimalPercent(rawClientYield);
  const clientInterestUsdt = clientYield === null ? null : investmentUsdt * clientYield * (dayCount / 365);
  const tradingFeePerContractBtc =
    effectivePutBidPrice === null ? null : -Math.min(0.0003, 0.125 * effectivePutBidPrice);
  const tradingFeesBtc = tradingFeePerContractBtc === null ? null : tradingFeePerContractBtc * requiredContracts;
  const grossOptionProceedsBtc = effectivePutBidPrice === null ? null : requiredContracts * effectivePutBidPrice;
  const netOptionProceedsBtc =
    grossOptionProceedsBtc === null || tradingFeesBtc === null ? null : grossOptionProceedsBtc + tradingFeesBtc;
  const netOptionProceedsUsdt = netOptionProceedsBtc === null ? null : netOptionProceedsBtc * spotPrice;

  const premiumCoversInterest =
    netOptionProceedsUsdt !== null && clientInterestUsdt !== null && netOptionProceedsUsdt >= clientInterestUsdt;

  const clientPrincipalInterestUsdt =
    clientYield === null ? null : investmentUsdt * (1 + clientYield * (dayCount / 365));
  const scenarioUpsidePrice = request.scenarioUpsidePrice ?? spotPrice;
  const scenarioDownsidePrice = request.scenarioDownsidePrice ?? market.strike * (2 / 3);
  const clientPrincipalInterestBtc =
    clientYield === null ? null : (investmentUsdt / market.strike) * (1 + clientYield * (dayCount / 365));

  const baseScenarioInput = {
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
    clientYieldPositive: clientYield !== null && clientYield > 0,
    firmMarginPositive: firmMarginBps > 0,
    selectedScenarioProfitPositive: selectedScenario.firmProfitUsdt !== null && selectedScenario.firmProfitUsdt > 0,
    upsideProfitPositive: upsideProfitUsdt !== null && upsideProfitUsdt > 0,
    downsideProfitPositive: downsideProfitUsdt !== null && downsideProfitUsdt > 0
  };
  const eligible = Object.values(checks).every(Boolean);

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
      cell: "Signafi Margin",
      label: "Firm margin",
      formula: "request firmMarginBps / 10000",
      value: firmMarginBps / 10000
    },
    {
      cell: "Client Yield",
      label: "Client target yield",
      formula: DCN_SELL_PUT_TEMPLATE.formulas.clientYield,
      value: clientYield
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
    formulaTemplate: { ...getDcnTemplateSummary(), firmMarginBps },
    instrumentName: market.instrumentName,
    investmentUsdt,
    spotPrice,
    strike: market.strike,
    dayCount,
    requiredContracts,
    effectivePutBidPrice,
    grossReferenceYield,
    firmMarginBps,
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

export function priceCandidateAtSize(request: DcnPricingRequest, market: PutMarketInput): DcnCalculation {
  return calculateDcnSellPut(request, market);
}

export function scorePutCandidate(request: DcnPricingRequest, market: PutMarketInput): number {
  const spot = market.underlyingPrice ?? 0;
  if (!spot || !market.bidPrice || market.bidPrice <= 0) return -Infinity;
  if (market.strike >= spot) return -Infinity;

  const dayCount = dayCountFromExpiry(market.expirationTimestamp, request.nowMs ?? Date.now());
  if (dayCount <= 0) return -Infinity;
  const roughClientYield = roundYieldToOneDecimalPercent(
    Math.max(0, (market.bidPrice / dayCount) * 365 - (request.firmMarginBps ?? 200) / 10000)
  );
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
  const mode = request.selectorMode ?? "closest";
  const targetBonus = fit.targetMet ? 1000 : 0;

  if (mode === "auto_yield") {
    const boundedYieldScore = Math.min(Math.max(roughClientYield, 0), 1) * 100;
    return 1000 - fit.normalizedRunwayGap * 1000 - fit.strikeMoneynessGap * 2000 + boundedYieldScore;
  }

  if (mode === "auto_strike") {
    return (
      1000 +
      targetBonus -
      fit.normalizedRunwayGap * 200 -
      (fit.targetMet ? fit.strikeMoneyness * 25 + fit.yieldExcess * 100 : fit.yieldShortfall * 1000)
    );
  }

  if (mode === "auto_runway") {
    return (
      1000 +
      targetBonus -
      fit.strikeMoneynessGap * 200 -
      (fit.targetMet ? (roughCandidate.dayCount ?? 0) / 10 + fit.yieldExcess * 100 : fit.yieldShortfall * 1000)
    );
  }

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

  if (mode === "auto_yield") {
    return compareBy([
      () => compareAsc(af.normalizedRunwayGap, bf.normalizedRunwayGap),
      () => compareAsc(af.strikeMoneynessGap, bf.strikeMoneynessGap),
      () => compareDesc(a.clientYield, b.clientYield),
      () => compareAsc(a.depth.slippagePct, b.depth.slippagePct),
      () => compareAsc(a.quoteAgeSeconds, b.quoteAgeSeconds),
      () => compareDesc(a.upsideProfitUsdt, b.upsideProfitUsdt),
      () => compareDesc(a.score, b.score)
    ]);
  }

  if (mode === "auto_strike") {
    return compareBy([
      () => compareBooleanDesc(af.targetMet, bf.targetMet),
      () => (af.targetMet && bf.targetMet ? compareAsc(af.normalizedRunwayGap, bf.normalizedRunwayGap) : 0),
      () => (af.targetMet && bf.targetMet ? compareAsc(af.strikeMoneyness, bf.strikeMoneyness) : 0),
      () => (af.targetMet && bf.targetMet ? compareAsc(af.yieldExcess, bf.yieldExcess) : compareAsc(af.yieldShortfall, bf.yieldShortfall)),
      () => compareAsc(a.depth.slippagePct, b.depth.slippagePct),
      () => compareAsc(a.quoteAgeSeconds, b.quoteAgeSeconds),
      () => compareDesc(a.upsideProfitUsdt, b.upsideProfitUsdt),
      () => compareDesc(a.score, b.score)
    ]);
  }

  if (mode === "auto_runway") {
    return compareBy([
      () => compareBooleanDesc(af.targetMet, bf.targetMet),
      () => compareAsc(af.strikeMoneynessGap, bf.strikeMoneynessGap),
      () => (af.targetMet && bf.targetMet ? compareAsc(a.dayCount, b.dayCount) : compareAsc(af.yieldShortfall, bf.yieldShortfall)),
      () => (af.targetMet && bf.targetMet ? compareAsc(af.yieldExcess, bf.yieldExcess) : 0),
      () => compareAsc(a.depth.slippagePct, b.depth.slippagePct),
      () => compareAsc(a.quoteAgeSeconds, b.quoteAgeSeconds),
      () => compareDesc(a.upsideProfitUsdt, b.upsideProfitUsdt),
      () => compareDesc(a.score, b.score)
    ]);
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
      ? "Highest executable client yield among products closest to the requested runway and strike buffer."
      : selectorMode === "auto_runway"
        ? "Shortest eligible runway that fits the requested target yield and strike buffer."
        : selectorMode === "auto_strike"
          ? "Safest eligible strike that fits the requested runway and target yield."
          : "Closest eligible product to the requested target yield, runway, and strike buffer.";

  return {
    selectorMode,
    recommendedLever,
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
  const preferredMoneyness = getPreferredMoneyness(request.strikePreference);
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

function getPreferredMoneyness(strikePreference: DcnPricingRequest["strikePreference"]): number | null {
  if (strikePreference === "ten_otm") return 0.9;
  if (strikePreference === "five_otm") return 0.95;
  return null;
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
