export type BidAskLevel = [price: number, amount: number];

export interface DcnPricingRequest {
  investmentUsdt: number;
  targetYieldBps?: number;
  runwayDays?: number;
  strikePreference?: "any" | "five_otm" | "ten_otm";
  firmMarginBps?: number;
  quoteFreshnessSeconds?: number;
  orderBookDepth?: number;
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

export interface DcnCalculation {
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

export function roundContracts(rawContracts: number, minTradeAmount = 0.1): number {
  if (!Number.isFinite(rawContracts) || rawContracts <= 0) {
    return minTradeAmount;
  }
  const rounded = Math.round(rawContracts * 10) / 10;
  return Math.max(rounded, minTradeAmount);
}

export function dayCountFromExpiry(expirationTimestamp: number, nowMs = Date.now()): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((expirationTimestamp - nowMs) / msPerDay));
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

export function calculateDcnSellPut(request: DcnPricingRequest, market: PutMarketInput): DcnCalculation {
  const nowMs = request.nowMs ?? Date.now();
  const firmMarginBps = request.firmMarginBps ?? 200;
  const quoteFreshnessSeconds = request.quoteFreshnessSeconds ?? 10;
  const investmentUsdt = request.investmentUsdt;
  const spotPrice = market.underlyingPrice ?? 0;
  const dayCount = dayCountFromExpiry(market.expirationTimestamp, nowMs);
  const requiredContracts = roundContracts(investmentUsdt / spotPrice, market.minTradeAmount ?? 0.1);
  const depth = modelSellIntoBidDepth(market.bids, requiredContracts, market.bidPrice, market.bidAmount);
  const effectivePutBidPrice = depth.effectivePutBidPrice;
  const quoteTime = market.deribitTimestamp ?? market.ingestedAt ?? null;
  const quoteAgeSeconds = quoteTime ? Math.max(0, (nowMs - quoteTime) / 1000) : null;

  const grossReferenceYield = effectivePutBidPrice === null ? null : (effectivePutBidPrice / dayCount) * 365;
  const clientYield = grossReferenceYield === null ? null : Math.max(0, grossReferenceYield - firmMarginBps / 10000);
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
  const scenarioUpsidePrice = request.scenarioUpsidePrice ?? market.strike * 1.2;
  const scenarioDownsidePrice = request.scenarioDownsidePrice ?? market.strike * (2 / 3);
  const clientPrincipalInterestBtc =
    clientYield === null ? null : (investmentUsdt / market.strike) * (1 + clientYield * (dayCount / 365));

  const upsideProfitUsdt =
    netOptionProceedsBtc === null || clientPrincipalInterestUsdt === null
      ? null
      : investmentUsdt + netOptionProceedsBtc * scenarioUpsidePrice - clientPrincipalInterestUsdt;
  const upsideAnnualizedProfit =
    upsideProfitUsdt === null ? null : (upsideProfitUsdt / investmentUsdt / dayCount) * 365;

  const optionSettlementBtc =
    scenarioDownsidePrice < market.strike
      ? -((market.strike - scenarioDownsidePrice) / scenarioDownsidePrice) * requiredContracts
      : 0;
  const hedgeBtc = netOptionProceedsBtc === null ? null : netOptionProceedsBtc + optionSettlementBtc;
  const btcToPurchase =
    hedgeBtc === null || clientPrincipalInterestBtc === null ? null : clientPrincipalInterestBtc - hedgeBtc;
  const downsideProfitUsdt = btcToPurchase === null ? null : investmentUsdt - btcToPurchase * scenarioDownsidePrice;
  const downsideAnnualizedProfit =
    downsideProfitUsdt === null ? null : (downsideProfitUsdt / investmentUsdt / dayCount) * 365;

  const checks = {
    quoteFresh: quoteAgeSeconds !== null && quoteAgeSeconds <= quoteFreshnessSeconds,
    usableBid: effectivePutBidPrice !== null && effectivePutBidPrice > 0,
    sufficientDepth: depth.sufficientDepth,
    premiumCoversInterest,
    clientYieldPositive: clientYield !== null && clientYield > 0,
    firmMarginPositive: firmMarginBps > 0,
    upsideProfitPositive: upsideProfitUsdt !== null && upsideProfitUsdt > 0,
    downsideProfitPositive: downsideProfitUsdt !== null && downsideProfitUsdt > 0
  };
  const eligible = Object.values(checks).every(Boolean);

  const formulaTrace: FormulaTraceRow[] = [
    { cell: "C4", label: "Initial Investment (USDT)", formula: "user input", value: investmentUsdt },
    { cell: "C5", label: "BTC Spot Price", formula: "Deribit underlying_price", value: spotPrice },
    { cell: "C7", label: "Strike Price", formula: "selected Deribit put strike", value: market.strike },
    { cell: "C11", label: "Day Count", formula: "DAYS(expiry, today)", value: dayCount },
    { cell: "C14", label: "Contracts", formula: "ROUND(C4/C5, 1)", value: requiredContracts },
    {
      cell: "C15",
      label: "Put Bid Price",
      formula: "SUM(filled contracts * bid level price) / required contracts",
      value: effectivePutBidPrice
    },
    {
      cell: "C17",
      label: "Option Baseline Premium",
      formula: "C15/C11*365",
      value: grossReferenceYield
    },
    {
      cell: "Signafi Margin",
      label: "Firm margin",
      formula: "configured firm_margin_bps / 10000",
      value: firmMarginBps / 10000
    },
    {
      cell: "Client Yield",
      label: "Client target yield",
      formula: "MAX(C17 - Signafi Margin, 0)",
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
      cell: "Upside Profit",
      label: "Issuer upside profit",
      formula: "C4 + C22*upsidePrice - client principal and interest",
      value: upsideProfitUsdt
    },
    {
      cell: "Downside Profit",
      label: "Issuer downside profit",
      formula: "C4 - BTC_to_purchase*downsidePrice",
      value: downsideProfitUsdt
    }
  ];

  return {
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

export function scorePutCandidate(request: DcnPricingRequest, market: PutMarketInput): number {
  const spot = market.underlyingPrice ?? 0;
  if (!spot || !market.bidPrice || market.bidPrice <= 0) return -Infinity;

  const dayCount = dayCountFromExpiry(market.expirationTimestamp, request.nowMs ?? Date.now());
  const runwayDays = request.runwayDays ?? dayCount;
  const targetYield = (request.targetYieldBps ?? 0) / 10000;
  const roughClientYield = Math.max(0, (market.bidPrice / dayCount) * 365 - (request.firmMarginBps ?? 200) / 10000);
  const moneyness = market.strike / spot;
  const preferredMoneyness =
    request.strikePreference === "ten_otm" ? 0.9 : request.strikePreference === "five_otm" ? 0.95 : 0.93;

  const runwayPenalty = Math.abs(dayCount - runwayDays) / Math.max(runwayDays, 1);
  const targetPenalty = targetYield > 0 ? Math.abs(roughClientYield - targetYield) / Math.max(targetYield, 0.01) : 0;
  const moneynessPenalty = Math.abs(moneyness - preferredMoneyness);

  return 100 - runwayPenalty * 25 - targetPenalty * 30 - moneynessPenalty * 100;
}
