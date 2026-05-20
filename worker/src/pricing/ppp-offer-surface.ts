import {
  normalizePppPricingRequest,
  type NormalizedPppPricingRequest,
  type PppCandidate,
  type PppHedgeLeg,
  type PppPricingRequest
} from "./ppp";

export interface PppOfferSurfaceRequest extends PppPricingRequest {
  minDte?: number;
  maxDte?: number;
  minProtectionBps?: number;
  maxProtectionBps?: number;
  maxCells?: number;
}

export type NormalizedPppOfferSurfaceRequest = NormalizedPppPricingRequest & {
  minDte: number;
  maxDte: number;
  minProtectionBps: number;
  maxProtectionBps: number;
  maxCells: number;
};

export interface PppOfferSurfaceLeg {
  role: PppHedgeLeg["role"];
  side: PppHedgeLeg["side"];
  instrumentName: string;
  optionType: PppHedgeLeg["optionType"];
  strike: number;
  requiredContracts: number;
  averagePrice: number | null;
  bestPrice: number | null;
  quoteAgeSeconds: number | null;
  sufficientDepth: boolean;
  slippagePct: number | null;
}

export interface PppOfferSurfacePoint {
  id: string;
  expirationTimestamp: number;
  expiryLabel: string;
  daysToExpiry: number;
  floorPutStrike: number;
  floorProtection: number;
  floorProtectionBps: number;
  quotedProtection: number | null;
  quotedProtectionBps: number | null;
  putSpreadImpliedFloor: number | null;
  quotedParticipation: number | null;
  quotedParticipationBps: number | null;
  optimizedParticipation: number | null;
  optimizedParticipationBps: number | null;
  targetFirmMarginBps: number;
  targetProfitUsdt: number;
  minScenarioPnlUsdt: number | null;
  marginHeadroomUsdt: number | null;
  marginHeadroomBps: number | null;
  stressPrice: number | null;
  netOptionCashUsdt: number | null;
  quoteAgeSeconds: number | null;
  maxSlippagePct: number | null;
  eligible: boolean;
  best: boolean;
  frontier: boolean;
  checks: Record<string, boolean>;
  atmCallStrike: number;
  atmPutStrike: number;
  spotPrice: number;
  legs: PppOfferSurfaceLeg[];
}

export interface PppOfferSurfaceExpiry {
  expirationTimestamp: number;
  label: string;
  daysToExpiry: number;
  pointCount: number;
}

export interface PppOfferSurfaceFloorRow {
  floorPutStrike: number;
  floorProtection: number;
  floorProtectionBps: number;
  pointCount: number;
}

export interface PppOfferSurfaceDiagnostics {
  totalExpiriesScanned: number;
  totalRoughCells: number;
  livePricedCells: number;
  eligibleCells: number;
  frontierCells: number;
  uniqueOrderBooksFetched: number;
  pricingElapsedMs: number;
  truncated: boolean;
  maxCells: number;
  latestQuoteAgeSeconds: number | null;
}

export interface PppOfferSurfaceResponse {
  generatedAt: number;
  input: Record<string, unknown>;
  objective: "client_terms";
  source: "d1_latest" | "mock";
  spotPrice: number | null;
  expiries: PppOfferSurfaceExpiry[];
  floorRows: PppOfferSurfaceFloorRow[];
  points: PppOfferSurfacePoint[];
  bestPoint: PppOfferSurfacePoint | null;
  highestFrontierProtectionBps: number | null;
  minParticipationBps: number | null;
  maxParticipationBps: number | null;
  minMarginHeadroomUsdt: number | null;
  maxMarginHeadroomUsdt: number | null;
  diagnostics: PppOfferSurfaceDiagnostics;
  mock?: boolean;
}

const DEFAULT_MIN_DTE = 1;
const DEFAULT_MAX_DTE = 365;
const DEFAULT_MIN_PROTECTION_BPS = 6000;
const DEFAULT_MAX_PROTECTION_BPS = 9500;
const DEFAULT_MAX_CELLS = 180;
const HARD_MAX_CELLS = 260;

