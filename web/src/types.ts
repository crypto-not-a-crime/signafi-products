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
  firmMarginBps: number;
}

export interface FormulaTraceRow {
  cell: string;
  label: string;
  formula: string;
  value: number | string | boolean | null;
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
    effectivePutBidPrice: number | null;
    bestBidPrice: number | null;
    bestBidAmount: number | null;
    sufficientDepth: boolean;
    remainingContracts: number;
    slippagePct: number | null;
    fills: DepthFill[];
  };
}

export interface DcnPricingResponse {
  generatedAt: number;
  input: Record<string, unknown>;
  candidates: DcnCandidate[];
  bestCandidate: DcnCandidate | null;
  mock?: boolean;
}
