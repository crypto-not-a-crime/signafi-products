import {
  getInstrumentQuote,
  getPricingConfig,
  getPutCandidates,
  type JoinedPutRow,
  insertAudit,
  insertOrderBookSnapshot,
  upsertBookSummaries,
  upsertInstruments,
  upsertTicker
} from "./db";
import { DeribitClient, spotPriceFromTicker, type DeribitTicker } from "./deribit";
import {
  calculateDcnSellPut,
  priceCandidateAtSize,
  scorePutCandidate,
  selectDcnCandidate,
  type BidAskLevel,
  type DcnPricingRequest,
  type PutMarketInput
} from "./pricing/dcn";

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
  ["GET", /^\/api\/admin\/market-health$/, handleMarketHealth, true],
  ["POST", /^\/api\/admin\/dcn-audit$/, handleDcnAudit, true],
  ["POST", /^\/api\/admin\/verify-quote$/, handleVerifyQuote, true],
  ["POST", /^\/api\/admin\/deribit-margins$/, handleDeribitMargins, true],
  ["POST", /^\/api\/admin\/sync-market-data$/, handleSyncMarketData, true],
  ["GET", /^\/api\/admin\/stream-status$/, handleStreamStatus, true],
  ["POST", /^\/api\/admin\/stream-start$/, handleStreamStart, true]
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
    ctx.waitUntil(syncMarketData(env).then(() => ensurePricingStream(env)));
  }
};