export function normalizePppOfferSurfaceRequest(
  request: PppOfferSurfaceRequest,
  config: {
    pppTargetFirmMarginBps?: number;
    pppIncludeDeliveryFees?: boolean;
    pppParticipationRoundDownBps?: number;
    quoteFreshnessSeconds: number;
    defaultOrderBookDepth: number;
    maxSlippageBps: number;
  }
): NormalizedPppOfferSurfaceRequest {
  const minProtectionBps = clamp(
    Math.round(Number(request.minProtectionBps ?? DEFAULT_MIN_PROTECTION_BPS)),
    1000,
    10000
  );
  const maxProtectionBps = clamp(
    Math.round(Number(request.maxProtectionBps ?? DEFAULT_MAX_PROTECTION_BPS)),
    minProtectionBps,
    10000
  );
  const minDte = clamp(Math.round(Number(request.minDte ?? DEFAULT_MIN_DTE)), 1, 3650);
  const maxDte = clamp(Math.round(Number(request.maxDte ?? DEFAULT_MAX_DTE)), minDte, 3650);
  const base = normalizePppPricingRequest(
    {
      ...request,
      runwayDays: request.runwayDays ?? Math.min(Math.max(minDte, 92), maxDte),
      protectionLevelBps: minProtectionBps,
      participationLevelBps: 0,
      selectorMode: "auto_participation",
      priorityLever: "protection"
    },
    config
  );

  return {
    ...base,
    selectorMode: "auto_participation",
    priorityLever: "protection",
    minDte,
    maxDte,
    minProtectionBps,
    maxProtectionBps,
    maxCells: clamp(Math.round(Number(request.maxCells ?? DEFAULT_MAX_CELLS)), 1, HARD_MAX_CELLS)
  };
}

export function buildPppOfferSurfaceResponse({
  nowMs,
  request,
  candidates,
  spotPrice,
  source,
  diagnostics,
  mock
}: {
  nowMs: number;
  request: NormalizedPppOfferSurfaceRequest | Record<string, unknown>;
  candidates: PppCandidate[];
  spotPrice: number | null;
  source: "d1_latest" | "mock";
  diagnostics: Omit<PppOfferSurfaceDiagnostics, "eligibleCells" | "frontierCells" | "latestQuoteAgeSeconds">;
  mock?: boolean;
}): PppOfferSurfaceResponse {
  const basePoints = candidates.map(candidateToPoint);
  const frontierIds = new Set(findFrontierPointIds(basePoints));
  const bestPointId = selectBestPoint(basePoints)?.id ?? null;
  const points = basePoints.map((point) => ({
    ...point,
    best: point.id === bestPointId,
    frontier: frontierIds.has(point.id)
  }));
  const bestPoint = points.find((point) => point.id === bestPointId) ?? null;
  const participationBps = points
    .map((point) => point.quotedParticipationBps)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const marginHeadroom = points
    .map((point) => point.marginHeadroomUsdt)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const eligibleCells = points.filter((point) => point.eligible).length;
  const frontierCells = points.filter((point) => point.frontier).length;

  return {
    generatedAt: nowMs,
    input: request as Record<string, unknown>,
    objective: "client_terms",
    source,
    spotPrice,
    expiries: summarizeExpiries(points),
    floorRows: summarizeFloorRows(points),
    points,
    bestPoint,
    highestFrontierProtectionBps: maxFinite(
      points.filter((point) => point.frontier).map((point) => point.quotedProtectionBps ?? point.floorProtectionBps)
    ),
    minParticipationBps: minFinite(participationBps),
    maxParticipationBps: maxFinite(participationBps),
    minMarginHeadroomUsdt: minFinite(marginHeadroom),
    maxMarginHeadroomUsdt: maxFinite(marginHeadroom),
    diagnostics: {
      ...diagnostics,
      eligibleCells,
      frontierCells,
      latestQuoteAgeSeconds: minFinite(points.map((point) => point.quoteAgeSeconds))
    },
    mock
  };
}

