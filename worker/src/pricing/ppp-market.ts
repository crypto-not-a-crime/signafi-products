import { dayCountFromExpiry } from "./dcn";
import {
  buildPppAutoProtectionParticipationBps,
  buildPppAutoParticipationProtectionBps,
  calculatePppCandidate,
  type PppMarketLegInput,
  type PppMarketPackageInput,
  type PppPricingRequest
} from "./ppp";

export interface PppOptionCandidateRow {
  instrument_name: string;
  option_type: "call" | "put";
  strike: number;
  expiration_timestamp: number;
  min_trade_amount: number | null;
  contract_size: number | null;
  bid_price: number | null;
  bid_amount: number | null;
  ask_price: number | null;
  ask_amount: number | null;
  mark_price: number | null;
  last_price: number | null;
  bid_iv: number | null;
  ask_iv: number | null;
  mark_iv: number | null;
  open_interest: number | null;
  underlying_price: number | null;
  underlying_index: string | null;
  interest_rate: number | null;
  deribit_timestamp: number | null;
  ingested_at: number | null;
}

export interface PppOfferSurfaceMarketPackage extends PppMarketPackageInput {
  floorProtectionLevel: number;
  floorProtectionBps: number;
}

export interface PppOfferSurfacePackageFilters {
  minDte: number;
  maxDte: number;
  minProtectionBps: number;
  maxProtectionBps: number;
}

export function countPppScannedExpiries(
  rows: PppOptionCandidateRow[],
  requestedExpirationTimestamp?: number
): number {
  const requested = Number(requestedExpirationTimestamp);
  const expiries = new Set<number>();
  for (const row of rows) {
    if (Number.isFinite(requested) && requested > 0 && row.expiration_timestamp !== requested) continue;
    expiries.add(row.expiration_timestamp);
  }
  return expiries.size;
}

export function buildPppMarketPackages(
  rows: PppOptionCandidateRow[],
  spotPrice: number,
  request: PppPricingRequest,
  nowMs: number
): PppMarketPackageInput[] {
  const selectorMode =
    request.selectorMode === "closest" || request.selectorMode === "auto_protection"
      ? request.selectorMode
      : "auto_participation";
  const requestedExpirationTimestamp = Number(request.expirationTimestamp);
  const protectionLevelBps = Math.round(Math.min(10000, Math.max(1000, Number(request.protectionLevelBps ?? 8000))));
  const protectionLevel = protectionLevelBps / 10000;
  const participationLevelBps = Math.round(Math.min(10000, Math.max(0, Number(request.participationLevelBps ?? 3000))));
  const targetFloorStrike = spotPrice * protectionLevel;
  const byExpiry = groupRowsByExpiry(rows);

  const packages: PppMarketPackageInput[] = [];
  for (const [expirationTimestamp, expiryRows] of byExpiry) {
    if (
      Number.isFinite(requestedExpirationTimestamp) &&
      requestedExpirationTimestamp > 0 &&
      expirationTimestamp !== requestedExpirationTimestamp
    ) {
      continue;
    }
    const market = getPppExpiryMarket(expiryRows, spotPrice);
    if (!market) continue;

    if (selectorMode === "auto_protection") {
      for (const candidateParticipationBps of buildPppAutoProtectionParticipationBps(participationLevelBps)) {
        const candidateParticipationLevel = candidateParticipationBps / 10000;
        let fallbackCount = 0;
        for (let floorBps = 9500; floorBps >= 5000; floorBps -= 10) {
          const candidateProtectionLevel = floorBps / 10000;
          const floorPut = findLowestStrikeAtOrAbove(market.askPuts, spotPrice * candidateProtectionLevel);
          if (!floorPut) continue;
          const roughPackage = withRoughPppDepth({
            expirationTimestamp,
            spotPrice,
            candidateProtectionLevel,
            candidateParticipationLevel,
            atmCall: pppRowToMarketLeg(market.atmCall),
            atmPut: pppRowToMarketLeg(market.atmPut),
            floorPut: pppRowToMarketLeg(floorPut)
          });
          const roughCandidate = calculatePppCandidate(
            {
              ...request,
              participationLevelBps: candidateParticipationBps,
              protectionLevelBps: floorBps,
              selectorMode: "auto_protection",
              nowMs
            },
            roughPackage
          );
          if (roughCandidate.checks.targetProfitMet && roughCandidate.checks.callHedgeAtOrAboveParticipation) {
            packages.push({
              expirationTimestamp,
              spotPrice,
              candidateProtectionLevel,
              candidateParticipationLevel,
              atmCall: pppRowToMarketLeg(market.atmCall),
              atmPut: pppRowToMarketLeg(market.atmPut),
              floorPut: pppRowToMarketLeg(floorPut)
            });
            fallbackCount += 1;
            if (fallbackCount >= 3) break;
          }
        }
      }
      continue;
    }

    if (selectorMode === "auto_participation") {
      for (const candidateProtectionBps of buildPppAutoParticipationProtectionBps(protectionLevelBps)) {
        const candidateProtectionLevel = candidateProtectionBps / 10000;
        const floorPut = findLowestStrikeAtOrAbove(market.askPuts, spotPrice * candidateProtectionLevel);
        if (!floorPut) continue;

        packages.push({
          expirationTimestamp,
          spotPrice,
          candidateProtectionLevel,
          atmCall: pppRowToMarketLeg(market.atmCall),
          atmPut: pppRowToMarketLeg(market.atmPut),
          floorPut: pppRowToMarketLeg(floorPut)
        });
      }
      continue;
    }

    const floorPut = findLowestStrikeAtOrAbove(market.askPuts, targetFloorStrike);
    if (!floorPut) continue;

    packages.push({
      expirationTimestamp,
      spotPrice,
      atmCall: pppRowToMarketLeg(market.atmCall),
      atmPut: pppRowToMarketLeg(market.atmPut),
      floorPut: pppRowToMarketLeg(floorPut)
    });
  }

  return packages;
}

