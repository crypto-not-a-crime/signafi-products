import { describe, expect, it } from "vitest";
import {
  buildPppOfferSurfaceResponse,
  normalizePppOfferSurfaceRequest,
  type PppOfferSurfaceDiagnostics
} from "../src/pricing/ppp-offer-surface";
import {
  buildPppOfferSurfaceMarketPackages,
  withTopOfBookPppDepth,
  type PppOptionCandidateRow
} from "../src/pricing/ppp-market";
import { calculatePppCandidate, type PppCandidate, type PppMarketPackageInput } from "../src/pricing/ppp";

const NOW = Date.UTC(2026, 4, 18);
const EXPIRY = Date.UTC(2026, 11, 25, 8, 0);
const SPOT = 80_000;

describe("PPP offer surface market packages", () => {
  it("uses the shared PPP leg-selection rules and maps floor put strike to protection", () => {
    const packages = buildPppOfferSurfaceMarketPackages(
      [
        row({ instrument_name: "BTC-25DEC26-76000-C", option_type: "call", strike: 76000, ask_price: 0.15 }),
        row({ instrument_name: "BTC-25DEC26-79000-C", option_type: "call", strike: 79000, ask_price: 0.14 }),
        row({ instrument_name: "BTC-25DEC26-82000-C", option_type: "call", strike: 82000, ask_price: 0.13 }),
        row({ instrument_name: "BTC-25DEC26-76000-P", option_type: "put", strike: 76000, bid_price: 0.12, ask_price: 0.13 }),
        row({ instrument_name: "BTC-25DEC26-79000-P", option_type: "put", strike: 79000, bid_price: 0.11, ask_price: 0.12 }),
        row({ instrument_name: "BTC-25DEC26-62000-P", option_type: "put", strike: 62000, bid_price: 0.04, ask_price: 0.05 }),
        row({ instrument_name: "BTC-25DEC26-66000-P", option_type: "put", strike: 66000, bid_price: 0.05, ask_price: 0.06 })
      ],
      SPOT,
      {
        minDte: 1,
        maxDte: 365,
        minProtectionBps: 7500,
        maxProtectionBps: 8500
      },
      NOW
    );

    expect(packages.map((item) => item.floorPut.strike)).toEqual([62000, 66000]);
    expect(packages.every((item) => item.atmCall.strike === 79000)).toBe(true);
    expect(packages.every((item) => item.atmPut.strike === 79000)).toBe(true);
    expect(packages[0].floorProtectionBps).toBe(Math.round((62000 / SPOT) * 10000));
  });

  it("can price surface cells from top-of-book rows without full order-book levels", () => {
    const market = withTopOfBookPppDepth({
      ...workbookMarket(),
      atmCall: { ...workbookMarket().atmCall, askAmount: 0.1, asks: [] },
      atmPut: { ...workbookMarket().atmPut, bidAmount: 0.1, bids: [] },
      floorPut: { ...workbookMarket().floorPut, askAmount: 0.1, asks: [] }
    });
    const candidate = calculatePppCandidate(
      {
        investmentUsdt: 1_000_000,
        targetFirmMarginBps: 500,
        quoteFreshnessSeconds: 10,
        maxSlippageBps: 500,
        nowMs: NOW
      },
      market
    );

    expect(candidate.legs.every((leg) => leg.depth.sufficientDepth)).toBe(true);
    expect(candidate.legs.every((leg) => leg.depth.fills.length <= 1)).toBe(true);
    expect(candidate.legs.find((leg) => leg.role === "long_call")?.averagePrice).toBe(0.152);
  });
});

