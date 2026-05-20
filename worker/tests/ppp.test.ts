import { describe, expect, it } from "vitest";
import {
  buildPppAutoProtectionParticipationBps,
  buildPppAutoParticipationProtectionBps,
  calculatePppCandidate,
  modelExecutableDepth,
  normalizePppPricingRequest,
  roundPppParticipationDown,
  selectPppCandidate,
  type PppMarketPackageInput
} from "../src/pricing/ppp";
import { getPppCandidateKey, getPppRecommendations } from "../../web/src/lib/ppp-recommendations";

const NOW = Date.UTC(2026, 4, 18);
const EXPIRY_221_DAYS = Date.UTC(2026, 11, 25);

function workbookMarket(overrides: Partial<PppMarketPackageInput> = {}): PppMarketPackageInput {
  const base: PppMarketPackageInput = {
    expirationTimestamp: EXPIRY_221_DAYS,
    spotPrice: 77121,
    atmCall: {
      instrumentName: "BTC-25DEC26-76000-C",
      optionType: "call",
      strike: 76000,
      expirationTimestamp: EXPIRY_221_DAYS,
      askPrice: 0.152,
      askAmount: 50,
      deribitTimestamp: NOW,
      asks: [[0.152, 50]]
    },
    atmPut: {
      instrumentName: "BTC-25DEC26-76000-P",
      optionType: "put",
      strike: 76000,
      expirationTimestamp: EXPIRY_221_DAYS,
      bidPrice: 0.1185,
      bidAmount: 50,
      deribitTimestamp: NOW,
      bids: [[0.1185, 50]]
    },
    floorPut: {
      instrumentName: "BTC-25DEC26-62000-P",
      optionType: "put",
      strike: 62000,
      expirationTimestamp: EXPIRY_221_DAYS,
      askPrice: 0.0535,
      askAmount: 50,
      deribitTimestamp: NOW,
      asks: [[0.0535, 50]]
    }
  };
  return { ...base, ...overrides };
}

function workbookAutoProtectionMarket(overrides: Partial<PppMarketPackageInput> = {}): PppMarketPackageInput {
  return workbookMarket({
    spotPrice: 77000,
    candidateProtectionLevel: 0.753,
    atmCall: {
      instrumentName: "BTC-25DEC26-76000-C",
      optionType: "call",
      strike: 76000,
      expirationTimestamp: EXPIRY_221_DAYS,
      askPrice: 0.151,
      askAmount: 50,
      deribitTimestamp: NOW,
      asks: [[0.151, 50]]
    },
    atmPut: {
      instrumentName: "BTC-25DEC26-76000-P",
      optionType: "put",
      strike: 76000,
      expirationTimestamp: EXPIRY_221_DAYS,
      bidPrice: 0.119,
      bidAmount: 50,
      deribitTimestamp: NOW,
      bids: [[0.119, 50]]
    },
    floorPut: {
      instrumentName: "BTC-25DEC26-58000-P",
      optionType: "put",
      strike: 58000,
      expirationTimestamp: EXPIRY_221_DAYS,
      askPrice: 0.0415,
      askAmount: 50,
      deribitTimestamp: NOW,
      asks: [[0.0415, 50]]
    },
    ...overrides
  });
}

describe("PPP executable depth modelling", () => {
  it("uses depth-weighted average asks for buy legs", () => {
    const depth = modelExecutableDepth({
      side: "buy",
      levels: [
        [0.1, 1],
        [0.2, 2]
      ],
      requiredContracts: 2
    });

    expect(depth.sufficientDepth).toBe(true);
    expect(depth.averagePrice).toBeCloseTo(0.15, 10);
    expect(depth.slippagePct).toBeCloseTo(0.5, 10);
  });

  it("uses depth-weighted average bids for sell legs", () => {
    const depth = modelExecutableDepth({
      side: "sell",
      levels: [
        [0.2, 1],
        [0.1, 2]
      ],
      requiredContracts: 2
    });

    expect(depth.sufficientDepth).toBe(true);
    expect(depth.averagePrice).toBeCloseTo(0.15, 10);
    expect(depth.slippagePct).toBeCloseTo(0.25, 10);
  });

  it("fails when hedge depth cannot fill the required contracts", () => {
    const depth = modelExecutableDepth({
      side: "buy",
      levels: [[0.1, 1]],
      requiredContracts: 2
    });

    expect(depth.sufficientDepth).toBe(false);
    expect(depth.averagePrice).toBeNull();
    expect(depth.remainingContracts).toBeCloseTo(1, 10);
  });
});

