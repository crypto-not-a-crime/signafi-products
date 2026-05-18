import { describe, expect, it } from "vitest";
import {
  calculatePppCandidate,
  modelExecutableDepth,
  normalizePppPricingRequest,
  selectPppCandidate,
  type PppMarketPackageInput
} from "../src/pricing/ppp";

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

  it("uses saved PPP target firm margin from pricing config defaults", () => {
    const normalized = normalizePppPricingRequest(
      { investmentUsdt: 1_000_000 },
      {
        pppTargetFirmMarginBps: 650,
        pppIncludeDeliveryFees: true,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );

    expect(normalized.targetFirmMarginBps).toBe(650);
    expect(normalized.includeDeliveryFees).toBe(true);
  });

  it("uses saved PPP delivery-fee config defaults", () => {
    const normalized = normalizePppPricingRequest(
      { investmentUsdt: 1_000_000 },
      {
        pppTargetFirmMarginBps: 500,
        pppIncludeDeliveryFees: false,
        quoteFreshnessSeconds: 10,
        defaultOrderBookDepth: 100,
        maxSlippageBps: 500
      }
    );

    expect(normalized.includeDeliveryFees).toBe(false);
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
