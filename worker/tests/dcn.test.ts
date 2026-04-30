import { describe, expect, it } from "vitest";
import { calculateDcnSellPut, modelSellIntoBidDepth, roundContracts } from "../src/pricing/dcn";

const NOW = Date.UTC(2026, 3, 30);
const EXPIRY_92_DAYS = NOW + 92 * 24 * 60 * 60 * 1000;

describe("DCN depth modelling", () => {
  it("uses top of book when it fully covers required contracts", () => {
    const depth = modelSellIntoBidDepth([[0.0645, 20]], 12.7);
    expect(depth.sufficientDepth).toBe(true);
    expect(depth.effectivePutBidPrice).toBeCloseTo(0.0645, 8);
    expect(depth.slippagePct).toBeCloseTo(0, 8);
  });

  it("averages across multiple bid levels and reports slippage", () => {
    const depth = modelSellIntoBidDepth(
      [
        [0.0645, 5],
        [0.062, 5],
        [0.06, 5]
      ],
      12
    );
    const expected = (0.0645 * 5 + 0.062 * 5 + 0.06 * 2) / 12;
    expect(depth.sufficientDepth).toBe(true);
    expect(depth.effectivePutBidPrice).toBeCloseTo(expected, 8);
    expect(depth.slippagePct).toBeGreaterThan(0);
  });

  it("marks insufficient depth when bids cannot fill the order", () => {
    const depth = modelSellIntoBidDepth([[0.0645, 2]], 10);
    expect(depth.sufficientDepth).toBe(false);
    expect(depth.effectivePutBidPrice).toBeNull();
    expect(depth.remainingContracts).toBeCloseTo(8);
  });
});

describe("DCN sell-put pricing", () => {
  it("rounds contracts like the workbook model", () => {
    expect(roundContracts(1000000 / 78493, 0.1)).toBe(12.7);
  });

  it("matches workbook-style baseline premium when effective bid equals C15", () => {
    const result = calculateDcnSellPut(
      {
        investmentUsdt: 1000000,
        firmMarginBps: 200,
        quoteFreshnessSeconds: 10,
        nowMs: NOW
      },
      {
        instrumentName: "BTC-30JUL26-75000-P",
        strike: 75000,
        expirationTimestamp: EXPIRY_92_DAYS,
        minTradeAmount: 0.1,
        underlyingPrice: 78493,
        bidPrice: 0.0645,
        bidAmount: 20,
        markPrice: 0.0653,
        deribitTimestamp: NOW,
        bids: [[0.0645, 20]]
      }
    );

    expect(result.dayCount).toBe(92);
    expect(result.requiredContracts).toBe(12.7);
    expect(result.effectivePutBidPrice).toBeCloseTo(0.0645, 8);
    expect(result.grossReferenceYield).toBeCloseTo((0.0645 / 92) * 365, 8);
    expect(result.clientYield).toBeCloseTo((0.0645 / 92) * 365 - 0.02, 8);
    expect(result.tradingFeesBtc).toBeCloseTo(-0.00381, 8);
    expect(result.netOptionProceedsBtc).toBeCloseTo(0.81534, 5);
    expect(result.premiumCoversInterest).toBe(true);
  });

  it("fails eligibility when the quote is stale", () => {
    const result = calculateDcnSellPut(
      {
        investmentUsdt: 500000,
        quoteFreshnessSeconds: 10,
        nowMs: NOW
      },
      {
        instrumentName: "BTC-30JUL26-75000-P",
        strike: 75000,
        expirationTimestamp: EXPIRY_92_DAYS,
        underlyingPrice: 78493,
        bidPrice: 0.0645,
        bidAmount: 20,
        deribitTimestamp: NOW - 30_000,
        bids: [[0.0645, 20]]
      }
    );

    expect(result.checks.quoteFresh).toBe(false);
    expect(result.eligible).toBe(false);
  });
});
