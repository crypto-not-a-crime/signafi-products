export interface DepthFill {
  price: number;
  amount: number;
  notionalBtc: number;
}

export interface DcnCandidate {
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
  eligible: boolean;
  checks: Record<string, boolean>;
  formulaTrace: Array<{
    cell: string;
    label: string;
    formula: string;
    value: number | string | boolean | null;
  }>;
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
