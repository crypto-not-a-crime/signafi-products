import { describe, expect, it } from "vitest";
import {
  calculateDcnScenario,
  calculateDcnSellCall,
  calculateDcnSellPut,
  calculateSellPutClientYield,
  calculateSellCallClientYield,
  compareDcnCandidatesForClientMandate,
  dayCountFromExpiry,
  modelSellIntoBidDepth,
  roundContracts,
  roundYieldToOneDecimalPercent,
  scoreCallCandidate,
  scorePutCandidate,
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

  it("rounds down contracts like the workbook model", () => {
    expect(roundContracts(1000000 / 75000, 0.1)).toBe(13.3);
    expect(roundContracts(500000 / 69000, 0.1)).toBe(7.2);
    expect(roundContracts(799999 / 75000, 0.1)).toBe(10.6);
    expect(roundContracts(Number.NaN, 0.1)).toBe(0);
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
    expect(result.requiredContracts).toBe(13.3);
    expect(result.effectivePutBidPrice).toBeCloseTo(0.0645, 8);
    expect(result.grossReferenceYield).toBeCloseTo((0.0645 / 92) * 365, 8);
    expect(result.clientYield).toBe(roundYieldToOneDecimalPercent((0.0645 / 92) * 365 - 0.02));
    expect(result.clientInterestUsdt).toBeCloseTo(1000000 * result.clientYield! * (92 / 365), 8);
    expect(result.tradingFeesBtc).toBeCloseTo(-0.00399, 8);
    expect(result.netOptionProceedsBtc).toBeCloseTo(0.85386, 5);
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
    const c14 = result.formulaTrace.find((row) => row.cell === "C14");
    expect(result.spotPrice).toBe(80258);
    expect(c5?.formula).toBe("Deribit BTC_USDC spot mid");
    expect(c14?.formula).toBe("ROUNDDOWN(C4/C7, 1)");
    expect(result.requiredContracts).toBe(roundContracts(1000000 / 75000, 0.1));
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
        bidAmount: 7.2,
        markPrice: 0.0449,
        deribitTimestamp: NOW,
        bids: [[0.04358, 7.2]]
      }
    );

    expect(result.requiredContracts).toBe(7.2);
    expect(result.grossReferenceYield).toBeCloseTo(0.17289891304347826, 10);
    expect(result.clientYield).toBeCloseTo(workbookClientYield, 10);
    expect(result.netOptionProceedsBtc).toBeCloseTo(0.311616, 10);
    expect(result.downsideProfitUsdt).toBeCloseTo(2724.8045741512324, 6);
    expect(result.upsideProfitUsdt).toBeCloseTo(9015.303013698547, 6);
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

  it("preserves the legacy firm-margin client yield method", () => {
    const result = calculateDcnSellPut(
      {
        investmentUsdt: 500000,
        sellPutPricingMethod: "firm_margin",
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
        bidAmount: 7.2,
        deribitTimestamp: NOW,
        bids: [[0.04358, 7.2]]
      }
    );

    expect(result.sellPutPricingMethod).toBe("firm_margin");
    expect(result.clientYield).toBe(roundYieldToOneDecimalPercent((0.04358 / 92) * 365 - 0.02));
  });

  it("matches the Sell Put dashboard C9 yield formula when target firm profit mode is selected", () => {
    const putWorkbookNow = Date.UTC(2026, 4, 8);
    const putWorkbookExpiry = Date.UTC(2026, 6, 31, 8, 0);
    const result = calculateDcnSellPut(
      {
        investmentUsdt: 1000000,
        sellPutPricingMethod: "target_firm_profit",
        sellPutTargetFirmProfitBps: 500,
        quoteFreshnessSeconds: 10,
        nowMs: putWorkbookNow
      },
      {
        instrumentName: "BTC-31JUL26-77000-P",
        strike: 77000,
        expirationTimestamp: putWorkbookExpiry,
        minTradeAmount: 0.1,
        underlyingPrice: 81499,
        bidPrice: 0.04908,
        bidAmount: 12.9,
        markPrice: 0.0498,
        deribitTimestamp: putWorkbookNow,
        bids: [[0.04908, 12.9]]
      }
    );

    const expected = calculateSellPutClientYield({
      pricingMethod: "target_firm_profit",
      grossReferenceYield: result.grossReferenceYield,
      netOptionProceedsUsdt: result.netOptionProceedsUsdt,
      investmentUsdt: result.investmentUsdt,
      dayCount: result.dayCount,
      firmMarginBps: 200,
      targetFirmAnnualizedProfit: 0.05
    });

    expect(result.sellPutPricingMethod).toBe("target_firm_profit");
    expect(result.dayCount).toBe(84);
    expect(result.requiredContracts).toBe(12.9);
    expect(result.tradingFeesBtc).toBeCloseTo(-0.00387, 10);
    expect(result.netOptionProceedsBtc).toBeCloseTo(0.629262, 10);
    expect(result.netOptionProceedsUsdt).toBeCloseTo(51284.223738, 8);
    expect(result.clientYield).toBe(expected);
    expect(result.clientYield).toBeCloseTo(0.172842162671071, 12);
    expect(result.checks.clientYieldFormulaValid).toBe(true);
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

  it("uses custom strike buffer percentages before legacy strike preferences", () => {
    const baseRequest = {
      investmentUsdt: 500000,
      targetYieldBps: 1000,
      runwayDays: 180,
      selectorMode: "closest" as const
    };
    const fiveOtm = rankableCandidate("five-otm", { strike: 95000, spotPrice: 100000 });
    const fifteenOtm = rankableCandidate("fifteen-otm", { strike: 85000, spotPrice: 100000 });

    expect(
      selectDcnCandidate({ ...baseRequest, strikePreference: "five_otm" as const }, [fifteenOtm, fiveOtm])
        .bestCandidate
    ).toBe(fiveOtm);
    expect(
      selectDcnCandidate(
        { ...baseRequest, strikePreference: "five_otm" as const, strikeBufferPct: 15 },
        [fiveOtm, fifteenOtm]
      ).bestCandidate
    ).toBe(fifteenOtm);
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

  it("auto runway can prioritize strike buffer over target return", () => {
    const request = {
      investmentUsdt: 500000,
      targetYieldBps: 1200,
      runwayDays: 180,
      strikeBufferPct: 10,
      selectorMode: "auto_runway" as const
    };
    const betterReturn = rankableCandidate("better-return", {
      clientYield: 0.13,
      dayCount: 80,
      strike: 96000,
      spotPrice: 100000
    });
    const betterStrike = rankableCandidate("better-strike", {
      clientYield: 0.09,
      dayCount: 150,
      strike: 90000,
      spotPrice: 100000
    });

    expect(selectDcnCandidate({ ...request, priorityLever: "yield" as const }, [betterStrike, betterReturn]).bestCandidate)
      .toBe(betterReturn);
    expect(selectDcnCandidate({ ...request, priorityLever: "strike" as const }, [betterReturn, betterStrike]).bestCandidate)
      .toBe(betterStrike);
  });

  it("auto return can switch fixed-input priority between runway and strike buffer", () => {
    const request = {
      investmentUsdt: 500000,
      targetYieldBps: 1000,
      runwayDays: 180,
      strikeBufferPct: 10,
      selectorMode: "auto_yield" as const
    };
    const betterRunway = rankableCandidate("better-runway", {
      clientYield: 0.12,
      dayCount: 180,
      strike: 85000,
      spotPrice: 100000
    });
    const betterStrike = rankableCandidate("better-strike", {
      clientYield: 0.11,
      dayCount: 120,
      strike: 90000,
      spotPrice: 100000
    });

    expect(selectDcnCandidate({ ...request, priorityLever: "runway" as const }, [betterStrike, betterRunway]).bestCandidate)
      .toBe(betterRunway);
    expect(selectDcnCandidate({ ...request, priorityLever: "strike" as const }, [betterRunway, betterStrike]).bestCandidate)
      .toBe(betterStrike);
  });

  it("auto strike can prioritize runway over return", () => {
    const request = {
      investmentUsdt: 500000,
      targetYieldBps: 1000,
      runwayDays: 180,
      selectorMode: "auto_strike" as const
    };
    const betterReturn = rankableCandidate("better-return", {
      clientYield: 0.11,
      dayCount: 240,
      strike: 65000,
      spotPrice: 100000
    });
    const betterRunway = rankableCandidate("better-runway", {
      clientYield: 0.09,
      dayCount: 180,
      strike: 64000,
      spotPrice: 100000
    });

    expect(selectDcnCandidate({ ...request, priorityLever: "yield" as const }, [betterRunway, betterReturn]).bestCandidate)
      .toBe(betterReturn);
    expect(selectDcnCandidate({ ...request, priorityLever: "runway" as const }, [betterReturn, betterRunway]).bestCandidate)
      .toBe(betterRunway);
  });

  it("auto strike chooses the safer above-spot call strike after fixed priorities match", () => {
    const request = {
      productType: "sell_call" as const,
      investmentBtc: 10,
      targetYieldBps: 1000,
      runwayDays: 180,
      selectorMode: "auto_strike" as const,
      priorityLever: "runway" as const
    };
    const lowerCallStrike = rankableCandidate("BTC-180D-110000-C", {
      clientYield: 0.11,
      dayCount: 180,
      strike: 110000,
      spotPrice: 100000
    });
    const higherCallStrike = rankableCandidate("BTC-180D-130000-C", {
      clientYield: 0.11,
      dayCount: 180,
      strike: 130000,
      spotPrice: 100000
    });

    expect(selectDcnCandidate(request, [lowerCallStrike, higherCallStrike]).bestCandidate).toBe(higherCallStrike);
  });

  it("auto return shortlist favors fixed runway and strike buffer before raw yield", () => {
    const request = {
      investmentUsdt: 1000000,
      targetYieldBps: 1000,
      runwayDays: 180,
      strikePreference: "five_otm" as const,
      selectorMode: "auto_yield" as const,
      firmMarginBps: 200,
      nowMs: NOW
    };
    const fixedRunwayStrike = {
      instrumentName: "BTC-180D-76000-P",
      strike: 76000,
      expirationTimestamp: NOW + 180 * 24 * 60 * 60 * 1000,
      underlyingPrice: 80000,
      bidPrice: 0.05
    };
    const highYieldButWrongRunway = {
      instrumentName: "BTC-52D-76000-P",
      strike: 76000,
      expirationTimestamp: NOW + 52 * 24 * 60 * 60 * 1000,
      underlyingPrice: 80000,
      bidPrice: 0.1
    };

    expect(scorePutCandidate(request, fixedRunwayStrike)).toBeGreaterThan(
      scorePutCandidate(request, highYieldButWrongRunway)
    );
  });

  it("does not shortlist puts with strikes at or above spot for the below-spot DCN product", () => {
    const request = {
      investmentUsdt: 1000000,
      runwayDays: 180,
      strikePreference: "five_otm" as const,
      selectorMode: "auto_yield" as const,
      nowMs: NOW
    };

    expect(
      scorePutCandidate(request, {
        instrumentName: "BTC-180D-260000-P",
        strike: 260000,
        expirationTimestamp: NOW + 180 * 24 * 60 * 60 * 1000,
        underlyingPrice: 80000,
        bidPrice: 2.1
      })
    ).toBe(-Infinity);
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

  it("does not recommend an ineligible candidate as the best match", () => {
    const request = {
      investmentUsdt: 1000000,
      targetYieldBps: 1000,
      runwayDays: 180,
      strikePreference: "five_otm" as const,
      selectorMode: "auto_yield" as const
    };
    const ineligible = rankableCandidate("review-only", {
      eligible: false,
      clientYield: 0,
      dayCount: 52,
      strike: 260000,
      spotPrice: 80000
    });

    expect(selectDcnCandidate(request, [ineligible]).bestCandidate).toBeNull();
  });
});

describe("DCN sell-call pricing", () => {
  it("matches the Sell Call dashboard C9 yield formula", () => {
    const result = calculateDcnSellCall(
      {
        productType: "sell_call",
        investmentBtc: 10,
        sellCallTargetFirmProfitBps: 500,
        scenarioUpsidePrice: 120000,
        quoteFreshnessSeconds: 10,
        nowMs: Date.UTC(2026, 4, 2)
      },
      {
        instrumentName: "BTC-26JUN26-92000-C",
        optionType: "call",
        strike: 92000,
        expirationTimestamp: Date.UTC(2026, 5, 26, 8, 0),
        minTradeAmount: 0.1,
        underlyingPrice: 81000,
        bidPrice: 0.0145,
        bidAmount: 10,
        markPrice: 0.015,
        deribitTimestamp: Date.UTC(2026, 4, 2),
        bids: [[0.0145, 10]]
      }
    );

    const expected = calculateSellCallClientYield({
      upsidePrice: 120000,
      strike: 92000,
      investmentBtc: 10,
      spotPrice: 81000,
      dayCount: result.dayCount,
      requiredContracts: 10,
      premiumUsdt: result.netOptionProceedsUsdt!,
      targetFirmAnnualizedProfit: 0.05
    });

    expect(result.productType).toBe("sell_call");
    expect(result.dayCount).toBe(55);
    expect(result.requiredContracts).toBe(10);
    expect(result.effectiveCallBidPrice).toBeCloseTo(0.0145, 10);
    expect(result.netOptionProceedsBtc).toBeCloseTo(0.142, 10);
    expect(result.netOptionProceedsUsdt).toBeCloseTo(11502, 8);
    expect(result.clientYield).toBe(expected);
    expect(result.clientYield).toBeCloseTo(0.0389, 10);
  });

  it("uses strike times 1.30 as the live upside reference when none is supplied", () => {
    const result = calculateDcnSellCall(
      {
        productType: "sell_call",
        investmentBtc: 10,
        sellCallTargetFirmProfitBps: 500,
        quoteFreshnessSeconds: 10,
        nowMs: NOW
      },
      {
        instrumentName: "BTC-30JUL26-92000-C",
        optionType: "call",
        strike: 92000,
        expirationTimestamp: EXPIRY_92_DAYS,
        minTradeAmount: 0.1,
        underlyingPrice: 81000,
        bidPrice: 0.0145,
        bidAmount: 10,
        deribitTimestamp: NOW,
        bids: [[0.0145, 10]]
      }
    );

    expect(result.upsideReferencePrice).toBeCloseTo(119600, 8);
  });

  it("does not shortlist calls with strikes at or below spot", () => {
    const request = {
      productType: "sell_call" as const,
      investmentBtc: 10,
      runwayDays: 180,
      strikePreference: "five_otm" as const,
      selectorMode: "auto_yield" as const,
      nowMs: NOW
    };

    expect(
      scoreCallCandidate(request, {
        instrumentName: "BTC-180D-76000-C",
        optionType: "call",
        strike: 76000,
        expirationTimestamp: NOW + 180 * 24 * 60 * 60 * 1000,
        underlyingPrice: 80000,
        bidPrice: 0.1
      })
    ).toBe(-Infinity);
  });

  it("uses call strike buffers above 99 percent when ranking candidates", () => {
    const request = {
      productType: "sell_call" as const,
      investmentBtc: 10,
      targetYieldBps: 1000,
      runwayDays: 180,
      strikeBufferPct: 150,
      selectorMode: "closest" as const
    };
    const nearLegacyCap = rankableCandidate("BTC-180D-199000-C", {
      dayCount: 180,
      strike: 199000,
      spotPrice: 100000
    });
    const requestedBuffer = rankableCandidate("BTC-180D-250000-C", {
      dayCount: 180,
      strike: 250000,
      spotPrice: 100000
    });

    expect(selectDcnCandidate(request, [nearLegacyCap, requestedBuffer]).bestCandidate).toBe(requestedBuffer);
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
