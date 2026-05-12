export interface DepthFill {
  price: number;
  amount: number;
  notionalBtc: number;
}

export interface FormulaTemplateSummary {
  id: string;
  version: string;
  label: string;
  sourceWorkbook: string;
  sourceSheets: string[];
  sellPutPricingMethod?: SellPutPricingMethod;
  firmMarginBps?: number;
  sellPutTargetFirmProfitBps?: number;
  sellCallTargetFirmProfitBps?: number;
  upsideReferenceMultiplier?: number;
}

export interface FormulaTraceRow {
  cell: string;
  label: string;
  formula: string;
  value: number | string | boolean | null;
}

export interface PricingConfig {
  sellPutPricingMethod: SellPutPricingMethod;
  firmMarginBps: number;
  sellPutTargetFirmProfitBps: number;
  sellCallTargetFirmProfitBps: number;
  quoteFreshnessSeconds: number;
  defaultOrderBookDepth: number;
  maxDepthCandidates: number;
  maxSlippageBps: number;
}

export interface DcnScenarioResult {
  expiryPrice: number;
  side: "downside" | "upside";
  clientPayoutAsset: "BTC" | "USDT";
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

export interface DcnCandidate {
  formulaTemplate?: FormulaTemplateSummary;
  productType?: "sell_put" | "sell_call";
  instrumentName: string;
  investmentUsdt: number;
  investmentBtc?: number;
  spotPrice: number;
  strike: number;
  dayCount: number;
  requiredContracts: number;
  effectiveOptionBidPrice?: number | null;
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
  selectedScenario?: DcnScenarioResult;
  downsideScenario?: DcnScenarioResult;
  upsideScenario?: DcnScenarioResult;
  upsideProfitUsdt: number | null;
  upsideAnnualizedProfit: number | null;
  downsideProfitUsdt: number | null;
  downsideAnnualizedProfit: number | null;
  quoteAgeSeconds: number | null;
  eligible: boolean;
  checks: Record<string, boolean>;
  formulaTrace: FormulaTraceRow[];
  depth: {
    requiredContracts: number;
    filledContracts: number;
    grossProceedsBtc: number;
    effectiveOptionBidPrice?: number | null;
    effectivePutBidPrice: number | null;
    bestBidPrice: number | null;
    bestBidAmount: number | null;
    sufficientDepth: boolean;
    remainingContracts: number;
    slippagePct: number | null;
    fills: DepthFill[];
  };
}

export type DcnSelectorMode = "closest" | "auto_yield" | "auto_runway" | "auto_strike";
export type DcnPriorityLever = "yield" | "runway" | "strike";
export type SellPutPricingMethod = "firm_margin" | "target_firm_profit";

export interface DcnPricingRequest {
  productType?: "sell_put" | "sell_call";
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
}

export interface DcnRecommendation {
  selectorMode: DcnSelectorMode;
  recommendedLever: "none" | "yield" | "runway" | "strike";
  priorityLever?: DcnPriorityLever;
  reason: string;
  targetYieldGapBps: number | null;
  runwayGapDays: number | null;
  strikeMoneynessGapBps: number | null;
}

export interface DcnPricingResponse {
  generatedAt: number;
  input: Record<string, unknown>;
  candidates: DcnCandidate[];
  bestCandidate: DcnCandidate | null;
  recommendation?: DcnRecommendation;
  mock?: boolean;
}

export interface DeribitMarginResult {
  buy: number;
  sell: number;
  min_price: number;
  max_price: number;
}

export interface DeribitMarginCheck {
  instrumentName: string;
  amount: number;
  price: number;
  result?: DeribitMarginResult;
  error?: string;
  mock?: boolean;
}

export interface MarketOption {
  instrument_name: string;
  option_type: "call" | "put";
  strike: number;
  expiration_timestamp: number;
  bid_price: number | null;
  bid_amount: number | null;
  ask_price: number | null;
  ask_amount: number | null;
  mark_price: number | null;
  last_price: number | null;
  mark_iv: number | null;
  open_interest: number | null;
  underlying_price: number | null;
  deribit_timestamp: number | null;
  ingested_at: number | null;
}

export interface MarketExpirySummary {
  option_type: "call" | "put";
  expiration_timestamp: number;
  instrument_count: number;
}

export interface YieldSurfacePoint {
  instrumentName: string;
  optionType: "call" | "put";
  strike: number;
  expirationTimestamp: number;
  expiryLabel: string;
  daysToExpiry: number;
  bidPrice: number;
  bidAmount: number | null;
  askPrice: number | null;
  askAmount: number | null;
  markPrice: number | null;
  lastPrice: number | null;
  markIv: number | null;
  openInterest: number | null;
  underlyingPrice: number | null;
  deribitTimestamp: number | null;
  ingestedAt: number | null;
  annualizedYield: number;
}

export interface YieldSurfaceExpiry {
  expirationTimestamp: number;
  label: string;
  daysToExpiry: number;
  pointCount: number;
}

export interface YieldSurfaceResponse {
  generatedAt: number;
  optionType: "call" | "put";
  source: "d1_latest" | "deribit_public" | "mock";
  spotPrice?: number | null;
  spotInstrumentName?: string | null;
  spotTickerTimestamp?: number | null;
  formula: {
    label: string;
    expression: string;
    annualizationDays: number;
    dayCount: string;
  };
  filters: {
    minDte: number;
    maxDte: number;
    minStrike: number;
    maxStrike: number;
  };
  latestQuoteAt: number | null;
  latestQuoteAgeSeconds: number | null;
  minAnnualizedYield: number | null;
  maxAnnualizedYield: number | null;
  strikes: number[];
  expiries: YieldSurfaceExpiry[];
  points: YieldSurfacePoint[];
  mock?: boolean;
  fallbackReason?: string;
}
