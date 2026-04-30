import type { DcnCandidate, DcnPricingResponse } from "@/types";

export function mockDcnCandidate(overrides: Partial<DcnCandidate> = {}): DcnCandidate {
  const candidate: DcnCandidate = {
    instrumentName: "BTC-31JUL26-75000-P",
    investmentUsdt: 500000,
    spotPrice: 78500,
    strike: 75000,
    dayCount: 92,
    requiredContracts: 6.4,
    effectivePutBidPrice: 0.0641,
    grossReferenceYield: (0.0641 / 92) * 365,
    firmMarginBps: 200,
    clientYield: (0.0641 / 92) * 365 - 0.02,
    clientInterestUsdt: 500000 * (((0.0641 / 92) * 365 - 0.02) * (92 / 365)),
    tradingFeesBtc: -0.00192,
    netOptionProceedsBtc: 0.40832,
    netOptionProceedsUsdt: 32053.12,
    premiumCoversInterest: true,
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
      { cell: "C17", label: "Option Baseline Premium", formula: "C15/C11*365", value: (0.0641 / 92) * 365 },
      { cell: "Client Yield", label: "Client target yield", formula: "C17 - 2.0% p.a.", value: (0.0641 / 92) * 365 - 0.02 },
      { cell: "Upside Profit", label: "Issuer upside profit", formula: "scenario analysis", value: 17900 },
      { cell: "Downside Profit", label: "Issuer downside profit", formula: "scenario analysis", value: 11420 }
    ],
    depth: {
      requiredContracts: 6.4,
      filledContracts: 6.4,
      grossProceedsBtc: 0.41024,
      effectivePutBidPrice: 0.0641,
      bestBidPrice: 0.0645,
      bestBidAmount: 3.1,
      sufficientDepth: true,
      remainingContracts: 0,
      slippagePct: 0.0062,
      fills: [
        { price: 0.0645, amount: 3.1, notionalBtc: 0.19995 },
        { price: 0.0638, amount: 3.3, notionalBtc: 0.21054 }
      ]
    }
  };
  return { ...candidate, ...overrides };
}

export function mockPricingResponse(input: Record<string, unknown> = {}): DcnPricingResponse {
  const investmentUsdt = Number(input.investmentUsdt ?? 500000);
  const best = mockDcnCandidate({
    investmentUsdt,
    requiredContracts: Math.round((investmentUsdt / 78500) * 10) / 10
  });
  return {
    generatedAt: Date.now(),
    input,
    candidates: [
      best,
      mockDcnCandidate({
        instrumentName: "BTC-31JUL26-70000-P",
        strike: 70000,
        effectivePutBidPrice: 0.044,
        clientYield: (0.044 / 92) * 365 - 0.02,
        grossReferenceYield: (0.044 / 92) * 365,
        upsideProfitUsdt: 9700,
        downsideProfitUsdt: 8400
      })
    ],
    bestCandidate: best,
    mock: true
  };
}
