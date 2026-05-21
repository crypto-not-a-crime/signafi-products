import {
  getCallCandidates,
  getInstrumentQuote,
  getMarketDataSyncStatus,
  getPppOptionCandidates,
  getPricingConfig,
  getPutCandidates,
  getYieldSurfaceRows,
  type JoinedPutRow,
  insertAudit,
  insertOrderBookSnapshot,
  recordMarketDataSync,
  updatePricingConfig,
  upsertBookSummaries,
  upsertInstruments,
  upsertTicker
} from "./db";
import { DeribitClient, spotPriceFromTicker, type DeribitOrderBook, type DeribitTicker } from "./deribit";
import { OrderBookCache, type CachedOrderBookResult } from "./market-data-cache";
import {
  calculateDcnSellCall,
  calculateDcnSellPut,
  priceCallCandidateAtSize,
  priceCandidateAtSize,
  scoreCallCandidate,
  scorePutCandidate,
  selectDcnCandidate,
  type BidAskLevel,
  type DcnPricingRequest,
  type PutMarketInput
} from "./pricing/dcn";
import {
  calculatePppCandidate,
  getPppDepthCandidateCount,
  getPppDurationGuardrailDays,
  normalizePppPricingRequest,
  selectPppCandidate,
  shortlistPppPackages,
  type PppMarketLegInput,
  type PppMarketPackageInput,
  type PppPricingDiagnostics,
  type PppPricingRequest
} from "./pricing/ppp";
import {
  buildPppMarketPackages,
  buildPppOfferSurfaceMarketPackages,
  countPppScannedExpiries,
  limitPppOfferSurfacePackages,
  withTopOfBookPppDepth
} from "./pricing/ppp-market";
import {
  buildPppOfferSurfaceResponse,
  normalizePppOfferSurfaceRequest,
  type PppOfferSurfaceRequest
} from "./pricing/ppp-offer-surface";
import { buildYieldSurface, type YieldSurfaceOptionType } from "./pricing/yield-surface";

const DEFAULT_DEPTH_CACHE_MAX_AGE_MS = 5_000;
const STREAM_TICKER_PERSIST_INTERVAL_MS = 15 * 60 * 1000;
const DEPTH_REQUEST_SPACING_MS = 75;
const INSTRUMENT_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const SUMMARY_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const SHORT_LIVED_STREAM_TIMEOUT_MS = 2_500;

type MarketDataSource = "live_rest" | "short_lived_stream" | "stale_d1_fallback" | "mock";

interface PricingMarketDataState {
  source: MarketDataSource;
  livePricingAttempted: boolean;
  degradedReasons: string[];
  shortLivedQuotes: Map<string, DeribitTicker>;
  shortLivedAttemptedInstruments: Set<string>;
  durableObjectUnavailable: boolean;
}

interface QuoteFallbackRow {
  instrument_name?: string;
  instrumentName?: string;
  bid_price?: number | null;
  bidPrice?: number | null;
  bid_amount?: number | null;
  bidAmount?: number | null;
  ask_price?: number | null;
  askPrice?: number | null;
  ask_amount?: number | null;
  askAmount?: number | null;
  mark_price?: number | null;
  markPrice?: number | null;
  last_price?: number | null;
  lastPrice?: number | null;
  open_interest?: number | null;
  openInterest?: number | null;
  underlying_price?: number | null;
  underlyingPrice?: number | null;
  underlying_index?: string | null;
  underlyingIndex?: string | null;
  interest_rate?: number | null;
  interestRate?: number | null;
  deribit_timestamp?: number | null;
  deribitTimestamp?: number | null;
  ingested_at?: number | null;
  ingestedAt?: number | null;
}

export interface Env {
  DB: D1Database;
  MARKET_DATA: DurableObjectNamespace;
  BACKEND_API_TOKEN?: string;
  DERIBIT_BASE_URL?: string;
  DERIBIT_PROXY_TOKEN?: string;
  DERIBIT_CLIENT_ID?: string;
  DERIBIT_CLIENT_SECRET?: string;
  DERIBIT_WS_URL?: string;
}

type RouteHandler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

const routes: Array<[method: string, pattern: RegExp, handler: RouteHandler, admin?: boolean]> = [
  ["GET", /^\/api\/market\/options$/, handleOptions],
  ["POST", /^\/api\/products\/dcn\/sell-put\/price$/, handleSellPutPrice],
  ["POST", /^\/api\/products\/dcn\/sell-call\/price$/, handleSellCallPrice],
  ["POST", /^\/api\/products\/ppp\/price$/, handlePppPrice],
  ["GET", /^\/api\/admin\/market-health$/, handleMarketHealth, true],
  ["GET", /^\/api\/admin\/yield-surface$/, handleYieldSurface, true],
  ["POST", /^\/api\/admin\/ppp-offer-surface$/, handlePppOfferSurface, true],
  ["POST", /^\/api\/admin\/dcn-audit$/, handleDcnAudit, true],
  ["POST", /^\/api\/admin\/ppp-audit$/, handlePppAudit, true],
  ["POST", /^\/api\/admin\/verify-quote$/, handleVerifyQuote, true],
  ["POST", /^\/api\/admin\/deribit-margins$/, handleDeribitMargins, true],
  ["GET", /^\/api\/admin\/pricing-config$/, handleGetPricingConfig, true],
  ["POST", /^\/api\/admin\/pricing-config$/, handleUpdatePricingConfig, true],
  ["POST", /^\/api\/admin\/refresh-selected-market$/, handleRefreshSelectedMarket, true],
  ["POST", /^\/api\/admin\/sync-market-data$/, handleSyncMarketData, true],
  ["GET", /^\/api\/admin\/stream-status$/, handleStreamStatus, true],
  ["POST", /^\/api\/admin\/stream-start$/, handleStreamStart, true],
  ["POST", /^\/api\/admin\/stream-stop$/, handleStreamStop, true]
];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    const url = new URL(request.url);

    for (const [method, pattern, handler, admin] of routes) {
      if (method === request.method && pattern.test(url.pathname)) {
        if (admin && !isAuthorized(request, env)) {
          return cors(json({ error: "Unauthorized" }, 401));
        }
        try {
          return cors(await handler(request, env, ctx));
        } catch (error) {
          return cors(json({ error: error instanceof Error ? error.message : "Unknown error" }, 500));
        }
      }
    }

    return cors(json({ ok: true, service: "signafi-market-worker" }));
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(syncMarketData(env));
  }
};