function candidateToPoint(candidate: PppCandidate): PppOfferSurfacePoint {
  const floorProtection = candidate.spotPrice > 0 ? candidate.floorPutStrike / candidate.spotPrice : 0;
  const floorProtectionBps = Math.round(floorProtection * 10000);
  const quotedProtection = candidate.quotedProtection ?? candidate.protectionLevel ?? null;
  const quotedProtectionBps = candidate.quotedProtectionBps ?? (quotedProtection === null ? null : quotedProtection * 10000);
  const quotedParticipation = candidate.quotedParticipation;
  const quotedParticipationBps =
    candidate.quotedParticipationBps ?? (quotedParticipation === null ? null : quotedParticipation * 10000);
  const marginHeadroomUsdt =
    candidate.minScenarioPnlUsdt === null ? null : candidate.minScenarioPnlUsdt - candidate.targetProfitUsdt;
  const marginHeadroomBps =
    marginHeadroomUsdt === null || candidate.investmentUsdt <= 0 || candidate.dayCount <= 0
      ? null
      : (marginHeadroomUsdt / candidate.investmentUsdt / candidate.dayCount) * 365 * 10000;

  return {
    id: [
      candidate.expirationTimestamp,
      candidate.floorPutStrike,
      Math.round(quotedProtectionBps ?? floorProtectionBps),
      candidate.legs.map((leg) => leg.instrumentName).join("|")
    ].join(":"),
    expirationTimestamp: candidate.expirationTimestamp,
    expiryLabel: formatExpiry(candidate.expirationTimestamp),
    daysToExpiry: candidate.dayCount,
    floorPutStrike: candidate.floorPutStrike,
    floorProtection,
    floorProtectionBps,
    quotedProtection,
    quotedProtectionBps,
    putSpreadImpliedFloor: candidate.putSpreadImpliedFloor,
    quotedParticipation,
    quotedParticipationBps,
    optimizedParticipation: candidate.optimizedParticipation,
    optimizedParticipationBps: candidate.optimizedParticipationBps,
    targetFirmMarginBps: candidate.targetFirmMarginBps,
    targetProfitUsdt: candidate.targetProfitUsdt,
    minScenarioPnlUsdt: candidate.minScenarioPnlUsdt,
    marginHeadroomUsdt,
    marginHeadroomBps,
    stressPrice: candidate.stressPrice,
    netOptionCashUsdt: candidate.netOptionCashUsdt,
    quoteAgeSeconds: candidate.quoteAgeSeconds,
    maxSlippagePct: candidate.maxSlippagePct,
    eligible: candidate.eligible,
    best: false,
    frontier: false,
    checks: candidate.checks,
    atmCallStrike: candidate.atmCallStrike,
    atmPutStrike: candidate.atmPutStrike,
    spotPrice: candidate.spotPrice,
    legs: candidate.legs.map((leg) => ({
      role: leg.role,
      side: leg.side,
      instrumentName: leg.instrumentName,
      optionType: leg.optionType,
      strike: leg.strike,
      requiredContracts: leg.requiredContracts,
      averagePrice: leg.averagePrice,
      bestPrice: leg.bestPrice,
      quoteAgeSeconds: leg.quoteAgeSeconds,
      sufficientDepth: leg.depth.sufficientDepth,
      slippagePct: leg.depth.slippagePct
    }))
  };
}