describe("PPP offer surface response", () => {
  it("selects the best eligible client offer and excludes dominated cells from the frontier", () => {
    const request = normalizePppOfferSurfaceRequest(
      {
        investmentUsdt: 1_000_000,
        targetFirmMarginBps: 500,
        includeDeliveryFees: false,
        minProtectionBps: 6000,
        maxProtectionBps: 9500,
        minDte: 1,
        maxDte: 365
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
    const base = calculatePppCandidate({ ...request, nowMs: NOW }, workbookMarket());
    const highParticipation = withClientTerms(base, 62000, 7750, 4500, true);
    const highProtection = withClientTerms(base, 66000, 8250, 3500, true);
    const dominated = withClientTerms(base, 61000, 7625, 3000, true);
    const ineligible = withClientTerms(base, 70000, 8750, 9000, false);
    const response = buildPppOfferSurfaceResponse({
      nowMs: NOW,
      request,
      candidates: [dominated, highProtection, ineligible, highParticipation],
      spotPrice: SPOT,
      source: "d1_latest",
      diagnostics: diagnostics({ totalRoughCells: 4, livePricedCells: 4, uniqueOrderBooksFetched: 6 })
    });

    expect(response.bestPoint?.floorPutStrike).toBe(62000);
    expect(response.bestPoint?.quotedParticipationBps).toBe(4500);
    expect(response.points.find((point) => point.floorPutStrike === 61000)?.frontier).toBe(false);
    expect(response.points.find((point) => point.floorPutStrike === 70000)?.frontier).toBe(false);
    expect(response.points.filter((point) => point.frontier).map((point) => point.floorPutStrike).sort()).toEqual([62000, 66000]);
    expect(response.diagnostics.eligibleCells).toBe(3);
    expect(response.diagnostics.uniqueOrderBooksFetched).toBe(6);
    expect(response.diagnostics.pricingMode).toBe("d1_top_of_book");
  });

  it("excludes freshness, depth, and slippage checks from top-of-book matrix eligibility", () => {
    const request = normalizePppOfferSurfaceRequest(
      {
        investmentUsdt: 1_000_000,
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
    const candidate = calculatePppCandidate({ ...request, nowMs: NOW }, workbookMarket());
    const depthFailed = {
      ...candidate,
      eligible: false,
      checks: {
        ...candidate.checks,
        quoteFresh: false,
        sufficientDepth: false,
        slippageWithinLimit: false
      }
    };
    const response = buildPppOfferSurfaceResponse({
      nowMs: NOW,
      request,
      candidates: [depthFailed],
      spotPrice: SPOT,
      source: "d1_latest",
      diagnostics: diagnostics({ totalRoughCells: 1, livePricedCells: 1 })
    });

    expect(response.points[0].eligible).toBe(true);
    expect(response.points[0].checks.quoteFresh).toBeUndefined();
    expect(response.points[0].checks.sufficientDepth).toBeUndefined();
    expect(response.points[0].checks.slippageWithinLimit).toBeUndefined();
    expect(response.diagnostics.eligibleCells).toBe(1);
    expect(response.bestPoint?.id).toBe(response.points[0].id);
  });

  it("carries business check failures into each surface point", () => {
    const request = normalizePppOfferSurfaceRequest({}, {
      pppTargetFirmMarginBps: 500,
      pppIncludeDeliveryFees: true,
      pppParticipationRoundDownBps: 0,
      quoteFreshnessSeconds: 10,
      defaultOrderBookDepth: 100,
      maxSlippageBps: 500
    });
    const candidate = calculatePppCandidate({ ...request, nowMs: NOW }, workbookMarket());
    const failed = {
      ...candidate,
      eligible: false,
      checks: { ...candidate.checks, targetProfitMet: false }
    };
    const response = buildPppOfferSurfaceResponse({
      nowMs: NOW,
      request,
      candidates: [failed],
      spotPrice: SPOT,
      source: "d1_latest",
      diagnostics: diagnostics({ totalRoughCells: 1, livePricedCells: 1, uniqueOrderBooksFetched: 3 })
    });

    expect(response.points[0].eligible).toBe(false);
    expect(response.points[0].checks.targetProfitMet).toBe(false);
    expect(response.bestPoint).toBeNull();
  });
});

function workbookMarket(): PppMarketPackageInput {
  return {
    expirationTimestamp: EXPIRY,
    spotPrice: SPOT,
    candidateProtectionLevel: 62000 / SPOT,
    atmCall: {
      instrumentName: "BTC-25DEC26-79000-C",
      optionType: "call",
      strike: 79000,
      expirationTimestamp: EXPIRY,
      askPrice: 0.152,
      askAmount: 50,
      deribitTimestamp: NOW,
      asks: [[0.152, 50]]
    },
    atmPut: {
      instrumentName: "BTC-25DEC26-79000-P",
      optionType: "put",
      strike: 79000,
      expirationTimestamp: EXPIRY,
      bidPrice: 0.1185,
      bidAmount: 50,
      deribitTimestamp: NOW,
      bids: [[0.1185, 50]]
    },
    floorPut: {
      instrumentName: "BTC-25DEC26-62000-P",
      optionType: "put",
      strike: 62000,
      expirationTimestamp: EXPIRY,
      askPrice: 0.0535,
      askAmount: 50,
      deribitTimestamp: NOW,
      asks: [[0.0535, 50]]
    }
  };
}

function withClientTerms(
  candidate: PppCandidate,
  floorPutStrike: number,
  protectionBps: number,
  participationBps: number,
  eligible: boolean
): PppCandidate {
  return {
    ...candidate,
    floorPutStrike,
    floorStrikeTarget: SPOT * (protectionBps / 10000),
    protectionLevel: protectionBps / 10000,
    protectionLevelBps: protectionBps,
    quotedProtection: protectionBps / 10000,
    quotedProtectionBps: protectionBps,
    quotedParticipation: participationBps / 10000,
    quotedParticipationBps: participationBps,
    optimizedParticipation: participationBps / 10000,
    optimizedParticipationBps: participationBps,
    minScenarioPnlUsdt: eligible ? candidate.targetProfitUsdt + participationBps : candidate.targetProfitUsdt - 1,
    eligible,
    checks: { ...candidate.checks, targetProfitMet: eligible }
  };
}

function diagnostics(
  overrides: Partial<Omit<PppOfferSurfaceDiagnostics, "eligibleCells" | "frontierCells" | "latestQuoteAgeSeconds">>
): Omit<PppOfferSurfaceDiagnostics, "eligibleCells" | "frontierCells" | "latestQuoteAgeSeconds"> {
  return {
    pricingMode: "d1_top_of_book",
    totalExpiriesScanned: 1,
    totalRoughCells: 0,
    livePricedCells: 0,
    uniqueOrderBooksFetched: 0,
    pricingElapsedMs: 12,
    truncated: false,
    maxCells: 180,
    ...overrides
  };
}

function row(overrides: Partial<PppOptionCandidateRow> = {}): PppOptionCandidateRow {
  return {
    instrument_name: "BTC-25DEC26-62000-P",
    option_type: "put",
    strike: 62000,
    expiration_timestamp: EXPIRY,
    min_trade_amount: 0.1,
    contract_size: 1,
    bid_price: 0.05,
    bid_amount: 50,
    ask_price: 0.06,
    ask_amount: 50,
    mark_price: 0.055,
    last_price: null,
    bid_iv: null,
    ask_iv: null,
    mark_iv: 45,
    open_interest: 20,
    underlying_price: SPOT,
    underlying_index: "BTC_USDC",
    interest_rate: null,
    deribit_timestamp: NOW,
    ingested_at: NOW,
    ...overrides
  };
}
