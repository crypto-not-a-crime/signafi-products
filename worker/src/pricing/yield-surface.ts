import { dayCountFromExpiry } from "./dcn";

export type YieldSurfaceOptionType = "call" | "put";

export interface YieldSurfaceSourceRow {
  instrument_name: string;
  base_currency: string | null;
  option_type: YieldSurfaceOptionType;
  strike: number;
  expiration_timestamp: number;
  bid_price: number | null;
  bid_amount: number | null;
  ask_price: number | null;
  ask_amount: number | null;
  mark_price: number | null;
  last_price: number | null;
  mark_iv: number | null;
  open_interest: number | null;
  underlying_price: number | null;
  deribit_timestamp: number | null;
  ingested_at: number | null;
}

export interface YieldSurfaceFilters {
  minDte?: number;
  maxDte?: number;
  minStrike?: number;
  maxStrike?: number;
}

export interface YieldSurfacePoint {
  instrumentName: string;
  optionType: YieldSurfaceOptionType;
  strike: number;
  expirationTimestamp: number;
  expiryLabel: string;
  daysToExpiry: number;
  bidPrice: number;
  bidAmount: number | null;
  askPrice: number | null;
  askAmount: number | null;
  markPrice: number | null;
  lastPrice: number | null;
  markIv: number | null;
  openInterest: number | null;
  underlyingPrice: number | null;
  deribitTimestamp: number | null;
  ingestedAt: number | null;
  annualizedYield: number;
}

export interface YieldSurfaceExpiry {
  expirationTimestamp: number;
  label: string;
  daysToExpiry: number;
  pointCount: number;
}

export interface YieldSurfaceResponse {
  generatedAt: number;
  optionType: YieldSurfaceOptionType;
  source: "d1_latest";
  spotPrice?: number | null;
  spotInstrumentName?: string | null;
  spotTickerTimestamp?: number | null;
  formula: {
    label: string;
    expression: string;
    annualizationDays: number;
    dayCount: string;
  };
  filters: Required<YieldSurfaceFilters>;
  latestQuoteAt: number | null;
  latestQuoteAgeSeconds: number | null;
  minAnnualizedYield: number | null;
  maxAnnualizedYield: number | null;
  strikes: number[];
  expiries: YieldSurfaceExpiry[];
  points: YieldSurfacePoint[];
}

export function buildYieldSurface(
  rows: YieldSurfaceSourceRow[],
  options: {
    nowMs?: number;
    optionType: YieldSurfaceOptionType;
    filters?: YieldSurfaceFilters;
    spot?: {
      spotPrice: number | null;
      spotInstrumentName: string | null;
      spotTickerTimestamp: number | null;
    };
  }
): YieldSurfaceResponse {
  const nowMs = options.nowMs ?? Date.now();
  const filters = normalizeFilters(options.filters);
  const points: YieldSurfacePoint[] = [];

  for (const row of rows) {
    if (row.option_type !== options.optionType) continue;
    if (row.base_currency !== "BTC") continue;
    if (!isPositiveFinite(row.strike) || !isPositiveFinite(row.expiration_timestamp)) continue;
    if (!isPositiveFinite(row.bid_price)) continue;

    if (row.expiration_timestamp <= nowMs) continue;
    const daysToExpiry = yieldSurfaceDayCountFromExpiry(row.expiration_timestamp, nowMs);
    if (daysToExpiry <= 0) continue;
    if (daysToExpiry < filters.minDte || daysToExpiry > filters.maxDte) continue;
    if (row.strike < filters.minStrike || row.strike > filters.maxStrike) continue;

    points.push({
      instrumentName: row.instrument_name,
      optionType: row.option_type,
      strike: row.strike,
      expirationTimestamp: row.expiration_timestamp,
      expiryLabel: formatExpiry(row.expiration_timestamp),
      daysToExpiry,
      bidPrice: row.bid_price,
      bidAmount: finiteOrNull(row.bid_amount),
      askPrice: finiteOrNull(row.ask_price),
      askAmount: finiteOrNull(row.ask_amount),
      markPrice: finiteOrNull(row.mark_price),
      lastPrice: finiteOrNull(row.last_price),
      markIv: finiteOrNull(row.mark_iv),
      openInterest: finiteOrNull(row.open_interest),
      underlyingPrice: finiteOrNull(row.underlying_price),
      deribitTimestamp: finiteOrNull(row.deribit_timestamp),
      ingestedAt: finiteOrNull(row.ingested_at),
      annualizedYield: (row.bid_price / daysToExpiry) * 365
    });
  }

  points.sort((a, b) => {
    if (a.expirationTimestamp !== b.expirationTimestamp) return a.expirationTimestamp - b.expirationTimestamp;
    return a.strike - b.strike;
  });

  const strikes = Array.from(new Set(points.map((point) => point.strike))).sort((a, b) => a - b);
  const expiries = summarizeExpiries(points);
  const latestQuoteAt = maxFinite(points.map((point) => point.ingestedAt ?? point.deribitTimestamp));
  const yields = points.map((point) => point.annualizedYield);

  return {
    generatedAt: nowMs,
    optionType: options.optionType,
    source: "d1_latest",
    spotPrice: options.spot?.spotPrice,
    spotInstrumentName: options.spot?.spotInstrumentName,
    spotTickerTimestamp: options.spot?.spotTickerTimestamp,
    formula: {
      label: "Annualized Premium Yield",
      expression: "bidPrice / daysToExpiry * 365",
      annualizationDays: 365,
      dayCount: "UTC calendar days from today to expiry date"
    },
    filters,
    latestQuoteAt,
    latestQuoteAgeSeconds: latestQuoteAt === null ? null : Math.max(0, (nowMs - latestQuoteAt) / 1000),
    minAnnualizedYield: minFinite(yields),
    maxAnnualizedYield: maxFinite(yields),
    strikes,
    expiries,
    points
  };
}

function summarizeExpiries(points: YieldSurfacePoint[]): YieldSurfaceExpiry[] {
  const map = new Map<number, YieldSurfaceExpiry>();
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
  return Array.from(map.values()).sort((a, b) => a.expirationTimestamp - b.expirationTimestamp);
}

function normalizeFilters(filters: YieldSurfaceFilters = {}): Required<YieldSurfaceFilters> {
  return {
    minDte: isNonNegativeFinite(filters.minDte) ? filters.minDte : 1,
    maxDte: isNonNegativeFinite(filters.maxDte) ? filters.maxDte : Number.MAX_SAFE_INTEGER,
    minStrike: isNonNegativeFinite(filters.minStrike) ? filters.minStrike : 0,
    maxStrike: isNonNegativeFinite(filters.maxStrike) ? filters.maxStrike : Number.MAX_SAFE_INTEGER
  };
}

function formatExpiry(timestamp: number): string {
  const date = new Date(timestamp);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = months[date.getUTCMonth()] ?? "UNK";
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${day}${month}${year}`;
}

function yieldSurfaceDayCountFromExpiry(expirationTimestamp: number, nowMs: number): number {
  return Math.max(1, dayCountFromExpiry(expirationTimestamp, nowMs));
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function minFinite(values: Array<number | null | undefined>): number | null {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finiteValues.length === 0 ? null : Math.min(...finiteValues);
}

function maxFinite(values: Array<number | null | undefined>): number | null {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finiteValues.length === 0 ? null : Math.max(...finiteValues);
}
