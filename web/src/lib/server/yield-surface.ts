import type { YieldSurfaceExpiry, YieldSurfacePoint, YieldSurfaceResponse } from "@/types";

type OptionType = "call" | "put";

interface DeribitInstrument {
  instrument_name: string;
  kind: string;
  base_currency: string;
  quote_currency: string;
  option_type?: OptionType;
  strike?: number;
  expiration_timestamp?: number;
  contract_size?: number;
  state?: string;
  is_active?: boolean;
}

interface DeribitBookSummary {
  instrument_name: string;
  bid_price?: number | null;
  ask_price?: number | null;
  mark_price?: number | null;
  last?: number | null;
  open_interest?: number | null;
  creation_timestamp?: number;
  underlying_price?: number | null;
  mark_iv?: number | null;
}

interface DeribitRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

const DERIBIT_RPC_URL = "https://www.deribit.com/api/v2/";

export async function fetchLiveDeribitYieldSurface(request: Request): Promise<YieldSurfaceResponse> {
  const url = new URL(request.url);
  const optionType = url.searchParams.get("type") === "call" ? "call" : "put";
  const filters = normalizeFilters(url);
  const nowMs = Date.now();

  const [instruments, summaries] = await Promise.all([
    deribitRpc<DeribitInstrument[]>("public/get_instruments", {
      currency: "BTC",
      kind: "option",
      expired: false
    }),
    deribitRpc<DeribitBookSummary[]>("public/get_book_summary_by_currency", {
      currency: "BTC",
      kind: "option"
    })
  ]);
  const summariesByInstrument = new Map(summaries.map((summary) => [summary.instrument_name, summary]));
  const points: YieldSurfacePoint[] = [];

  for (const instrument of instruments) {
    if (instrument.kind !== "option") continue;
    if (instrument.base_currency !== "BTC") continue;
    if (instrument.option_type !== optionType) continue;
    if (instrument.is_active === false || instrument.state === "closed") continue;
    if (!isPositiveFinite(instrument.strike) || !isPositiveFinite(instrument.expiration_timestamp)) continue;

    const summary = summariesByInstrument.get(instrument.instrument_name);
    if (!summary || !isPositiveFinite(summary.bid_price)) continue;

    if (instrument.expiration_timestamp <= nowMs) continue;
    const daysToExpiry = yieldSurfaceDayCountFromExpiry(instrument.expiration_timestamp, nowMs);
    if (daysToExpiry < filters.minDte || daysToExpiry > filters.maxDte) continue;
    if (instrument.strike < filters.minStrike || instrument.strike > filters.maxStrike) continue;

    const expiryLabel = formatExpiry(instrument.expiration_timestamp);
    points.push({
      instrumentName: instrument.instrument_name,
      optionType,
      strike: instrument.strike,
      expirationTimestamp: instrument.expiration_timestamp,
      expiryLabel,
      daysToExpiry,
      bidPrice: summary.bid_price,
      bidAmount: null,
      askPrice: finiteOrNull(summary.ask_price),
      askAmount: null,
      markPrice: finiteOrNull(summary.mark_price),
      lastPrice: finiteOrNull(summary.last),
      markIv: finiteOrNull(summary.mark_iv),
      openInterest: finiteOrNull(summary.open_interest),
      underlyingPrice: finiteOrNull(summary.underlying_price),
      deribitTimestamp: finiteOrNull(summary.creation_timestamp),
      ingestedAt: nowMs,
      annualizedYield: (summary.bid_price / daysToExpiry) * 365
    });
  }

  points.sort((a, b) => {
    if (a.expirationTimestamp !== b.expirationTimestamp) return a.expirationTimestamp - b.expirationTimestamp;
    return a.strike - b.strike;
  });

  const strikes = Array.from(new Set(points.map((point) => point.strike))).sort((a, b) => a - b);
  const latestQuoteAt = maxFinite(points.map((point) => point.deribitTimestamp ?? point.ingestedAt));
  const yields = points.map((point) => point.annualizedYield);

  return {
    generatedAt: nowMs,
    optionType,
    source: "deribit_public",
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
    expiries: summarizeExpiries(points),
    points
  };
}

async function deribitRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(DERIBIT_RPC_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "SignafiYieldSurfaceLocal/1.0"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Deribit ${method} failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as DeribitRpcResponse<T>;
  if (payload.error) {
    throw new Error(`Deribit ${method} error ${payload.error.code}: ${payload.error.message}`);
  }
  if (payload.result === undefined) {
    throw new Error(`Deribit ${method} returned no result`);
  }
  return payload.result;
}

function normalizeFilters(url: URL): YieldSurfaceResponse["filters"] {
  return {
    minDte: optionalNonNegativeParam(url, ["minDte", "min_dte"]) ?? 1,
    maxDte: optionalNonNegativeParam(url, ["maxDte", "max_dte"]) ?? Number.MAX_SAFE_INTEGER,
    minStrike: optionalNonNegativeParam(url, ["minStrike", "min_strike"]) ?? 0,
    maxStrike: optionalNonNegativeParam(url, ["maxStrike", "max_strike"]) ?? Number.MAX_SAFE_INTEGER
  };
}

function optionalNonNegativeParam(url: URL, names: string[]): number | undefined {
  for (const name of names) {
    const raw = url.searchParams.get(name);
    if (raw === null || raw === "") continue;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  return undefined;
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

function dayCountFromExpiry(expirationTimestamp: number, nowMs: number): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const todayUtc = new Date(nowMs);
  const expiryUtc = new Date(expirationTimestamp);
  const todayDate = Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate());
  const expiryDate = Date.UTC(expiryUtc.getUTCFullYear(), expiryUtc.getUTCMonth(), expiryUtc.getUTCDate());
  return Math.max(0, Math.round((expiryDate - todayDate) / msPerDay));
}

function yieldSurfaceDayCountFromExpiry(expirationTimestamp: number, nowMs: number): number {
  return Math.max(1, dayCountFromExpiry(expirationTimestamp, nowMs));
}

function formatExpiry(timestamp: number): string {
  const date = new Date(timestamp);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(date.getUTCDate()).padStart(2, "0")}${months[date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(-2)}`;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
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