export class MarketDataDurableObject {
  private ws: WebSocket | null = null;
  private quotes = new Map<string, DeribitTicker>();
  private quoteReceivedAt = new Map<string, number>();
  private quotePersistedAt = new Map<string, number>();
  private orderBookCache: OrderBookCache | null = null;
  private depthQueue: Promise<void> = Promise.resolve();
  private lastDepthRequestAt = 0;
  private lastConnectAt = 0;
  private subscribed: string[] = [];

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/status")) {
      const nowMs = Date.now();
      const subscribedSet = new Set(this.subscribed);
      let freshStreamQuoteCount = 0;
      for (const [instrument, receivedAt] of this.quoteReceivedAt) {
        if (subscribedSet.has(instrument) && nowMs - receivedAt <= 10_000) freshStreamQuoteCount += 1;
      }
      return json({
        connected: this.ws?.readyState === WebSocket.OPEN,
        lastConnectAt: this.lastConnectAt,
        subscribed: this.subscribed,
        subscribedCount: this.subscribed.length,
        memoryQuoteCount: this.quotes.size,
        freshStreamQuoteCount,
        latestStreamQuoteAt: maxNumber(Array.from(this.quoteReceivedAt.values())),
        ...this.getOrderBookCache().status(DEFAULT_DEPTH_CACHE_MAX_AGE_MS)
      });
    }

    if (url.pathname.endsWith("/quote")) {
      const instrument = url.searchParams.get("instrument");
      const quote = instrument ? this.quotes.get(instrument) ?? null : null;
      const receivedAt = instrument ? this.quoteReceivedAt.get(instrument) ?? null : null;
      return json({
        instrument,
        quote,
        receivedAt,
        ageMs: receivedAt === null ? null : Math.max(0, Date.now() - receivedAt)
      });
    }

    if (url.pathname.endsWith("/order-book")) {
      const instrument = url.searchParams.get("instrument");
      if (!instrument) return json({ error: "instrument is required" }, 400);
      const depth = normalizeDepth(Number(url.searchParams.get("depth") ?? 100));
      const maxAgeMs = Math.max(1_000, Math.min(10_000, Number(url.searchParams.get("maxAgeMs") ?? DEFAULT_DEPTH_CACHE_MAX_AGE_MS)));
      try {
        const result = await this.getOrderBookCache().get(instrument, depth, maxAgeMs);
        return json(result);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Order book fetch failed" }, 502);
      }
    }

    if (url.pathname.endsWith("/start")) {
      const payload = await request.json().catch(() => ({})) as { instruments?: string[] };
      await this.start(payload.instruments ?? []);
      return json({ started: true, subscribed: this.subscribed });
    }

    if (url.pathname.endsWith("/stop")) {
      const stopped = this.stop();
      return json({ stopped, connected: false, subscribed: this.subscribed });
    }

    if (url.pathname.endsWith("/refresh-quotes")) {
      const payload = await request.json().catch(() => ({})) as { instruments?: string[]; timeoutMs?: number };
      return json(await this.refreshQuotes(payload.instruments ?? [], payload.timeoutMs));
    }

    return json({ ok: true });
  }

  private async start(instruments: string[]): Promise<void> {
    const unique = Array.from(new Set(instruments)).filter(Boolean).slice(0, 500);
    const existing = new Set(this.subscribed);
    const next = unique.filter((instrument) => !existing.has(instrument));
    this.subscribed = Array.from(new Set([...this.subscribed, ...unique])).slice(0, 500);
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (next.length > 0) this.subscribe(next);
      return;
    }

    const wsUrl = this.env.DERIBIT_WS_URL ?? "wss://www.deribit.com/ws/api/v2";
    this.ws = new WebSocket(wsUrl);
    this.lastConnectAt = Date.now();

    this.ws.addEventListener("open", () => this.subscribe(this.subscribed));
    this.ws.addEventListener("message", (event) => {
      this.state.waitUntil(this.onMessage(String(event.data)));
    });
    this.ws.addEventListener("close", () => {
      this.ws = null;
    });
    this.ws.addEventListener("error", () => {
      this.ws = null;
    });
  }

  private stop(): boolean {
    const wasConnected = this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING;
    try {
      this.ws?.close(1000, "Stopped by admin");
    } catch {
      // Ignore close errors; the object state below is authoritative for future calls.
    }
    this.ws = null;
    this.subscribed = [];
    this.quotes.clear();
    this.quoteReceivedAt.clear();
    this.quotePersistedAt.clear();
    this.orderBookCache = null;
    this.depthQueue = Promise.resolve();
    this.lastDepthRequestAt = 0;
    return Boolean(wasConnected);
  }

  private subscribe(instruments: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || instruments.length === 0) return;
    this.sendSubscribe(this.ws, instruments);
  }

  private sendSubscribe(ws: WebSocket, instruments: string[]): void {
    for (let index = 0; index < instruments.length; index += 500) {
      const batch = instruments.slice(index, index + 500);
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now() + index,
          method: "public/subscribe",
          params: {
            channels: batch.map((instrument) => `ticker.${instrument}.agg2`)
          }
        })
      );
    }
  }

  private async refreshQuotes(
    instruments: string[],
    requestedTimeoutMs?: number
  ): Promise<{
    connectedAt: number | null;
    closedAt: number;
    requested: string[];
    receivedCount: number;
    quotes: Record<string, DeribitTicker>;
    error?: string;
  }> {
    const requested = normalizeInstruments(instruments, 500);
    if (requested.length === 0) {
      return {
        connectedAt: null,
        closedAt: Date.now(),
        requested,
        receivedCount: 0,
        quotes: {}
      };
    }

    const timeoutMs = Math.max(500, Math.min(5_000, Number(requestedTimeoutMs ?? SHORT_LIVED_STREAM_TIMEOUT_MS)));
    const requestedSet = new Set(requested);
    const quotes = new Map<string, DeribitTicker>();
    const wsUrl = this.env.DERIBIT_WS_URL ?? "wss://www.deribit.com/ws/api/v2";

    return new Promise((resolve) => {
      let settled = false;
      let connectedAt: number | null = null;
      let ws: WebSocket | null = null;
      const finish = (error?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws?.close(1000, "Short-lived quote refresh complete");
        } catch {
          // The websocket may already be closed; that is fine for this short refresh path.
        }
        resolve({
          connectedAt,
          closedAt: Date.now(),
          requested,
          receivedCount: quotes.size,
          quotes: Object.fromEntries(quotes),
          ...(error ? { error } : {})
        });
      };
      const timer = setTimeout(() => finish(), timeoutMs);

      try {
        ws = new WebSocket(wsUrl);
      } catch (error) {
        finish(error instanceof Error ? error.message : "Short-lived Deribit websocket failed to open");
        return;
      }

      ws.addEventListener("open", () => {
        connectedAt = Date.now();
        this.sendSubscribe(ws as WebSocket, requested);
      });
      ws.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { method?: string; params?: { data?: DeribitTicker } };
          const data = payload.params?.data;
          if (!data?.instrument_name || !requestedSet.has(data.instrument_name)) return;
          quotes.set(data.instrument_name, data);
          this.quotes.set(data.instrument_name, data);
          this.quoteReceivedAt.set(data.instrument_name, Date.now());
          if (quotes.size >= requested.length) finish();
        } catch {
          // Ignore non-ticker messages and malformed frames from the short-lived refresh.
        }
      });
      ws.addEventListener("close", () => {
        finish(quotes.size > 0 ? undefined : "Short-lived Deribit websocket closed before quotes arrived");
      });
      ws.addEventListener("error", () => {
        finish("Short-lived Deribit websocket failed");
      });
    });
  }

  private async onMessage(message: string): Promise<void> {
    const payload = JSON.parse(message) as { method?: string; params?: { data?: DeribitTicker } };
    const data = payload.params?.data;
    if (!data?.instrument_name) return;
    const nowMs = Date.now();
    this.quotes.set(data.instrument_name, data);
    this.quoteReceivedAt.set(data.instrument_name, nowMs);
    if (!this.shouldPersistTicker(data.instrument_name, nowMs)) return;
    await upsertTicker(this.env.DB, data, nowMs);
    this.quotePersistedAt.set(data.instrument_name, nowMs);
  }

  private shouldPersistTicker(instrumentName: string, nowMs: number): boolean {
    const lastPersistedAt = this.quotePersistedAt.get(instrumentName) ?? 0;
    return nowMs - lastPersistedAt >= STREAM_TICKER_PERSIST_INTERVAL_MS;
  }

  private getOrderBookCache(): OrderBookCache {
    if (!this.orderBookCache) {
      const client = new DeribitClient(this.env.DERIBIT_BASE_URL, this.env.DERIBIT_PROXY_TOKEN);
      this.orderBookCache = new OrderBookCache((instrumentName, depth) =>
        this.throttleDepthRequest(() => client.getOrderBook(instrumentName, depth))
      );
    }
    return this.orderBookCache;
  }

  private async throttleDepthRequest<T>(request: () => Promise<T>): Promise<T> {
    const previous = this.depthQueue;
    let release!: () => void;
    this.depthQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const nowMs = Date.now();
      const waitMs = Math.max(0, this.lastDepthRequestAt + DEPTH_REQUEST_SPACING_MS - nowMs);
      if (waitMs > 0) await sleep(waitMs);
      this.lastDepthRequestAt = Date.now();
      return await request();
    } finally {
      release();
    }
  }
}

async function handleOptions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 300), 5000);
  const rawOptionType = url.searchParams.get("type");
  const optionType = rawOptionType === "call" || rawOptionType === "put" ? rawOptionType : null;
  const expiryParam = url.searchParams.get("expiry");
  const expiryTimestamp = expiryParam ? Number(expiryParam) : null;

  if (url.searchParams.get("summary") === "expiries") {
    const expiries = await env.DB
      .prepare(
        `SELECT i.option_type, i.expiration_timestamp, COUNT(*) AS instrument_count
        FROM option_instruments i
        WHERE i.is_active = 1
          AND (? IS NULL OR i.option_type = ?)
        GROUP BY i.option_type, i.expiration_timestamp
        ORDER BY i.expiration_timestamp ASC, i.option_type ASC`
      )
      .bind(optionType, optionType)
      .all();
    return json({ expiries: expiries.results });
  }

  const rows = await env.DB
    .prepare(
      `SELECT i.instrument_name, i.option_type, i.strike, i.expiration_timestamp,
        q.bid_price, q.bid_amount, q.ask_price, q.ask_amount, q.mark_price, q.last_price,
        q.mark_iv, q.open_interest, q.underlying_price, q.deribit_timestamp, q.ingested_at
      FROM option_instruments i
      LEFT JOIN option_quotes_latest q ON q.instrument_name = i.instrument_name
      WHERE i.is_active = 1
        AND (? IS NULL OR i.option_type = ?)
        AND (? IS NULL OR i.expiration_timestamp = ?)
      ORDER BY i.expiration_timestamp ASC, i.strike ASC
      LIMIT ?`
    )
    .bind(optionType, optionType, expiryTimestamp, expiryTimestamp, limit)
    .all();
  return json({ options: rows.results });
}

async function handleYieldSurface(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const rawType = url.searchParams.get("type") ?? "put";
  if (rawType !== "put" && rawType !== "call") {
    return json({ error: "type must be either 'put' or 'call'" }, 400);
  }

  const minDte = optionalNonNegativeParam(url, ["minDte", "min_dte"]);
  const maxDte = optionalNonNegativeParam(url, ["maxDte", "max_dte"]);
  const minStrike = optionalNonNegativeParam(url, ["minStrike", "min_strike"]);
  const maxStrike = optionalNonNegativeParam(url, ["maxStrike", "max_strike"]);
  const limitParam = optionalNonNegativeParam(url, ["limit"]);
  if (minDte === null || maxDte === null || minStrike === null || maxStrike === null || limitParam === null) {
    return json({ error: "yield surface filters must be non-negative numbers" }, 400);
  }
  if (minDte !== undefined && maxDte !== undefined && minDte > maxDte) {
    return json({ error: "minDte must be less than or equal to maxDte" }, 400);
  }
  if (minStrike !== undefined && maxStrike !== undefined && minStrike > maxStrike) {
    return json({ error: "minStrike must be less than or equal to maxStrike" }, 400);
  }

  const nowMs = Date.now();
  const limit = Math.min(Math.max(Math.floor(limitParam ?? 5000), 1), 10000);
  const client = new DeribitClient(env.DERIBIT_BASE_URL, env.DERIBIT_PROXY_TOKEN);
  const [rows, spot] = await Promise.all([
    getYieldSurfaceRows(env.DB, rawType as YieldSurfaceOptionType, nowMs, limit),
    getBtcUsdcSpotMetadata(client)
  ]);
  return json(
    buildYieldSurface(rows, {
      nowMs,
      optionType: rawType as YieldSurfaceOptionType,
      spot,
      filters: {
        minDte,
        maxDte,
        minStrike,
        maxStrike
      }
    })
  );
}