export function buildPppOfferSurfaceMarketPackages(
  rows: PppOptionCandidateRow[],
  spotPrice: number,
  filters: PppOfferSurfacePackageFilters,
  nowMs: number
): PppOfferSurfaceMarketPackage[] {
  const byExpiry = groupRowsByExpiry(rows);
  const packages: PppOfferSurfaceMarketPackage[] = [];

  for (const [expirationTimestamp, expiryRows] of byExpiry) {
    const dayCount = dayCountFromExpiry(expirationTimestamp, nowMs);
    if (dayCount < filters.minDte || dayCount > filters.maxDte) continue;

    const market = getPppExpiryMarket(expiryRows, spotPrice);
    if (!market) continue;

    const floorPutsByStrike = new Map<number, PppOptionCandidateRow>();
    for (const row of market.askPuts) {
      const floorProtectionLevel = spotPrice > 0 ? row.strike / spotPrice : 0;
      const floorProtectionBps = Math.round(floorProtectionLevel * 10000);
      if (floorProtectionBps < filters.minProtectionBps || floorProtectionBps > filters.maxProtectionBps) continue;
      const existing = floorPutsByStrike.get(row.strike);
      if (!existing || compareFloorPut(row, existing) < 0) {
        floorPutsByStrike.set(row.strike, row);
      }
    }

    for (const floorPut of [...floorPutsByStrike.values()].sort((a, b) => a.strike - b.strike)) {
      const floorProtectionLevel = floorPut.strike / spotPrice;
      const floorProtectionBps = Math.round(floorProtectionLevel * 10000);
      packages.push({
        expirationTimestamp,
        spotPrice,
        candidateProtectionLevel: floorProtectionLevel,
        floorProtectionLevel,
        floorProtectionBps,
        atmCall: pppRowToMarketLeg(market.atmCall),
        atmPut: pppRowToMarketLeg(market.atmPut),
        floorPut: pppRowToMarketLeg(floorPut)
      });
    }
  }

  return packages.sort((a, b) => {
    if (a.expirationTimestamp !== b.expirationTimestamp) return a.expirationTimestamp - b.expirationTimestamp;
    return a.floorPut.strike - b.floorPut.strike;
  });
}

export function limitPppOfferSurfacePackages(
  packages: PppOfferSurfaceMarketPackage[],
  maxCells: number
): PppOfferSurfaceMarketPackage[] {
  if (packages.length <= maxCells) return packages;
  const byExpiry = new Map<number, PppOfferSurfaceMarketPackage[]>();
  for (const item of packages) {
    const bucket = byExpiry.get(item.expirationTimestamp) ?? [];
    bucket.push(item);
    byExpiry.set(item.expirationTimestamp, bucket);
  }

  const groups = [...byExpiry.values()]
    .map((items) => items.sort((a, b) => b.floorProtectionBps - a.floorProtectionBps))
    .sort((a, b) => a[0].expirationTimestamp - b[0].expirationTimestamp);
  const selected: PppOfferSurfaceMarketPackage[] = [];
  for (let offset = 0; selected.length < maxCells; offset += 1) {
    let pushed = false;
    for (const group of groups) {
      const item = group[offset];
      if (!item) continue;
      selected.push(item);
      pushed = true;
      if (selected.length >= maxCells) break;
    }
    if (!pushed) break;
  }
  return selected.sort((a, b) => {
    if (a.expirationTimestamp !== b.expirationTimestamp) return a.expirationTimestamp - b.expirationTimestamp;
    return a.floorPut.strike - b.floorPut.strike;
  });
}