describe("PPP robust model pricing", () => {
  it("matches the workbook participation optimization sample", () => {
    const candidate = calculatePppCandidate(
      {
        investmentUsdt: 1_000_000,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500,
        quoteFreshnessSeconds: 10,
        maxSlippageBps: 500,
        nowMs: NOW
      },
      workbookMarket()
    );

    expect(candidate.dayCount).toBe(221);
    expect(candidate.spotPrice).toBe(77121);
    expect(candidate.putSpreadContracts).toBe(12.9);
    expect(candidate.optimalCallContracts).toBeCloseTo(3.1, 10);
    expect(candidate.optimizedParticipation).toBeCloseTo(0.239039238735, 12);
    expect(candidate.targetProfitUsdt).toBeCloseTo(30273.972602739726, 8);
    expect(candidate.minScenarioPnlUsdt).toBeGreaterThan(candidate.targetProfitUsdt);
    expect(candidate.eligible).toBe(true);
  });

  it("records Robust Model B5 as the existing BTC_USDC spot mid source", () => {
    const candidate = calculatePppCandidate(
      {
        investmentUsdt: 1_000_000,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500,
        quoteFreshnessSeconds: 10,
        maxSlippageBps: 500,
        nowMs: NOW
      },
      workbookMarket()
    );

    const spotTrace = candidate.formulaTrace.find((row) => row.cell === "Robust Model!B5");
    expect(spotTrace?.formula).toBe("Deribit BTC_USDC spot mid");
    expect(spotTrace?.value).toBe(77121);
  });

  it("uses the auto-participation candidate protection as Robust Model B7", () => {
    const candidate = calculatePppCandidate(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_participation",
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500,
        quoteFreshnessSeconds: 10,
        maxSlippageBps: 500,
        nowMs: NOW
      },
      workbookMarket({ candidateProtectionLevel: 0.75 })
    );

    expect(candidate.protectionLevel).toBeCloseTo(0.75, 12);
    expect(candidate.quotedProtection).toBeCloseTo(0.75, 12);
    expect(candidate.floorStrikeTarget).toBeCloseTo(candidate.spotPrice * 0.75, 8);
    expect(candidate.protectionGapBps).toBeCloseTo(500, 10);
    expect(candidate.formulaTrace.find((row) => row.cell === "Robust Model!B7")?.value).toBeCloseTo(0.75, 12);
  });

  it("uses saved PPP target firm margin from pricing config defaults", () => {
    const normalized = normalizePppPricingRequest(
      { investmentUsdt: 1_000_000 },
      {
        pppTargetFirmMarginBps: 650,
        pppIncludeDeliveryFees: true,
        pppParticipationRoundDownBps: 0,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );

    expect(normalized.targetFirmMarginBps).toBe(650);
    expect(normalized.includeDeliveryFees).toBe(true);
    expect(normalized.participationRoundDownBps).toBe(0);
  });

  it("uses saved PPP delivery-fee config defaults", () => {
    const normalized = normalizePppPricingRequest(
      { investmentUsdt: 1_000_000 },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: false,
        pppParticipationRoundDownBps: 0,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );

    expect(normalized.includeDeliveryFees).toBe(false);
  });

  it("uses saved PPP participation rounding config defaults", () => {
    const normalized = normalizePppPricingRequest(
      { investmentUsdt: 1_000_000 },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: true,
        pppParticipationRoundDownBps: 500,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );

    expect(normalized.participationRoundDownBps).toBe(500);
  });

  it("rounds PPP auto-participation quotes down to the configured increment", () => {
    expect(roundPppParticipationDown(0.5856, 500)).toBeCloseTo(0.55, 12);
    expect(roundPppParticipationDown(0.3277, 500)).toBeCloseTo(0.3, 12);
    expect(roundPppParticipationDown(0.3277, 0)).toBeCloseTo(0.3277, 12);
  });

  it("builds a bounded protection grid around the selected auto-participation floor", () => {
    const levels = buildPppAutoParticipationProtectionBps(8000);

    expect(levels[0]).toBe(7000);
    expect(levels.at(-1)).toBe(9000);
    expect(levels).toContain(8000);
    expect(levels).toContain(7500);
    expect(levels).toContain(8500);
  });

  it("builds bounded participation variants around the selected auto-protection participation", () => {
    const levels = buildPppAutoProtectionParticipationBps(3000);

    expect(levels).toEqual([3000, 2500, 3500, 2000, 4000, 1500, 4500, 1000, 5000]);
  });

  it("keeps raw max participation while quoting the rounded participation", () => {
    const unrounded = calculatePppCandidate(
      {
        investmentUsdt: 1_000_000,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500,
        quoteFreshnessSeconds: 10,
        maxSlippageBps: 500,
        nowMs: NOW
      },
      workbookMarket()
    );
    const rounded = calculatePppCandidate(
      {
        investmentUsdt: 1_000_000,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500,
        participationRoundDownBps: 500,
        quoteFreshnessSeconds: 10,
        maxSlippageBps: 500,
        nowMs: NOW
      },
      workbookMarket()
    );

    expect(unrounded.quotedParticipation).toBeCloseTo(unrounded.optimizedParticipation ?? 0, 12);
    expect(rounded.optimizedParticipation).toBeCloseTo(unrounded.optimizedParticipation ?? 0, 12);
    expect(rounded.quotedParticipation).toBeCloseTo(0.2, 12);
    expect(rounded.quotedParticipation).toBeLessThan(rounded.optimizedParticipation ?? 0);
    expect(rounded.formulaTrace.find((row) => row.cell === "pricing_config.ppp_participation_round_down_bps")?.value).toBe(0.05);
  });

  it("uses rounded participation for scenario PnL calculations", () => {
    const candidate = calculatePppCandidate(
      {
        investmentUsdt: 1_000_000,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500,
        participationRoundDownBps: 500,
        quoteFreshnessSeconds: 10,
        maxSlippageBps: 500,
        nowMs: NOW
      },
      workbookMarket()
    );
    const upsideScenario = candidate.scenarios.reduce((max, scenario) =>
      scenario.expiryPrice > max.expiryPrice ? scenario : max
    );
    const roundedPayout =
      candidate.investmentUsdt *
      (1 + (candidate.quotedParticipation ?? 0) * (upsideScenario.expiryPrice / candidate.spotPrice - 1));
    const rawPayout =
      candidate.investmentUsdt *
      (1 + (candidate.optimizedParticipation ?? 0) * (upsideScenario.expiryPrice / candidate.spotPrice - 1));

    expect(upsideScenario.expiryPrice).toBeGreaterThan(candidate.spotPrice);
    expect(upsideScenario.clientPayoutUsdt).toBeCloseTo(roundedPayout, 8);
    expect(upsideScenario.clientPayoutUsdt).toBeLessThan(rawPayout);
    expect(candidate.minScenarioPnlUsdt).toBeGreaterThan(candidate.targetProfitUsdt);
  });

  it("does not round manually selected PPP participation modes", () => {
    const closest = calculatePppCandidate(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "closest",
        participationLevelBps: 3277,
        protectionLevelBps: 8000,
        participationRoundDownBps: 500,
        targetFirmMarginBps: 100,
        quoteFreshnessSeconds: 10,
        maxSlippageBps: 500,
        nowMs: NOW
      },
      workbookMarket()
    );
    const autoProtection = calculatePppCandidate(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_protection",
        participationLevelBps: 3277,
        participationRoundDownBps: 500,
        targetFirmMarginBps: 500,
        includeDeliveryFees: false,
        quoteFreshnessSeconds: 10,
        maxSlippageBps: 500,
        nowMs: NOW
      },
      workbookAutoProtectionMarket()
    );

    expect(closest.quotedParticipation).toBeCloseTo(0.3277, 12);
    expect(autoProtection.quotedParticipation).toBeCloseTo(0.3277, 12);
  });

  it("matches the workbook auto-protection optimization sample", () => {
    const candidate = calculatePppCandidate(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_protection",
        participationLevelBps: 3000,
        targetFirmMarginBps: 500,
        includeDeliveryFees: false,
        quoteFreshnessSeconds: 10,
        maxSlippageBps: 500,
        nowMs: NOW
      },
      workbookAutoProtectionMarket()
    );

    expect(candidate.dayCount).toBe(221);
    expect(candidate.spotPrice).toBe(77000);
    expect(candidate.optimalCallContracts).toBeCloseTo(3.9, 10);
    expect(candidate.quotedParticipation).toBeCloseTo(0.3, 12);
    expect(candidate.optimizedProtection).toBeCloseTo(0.753, 12);
    expect(candidate.floorPutStrike).toBe(58000);
    expect(candidate.minScenarioPnlUsdt).toBeCloseTo(34849.38, 8);
    expect(candidate.eligible).toBe(true);
    expect(candidate.formulaTrace.some((row) => row.cell === "Robust Model!B46")).toBe(true);
  });

  it("uses the auto-protection candidate participation as Robust Model B8", () => {
    const candidate = calculatePppCandidate(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_protection",
        participationLevelBps: 3000,
        targetFirmMarginBps: 500,
        includeDeliveryFees: false,
        quoteFreshnessSeconds: 10,
        maxSlippageBps: 500,
        nowMs: NOW
      },
      workbookAutoProtectionMarket({ candidateParticipationLevel: 0.25 })
    );

    expect(candidate.quotedParticipation).toBeCloseTo(0.25, 12);
    expect(candidate.quotedParticipationBps).toBeCloseTo(2500, 10);
    expect(candidate.participationGapBps).toBeCloseTo(500, 10);
    expect(candidate.formulaTrace.find((row) => row.cell === "Robust Model!B8")?.value).toBeCloseTo(0.25, 12);
  });

  it("uses depth-weighted ask for the auto-protection floor put", () => {
    const candidate = calculatePppCandidate(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_protection",
        participationLevelBps: 3000,
        targetFirmMarginBps: 500,
        includeDeliveryFees: false,
        quoteFreshnessSeconds: 10,
        maxSlippageBps: 500,
        nowMs: NOW
      },
      workbookAutoProtectionMarket({
        floorPut: {
          instrumentName: "BTC-25DEC26-58000-P",
          optionType: "put",
          strike: 58000,
          expirationTimestamp: EXPIRY_221_DAYS,
          askPrice: 0.04,
          askAmount: 5,
          deribitTimestamp: NOW,
          asks: [
            [0.04, 5],
            [0.05, 20]
          ]
        }
      })
    );

    const floorLeg = candidate.legs.find((leg) => leg.role === "long_floor_put");
    expect(floorLeg?.averagePrice).toBeCloseTo((5 * 0.04 + 7.9 * 0.05) / 12.9, 12);
  });

  it("fails auto-protection eligibility when floor-put depth is insufficient", () => {
    const candidate = calculatePppCandidate(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_protection",
        participationLevelBps: 3000,
        targetFirmMarginBps: 500,
        includeDeliveryFees: false,
        quoteFreshnessSeconds: 10,
        maxSlippageBps: 500,
        nowMs: NOW
      },
      workbookAutoProtectionMarket({
        floorPut: {
          instrumentName: "BTC-25DEC26-58000-P",
          optionType: "put",
          strike: 58000,
          expirationTimestamp: EXPIRY_221_DAYS,
          askPrice: 0.0415,
          askAmount: 1,
          deribitTimestamp: NOW,
          asks: [[0.0415, 1]]
        }
      })
    );

    expect(candidate.checks.sufficientDepth).toBe(false);
    expect(candidate.eligible).toBe(false);
  });

  it("ranks closest duration before higher participation", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        runwayDays: 221,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: true,
        pppParticipationRoundDownBps: 0,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookMarket());
    const far = {
      ...exact,
      expirationTimestamp: Date.UTC(2027, 2, 14),
      dayCount: 300,
      optimizedParticipation: 0.5,
      optimizedParticipationBps: 5000
    };

    const selected = selectPppCandidate(request, [far, exact]);
    expect(selected.bestCandidate?.dayCount).toBe(221);
  });

  it("auto-participation ranks by duration first when duration is prioritized", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_participation",
        priorityLever: "duration",
        runwayDays: 221,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: true,
        pppParticipationRoundDownBps: 0,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookMarket());
    const betterDuration = {
      ...exact,
      dayCount: 221,
      protectionLevel: 0.78,
      protectionLevelBps: 7800,
      quotedProtection: 0.78,
      quotedProtectionBps: 7800,
      optimizedParticipation: 0.2
    };
    const betterProtection = {
      ...exact,
      expirationTimestamp: Date.UTC(2027, 0, 15),
      dayCount: 260,
      protectionLevel: 0.8,
      protectionLevelBps: 8000,
      quotedProtection: 0.8,
      quotedProtectionBps: 8000,
      optimizedParticipation: 0.5
    };

    const selected = selectPppCandidate(request, [betterProtection, betterDuration]);
    expect(selected.bestCandidate).toBe(betterDuration);
    expect(selected.priorityLever).toBe("duration");
  });

  it("keeps closest-expiry protection variants distinct for duration-priority PPP recommendations", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_participation",
        priorityLever: "duration",
        runwayDays: 221,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: true,
        pppParticipationRoundDownBps: 0,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = {
      ...calculatePppCandidate({ ...request, nowMs: NOW }, workbookMarket({ candidateProtectionLevel: 0.8 })),
      quotedParticipation: 0.5,
      quotedParticipationBps: 5000,
      optimizedParticipation: 0.52,
      optimizedParticipationBps: 5200
    };
    const lowerProtection = {
      ...calculatePppCandidate(
      { ...request, nowMs: NOW },
      workbookMarket({
        candidateProtectionLevel: 0.75,
        floorPut: {
          instrumentName: "BTC-25DEC26-58000-P",
          optionType: "put",
          strike: 58000,
          expirationTimestamp: EXPIRY_221_DAYS,
          askPrice: 0.0415,
          askAmount: 50,
          deribitTimestamp: NOW,
          asks: [[0.0415, 50]]
        }
      })
      ),
      quotedParticipation: 0.6,
      quotedParticipationBps: 6000,
      optimizedParticipation: 0.62,
      optimizedParticipationBps: 6200
    };
    const higherProtection = {
      ...calculatePppCandidate(
      { ...request, nowMs: NOW },
      workbookMarket({
        candidateProtectionLevel: 0.85,
        floorPut: {
          instrumentName: "BTC-25DEC26-66000-P",
          optionType: "put",
          strike: 66000,
          expirationTimestamp: EXPIRY_221_DAYS,
          askPrice: 0.071,
          askAmount: 50,
          deribitTimestamp: NOW,
          asks: [[0.071, 50]]
        }
      })
      ),
      quotedParticipation: 0.4,
      quotedParticipationBps: 4000,
      optimizedParticipation: 0.42,
      optimizedParticipationBps: 4200
    };
    const farExactProtection = {
      ...exact,
      expirationTimestamp: Date.UTC(2027, 0, 15),
      dayCount: 242,
      optimizedParticipation: 0.9,
      quotedParticipation: 0.9
    };

    const selected = selectPppCandidate(request, [farExactProtection, higherProtection, lowerProtection, exact]);
    const recommendations = getPppRecommendations({
      best: selected.bestCandidate,
      candidates: selected.candidates,
      selectorMode: "auto_participation",
      priorityLever: "duration",
      targetProtectionBps: 8000,
      limit: 3
    });

    expect(selected.bestCandidate).toBe(lowerProtection);
    expect(recommendations.map((candidate) => candidate.dayCount)).toEqual([221, 221, 221]);
    expect(recommendations.map((candidate) => candidate.quotedProtectionBps)).toEqual([7500, 8000, 8500]);
    expect(recommendations.map((candidate) => candidate.quotedParticipationBps)).toEqual([6000, 5000, 4000]);
    expect(new Set(recommendations.map(getPppCandidateKey)).size).toBe(3);
  });

  it("auto-participation ranks by protection first when protection is prioritized", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_participation",
        priorityLever: "protection",
        runwayDays: 221,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: true,
        pppParticipationRoundDownBps: 0,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookMarket());
    const betterDuration = {
      ...exact,
      dayCount: 221,
      protectionLevel: 0.78,
      protectionLevelBps: 7800,
      quotedProtection: 0.78,
      quotedProtectionBps: 7800,
      optimizedParticipation: 0.5
    };
    const betterProtection = {
      ...exact,
      dayCount: 260,
      protectionLevel: 0.8,
      protectionLevelBps: 8000,
      quotedProtection: 0.8,
      quotedProtectionBps: 8000,
      optimizedParticipation: 0.2
    };

    const selected = selectPppCandidate(request, [betterDuration, betterProtection]);
    expect(selected.bestCandidate).toBe(betterProtection);
    expect(selected.priorityLever).toBe("protection");
  });

  it("auto-participation protection priority uses displayed participation before duration inside the protection bucket", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_participation",
        priorityLever: "protection",
        runwayDays: 92,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: true,
        pppParticipationRoundDownBps: 500,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookMarket());
    const closerDuration = {
      ...exact,
      expirationTimestamp: Date.UTC(2026, 6, 31),
      dayCount: 74,
      quotedProtection: 0.8,
      quotedProtectionBps: 8000,
      quotedParticipation: 0.5,
      quotedParticipationBps: 5000,
      optimizedParticipation: 0.52,
      optimizedParticipationBps: 5200
    };
    const higherParticipation = {
      ...closerDuration,
      expirationTimestamp: Date.UTC(2026, 8, 25),
      dayCount: 129,
      quotedParticipation: 0.6,
      quotedParticipationBps: 6000,
      optimizedParticipation: 0.62,
      optimizedParticipationBps: 6200
    };

    const selected = selectPppCandidate(request, [closerDuration, higherParticipation]);

    expect(selected.bestCandidate).toBe(higherParticipation);
    expect(selected.priorityLever).toBe("protection");
  });

  it("auto-participation ranking does not let raw optimized participation beat a higher displayed quote", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_participation",
        priorityLever: "duration",
        runwayDays: 92,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: true,
        pppParticipationRoundDownBps: 500,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookMarket());
    const higherRaw = {
      ...exact,
      expirationTimestamp: Date.UTC(2026, 6, 31),
      dayCount: 92,
      quotedProtection: 0.8,
      quotedProtectionBps: 8000,
      quotedParticipation: 0.5,
      quotedParticipationBps: 5000,
      optimizedParticipation: 0.9,
      optimizedParticipationBps: 9000
    };
    const higherDisplayed = {
      ...higherRaw,
      expirationTimestamp: Date.UTC(2026, 8, 25),
      quotedParticipation: 0.55,
      quotedParticipationBps: 5500,
      optimizedParticipation: 0.56,
      optimizedParticipationBps: 5600
    };

    const selected = selectPppCandidate(request, [higherRaw, higherDisplayed]);

    expect(selected.bestCandidate).toBe(higherDisplayed);
  });

  it("auto-participation removes same-expiry lower protection when displayed participation is unchanged", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_participation",
        priorityLever: "protection",
        runwayDays: 92,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: true,
        pppParticipationRoundDownBps: 500,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookMarket());
    const dominant = {
      ...exact,
      protectionLevel: 0.8,
      protectionLevelBps: 8000,
      quotedProtection: 0.8,
      quotedProtectionBps: 8000,
      quotedParticipation: 0.55,
      quotedParticipationBps: 5500,
      optimizedParticipation: 0.5856,
      optimizedParticipationBps: 5856
    };
    const dominated = {
      ...dominant,
      protectionLevel: 0.79,
      protectionLevelBps: 7900,
      quotedProtection: 0.79,
      quotedProtectionBps: 7900,
      optimizedParticipation: 0.589,
      optimizedParticipationBps: 5890
    };

    const selected = selectPppCandidate(request, [dominated, dominant]);

    expect(selected.candidates).toHaveLength(1);
    expect(selected.bestCandidate?.quotedProtectionBps).toBe(8000);
    expect(selected.bestCandidate?.quotedParticipationBps).toBe(5500);
  });

  it("auto-participation keeps lower-protection variants only when displayed participation improves", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_participation",
        priorityLever: "protection",
        runwayDays: 92,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: true,
        pppParticipationRoundDownBps: 500,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookMarket());
    const targetProtection = {
      ...exact,
      protectionLevel: 0.8,
      protectionLevelBps: 8000,
      quotedProtection: 0.8,
      quotedProtectionBps: 8000,
      quotedParticipation: 0.55,
      quotedParticipationBps: 5500,
      optimizedParticipation: 0.5856,
      optimizedParticipationBps: 5856
    };
    const visibleTradeoff = {
      ...targetProtection,
      protectionLevel: 0.79,
      protectionLevelBps: 7900,
      quotedProtection: 0.79,
      quotedProtectionBps: 7900,
      quotedParticipation: 0.6,
      quotedParticipationBps: 6000,
      optimizedParticipation: 0.612,
      optimizedParticipationBps: 6120
    };

    const selected = selectPppCandidate(request, [visibleTradeoff, targetProtection]);
    const recommendations = getPppRecommendations({
      best: selected.bestCandidate,
      candidates: selected.candidates,
      selectorMode: "auto_participation",
      priorityLever: "protection",
      targetProtectionBps: 8000,
      limit: 3
    });

    expect(selected.candidates).toHaveLength(2);
    expect(recommendations.map((candidate) => candidate.quotedProtectionBps)).toEqual([8000, 7900]);
    expect(recommendations.map((candidate) => candidate.quotedParticipationBps)).toEqual([5500, 6000]);
  });

  it("auto-participation protection-priority recommendations prune screenshot-style dominated cards", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_participation",
        priorityLever: "protection",
        runwayDays: 92,
        protectionLevelBps: 8000,
        targetFirmMarginBps: 500
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: true,
        pppParticipationRoundDownBps: 500,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookMarket());
    const julyTarget = {
      ...exact,
      expirationTimestamp: Date.UTC(2026, 6, 31),
      dayCount: 73,
      protectionLevel: 0.8,
      protectionLevelBps: 8000,
      quotedProtection: 0.8,
      quotedProtectionBps: 8000,
      quotedParticipation: 0.55,
      quotedParticipationBps: 5500,
      optimizedParticipation: 0.5856,
      optimizedParticipationBps: 5856
    };
    const septemberTarget = {
      ...julyTarget,
      expirationTimestamp: Date.UTC(2026, 8, 25),
      dayCount: 129,
      quotedParticipation: 0.35,
      quotedParticipationBps: 3500,
      optimizedParticipation: 0.372,
      optimizedParticipationBps: 3720
    };
    const julyDominated = {
      ...julyTarget,
      protectionLevel: 0.79,
      protectionLevelBps: 7900,
      quotedProtection: 0.79,
      quotedProtectionBps: 7900,
      optimizedParticipation: 0.589,
      optimizedParticipationBps: 5890
    };

    const recommendations = getPppRecommendations({
      best: julyTarget,
      candidates: [julyDominated, septemberTarget, julyTarget],
      selectorMode: "auto_participation",
      priorityLever: "protection",
      targetProtectionBps: 8000,
      limit: 3
    });

    expect(recommendations.map((candidate) => [candidate.quotedProtectionBps, candidate.quotedParticipationBps])).toContainEqual([
      8000,
      5500
    ]);
    expect(recommendations.map((candidate) => [candidate.quotedProtectionBps, candidate.quotedParticipationBps])).toContainEqual([
      8000,
      3500
    ]);
    expect(recommendations.map((candidate) => [candidate.quotedProtectionBps, candidate.quotedParticipationBps])).not.toContainEqual([
      7900,
      5500
    ]);
    expect(recommendations[0]?.expirationTimestamp).toBe(julyTarget.expirationTimestamp);
    expect(recommendations[1]?.expirationTimestamp).toBe(septemberTarget.expirationTimestamp);
  });

  it("auto-protection ranks by duration first when duration is prioritized", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_protection",
        priorityLever: "duration",
        runwayDays: 221,
        participationLevelBps: 3000,
        targetFirmMarginBps: 500,
        includeDeliveryFees: false
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: false,
        pppParticipationRoundDownBps: 0,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookAutoProtectionMarket());
    const betterDuration = {
      ...exact,
      dayCount: 221,
      participationGapBps: 100,
      quotedParticipation: 0.31,
      quotedParticipationBps: 3100,
      optimizedProtection: 0.74
    };
    const betterParticipation = {
      ...exact,
      expirationTimestamp: Date.UTC(2027, 0, 15),
      dayCount: 260,
      participationGapBps: 0,
      quotedParticipation: 0.3,
      quotedParticipationBps: 3000,
      optimizedProtection: 0.95
    };

    const selected = selectPppCandidate(request, [betterParticipation, betterDuration]);
    expect(selected.bestCandidate).toBe(betterDuration);
    expect(selected.priorityLever).toBe("duration");
  });

  it("auto-protection ranks by participation first when participation is prioritized", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_protection",
        priorityLever: "participation",
        runwayDays: 221,
        participationLevelBps: 3000,
        targetFirmMarginBps: 500,
        includeDeliveryFees: false
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: false,
        pppParticipationRoundDownBps: 0,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookAutoProtectionMarket());
    const betterDuration = {
      ...exact,
      dayCount: 221,
      participationGapBps: 100,
      quotedParticipation: 0.31,
      quotedParticipationBps: 3100,
      optimizedProtection: 0.95
    };
    const betterParticipation = {
      ...exact,
      expirationTimestamp: Date.UTC(2027, 0, 15),
      dayCount: 260,
      participationGapBps: 0,
      quotedParticipation: 0.3,
      quotedParticipationBps: 3000,
      optimizedProtection: 0.74
    };

    const selected = selectPppCandidate(request, [betterDuration, betterParticipation]);
    expect(selected.bestCandidate).toBe(betterParticipation);
    expect(selected.priorityLever).toBe("participation");
  });

  it("auto-protection collapses floor-grid duplicates to the highest eligible protection per fixed input pair", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_protection",
        priorityLever: "duration",
        runwayDays: 221,
        participationLevelBps: 3000,
        targetFirmMarginBps: 500,
        includeDeliveryFees: false
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: false,
        pppParticipationRoundDownBps: 0,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookAutoProtectionMarket());
    const lowerFloor = { ...exact, optimizedProtection: 0.74, quotedProtection: 0.74, quotedProtectionBps: 7400 };
    const higherFloor = { ...exact, optimizedProtection: 0.75, quotedProtection: 0.75, quotedProtectionBps: 7500 };

    const selected = selectPppCandidate(request, [lowerFloor, higherFloor]);

    expect(selected.candidates).toHaveLength(1);
    expect(selected.bestCandidate?.quotedProtection).toBeCloseTo(0.75, 12);
  });

  it("auto-protection duration-priority recommendations keep closest-expiry participation variants distinct", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_protection",
        priorityLever: "duration",
        runwayDays: 221,
        participationLevelBps: 3000,
        targetFirmMarginBps: 500,
        includeDeliveryFees: false
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: false,
        pppParticipationRoundDownBps: 0,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookAutoProtectionMarket({ candidateParticipationLevel: 0.3 }));
    const lowerParticipation = {
      ...exact,
      quotedParticipation: 0.25,
      quotedParticipationBps: 2500,
      participationGapBps: 500,
      optimizedProtection: 0.79,
      quotedProtection: 0.79,
      quotedProtectionBps: 7900
    };
    const higherParticipation = {
      ...exact,
      quotedParticipation: 0.35,
      quotedParticipationBps: 3500,
      participationGapBps: 500,
      optimizedProtection: 0.7,
      quotedProtection: 0.7,
      quotedProtectionBps: 7000
    };
    const farExactParticipation = {
      ...exact,
      expirationTimestamp: Date.UTC(2027, 0, 15),
      dayCount: 260,
      optimizedProtection: 0.95,
      quotedProtection: 0.95,
      quotedProtectionBps: 9500
    };

    const selected = selectPppCandidate(request, [farExactParticipation, higherParticipation, lowerParticipation, exact]);
    const recommendations = getPppRecommendations({
      best: selected.bestCandidate,
      candidates: selected.candidates,
      selectorMode: "auto_protection",
      priorityLever: "duration",
      targetProtectionBps: 8000,
      targetParticipationBps: 3000,
      limit: 3
    });

    expect(recommendations.map((candidate) => candidate.dayCount)).toEqual([221, 221, 221]);
    expect(recommendations.map((candidate) => candidate.quotedParticipationBps)).toEqual([3000, 2500, 3500]);
    expect(new Set(recommendations.map(getPppCandidateKey)).size).toBe(3);
  });

  it("auto-protection participation-priority recommendations keep selected participation across expiry alternatives", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "auto_protection",
        priorityLever: "participation",
        runwayDays: 221,
        participationLevelBps: 3000,
        targetFirmMarginBps: 500,
        includeDeliveryFees: false
      },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: false,
        pppParticipationRoundDownBps: 0,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookAutoProtectionMarket({ candidateParticipationLevel: 0.3 }));
    const sameParticipationFar = {
      ...exact,
      expirationTimestamp: Date.UTC(2027, 0, 15),
      dayCount: 260,
      optimizedProtection: 0.74,
      quotedProtection: 0.74,
      quotedProtectionBps: 7400
    };
    const sameParticipationFarther = {
      ...exact,
      expirationTimestamp: Date.UTC(2027, 2, 14),
      dayCount: 300,
      optimizedProtection: 0.7,
      quotedProtection: 0.7,
      quotedProtectionBps: 7000
    };
    const closestDifferentParticipation = {
      ...exact,
      quotedParticipation: 0.35,
      quotedParticipationBps: 3500,
      participationGapBps: 500,
      optimizedProtection: 0.95,
      quotedProtection: 0.95,
      quotedProtectionBps: 9500
    };

    const selected = selectPppCandidate(request, [
      closestDifferentParticipation,
      sameParticipationFarther,
      sameParticipationFar,
      exact
    ]);
    const recommendations = getPppRecommendations({
      best: selected.bestCandidate,
      candidates: selected.candidates,
      selectorMode: "auto_protection",
      priorityLever: "participation",
      targetProtectionBps: 8000,
      targetParticipationBps: 3000,
      limit: 3
    });

    expect(recommendations.map((candidate) => candidate.quotedParticipationBps)).toEqual([3000, 3000, 3000]);
    expect(recommendations.map((candidate) => candidate.dayCount)).toEqual([221, 260, 300]);
  });

  it("normalizes missing or invalid PPP priorities to duration defaults", () => {
    const config = {
      pppTargetFirmMarginBps: 500,
      pppIncludeDeliveryFees: true,
      pppParticipationRoundDownBps: 0,
      quoteFreshnessSeconds: 10,
      defaultOrderBookDepth: 100,
      maxSlippageBps: 500
    };

    expect(normalizePppPricingRequest({ selectorMode: "auto_participation" }, config).priorityLever).toBe("duration");
    expect(
      normalizePppPricingRequest({ selectorMode: "auto_participation", priorityLever: "participation" as never }, config)
        .priorityLever
    ).toBe("duration");
    expect(normalizePppPricingRequest({ selectorMode: "auto_protection" }, config).priorityLever).toBe("duration");
    expect(
      normalizePppPricingRequest({ selectorMode: "auto_protection", priorityLever: "protection" as never }, config)
        .priorityLever
    ).toBe("duration");
    expect(normalizePppPricingRequest({ selectorMode: "closest", priorityLever: "protection" }, config).priorityLever).toBeUndefined();
  });

  it("ranks closest mode by protection and participation after duration", () => {
    const request = normalizePppPricingRequest(
      {
        investmentUsdt: 1_000_000,
        selectorMode: "closest",
        runwayDays: 221,
        protectionLevelBps: 8000,
        participationLevelBps: 3000,
        targetFirmMarginBps: 100
      },
      {
        pppTargetFirmMarginBps: 100,
        pppIncludeDeliveryFees: true,
        pppParticipationRoundDownBps: 0,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );
    const exact = calculatePppCandidate({ ...request, nowMs: NOW }, workbookMarket());
    const worseParticipation = { ...exact, participationGapBps: 50 };
    const selected = selectPppCandidate(request, [worseParticipation, exact]);
    expect(selected.bestCandidate).toBe(exact);
  });
});