async function handleSellPutPrice(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<DcnPricingRequest>();
  const nowMs = Date.now();
  const config = await getPricingConfig(env.DB);
  const normalized = normalizePricingRequest(payload, config);
  let candidates = await getPutCandidates(env.DB, nowMs);

  if (candidates.length === 0) {
    await syncMarketData(env, { force: true });
    candidates = await getPutCandidates(env.DB, nowMs);
  }

  const client = new DeribitClient(env.DERIBIT_BASE_URL, env.DERIBIT_PROXY_TOKEN);
  const marketData = createPricingMarketDataState();
  const spotPrice = await getBtcUsdcSpotPriceForPricing(env, client, marketData, candidates);
  const depthCandidateCount = Math.min(Math.max(config.maxDepthCandidates, 6), 12);
  const shortlisted = candidates
    .map((row) => ({ row, score: scorePutCandidate(normalized, rowToMarket(row, [], undefined, spotPrice)) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, depthCandidateCount);
  const shortLivedUniverse = normalizeInstruments(["BTC_USDC", ...shortlisted.map((item) => item.row.instrument_name)], 500);

  const priced = [];

  for (const item of shortlisted) {
    const book = await getOrderBookForQuote(
      env,
      client,
      marketData,
      item.row.instrument_name,
      normalized.orderBookDepth ?? config.defaultOrderBookDepth,
      item.row,
      shortLivedUniverse
    );
    const calculation = priceCandidateAtSize(normalized, rowToMarket(item.row, book.bids, book.timestamp, spotPrice));
    priced.push({ score: item.score, snapshotId: null, ...calculation });
  }

  const selected = selectDcnCandidate(normalized, priced);

  return json({
    generatedAt: nowMs,
    input: normalized,
    candidates: selected.candidates,
    bestCandidate: selected.bestCandidate,
    recommendation: selected.recommendation,
    ...marketDataMetadata(marketData)
  });
}

async function handleSellCallPrice(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<DcnPricingRequest>();
  const nowMs = Date.now();
  const config = await getPricingConfig(env.DB);
  const normalized = normalizePricingRequest({ ...payload, productType: "sell_call" }, config);
  let candidates = await getCallCandidates(env.DB, nowMs);

  if (candidates.length === 0) {
    await syncMarketData(env, { force: true });
    candidates = await getCallCandidates(env.DB, nowMs);
  }

  const client = new DeribitClient(env.DERIBIT_BASE_URL, env.DERIBIT_PROXY_TOKEN);
  const marketData = createPricingMarketDataState();
  const spotPrice = await getBtcUsdcSpotPriceForPricing(env, client, marketData, candidates);
  const depthCandidateCount = Math.min(Math.max(config.maxDepthCandidates, 6), 12);
  const shortlisted = candidates
    .map((row) => ({ row, score: scoreCallCandidate(normalized, rowToMarket(row, [], undefined, spotPrice)) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, depthCandidateCount);
  const shortLivedUniverse = normalizeInstruments(["BTC_USDC", ...shortlisted.map((item) => item.row.instrument_name)], 500);

  const priced = [];

  for (const item of shortlisted) {
    const book = await getOrderBookForQuote(
      env,
      client,
      marketData,
      item.row.instrument_name,
      normalized.orderBookDepth ?? config.defaultOrderBookDepth,
      item.row,
      shortLivedUniverse
    );
    const calculation = priceCallCandidateAtSize(normalized, rowToMarket(item.row, book.bids, book.timestamp, spotPrice));
    priced.push({ score: item.score, snapshotId: null, ...calculation });
  }

  const selected = selectDcnCandidate(normalized, priced);

  return json({
    generatedAt: nowMs,
    input: normalized,
    candidates: selected.candidates,
    bestCandidate: selected.bestCandidate,
    recommendation: selected.recommendation,
    ...marketDataMetadata(marketData)
  });
}

async function handlePppPrice(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<PppPricingRequest>();
  const result = await pricePppRequest(payload, env);
  return json(result);
}

async function handlePppAudit(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<PppPricingRequest>();
  const result = await pricePppRequest(payload, env);
  return json({
    ...result,
    calculation: result.bestCandidate
  });
}

async function handlePppOfferSurface(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<PppOfferSurfaceRequest>();
  const result = await pricePppOfferSurfaceRequest(payload, env);
  return json(result);
}

async function handleDcnAudit(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<DcnPricingRequest & { instrumentName?: string }>();
  if (!payload.instrumentName) return json({ error: "instrumentName is required" }, 400);

  const config = await getPricingConfig(env.DB);
  const stored = await getInstrumentQuote(env.DB, payload.instrumentName);
  if (!stored) return json({ error: "Instrument not found in D1" }, 404);
  const productType = payload.productType ?? (stored.option_type === "call" ? "sell_call" : "sell_put");
  const normalized = normalizePricingRequest({ ...payload, productType }, config);

  const client = new DeribitClient(env.DERIBIT_BASE_URL, env.DERIBIT_PROXY_TOKEN);
  const [book, spotPrice] = await Promise.all([
    getOrderBookForPricing(env, client, config, payload.instrumentName, normalized.orderBookDepth ?? config.defaultOrderBookDepth),
    getBtcUsdcSpotPrice(env, client, config)
  ]);
  const snapshotId = await insertOrderBookSnapshot(
    env.DB,
    book,
    normalized.orderBookDepth ?? config.defaultOrderBookDepth,
    "admin-audit",
    Date.now()
  );
  const market = rowToMarket(stored, book.bids, book.timestamp, spotPrice);
  const calculation =
    productType === "sell_call" ? calculateDcnSellCall(normalized, market) : calculateDcnSellPut(normalized, market);
  const auditId = await insertAudit(env.DB, payload, payload.instrumentName, snapshotId, calculation, calculation.checks, Date.now());

  return json({ auditId, snapshotId, calculation });
}

async function handleVerifyQuote(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<{ instrumentName?: string; depth?: number }>();
  if (!payload.instrumentName) return json({ error: "instrumentName is required" }, 400);

  const config = await getPricingConfig(env.DB);
  const stored = await getInstrumentQuote(env.DB, payload.instrumentName);
  const client = new DeribitClient(env.DERIBIT_BASE_URL, env.DERIBIT_PROXY_TOKEN);
  const [ticker, memory] = await Promise.all([
    client.ticker(payload.instrumentName),
    config.marketDataMode === "hybrid_cache" ? getDurableObjectQuote(env, payload.instrumentName) : Promise.resolve(null)
  ]);
  const depth = normalizeDepth(payload.depth ?? config.defaultOrderBookDepth);
  const cachedBook =
    config.marketDataMode === "hybrid_cache"
      ? await getDurableObjectOrderBook(env, payload.instrumentName, depth, DEFAULT_DEPTH_CACHE_MAX_AGE_MS)
      : null;
  const book = cachedBook?.book ?? (await client.getOrderBook(payload.instrumentName, depth));

  const nowMs = Date.now();
  const storedBid = stored?.bid_price ?? null;
  const liveBid = ticker.best_bid_price ?? book.best_bid_price ?? null;
  const bidDriftPct =
    storedBid !== null && liveBid !== null && liveBid > 0 ? Math.abs(storedBid - liveBid) / liveBid : null;

  return json({
    instrumentName: payload.instrumentName,
    stored,
    memory,
    live: { ticker, book },
    checks: {
      storedExists: stored !== null,
      liveExists: liveBid !== null,
      storedFresh: stored?.ingested_at ? (nowMs - stored.ingested_at) / 1000 <= config.quoteFreshnessSeconds : false,
      bidDriftUnder10Bps: bidDriftPct !== null ? bidDriftPct <= 0.001 : false,
      depthAvailable: (book.bids ?? []).length > 0
    },
    source: {
      marketDataMode: config.marketDataMode,
      orderBook: cachedBook?.source ?? "deribit_rest",
      orderBookAgeMs: cachedBook?.ageMs ?? null
    },
    drift: {
      storedBid,
      liveBid,
      bidDriftPct
    }
  });
}

async function handleDeribitMargins(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<{ instrumentName?: string; amount?: number; price?: number }>();
  if (!payload.instrumentName) return json({ error: "instrumentName is required" }, 400);
  if (!isPositiveFinite(payload.amount)) return json({ error: "amount must be a positive number" }, 400);
  if (!isPositiveFinite(payload.price)) return json({ error: "price must be a positive number" }, 400);
  if (!env.DERIBIT_CLIENT_ID || !env.DERIBIT_CLIENT_SECRET) {
    return json(
      {
        error:
          "Deribit API credentials are not configured. Set DERIBIT_CLIENT_ID and DERIBIT_CLIENT_SECRET with trade:read scope."
      },
      503
    );
  }

  const client = new DeribitClient(
    env.DERIBIT_BASE_URL,
    env.DERIBIT_PROXY_TOKEN,
    env.DERIBIT_CLIENT_ID,
    env.DERIBIT_CLIENT_SECRET
  );
  const result = await client.getMargins(payload.instrumentName, payload.amount, payload.price);

  return json({
    instrumentName: payload.instrumentName,
    amount: payload.amount,
    price: payload.price,
    result
  });
}

async function handleGetPricingConfig(_request: Request, env: Env): Promise<Response> {
  return json({ pricingConfig: await getPricingConfig(env.DB) });
}

async function handleUpdatePricingConfig(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<{
    marketDataMode?: string;
    sellPutPricingMethod?: string;
    firmMarginBps?: number;
    sellPutTargetFirmProfitBps?: number;
    sellCallTargetFirmProfitBps?: number;
    pppTargetFirmMarginBps?: number;
    pppIncludeDeliveryFees?: boolean;
    pppParticipationRoundDownBps?: number;
  }>();
  if (
    payload.marketDataMode !== undefined &&
    payload.marketDataMode !== "legacy_rest" &&
    payload.marketDataMode !== "hybrid_cache"
  ) {
    return json({ error: "marketDataMode must be legacy_rest or hybrid_cache" }, 400);
  }
  if (
    payload.sellPutPricingMethod !== undefined &&
    payload.sellPutPricingMethod !== "firm_margin" &&
    payload.sellPutPricingMethod !== "target_firm_profit"
  ) {
    return json({ error: "sellPutPricingMethod must be firm_margin or target_firm_profit" }, 400);
  }
  if (payload.firmMarginBps !== undefined && !isNonNegativeFinite(payload.firmMarginBps)) {
    return json({ error: "firmMarginBps must be a non-negative number" }, 400);
  }
  if (payload.firmMarginBps !== undefined && payload.firmMarginBps > 10_000) {
    return json({ error: "firmMarginBps must be less than or equal to 10000" }, 400);
  }
  if (
    payload.sellPutTargetFirmProfitBps !== undefined &&
    !isNonNegativeFinite(payload.sellPutTargetFirmProfitBps)
  ) {
    return json({ error: "sellPutTargetFirmProfitBps must be a non-negative number" }, 400);
  }
  if (payload.sellPutTargetFirmProfitBps !== undefined && payload.sellPutTargetFirmProfitBps > 10_000) {
    return json({ error: "sellPutTargetFirmProfitBps must be less than or equal to 10000" }, 400);
  }
  if (
    payload.sellCallTargetFirmProfitBps !== undefined &&
    !isNonNegativeFinite(payload.sellCallTargetFirmProfitBps)
  ) {
    return json({ error: "sellCallTargetFirmProfitBps must be a non-negative number" }, 400);
  }
  if (payload.sellCallTargetFirmProfitBps !== undefined && payload.sellCallTargetFirmProfitBps > 10_000) {
    return json({ error: "sellCallTargetFirmProfitBps must be less than or equal to 10000" }, 400);
  }
  if (
    payload.pppTargetFirmMarginBps !== undefined &&
    !isNonNegativeFinite(payload.pppTargetFirmMarginBps)
  ) {
    return json({ error: "pppTargetFirmMarginBps must be a non-negative number" }, 400);
  }
  if (payload.pppTargetFirmMarginBps !== undefined && payload.pppTargetFirmMarginBps > 10_000) {
    return json({ error: "pppTargetFirmMarginBps must be less than or equal to 10000" }, 400);
  }
  if (payload.pppIncludeDeliveryFees !== undefined && typeof payload.pppIncludeDeliveryFees !== "boolean") {
    return json({ error: "pppIncludeDeliveryFees must be a boolean" }, 400);
  }
  if (
    payload.pppParticipationRoundDownBps !== undefined &&
    !isNonNegativeFinite(payload.pppParticipationRoundDownBps)
  ) {
    return json({ error: "pppParticipationRoundDownBps must be a non-negative number" }, 400);
  }
  if (payload.pppParticipationRoundDownBps !== undefined && payload.pppParticipationRoundDownBps > 10_000) {
    return json({ error: "pppParticipationRoundDownBps must be less than or equal to 10000" }, 400);
  }

  const pricingConfig = await updatePricingConfig(
    env.DB,
    {
      marketDataMode:
        payload.marketDataMode === "legacy_rest" || payload.marketDataMode === "hybrid_cache"
          ? payload.marketDataMode
          : undefined,
      sellPutPricingMethod:
        payload.sellPutPricingMethod === "target_firm_profit" || payload.sellPutPricingMethod === "firm_margin"
          ? payload.sellPutPricingMethod
          : undefined,
      firmMarginBps:
        payload.firmMarginBps === undefined ? undefined : Math.round(payload.firmMarginBps),
      sellPutTargetFirmProfitBps:
        payload.sellPutTargetFirmProfitBps === undefined
          ? undefined
          : Math.round(payload.sellPutTargetFirmProfitBps),
      sellCallTargetFirmProfitBps:
        payload.sellCallTargetFirmProfitBps === undefined
          ? undefined
          : Math.round(payload.sellCallTargetFirmProfitBps),
      pppTargetFirmMarginBps:
        payload.pppTargetFirmMarginBps === undefined ? undefined : Math.round(payload.pppTargetFirmMarginBps),
      pppIncludeDeliveryFees: payload.pppIncludeDeliveryFees,
      pppParticipationRoundDownBps:
        payload.pppParticipationRoundDownBps === undefined
          ? undefined
          : Math.round(payload.pppParticipationRoundDownBps)
    },
    Date.now()
  );
  return json({ pricingConfig });
}

async function handleRefreshSelectedMarket(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<DcnPricingRequest & { instrumentName?: string }>();
  if (!payload.instrumentName) return json({ error: "instrumentName is required" }, 400);

  const config = await getPricingConfig(env.DB);
  const stored = await getInstrumentQuote(env.DB, payload.instrumentName);
  if (!stored) return json({ error: "Instrument not found in D1" }, 404);
  const productType = payload.productType ?? (stored.option_type === "call" ? "sell_call" : "sell_put");
  const normalized = normalizePricingRequest({ ...payload, productType }, config);

  const client = new DeribitClient(env.DERIBIT_BASE_URL, env.DERIBIT_PROXY_TOKEN);
  const [ticker, book, spotTicker] = await Promise.all([
    client.ticker(payload.instrumentName),
    getOrderBookForPricing(env, client, config, payload.instrumentName, normalized.orderBookDepth ?? config.defaultOrderBookDepth),
    client.btcUsdcSpotTicker()
  ]);
  const nowMs = Date.now();
  await upsertTicker(env.DB, ticker, nowMs);
  const refreshed = await getInstrumentQuote(env.DB, payload.instrumentName);
  const spotPrice = spotPriceFromTicker(spotTicker);
  const snapshotId = await insertOrderBookSnapshot(
    env.DB,
    book,
    normalized.orderBookDepth ?? config.defaultOrderBookDepth,
    "admin-refresh-selected-market",
    nowMs
  );
  const market = rowToMarket(refreshed ?? stored, book.bids, book.timestamp, spotPrice);
  const calculation =
    productType === "sell_call" ? calculateDcnSellCall(normalized, market) : calculateDcnSellPut(normalized, market);
  const auditId = await insertAudit(env.DB, payload, payload.instrumentName, snapshotId, calculation, calculation.checks, nowMs);

  return json({
    auditId,
    snapshotId,
    calculation,
    refreshed: {
      instrumentName: payload.instrumentName,
      instrumentTickerTimestamp: ticker.timestamp ?? null,
      instrumentIngestedAt: nowMs,
      spotInstrumentName: spotTicker.instrument_name,
      spotTickerTimestamp: spotTicker.timestamp ?? null,
      spotPrice,
      orderBookTimestamp: book.timestamp ?? null,
      orderBookDepth: normalized.orderBookDepth ?? config.defaultOrderBookDepth
    }
  });
}

async function handleMarketHealth(request: Request, env: Env): Promise<Response> {
  const nowMs = Date.now();
  const summaryFreshnessSeconds = 180;
  const liveFreshnessSeconds = 10;
  const url = new URL(request.url);
  const config = await getPricingConfig(env.DB);
  const includeStreamStatus =
    config.marketDataMode === "hybrid_cache" ||
    url.searchParams.get("includeStream") === "1" ||
    url.searchParams.get("includeStream") === "true";
  const [
    syncStatus,
    instrumentStats,
    quoteStats,
    summaryStaleStats,
    latestAudit,
    streamStatus
  ] = await Promise.all([
    getMarketDataSyncStatus(env.DB),
    env.DB
      .prepare("SELECT COUNT(*) AS count FROM option_instruments WHERE is_active = 1 AND expiration_timestamp > ?")
      .bind(nowMs)
      .first<{ count: number }>(),
    env.DB
      .prepare(
        `SELECT COUNT(q.instrument_name) AS count, MAX(q.ingested_at) AS latest, MAX(q.deribit_timestamp) AS latestDeribit
        FROM option_instruments i
        LEFT JOIN option_quotes_latest q ON q.instrument_name = i.instrument_name
        WHERE i.is_active = 1
          AND i.expiration_timestamp > ?`
      )
      .bind(nowMs)
      .first<{
      count: number;
      latest: number;
      latestDeribit: number | null;
    }>(),
    env.DB
      .prepare(
        `SELECT COUNT(*) AS count
        FROM option_instruments i
        LEFT JOIN option_quotes_latest q ON q.instrument_name = i.instrument_name
        WHERE i.is_active = 1
          AND i.expiration_timestamp > ?
          AND (q.instrument_name IS NULL OR q.ingested_at < ?)`
      )
      .bind(nowMs, nowMs - summaryFreshnessSeconds * 1000)
      .first<{ count: number }>(),
    env.DB.prepare("SELECT MAX(created_at) AS latest FROM dcn_quote_audit").first<{ latest: number | null }>(),
    includeStreamStatus ? getDurableObjectStatus(env) : Promise.resolve(null)
  ]);
  const latestQuoteAt = quoteStats?.latest ?? null;
  const latestDeribitQuoteAt = quoteStats?.latestDeribit ?? null;
  const streamRecord = isRecord(streamStatus) ? streamStatus : {};
  const liveTickerFreshCount = numberFromUnknown(streamRecord.freshStreamQuoteCount) ?? 0;
  const subscribedStreamCount = numberFromUnknown(streamRecord.subscribedCount) ?? 0;
  const depthCacheCount = numberFromUnknown(streamRecord.depthCacheCount) ?? 0;
  const freshDepthCacheCount = numberFromUnknown(streamRecord.freshDepthCacheCount) ?? 0;
  const summarySyncAgeSeconds =
    syncStatus.lastSummarySyncAt === null ? null : Math.max(0, (nowMs - syncStatus.lastSummarySyncAt) / 1000);
  const instrumentSyncAgeSeconds =
    syncStatus.lastInstrumentSyncAt === null ? null : Math.max(0, (nowMs - syncStatus.lastInstrumentSyncAt) / 1000);

  return json({
    nowMs,
    marketDataMode: config.marketDataMode,
    activeInstrumentCount: instrumentStats?.count ?? 0,
    quoteCount: quoteStats?.count ?? 0,
    latestQuoteAt,
    latestDeribitQuoteAt,
    latestSyncAt: syncStatus.lastSummarySyncAt,
    catalogSyncAgeSeconds: instrumentSyncAgeSeconds,
    instrumentSyncAgeSeconds,
    summarySyncAgeSeconds,
    summaryFreshnessSeconds,
    summaryStaleCount: summaryStaleStats?.count ?? 0,
    liveFreshnessSeconds,
    liveTickerFreshCount,
    subscribedStreamCount,
    depthCacheCount,
    freshDepthCacheCount,
    staleQuoteCount: summaryStaleStats?.count ?? 0,
    latestAuditAt: latestAudit?.latest ?? null,
    ...(includeStreamStatus ? { streamStatus } : {}),
    d1FreeTierGuard: {
      quotePersistence: `summary writes are throttled to ${SUMMARY_SYNC_INTERVAL_MS / 60000}m and stream writes to ${STREAM_TICKER_PERSIST_INTERVAL_MS / 60000}m per instrument`,
      depthStorage: "hybrid depth cache is in Durable Object memory; only admin/pricing snapshots are persisted",
      rowsWrittenDailyLimit: 100000
    }
  });
}

async function handleSyncMarketData(_request: Request, env: Env): Promise<Response> {
  const result = await syncMarketData(env, { force: true });
  return json(result);
}

async function handleStreamStatus(_request: Request, env: Env): Promise<Response> {
  return json(await getDurableObjectStatus(env));
}

async function handleStreamStart(_request: Request, env: Env): Promise<Response> {
  return json(await ensurePricingStream(env));
}

async function handleStreamStop(_request: Request, env: Env): Promise<Response> {
  return json(await stopPricingStream(env));
}

async function ensurePricingStream(env: Env): Promise<unknown> {
  const instruments = await getPricingStreamInstruments(env);
  const id = env.MARKET_DATA.idFromName("btc-options");
  const stub = env.MARKET_DATA.get(id);
  const response = await stub.fetch("https://durable-object/start", {
    method: "POST",
    body: JSON.stringify({ instruments })
  });
  return response.json().catch(() => ({ started: false, subscribed: instruments }));
}

async function stopPricingStream(env: Env): Promise<unknown> {
  const id = env.MARKET_DATA.idFromName("btc-options");
  const stub = env.MARKET_DATA.get(id);
  const response = await stub.fetch("https://durable-object/stop", { method: "POST" });
  return response.json().catch(() => ({ stopped: false }));
}

async function getPricingStreamInstruments(env: Env): Promise<string[]> {
  const nowMs = Date.now();
  const [putRows, callRows] = await Promise.all([getPutCandidates(env.DB, nowMs), getCallCandidates(env.DB, nowMs)]);
  const puts = putRows
    .filter((row) => row.underlying_price && row.strike < row.underlying_price && row.strike > row.underlying_price * 0.75)
    .sort((a, b) => {
      const aSpot = a.underlying_price ?? 1;
      const bSpot = b.underlying_price ?? 1;
      const aMoneynessGap = Math.abs(a.strike / aSpot - 0.9);
      const bMoneynessGap = Math.abs(b.strike / bSpot - 0.9);
      if (aMoneynessGap !== bMoneynessGap) return aMoneynessGap - bMoneynessGap;
      return a.expiration_timestamp - b.expiration_timestamp;
    })
    .slice(0, 300);
  const calls = callRows
    .filter((row) => row.underlying_price && row.strike > row.underlying_price && row.strike < row.underlying_price * 1.35)
    .sort((a, b) => {
      const aSpot = a.underlying_price ?? 1;
      const bSpot = b.underlying_price ?? 1;
      const aMoneynessGap = Math.abs(a.strike / aSpot - 1.1);
      const bMoneynessGap = Math.abs(b.strike / bSpot - 1.1);
      if (aMoneynessGap !== bMoneynessGap) return aMoneynessGap - bMoneynessGap;
      return a.expiration_timestamp - b.expiration_timestamp;
    })
    .slice(0, 200);
  const optionInstruments = Array.from(new Set([...puts, ...calls].map((row) => row.instrument_name))).slice(0, 499);
  return ["BTC_USDC", ...optionInstruments];
}

function createPricingMarketDataState(): PricingMarketDataState {
  return {
    source: "live_rest",
    livePricingAttempted: false,
    degradedReasons: [],
    shortLivedQuotes: new Map(),
    shortLivedAttemptedInstruments: new Set(),
    durableObjectUnavailable: false
  };
}

function marketDataMetadata(state: PricingMarketDataState): {
  marketDataSource: MarketDataSource;
  degradedReason?: string;
  livePricingAttempted: boolean;
} {
  return {
    marketDataSource: state.source,
    ...(state.degradedReasons.length > 0 ? { degradedReason: Array.from(new Set(state.degradedReasons)).join(" ") } : {}),
    livePricingAttempted: state.livePricingAttempted
  };
}

function markMarketDataSource(state: PricingMarketDataState, source: MarketDataSource, reason?: string): void {
  const priority: Record<MarketDataSource, number> = {
    live_rest: 0,
    short_lived_stream: 1,
    stale_d1_fallback: 2,
    mock: 3
  };
  if (priority[source] > priority[state.source]) state.source = source;
  if (reason) state.degradedReasons.push(reason);
}

async function getBtcUsdcSpotPriceForPricing(
  env: Env,
  client: DeribitClient,
  state: PricingMarketDataState,
  fallbackRows: QuoteFallbackRow[] = []
): Promise<number | null> {
  state.livePricingAttempted = true;
  try {
    return spotPriceFromTicker(await client.btcUsdcSpotTicker());
  } catch (error) {
    const message = errorMessage(error);
    const streamed = await getShortLivedTicker(env, state, "BTC_USDC", ["BTC_USDC"]);
    const streamedSpot = spotPriceFromTicker(streamed);
    if (streamedSpot) {
      markMarketDataSource(state, "short_lived_stream", `BTC_USDC REST spot failed; used short-lived stream. ${message}`);
      return streamedSpot;
    }
    const fallbackSpot = latestFallbackSpotPrice(fallbackRows);
    if (fallbackSpot) {
      markMarketDataSource(state, "stale_d1_fallback", `BTC_USDC live spot unavailable; used latest D1 underlying price. ${message}`);
      return fallbackSpot;
    }
    markMarketDataSource(state, "stale_d1_fallback", `BTC_USDC live spot unavailable. ${message}`);
    return null;
  }
}

async function getOrderBookForQuote(
  env: Env,
  client: DeribitClient,
  state: PricingMarketDataState,
  instrumentName: string,
  depth: number,
  fallback: QuoteFallbackRow,
  shortLivedUniverse: string[]
): Promise<DeribitOrderBook> {
  state.livePricingAttempted = true;
  try {
    return await client.getOrderBook(instrumentName, depth);
  } catch (error) {
    const message = errorMessage(error);
    const streamed = await getShortLivedTicker(env, state, instrumentName, shortLivedUniverse);
    const streamedBook = streamed ? orderBookFromTicker(streamed) : null;
    if (streamedBook) {
      markMarketDataSource(state, "short_lived_stream", `${instrumentName} REST depth failed; used short-lived stream top of book. ${message}`);
      return streamedBook;
    }
    markMarketDataSource(state, "stale_d1_fallback", `${instrumentName} live depth unavailable; used latest D1 top of book. ${message}`);
    return orderBookFromFallback(fallback, instrumentName);
  }
}

async function getShortLivedTicker(
  env: Env,
  state: PricingMarketDataState,
  instrumentName: string,
  instruments: string[]
): Promise<DeribitTicker | null> {
  const cached = state.shortLivedQuotes.get(instrumentName);
  if (cached) return cached;
  if (state.durableObjectUnavailable) return null;

  const missing = normalizeInstruments(instruments, 500).filter(
    (instrument) => !state.shortLivedAttemptedInstruments.has(instrument)
  );
  if (missing.length === 0) return state.shortLivedQuotes.get(instrumentName) ?? null;
  for (const instrument of missing) state.shortLivedAttemptedInstruments.add(instrument);

  const id = env.MARKET_DATA.idFromName("btc-options");
  const stub = env.MARKET_DATA.get(id);
  const response = await stub
    .fetch("https://durable-object/refresh-quotes", {
      method: "POST",
      body: JSON.stringify({ instruments: missing, timeoutMs: SHORT_LIVED_STREAM_TIMEOUT_MS })
    })
    .catch((error) => {
      const message = errorMessage(error);
      if (isCloudflareLimitError(message)) state.durableObjectUnavailable = true;
      state.degradedReasons.push(`Short-lived stream unavailable. ${message}`);
      return null;
    });
  if (!response) return null;
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const message = `HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`;
    if (isCloudflareLimitError(message)) state.durableObjectUnavailable = true;
    state.degradedReasons.push(`Short-lived stream unavailable. ${message}`);
    return null;
  }
  const payload = await response.json().catch(() => null) as
    | { quotes?: Record<string, DeribitTicker>; error?: string }
    | null;
  if (payload?.error) {
    if (isCloudflareLimitError(payload.error)) state.durableObjectUnavailable = true;
    state.degradedReasons.push(`Short-lived stream returned an error. ${payload.error}`);
  }
  for (const [instrument, quote] of Object.entries(payload?.quotes ?? {})) {
    if (quote?.instrument_name) state.shortLivedQuotes.set(instrument, quote);
  }
  return state.shortLivedQuotes.get(instrumentName) ?? null;
}

async function getBtcUsdcSpotPrice(
  env: Env,
  client: DeribitClient,
  config: Awaited<ReturnType<typeof getPricingConfig>>
): Promise<number | null> {
  try {
    return spotPriceFromTicker(await client.btcUsdcSpotTicker());
  } catch {
    if (config.marketDataMode === "hybrid_cache") {
      const streamed = await getDurableObjectTicker(env, "BTC_USDC");
      const spotPrice = spotPriceFromTicker(streamed?.quote);
      if (spotPrice) return spotPrice;
    }
    return null;
  }
}

async function getBtcUsdcSpotPriceForAdminSurface(
  client: DeribitClient,
  fallbackRows: QuoteFallbackRow[] = []
): Promise<number | null> {
  try {
    return spotPriceFromTicker(await client.btcUsdcSpotTicker());
  } catch {
    return latestFallbackSpotPrice(fallbackRows);
  }
}

async function getOrderBookForPricing(
  env: Env,
  client: DeribitClient,
  config: Awaited<ReturnType<typeof getPricingConfig>>,
  instrumentName: string,
  depth: number
): Promise<DeribitOrderBook> {
  try {
    return await client.getOrderBook(instrumentName, depth);
  } catch (error) {
    if (config.marketDataMode === "hybrid_cache") {
      const cached = await getDurableObjectOrderBook(env, instrumentName, depth, DEFAULT_DEPTH_CACHE_MAX_AGE_MS);
      if (cached?.book) return cached.book;
    }
    throw error;
  }
}

async function getBtcUsdcSpotMetadata(client: DeribitClient): Promise<
  | {
      spotPrice: number | null;
      spotInstrumentName: string | null;
      spotTickerTimestamp: number | null;
    }
  | undefined
> {
  try {
    const ticker = await client.btcUsdcSpotTicker();
    return {
      spotPrice: spotPriceFromTicker(ticker),
      spotInstrumentName: ticker.instrument_name ?? "BTC_USDC",
      spotTickerTimestamp: ticker.timestamp ?? null
    };
  } catch {
    return undefined;
  }
}

async function syncMarketData(
  env: Env,
  options: { force?: boolean } = {}
): Promise<{
  instruments: number;
  quotes: number;
  syncedAt: number;
  instrumentSyncSkipped: boolean;
  summarySyncSkipped: boolean;
}> {
  const client = new DeribitClient(env.DERIBIT_BASE_URL, env.DERIBIT_PROXY_TOKEN);
  const nowMs = Date.now();
  const syncStatus = await getMarketDataSyncStatus(env.DB);
  const shouldSyncInstruments =
    options.force ||
    syncStatus.lastInstrumentSyncAt === null ||
    nowMs - syncStatus.lastInstrumentSyncAt >= INSTRUMENT_SYNC_INTERVAL_MS;
  const shouldSyncSummaries =
    options.force ||
    syncStatus.lastSummarySyncAt === null ||
    nowMs - syncStatus.lastSummarySyncAt >= SUMMARY_SYNC_INTERVAL_MS;

  let instrumentCount = 0;
  let quoteCount = 0;
  if (shouldSyncInstruments) {
    const instruments = await client.getInstruments("BTC");
    instrumentCount = await upsertInstruments(env.DB, instruments, nowMs);
    await recordMarketDataSync(env.DB, { instrumentSyncedAt: nowMs }, nowMs);
  }
  if (shouldSyncSummaries) {
    if (shouldSyncInstruments) await sleep(250);
    const summaries = await client.getBookSummaryByCurrency("BTC");
    quoteCount = await upsertBookSummaries(env.DB, summaries, nowMs);
    await recordMarketDataSync(env.DB, { summarySyncedAt: nowMs }, nowMs);
  }
  return {
    instruments: instrumentCount,
    quotes: quoteCount,
    syncedAt: nowMs,
    instrumentSyncSkipped: !shouldSyncInstruments,
    summarySyncSkipped: !shouldSyncSummaries
  };
}

async function pricePppRequest(payload: PppPricingRequest, env: Env) {
  const startedAtMs = Date.now();
  const nowMs = startedAtMs;
  const config = await getPricingConfig(env.DB);
  const normalized = normalizePppPricingRequest(payload, config);
  let rows = await getPppOptionCandidates(env.DB, nowMs);

  if (rows.length === 0) {
    await syncMarketData(env, { force: true });
    rows = await getPppOptionCandidates(env.DB, nowMs);
  }

  const client = new DeribitClient(env.DERIBIT_BASE_URL, env.DERIBIT_PROXY_TOKEN);
  const marketData = createPricingMarketDataState();
  const spotPrice = await getBtcUsdcSpotPriceForPricing(env, client, marketData, rows);
  const totalExpiriesScanned = countPppScannedExpiries(rows, normalized.expirationTimestamp);
  const durationGuardrailDays = getPppDurationGuardrailDays(normalized.runwayDays);
  const buildDiagnostics = (partial: Partial<PppPricingDiagnostics> = {}): PppPricingDiagnostics => ({
    totalExpiriesScanned,
    totalRoughPackages: 0,
    shortlistedPackages: 0,
    livePricedPackages: 0,
    uniqueOrderBooksFetched: 0,
    depthCandidateCap: getPppDepthCandidateCount(normalized.selectorMode, config.maxDepthCandidates),
    durationGuardrailDays,
    inWindowPackages: 0,
    outOfWindowPackages: 0,
    durationFallbackUsed: false,
    pricingElapsedMs: Date.now() - startedAtMs,
    ...partial
  });

  if (!spotPrice) {
    return {
      generatedAt: nowMs,
      input: normalized,
      candidates: [],
      bestCandidate: null,
      recommendation: {
        reason: "BTC_USDC spot price was unavailable.",
        selectorMode: normalized.selectorMode,
        recommendedLever:
          normalized.selectorMode === "auto_protection"
            ? "protection"
            : normalized.selectorMode === "closest"
              ? "none"
              : "participation",
        priorityLever: normalized.priorityLever,
        runwayGapDays: null,
        protectionGapBps: null,
        participationGapBps: null,
        optimizedParticipationBps: null,
        optimizedProtectionBps: null
      },
      diagnostics: buildDiagnostics(),
      ...marketDataMetadata(marketData)
    };
  }

  const packages = buildPppMarketPackages(rows, spotPrice, normalized, nowMs);
  const depthCandidateCount = getPppDepthCandidateCount(normalized.selectorMode, config.maxDepthCandidates);
  const shortlisted = shortlistPppPackages(normalized, packages, nowMs, depthCandidateCount);
  const fallbackByInstrument = new Map<string, PppMarketLegInput>();
  for (const item of shortlisted) {
    fallbackByInstrument.set(item.marketPackage.atmCall.instrumentName, item.marketPackage.atmCall);
    fallbackByInstrument.set(item.marketPackage.atmPut.instrumentName, item.marketPackage.atmPut);
    fallbackByInstrument.set(item.marketPackage.floorPut.instrumentName, item.marketPackage.floorPut);
  }
  const shortLivedUniverse = normalizeInstruments(["BTC_USDC", ...fallbackByInstrument.keys()], 500);

  const priced = [];
  const bookCache = new Map<string, Promise<DeribitOrderBook>>();
  const getCachedOrderBook = (leg: PppMarketLegInput) => {
    const cached = bookCache.get(leg.instrumentName);
    if (cached) return cached;
    const next = getOrderBookForQuote(
      env,
      client,
      marketData,
      leg.instrumentName,
      normalized.orderBookDepth,
      leg,
      shortLivedUniverse
    );
    bookCache.set(leg.instrumentName, next);
    return next;
  };
  for (const item of shortlisted) {
    const [callBook, atmPutBook, floorPutBook] = await Promise.all([
      getCachedOrderBook(item.marketPackage.atmCall),
      getCachedOrderBook(item.marketPackage.atmPut),
      getCachedOrderBook(item.marketPackage.floorPut)
    ]);
    const marketPackage: PppMarketPackageInput = {
      expirationTimestamp: item.marketPackage.expirationTimestamp,
      spotPrice,
      candidateProtectionLevel: item.marketPackage.candidateProtectionLevel,
      candidateParticipationLevel: item.marketPackage.candidateParticipationLevel,
      atmCall: rowToPppMarketLeg(item.marketPackage.atmCall, callBook.bids, callBook.asks, callBook.timestamp),
      atmPut: rowToPppMarketLeg(item.marketPackage.atmPut, atmPutBook.bids, atmPutBook.asks, atmPutBook.timestamp),
      floorPut: rowToPppMarketLeg(item.marketPackage.floorPut, floorPutBook.bids, floorPutBook.asks, floorPutBook.timestamp)
    };
    priced.push(calculatePppCandidate(normalized, marketPackage));
  }

  const selected = selectPppCandidate(normalized, priced);
  const usesDurationGuardrail =
    normalized.selectorMode === "closest" ||
    (normalized.selectorMode === "auto_participation" && normalized.priorityLever === "protection") ||
    (normalized.selectorMode === "auto_protection" && normalized.priorityLever === "participation");
  const inWindowPackages = usesDurationGuardrail
    ? priced.filter((candidate) => Math.abs(candidate.dayCount - normalized.runwayDays) <= durationGuardrailDays).length
    : 0;
  const outOfWindowPackages = usesDurationGuardrail ? Math.max(0, priced.length - inWindowPackages) : 0;
  const hasEligibleInWindow =
    usesDurationGuardrail &&
    priced.some((candidate) => candidate.eligible && Math.abs(candidate.dayCount - normalized.runwayDays) <= durationGuardrailDays);
  const diagnostics = buildDiagnostics({
    totalRoughPackages: packages.length,
    shortlistedPackages: shortlisted.length,
    livePricedPackages: priced.length,
    uniqueOrderBooksFetched: bookCache.size,
    depthCandidateCap: depthCandidateCount,
    inWindowPackages,
    outOfWindowPackages,
    durationFallbackUsed: usesDurationGuardrail && !hasEligibleInWindow && selected.bestCandidate !== null
  });

  return {
    generatedAt: nowMs,
    input: normalized,
    candidates: selected.candidates,
    bestCandidate: selected.bestCandidate,
    recommendation: {
      reason: selected.reason,
      selectorMode: selected.selectorMode,
      recommendedLever: selected.recommendedLever,
      priorityLever: selected.priorityLever,
      runwayGapDays: selected.runwayGapDays,
      protectionGapBps: selected.protectionGapBps,
      participationGapBps: selected.participationGapBps,
      optimizedParticipationBps: selected.optimizedParticipationBps,
      optimizedProtectionBps: selected.optimizedProtectionBps
    },
    diagnostics,
    ...marketDataMetadata(marketData)
  };
}

async function pricePppOfferSurfaceRequest(payload: PppOfferSurfaceRequest, env: Env) {
  const startedAtMs = Date.now();
  const nowMs = startedAtMs;
  const config = await getPricingConfig(env.DB);
  const normalized = normalizePppOfferSurfaceRequest(payload, config);
  let rows = await getPppOptionCandidates(env.DB, nowMs);

  if (rows.length === 0) {
    await syncMarketData(env, { force: true });
    rows = await getPppOptionCandidates(env.DB, nowMs);
  }

  const client = new DeribitClient(env.DERIBIT_BASE_URL, env.DERIBIT_PROXY_TOKEN);
  const spotPrice = await getBtcUsdcSpotPriceForAdminSurface(client, rows);
  const totalExpiriesScanned = countPppScannedExpiries(rows);
  const emptyDiagnostics = {
    pricingMode: "d1_top_of_book" as const,
    depthValidation: "not_validated" as const,
    totalExpiriesScanned,
    totalRoughCells: 0,
    livePricedCells: 0,
    uniqueOrderBooksFetched: 0,
    pricingElapsedMs: Date.now() - startedAtMs,
    truncated: false,
    maxCells: normalized.maxCells
  };

  if (!spotPrice) {
    return buildPppOfferSurfaceResponse({
      nowMs,
      request: normalized,
      candidates: [],
      spotPrice: null,
      source: "d1_latest",
      diagnostics: emptyDiagnostics
    });
  }

  const roughPackages = buildPppOfferSurfaceMarketPackages(
    rows,
    spotPrice,
    {
      minDte: normalized.minDte,
      maxDte: normalized.maxDte,
      minProtectionBps: normalized.minProtectionBps,
      maxProtectionBps: normalized.maxProtectionBps
    },
    nowMs
  );
  const limitedPackages = limitPppOfferSurfacePackages(roughPackages, normalized.maxCells);
  const priced = [];

  for (const item of limitedPackages) {
    const marketPackage = withTopOfBookPppDepth(item);
    priced.push(
      calculatePppCandidate(
        {
          ...normalized,
          selectorMode: "auto_participation",
          priorityLever: "protection",
          protectionLevelBps: item.floorProtectionBps,
          expirationTimestamp: item.expirationTimestamp,
          nowMs
        },
        marketPackage
      )
    );
  }

  return buildPppOfferSurfaceResponse({
    nowMs,
    request: normalized,
    candidates: priced,
    spotPrice,
    source: "d1_latest",
    diagnostics: {
      totalExpiriesScanned,
      totalRoughCells: roughPackages.length,
      livePricedCells: priced.length,
      uniqueOrderBooksFetched: 0,
      pricingElapsedMs: Date.now() - startedAtMs,
      truncated: limitedPackages.length < roughPackages.length,
      maxCells: normalized.maxCells,
      pricingMode: "d1_top_of_book",
      depthValidation: "not_validated",
      guardrailReason: limitedPackages.length < roughPackages.length ? "max_cells" : undefined
    }
  });
}

function normalizePricingRequest(request: DcnPricingRequest, config: Awaited<ReturnType<typeof getPricingConfig>>): DcnPricingRequest {
  const productType = request.productType === "sell_call" ? "sell_call" : "sell_put";
  const selectorMode = normalizeSelectorMode(request.selectorMode);
  return {
    productType,
    investmentUsdt: Number(request.investmentUsdt ?? 500000),
    investmentBtc: Number(request.investmentBtc ?? 10),
    targetYieldBps: Number(request.targetYieldBps ?? 1000),
    runwayDays: Number(request.runwayDays ?? 92),
    strikePreference: request.strikePreference ?? "any",
    strikeBufferPct: normalizeStrikeBufferPct(request.strikeBufferPct, productType),
    selectorMode,
    priorityLever: normalizePriorityLever(request.priorityLever, selectorMode),
    sellPutPricingMethod: normalizeSellPutPricingMethod(request.sellPutPricingMethod ?? config.sellPutPricingMethod),
    firmMarginBps: Number(request.firmMarginBps ?? config.firmMarginBps),
    sellPutTargetFirmProfitBps: Number(
      request.sellPutTargetFirmProfitBps ?? config.sellPutTargetFirmProfitBps
    ),
    sellCallTargetFirmProfitBps: Number(
      request.sellCallTargetFirmProfitBps ?? config.sellCallTargetFirmProfitBps
    ),
    maxSlippageBps: Number(request.maxSlippageBps ?? config.maxSlippageBps),
    quoteFreshnessSeconds: Number(request.quoteFreshnessSeconds ?? config.quoteFreshnessSeconds),
    orderBookDepth: Number(request.orderBookDepth ?? config.defaultOrderBookDepth),
    scenarioExpiryPrice: request.scenarioExpiryPrice,
    scenarioDownsidePrice: request.scenarioDownsidePrice,
    scenarioUpsidePrice: request.scenarioUpsidePrice,
    nowMs: request.nowMs
  };
}

function normalizeSelectorMode(mode: DcnPricingRequest["selectorMode"]): DcnPricingRequest["selectorMode"] {
  return mode === "auto_yield" || mode === "auto_runway" || mode === "auto_strike" ? mode : "closest";
}

function normalizePriorityLever(
  priorityLever: DcnPricingRequest["priorityLever"],
  selectorMode: DcnPricingRequest["selectorMode"]
): DcnPricingRequest["priorityLever"] {
  if (selectorMode === "auto_yield") return priorityLever === "strike" ? "strike" : "runway";
  if (selectorMode === "auto_runway") return priorityLever === "strike" ? "strike" : "yield";
  if (selectorMode === "auto_strike") return priorityLever === "runway" ? "runway" : "yield";
  return undefined;
}

function normalizeSellPutPricingMethod(method: DcnPricingRequest["sellPutPricingMethod"]): DcnPricingRequest["sellPutPricingMethod"] {
  return method === "target_firm_profit" ? "target_firm_profit" : "firm_margin";
}

function normalizeStrikeBufferPct(
  value: DcnPricingRequest["strikeBufferPct"],
  productType: DcnPricingRequest["productType"]
): number | undefined {
  if (value === null || value === undefined) return undefined;
  const numeric = Number(value);
  const maxBufferPct = productType === "sell_call" ? 200 : 99;
  return Number.isFinite(numeric) ? Math.min(maxBufferPct, Math.max(0, numeric)) : undefined;
}

function rowToPppMarketLeg(
  row: PppMarketLegInput,
  bids: BidAskLevel[] = [],
  asks: BidAskLevel[] = [],
  bookTimestamp?: number
): PppMarketLegInput {
  return {
    ...row,
    deribitTimestamp: bookTimestamp ?? row.deribitTimestamp,
    bids,
    asks
  };
}

function rowToMarket(
  row: JoinedPutRow,
  bids: BidAskLevel[] = [],
  bookTimestamp?: number,
  spotPrice?: number | null
): PutMarketInput {
  return {
    instrumentName: row.instrument_name,
    optionType: row.option_type,
    strike: row.strike,
    expirationTimestamp: row.expiration_timestamp,
    minTradeAmount: row.min_trade_amount,
    contractSize: row.contract_size,
    underlyingPrice: spotPrice ?? row.underlying_price,
    bidPrice: row.bid_price,
    bidAmount: row.bid_amount,
    askPrice: row.ask_price,
    markPrice: row.mark_price,
    lastPrice: row.last_price,
    bidIv: row.bid_iv,
    askIv: row.ask_iv,
    markIv: row.mark_iv,
    openInterest: row.open_interest,
    deribitTimestamp: bookTimestamp ?? row.deribit_timestamp,
    ingestedAt: row.ingested_at,
    bids
  };
}

async function getDurableObjectStatus(env: Env): Promise<unknown> {
  const id = env.MARKET_DATA.idFromName("btc-options");
  const stub = env.MARKET_DATA.get(id);
  return stub.fetch("https://durable-object/status").then((response) => response.json()).catch(() => null);
}

async function getDurableObjectTicker(
  env: Env,
  instrumentName: string
): Promise<{ instrument: string | null; quote: DeribitTicker | null; receivedAt: number | null; ageMs: number | null } | null> {
  const id = env.MARKET_DATA.idFromName("btc-options");
  const stub = env.MARKET_DATA.get(id);
  return stub
    .fetch(`https://durable-object/quote?instrument=${encodeURIComponent(instrumentName)}`)
    .then((response) =>
      response.json().then(
        (data) =>
          data as {
            instrument: string | null;
            quote: DeribitTicker | null;
            receivedAt: number | null;
            ageMs: number | null;
          }
      )
    )
    .catch(() => null);
}

async function getDurableObjectQuote(env: Env, instrumentName: string): Promise<unknown> {
  return getDurableObjectTicker(env, instrumentName);
}

async function getDurableObjectOrderBook(
  env: Env,
  instrumentName: string,
  depth: number,
  maxAgeMs: number
): Promise<CachedOrderBookResult | null> {
  const id = env.MARKET_DATA.idFromName("btc-options");
  const stub = env.MARKET_DATA.get(id);
  const url = new URL("https://durable-object/order-book");
  url.searchParams.set("instrument", instrumentName);
  url.searchParams.set("depth", String(depth));
  url.searchParams.set("maxAgeMs", String(maxAgeMs));
  const response = await stub.fetch(url.toString()).catch(() => null);
  if (!response?.ok) return null;
  return response.json().then((data) => data as CachedOrderBookResult).catch(() => null);
}

function normalizeInstruments(instruments: Iterable<string | null | undefined>, max: number): string[] {
  return Array.from(new Set(Array.from(instruments).map((instrument) => instrument?.trim()).filter(Boolean) as string[])).slice(
    0,
    max
  );
}

function orderBookFromTicker(ticker: DeribitTicker): DeribitOrderBook | null {
  const bidPrice = finitePositiveOrUndefined(ticker.best_bid_price);
  const bidAmount = finitePositiveOrUndefined(ticker.best_bid_amount);
  const askPrice = finitePositiveOrUndefined(ticker.best_ask_price);
  const askAmount = finitePositiveOrUndefined(ticker.best_ask_amount);
  const bids: BidAskLevel[] = bidPrice && bidAmount ? [[bidPrice, bidAmount]] : [];
  const asks: BidAskLevel[] = askPrice && askAmount ? [[askPrice, askAmount]] : [];
  if (bids.length === 0 && asks.length === 0) return null;
  return {
    ...ticker,
    best_bid_price: bidPrice ?? ticker.best_bid_price ?? null,
    best_bid_amount: bidAmount ?? ticker.best_bid_amount ?? null,
    best_ask_price: askPrice ?? ticker.best_ask_price ?? null,
    best_ask_amount: askAmount ?? ticker.best_ask_amount ?? null,
    index_price: finitePositiveOrUndefined(ticker.index_price),
    min_price: finitePositiveOrUndefined(ticker.min_price),
    max_price: finitePositiveOrUndefined(ticker.max_price),
    bids,
    asks
  };
}

function orderBookFromFallback(fallback: QuoteFallbackRow, instrumentName: string): DeribitOrderBook {
  const bidPrice = fallbackNumber(fallback, "bid_price", "bidPrice");
  const bidAmount = fallbackNumber(fallback, "bid_amount", "bidAmount");
  const askPrice = fallbackNumber(fallback, "ask_price", "askPrice");
  const askAmount = fallbackNumber(fallback, "ask_amount", "askAmount");
  const bids: BidAskLevel[] = bidPrice && bidAmount ? [[bidPrice, bidAmount]] : [];
  const asks: BidAskLevel[] = askPrice && askAmount ? [[askPrice, askAmount]] : [];
  return {
    instrument_name: fallback.instrument_name ?? fallback.instrumentName ?? instrumentName,
    timestamp: fallbackNumber(fallback, "deribit_timestamp", "deribitTimestamp") ?? fallbackNumber(fallback, "ingested_at", "ingestedAt") ?? 0,
    best_bid_price: bidPrice,
    best_bid_amount: bidAmount,
    best_ask_price: askPrice,
    best_ask_amount: askAmount,
    mark_price: fallbackNumber(fallback, "mark_price", "markPrice"),
    last_price: fallbackNumber(fallback, "last_price", "lastPrice"),
    open_interest: fallbackNumber(fallback, "open_interest", "openInterest"),
    underlying_price: fallbackNumber(fallback, "underlying_price", "underlyingPrice"),
    underlying_index: fallback.underlying_index ?? fallback.underlyingIndex ?? undefined,
    interest_rate: fallbackNumber(fallback, "interest_rate", "interestRate"),
    bids,
    asks
  };
}

function latestFallbackSpotPrice(rows: QuoteFallbackRow[]): number | null {
  const candidates = rows
    .map((row) => ({
      price: fallbackNumber(row, "underlying_price", "underlyingPrice"),
      timestamp: fallbackNumber(row, "deribit_timestamp", "deribitTimestamp") ?? fallbackNumber(row, "ingested_at", "ingestedAt") ?? 0
    }))
    .filter((item): item is { price: number; timestamp: number } => isPositiveFinite(item.price));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.timestamp - a.timestamp)[0].price;
}

function fallbackNumber<TSnake extends keyof QuoteFallbackRow, TCamel extends keyof QuoteFallbackRow>(
  row: QuoteFallbackRow,
  snakeKey: TSnake,
  camelKey: TCamel
): number | null {
  const value = row[snakeKey] ?? row[camelKey];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finitePositiveOrUndefined(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown market data error");
}

function isCloudflareLimitError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("1027") ||
    normalized.includes("daily request") ||
    normalized.includes("free tier") ||
    normalized.includes("durable object") && normalized.includes("limit")
  );
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.BACKEND_API_TOKEN) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${env.BACKEND_API_TOKEN}`;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeDepth(value: number): number {
  const allowed = [1, 5, 10, 20, 50, 100, 1000, 10000];
  if (!Number.isFinite(value)) return 100;
  return allowed.includes(value) ? value : 100;
}

function maxNumber(values: number[]): number | null {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  return finiteValues.length === 0 ? null : Math.max(...finiteValues);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberFromUnknown(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalNonNegativeParam(url: URL, names: string[]): number | undefined | null {
  for (const name of names) {
    const raw = url.searchParams.get(name);
    if (raw === null || raw === "") continue;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  return undefined;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export const __test__ = {
  createPricingMarketDataState,
  isCloudflareLimitError,
  marketDataMetadata,
  markMarketDataSource,
  normalizeInstruments,
  orderBookFromFallback
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