export function withTopOfBookPppDepth(packageInput: PppMarketPackageInput): PppMarketPackageInput {
  const depth = 1_000_000_000;
  return {
    ...packageInput,
    atmCall: {
      ...packageInput.atmCall,
      asks: packageInput.atmCall.askPrice ? [[packageInput.atmCall.askPrice, depth]] : packageInput.atmCall.asks
    },
    atmPut: {
      ...packageInput.atmPut,
      bids: packageInput.atmPut.bidPrice ? [[packageInput.atmPut.bidPrice, depth]] : packageInput.atmPut.bids
    },
    floorPut: {
      ...packageInput.floorPut,
      asks: packageInput.floorPut.askPrice ? [[packageInput.floorPut.askPrice, depth]] : packageInput.floorPut.asks
    }
  };
}

function groupRowsByExpiry(rows: PppOptionCandidateRow[]): Map<number, PppOptionCandidateRow[]> {
  const byExpiry = new Map<number, PppOptionCandidateRow[]>();
  for (const row of rows) {
    const bucket = byExpiry.get(row.expiration_timestamp) ?? [];
    bucket.push(row);
    byExpiry.set(row.expiration_timestamp, bucket);
  }
  return byExpiry;
}

function getPppExpiryMarket(
  expiryRows: PppOptionCandidateRow[],
  spotPrice: number
): {
  atmCall: PppOptionCandidateRow;
  atmPut: PppOptionCandidateRow;
  askPuts: PppOptionCandidateRow[];
} | null {
  const calls = expiryRows.filter((row) => row.option_type === "call" && isPositiveFinite(row.ask_price));
  const bidPuts = expiryRows.filter((row) => row.option_type === "put" && isPositiveFinite(row.bid_price));
  const askPuts = expiryRows.filter((row) => row.option_type === "put" && isPositiveFinite(row.ask_price));
  const atmCall = findHighestStrikeAtOrBelow(calls, spotPrice);
  const atmPut = findHighestStrikeAtOrBelow(bidPuts, spotPrice);
  if (!atmCall || !atmPut || askPuts.length === 0) return null;
  return { atmCall, atmPut, askPuts };
}

function withRoughPppDepth(packageInput: PppMarketPackageInput): PppMarketPackageInput {
  return withTopOfBookPppDepth(packageInput);
}

function findHighestStrikeAtOrBelow(rows: PppOptionCandidateRow[], target: number): PppOptionCandidateRow | null {
  return rows
    .filter((row) => row.strike <= target)
    .sort((a, b) => b.strike - a.strike)[0] ?? null;
}

function findLowestStrikeAtOrAbove(rows: PppOptionCandidateRow[], target: number): PppOptionCandidateRow | null {
  return rows
    .filter((row) => row.strike >= target)
    .sort((a, b) => a.strike - b.strike)[0] ?? null;
}

function pppRowToMarketLeg(row: PppOptionCandidateRow): PppMarketLegInput {
  return {
    instrumentName: row.instrument_name,
    optionType: row.option_type,
    strike: row.strike,
    expirationTimestamp: row.expiration_timestamp,
    minTradeAmount: row.min_trade_amount,
    bidPrice: row.bid_price,
    bidAmount: row.bid_amount,
    askPrice: row.ask_price,
    askAmount: row.ask_amount,
    deribitTimestamp: row.deribit_timestamp,
    ingestedAt: row.ingested_at,
    bids: [],
    asks: []
  };
}

function compareFloorPut(a: PppOptionCandidateRow, b: PppOptionCandidateRow): number {
  const askCompare = compareAsc(a.ask_price, b.ask_price);
  if (askCompare !== 0) return askCompare;
  return compareAsc(a.ingested_at ?? a.deribit_timestamp, b.ingested_at ?? b.deribit_timestamp);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function compareAsc(a: number | null | undefined, b: number | null | undefined): number {
  const av = typeof a === "number" && Number.isFinite(a) ? a : Infinity;
  const bv = typeof b === "number" && Number.isFinite(b) ? b : Infinity;
  return av === bv ? 0 : av - bv;
}