export class MarketDataDurableObject {
  private ws: WebSocket | null = null;
  private quotes = new Map<string, DeribitTicker>();
  private lastConnectAt = 0;
  private subscribed: string[] = [];

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/status")) {
      return json({
        connected: this.ws?.readyState === WebSocket.OPEN,
        lastConnectAt: this.lastConnectAt,
        subscribed: this.subscribed,
        memoryQuoteCount: this.quotes.size
      });
    }

    if (url.pathname.endsWith("/quote")) {
      const instrument = url.searchParams.get("instrument");
      return json({
        instrument,
        quote: instrument ? this.quotes.get(instrument) ?? null : null
      });
    }

    if (url.pathname.endsWith("/start")) {
      const payload = await request.json().catch(() => ({})) as { instruments?: string[] };
      await this.start(payload.instruments ?? []);
      return json({ started: true, subscribed: this.subscribed });
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

  private subscribe(instruments: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || instruments.length === 0) return;
    for (let index = 0; index < instruments.length; index += 500) {
      const batch = instruments.slice(index, index + 500);
      this.ws.send(
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

  private async onMessage(message: string): Promise<void> {
    const payload = JSON.parse(message) as { method?: string; params?: { data?: DeribitTicker } };
    const data = payload.params?.data;
    if (!data?.instrument_name) return;
    this.quotes.set(data.instrument_name, data);
    await upsertTicker(this.env.DB, data, Date.now());
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

async function handleSellPutPrice(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<DcnPricingRequest>();
  const nowMs = Date.now();
  const config = await getPricingConfig(env.DB);
  const normalized = normalizePricingRequest(payload, config);
  let candidates = await getPutCandidates(env.DB, nowMs);

  if (candidates.length === 0) {
    await syncMarketData(env);
    candidates = await getPutCandidates(env.DB, nowMs);
  }

  const client = new DeribitClient(env.DERIBIT_BASE_URL, env.DERIBIT_PROXY_TOKEN);
  const spotPrice = await getBtcUsdcSpotPrice(client);
  const depthCandidateCount = Math.min(Math.max(config.maxDepthCandidates, 6), 12);
  const shortlisted = candidates
    .map((row) => ({ row, score: scorePutCandidate(normalized, rowToMarket(row, [], undefined, spotPrice)) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, depthCandidateCount);

  const priced = [];

  for (const item of shortlisted) {
    const book = await client.getOrderBook(item.row.instrument_name, normalized.orderBookDepth ?? config.defaultOrderBookDepth);
    const calculation = priceCandidateAtSize(normalized, rowToMarket(item.row, book.bids, book.timestamp, spotPrice));
    priced.push({ score: item.score, snapshotId: null, ...calculation });
  }

  const selected = selectDcnCandidate(normalized, priced);

  return json({
    generatedAt: nowMs,
    input: normalized,
    candidates: selected.candidates,
    bestCandidate: selected.bestCandidate,
    recommendation: selected.recommendation
  });
}

async function handleDcnAudit(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<DcnPricingRequest & { instrumentName?: string }>();
  if (!payload.instrumentName) return json({ error: "instrumentName is required" }, 400);

  const config = await getPricingConfig(env.DB);
  const normalized = normalizePricingRequest(payload, config);
  const stored = await getInstrumentQuote(env.DB, payload.instrumentName);
  if (!stored) return json({ error: "Instrument not found in D1" }, 404);

  const client = new DeribitClient(env.DERIBIT_BASE_URL, env.DERIBIT_PROXY_TOKEN);
  const [book, spotPrice] = await Promise.all([
    client.getOrderBook(payload.instrumentName, normalized.orderBookDepth ?? config.defaultOrderBookDepth),
    getBtcUsdcSpotPrice(client)
  ]);
  const snapshotId = await insertOrderBookSnapshot(
    env.DB,
    book,
    normalized.orderBookDepth ?? config.defaultOrderBookDepth,
    "admin-audit",
    Date.now()
  );
  const calculation = calculateDcnSellPut(normalized, rowToMarket(stored, book.bids, book.timestamp, spotPrice));
  const auditId = await insertAudit(env.DB, payload, payload.instrumentName, snapshotId, calculation, calculation.checks, Date.now());

  return json({ auditId, snapshotId, calculation });
}

async function handleVerifyQuote(request: Request, env: Env): Promise<Response> {
  const payload = await request.json<{ instrumentName?: string; depth?: number }>();
  if (!payload.instrumentName) return json({ error: "instrumentName is required" }, 400);

  const stored = await getInstrumentQuote(env.DB, payload.instrumentName);
  const client = new DeribitClient(env.DERIBIT_BASE_URL, env.DERIBIT_PROXY_TOKEN);
  const [ticker, book, memory] = await Promise.all([
    client.ticker(payload.instrumentName),
    client.getOrderBook(payload.instrumentName, payload.depth ?? 100),
    getDurableObjectQuote(env, payload.instrumentName)
  ]);

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
      storedFresh: stored?.ingested_at ? (nowMs - stored.ingested_at) / 1000 <= 10 : false,
      bidDriftUnder10Bps: bidDriftPct !== null ? bidDriftPct <= 0.001 : false,
      depthAvailable: (book.bids ?? []).length > 0
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

async function handleMarketHealth(_request: Request, env: Env): Promise<Response> {
  const nowMs = Date.now();
  const summaryFreshnessSeconds = 180;
  const liveFreshnessSeconds = 10;
  const [instrumentStats, quoteStats, summaryStaleStats, liveTickerStats, latestAudit, streamStatus] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM option_instruments WHERE is_active = 1").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count, MAX(ingested_at) AS latest FROM option_quotes_latest").first<{
      count: number;
      latest: number;
    }>(),
    env.DB
      .prepare("SELECT COUNT(*) AS count FROM option_quotes_latest WHERE ingested_at < ?")
      .bind(nowMs - summaryFreshnessSeconds * 1000)
      .first<{ count: number }>(),
    env.DB
      .prepare("SELECT COUNT(*) AS count FROM option_quotes_latest WHERE ingested_at >= ?")
      .bind(nowMs - liveFreshnessSeconds * 1000)
      .first<{ count: number }>(),
    env.DB.prepare("SELECT MAX(created_at) AS latest FROM dcn_quote_audit").first<{ latest: number | null }>(),
    getDurableObjectStatus(env)
  ]);
  const latestQuoteAt = quoteStats?.latest ?? null;

  return json({
    nowMs,
    activeInstrumentCount: instrumentStats?.count ?? 0,
    quoteCount: quoteStats?.count ?? 0,
    latestQuoteAt,
    latestSyncAt: latestQuoteAt,
    catalogSyncAgeSeconds: latestQuoteAt === null ? null : Math.max(0, (nowMs - latestQuoteAt) / 1000),
    summaryFreshnessSeconds,
    summaryStaleCount: summaryStaleStats?.count ?? 0,
    liveFreshnessSeconds,
    liveTickerFreshCount: liveTickerStats?.count ?? 0,
    staleQuoteCount: summaryStaleStats?.count ?? 0,
    latestAuditAt: latestAudit?.latest ?? null,
    streamStatus,
    d1FreeTierGuard: {
      quotePersistence: "deduped/throttled in Worker design",
      depthStorage: "only admin/pricing snapshots",
      rowsWrittenDailyLimit: 100000
    }
  });
}

async function handleSyncMarketData(_request: Request, env: Env): Promise<Response> {
  const result = await syncMarketData(env);
  const stream = await ensurePricingStream(env);
  return json({ ...result, stream });
}

async function handleStreamStatus(_request: Request, env: Env): Promise<Response> {
  return json(await getDurableObjectStatus(env));
}

async function handleStreamStart(_request: Request, env: Env): Promise<Response> {
  return json(await ensurePricingStream(env));
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

async function getPricingStreamInstruments(env: Env): Promise<string[]> {
  const nowMs = Date.now();
  const rows = await getPutCandidates(env.DB, nowMs);
  return rows
    .filter((row) => row.underlying_price && row.strike < row.underlying_price && row.strike > row.underlying_price * 0.75)
    .sort((a, b) => {
      const aSpot = a.underlying_price ?? 1;
      const bSpot = b.underlying_price ?? 1;
      const aMoneynessGap = Math.abs(a.strike / aSpot - 0.9);
      const bMoneynessGap = Math.abs(b.strike / bSpot - 0.9);
      if (aMoneynessGap !== bMoneynessGap) return aMoneynessGap - bMoneynessGap;
      return a.expiration_timestamp - b.expiration_timestamp;
    })
    .slice(0, 500)
    .map((row) => row.instrument_name);
}

async function getBtcUsdcSpotPrice(client: DeribitClient): Promise<number | null> {
  try {
    return spotPriceFromTicker(await client.btcUsdcSpotTicker());
  } catch {
    return null;
  }
}

async function syncMarketData(env: Env): Promise<{ instruments: number; quotes: number; syncedAt: number }> {
  const client = new DeribitClient(env.DERIBIT_BASE_URL, env.DERIBIT_PROXY_TOKEN);
  const nowMs = Date.now();
  const instruments = await client.getInstruments("BTC");
  await sleep(250);
  const summaries = await client.getBookSummaryByCurrency("BTC");
  const instrumentCount = await upsertInstruments(env.DB, instruments, nowMs);
  const quoteCount = await upsertBookSummaries(env.DB, summaries, nowMs);
  return { instruments: instrumentCount, quotes: quoteCount, syncedAt: nowMs };
}

function normalizePricingRequest(request: DcnPricingRequest, config: Awaited<ReturnType<typeof getPricingConfig>>): DcnPricingRequest {
  return {
    investmentUsdt: Number(request.investmentUsdt || 500000),
    targetYieldBps: Number(request.targetYieldBps ?? 1000),
    runwayDays: Number(request.runwayDays ?? 92),
    strikePreference: request.strikePreference ?? "any",
    selectorMode: normalizeSelectorMode(request.selectorMode),
    firmMarginBps: Number(request.firmMarginBps ?? config.firmMarginBps),
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

function rowToMarket(
  row: JoinedPutRow,
  bids: BidAskLevel[] = [],
  bookTimestamp?: number,
  spotPrice?: number | null
): PutMarketInput {
  return {
    instrumentName: row.instrument_name,
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

async function getDurableObjectQuote(env: Env, instrumentName: string): Promise<unknown> {
  const id = env.MARKET_DATA.idFromName("btc-options");
  const stub = env.MARKET_DATA.get(id);
  return stub
    .fetch(`https://durable-object/quote?instrument=${encodeURIComponent(instrumentName)}`)
    .then((response) => response.json())
    .catch(() => null);
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.BACKEND_API_TOKEN) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${env.BACKEND_API_TOKEN}`;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
