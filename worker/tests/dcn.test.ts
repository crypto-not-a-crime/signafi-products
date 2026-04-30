import { describe, expect, it } from "vitest";
import { calculateDcnScenario, calculateDcnSellPut, modelSellIntoBidDepth, roundContracts } from "../src/pricing/dcn";

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

  it("matches workbook sample firm upside/downside profits when using the workbook C8 client yield", () => {
    const workbookGrossC17 = (0.04358 / 92) * 365;
    const workbookClientYield = 0.151;
    const result = calculateDcnSellPut(
      {
        investmentUsdt: 500000,
        firmMarginBps: (workbookGrossC17 - workbookClientYield) * 10000,
        scenarioDownsidePrice: 45000,
        scenarioUpsidePrice: 90000,
        scenarioExpiryPrice: 45000,
        quoteFreshnessSeconds: 10,
        nowMs: NOW
      },
      {
        instrumentName: "BTC-31JUL26-69000-P",
        strike: 69000,
        expirationTimestamp: EXPIRY_92_DAYS,
        minTradeAmount: 0.1,
        underlyingPrice: 75500,
        bidPrice: 0.04358,
        bidAmount: 6.6,
        markPrice: 0.0449,
        deribitTimestamp: NOW,
        bids: [[0.04358, 6.6]]
      }
    );

    expect(result.requiredContracts).toBe(6.6);
    expect(result.grossReferenceYield).toBeCloseTo(0.17289891304347826, 10);
    expect(result.clientYield).toBeCloseTo(workbookClientYield, 10);
    expect(result.netOptionProceedsBtc).toBeCloseTo(0.285648, 10);
    expect(result.downsideProfitUsdt).toBeCloseTo(15956.244574151351, 6);
    expect(result.upsideProfitUsdt).toBeCloseTo(6678.183013698552, 6);
    expect(result.selectedScenario.clientPayoutAsset).toBe("BTC");
    expect(result.selectedScenario.clientPayoutAmount).toBeCloseTo(7.522175898352194, 10);

    const upsideScenario = calculateDcnScenario(90000, {
      investmentUsdt: result.investmentUsdt,
      strike: result.strike,
      dayCount: result.dayCount,
      requiredContracts: result.requiredContracts,
      clientYield: result.clientYield,
      clientPrincipalInterestBtc: result.downsideScenario.clientPrincipalInterestBtc,
      clientPrincipalInterestUsdt: result.upsideScenario.clientPrincipalInterestUsdt,
      netOptionProceedsBtc: result.netOptionProceedsBtc
    });
    expect(upsideScenario.clientPayoutAsset).toBe("USDT");
    expect(upsideScenario.clientPayoutAmount).toBeCloseTo(519030.1369863014, 6);
  });

  it("keeps the Signafi client yield at C17 less a fixed 2 percent margin", () => {
    const result = calculateDcnSellPut(
      {
        investmentUsdt: 500000,
        firmMarginBps: 200,
        quoteFreshnessSeconds: 10,
        nowMs: NOW
      },
      {
        instrumentName: "BTC-31JUL26-69000-P",
        strike: 69000,
        expirationTimestamp: EXPIRY_92_DAYS,
        minTradeAmount: 0.1,
        underlyingPrice: 75500,
        bidPrice: 0.04358,
        bidAmount: 6.6,
        deribitTimestamp: NOW,
        bids: [[0.04358, 6.6]]
      }
    );

    expect(result.clientYield).toBeCloseTo((0.04358 / 92) * 365 - 0.02, 10);
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
