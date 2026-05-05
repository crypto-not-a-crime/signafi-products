import { describe, expect, it } from "vitest";
import {
  calculateDcnScenario,
  calculateDcnSellPut,
  compareDcnCandidatesForClientMandate,
  dayCountFromExpiry,
  modelSellIntoBidDepth,
  roundContracts,
  selectDcnCandidate
} from "../src/pricing/dcn";
import { spotPriceFromTicker } from "../src/deribit";

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
  it("counts calendar days exclusive of today and inclusive of the expiry date", () => {
    const nowIntraday = Date.UTC(2026, 3, 30, 5, 30);
    const expiryIntraday = Date.UTC(2026, 6, 31, 8, 0);
    const sameDateExpiry = Date.UTC(2026, 3, 30, 8, 0);

    expect(dayCountFromExpiry(expiryIntraday, nowIntraday)).toBe(92);
    expect(dayCountFromExpiry(sameDateExpiry, nowIntraday)).toBe(0);
  });

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

  it("uses BTC/USDC spot input as C5 rather than option underlying price semantics", () => {
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
        underlyingPrice: 80258,
        bidPrice: 0.0645,
        bidAmount: 20,
        deribitTimestamp: NOW,
        bids: [[0.0645, 20]]
      }
    );

    const c5 = result.formulaTrace.find((row) => row.cell === "C5");
    expect(result.spotPrice).toBe(80258);
    expect(c5?.formula).toBe("Deribit BTC_USDC spot mid");
    expect(result.requiredContracts).toBe(roundContracts(1000000 / 80258, 0.1));
  });

  it("derives BTC/USDC spot from ticker midpoint with sensible fallbacks", () => {
    expect(
      spotPriceFromTicker({
        instrument_name: "BTC_USDC",
        timestamp: NOW,
        best_bid_price: 80245,
        best_ask_price: 80271,
        mark_price: 80251.39,
        last_price: 80266,
        index_price: 80251.39
      })
    ).toBe(80258);
    expect(
      spotPriceFromTicker({
        instrument_name: "BTC_USDC",
        timestamp: NOW,
        mark_price: 80251.39,
        last_price: 80266
      })
    ).toBe(80251.39);
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

  it("keeps the same closest-fit product across investment sizes when both quotes remain executable", () => {
    const baseRequest = {
      targetYieldBps: 1000,
      runwayDays: 180,
      strikePreference: "ten_otm" as const,
      selectorMode: "closest" as const
    };
    const closestFit = rankableCandidate("BTC-25DEC26-70000-P", {
      clientYield: 0.1048,
      upsideProfitUsdt: 4500,
      dayCount: 180,
      strike: 70000,
      spotPrice: 78000
    });
    const higherFirmProfit = rankableCandidate("BTC-25DEC26-74000-P", {
      clientYield: 0.1339,
      upsideProfitUsdt: 12000,
      dayCount: 180,
      strike: 74000,
      spotPrice: 78000
    });

    expect(selectDcnCandidate({ ...baseRequest, investmentUsdt: 500000 }, [higherFirmProfit, closestFit]).bestCandidate)
      .toBe(closestFit);
    expect(selectDcnCandidate({ ...baseRequest, investmentUsdt: 1000000 }, [higherFirmProfit, closestFit]).bestCandidate)
      .toBe(closestFit);
  });

  it("changes product when the larger-size quote breaches depth or slippage eligibility", () => {
    const request = {
      investmentUsdt: 1000000,
      targetYieldBps: 1000,
      runwayDays: 180,
      strikePreference: "ten_otm" as const,
      selectorMode: "closest" as const
    };
    const staleFit = rankableCandidate("BTC-25DEC26-70000-P", {
      eligible: false,
      clientYield: 0.1048,
      dayCount: 180,
      strike: 70000,
      spotPrice: 78000
    });
    const nextExecutable = rankableCandidate("BTC-25DEC26-74000-P", {
      clientYield: 0.1339,
      dayCount: 180,
      strike: 74000,
      spotPrice: 78000
    });

    expect(selectDcnCandidate(request, [staleFit, nextExecutable]).bestCandidate).toBe(nextExecutable);
  });

  it("closest mode prefers the mandate fit over a higher-yield, higher-profit product", () => {
    const request = {
      investmentUsdt: 500000,
      targetYieldBps: 1000,
      runwayDays: 180,
      strikePreference: "ten_otm" as const,
      selectorMode: "closest" as const
    };
    const nearTargetTenOtm = rankableCandidate("near-target", {
      clientYield: 0.1048,
      upsideProfitUsdt: 4500,
      dayCount: 180,
      strike: 70000,
      spotPrice: 78000
    });
    const richerButWorseBuffer = rankableCandidate("richer", {
      clientYield: 0.1339,
      upsideProfitUsdt: 12000,
      dayCount: 180,
      strike: 74000,
      spotPrice: 78000
    });

    expect([richerButWorseBuffer, nearTargetTenOtm].sort((a, b) => compareDcnCandidatesForClientMandate(request, a, b))[0])
      .toBe(nearTargetTenOtm);
  });

  it("auto selector modes optimize the missing lever", () => {
    const fixedRunwayStrike = {
      investmentUsdt: 500000,
      targetYieldBps: 1000,
      runwayDays: 180,
      strikePreference: "ten_otm" as const
    };
    const lowerYield = rankableCandidate("lower-yield", { clientYield: 0.11, dayCount: 180, strike: 70000, spotPrice: 78000 });
    const higherYield = rankableCandidate("higher-yield", { clientYield: 0.14, dayCount: 180, strike: 70000, spotPrice: 78000 });
    expect(selectDcnCandidate({ ...fixedRunwayStrike, selectorMode: "auto_yield" }, [lowerYield, higherYield]).bestCandidate)
      .toBe(higherYield);

    const saferStrike = rankableCandidate("safer-strike", { clientYield: 0.11, dayCount: 180, strike: 66000, spotPrice: 78000 });
    const richerStrike = rankableCandidate("richer-strike", { clientYield: 0.14, dayCount: 180, strike: 74000, spotPrice: 78000 });
    expect(selectDcnCandidate({ ...fixedRunwayStrike, selectorMode: "auto_strike" }, [richerStrike, saferStrike]).bestCandidate)
      .toBe(saferStrike);

    const shorterRunway = rankableCandidate("shorter-runway", { clientYield: 0.11, dayCount: 92, strike: 70000, spotPrice: 78000 });
    const longerRunway = rankableCandidate("longer-runway", { clientYield: 0.12, dayCount: 180, strike: 70000, spotPrice: 78000 });
    expect(selectDcnCandidate({ ...fixedRunwayStrike, selectorMode: "auto_runway" }, [longerRunway, shorterRunway]).bestCandidate)
      .toBe(shorterRunway);
  });

  it("enforces max slippage as an eligibility gate", () => {
    const result = calculateDcnSellPut(
      {
        investmentUsdt: 1000000,
        firmMarginBps: 200,
        maxSlippageBps: 10,
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
        deribitTimestamp: NOW,
        bids: [
          [0.0645, 5],
          [0.0500, 20]
        ]
      }
    );

    expect(result.depth.sufficientDepth).toBe(true);
    expect(result.checks.slippageWithinLimit).toBe(false);
    expect(result.eligible).toBe(false);
  });
});

function rankableCandidate(
  instrumentName: string,
  overrides: Partial<ReturnType<typeof baseRankableCandidate>> = {}
) {
  return { ...baseRankableCandidate(instrumentName), ...overrides };
}

function baseRankableCandidate(instrumentName: string) {
  return {
    instrumentName,
    eligible: true,
    clientYield: 0.12,
    upsideProfitUsdt: 4500,
    downsideProfitUsdt: 4500,
    quoteAgeSeconds: 1,
    depth: { slippagePct: 0.002 },
    dayCount: 180,
    strike: 70000,
    spotPrice: 78000,
    score: 90
  };
}