function selectBestPoint(points: PppOfferSurfacePoint[]): PppOfferSurfacePoint | null {
  return [...points]
    .filter((point) => point.eligible)
    .sort((a, b) =>
      compareBy([
        () => compareDesc(a.quotedParticipationBps, b.quotedParticipationBps),
        () => compareDesc(a.quotedProtectionBps ?? a.floorProtectionBps, b.quotedProtectionBps ?? b.floorProtectionBps),
        () => compareDesc(a.marginHeadroomUsdt, b.marginHeadroomUsdt),
        () => compareAsc(a.quoteAgeSeconds, b.quoteAgeSeconds),
        () => compareAsc(a.maxSlippagePct, b.maxSlippagePct),
        () => compareAsc(a.daysToExpiry, b.daysToExpiry)
      ])
    )[0] ?? null;
}

function findFrontierPointIds(points: PppOfferSurfacePoint[]): string[] {
  const eligible = points.filter((point) => point.eligible);
  return eligible
    .filter(
      (point) =>
        !eligible.some((other) => {
          if (other.id === point.id) return false;
          const otherProtection = other.quotedProtectionBps ?? other.floorProtectionBps;
          const pointProtection = point.quotedProtectionBps ?? point.floorProtectionBps;
          const otherParticipation = other.quotedParticipationBps ?? -Infinity;
          const pointParticipation = point.quotedParticipationBps ?? -Infinity;
          const atLeastAsGood = otherProtection >= pointProtection && otherParticipation >= pointParticipation;
          const visiblyBetter = otherProtection > pointProtection || otherParticipation > pointParticipation;
          return atLeastAsGood && visiblyBetter;
        })
    )
    .map((point) => point.id);
}

function summarizeExpiries(points: PppOfferSurfacePoint[]): PppOfferSurfaceExpiry[] {
  const map = new Map<number, PppOfferSurfaceExpiry>();
  for (const point of points) {
    const existing = map.get(point.expirationTimestamp);
    if (existing) {
      existing.pointCount += 1;
    } else {
      map.set(point.expirationTimestamp, {
        expirationTimestamp: point.expirationTimestamp,
        label: point.expiryLabel,
        daysToExpiry: point.daysToExpiry,
        pointCount: 1
      });
    }
  }
  return [...map.values()].sort((a, b) => a.expirationTimestamp - b.expirationTimestamp);
}

function summarizeFloorRows(points: PppOfferSurfacePoint[]): PppOfferSurfaceFloorRow[] {
  const map = new Map<number, PppOfferSurfaceFloorRow>();
  for (const point of points) {
    const existing = map.get(point.floorPutStrike);
    if (existing) {
      existing.pointCount += 1;
    } else {
      map.set(point.floorPutStrike, {
        floorPutStrike: point.floorPutStrike,
        floorProtection: point.floorProtection,
        floorProtectionBps: point.floorProtectionBps,
        pointCount: 1
      });
    }
  }
  return [...map.values()].sort((a, b) => b.floorPutStrike - a.floorPutStrike);
}

function formatExpiry(timestamp: number): string {
  const date = new Date(timestamp);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(date.getUTCDate()).padStart(2, "0")}${months[date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(-2)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function minFinite(values: Array<number | null | undefined>): number | null {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finiteValues.length === 0 ? null : Math.min(...finiteValues);
}

function maxFinite(values: Array<number | null | undefined>): number | null {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finiteValues.length === 0 ? null : Math.max(...finiteValues);
}

function compareBy(comparators: Array<() => number>): number {
  for (const comparator of comparators) {
    const result = comparator();
    if (result !== 0) return result;
  }
  return 0;
}

function compareAsc(a: number | null | undefined, b: number | null | undefined): number {
  const av = typeof a === "number" && Number.isFinite(a) ? a : Infinity;
  const bv = typeof b === "number" && Number.isFinite(b) ? b : Infinity;
  return av === bv ? 0 : av - bv;
}

function compareDesc(a: number | null | undefined, b: number | null | undefined): number {
  const av = typeof a === "number" && Number.isFinite(a) ? a : -Infinity;
  const bv = typeof b === "number" && Number.isFinite(b) ? b : -Infinity;
  return av === bv ? 0 : bv - av;
}
