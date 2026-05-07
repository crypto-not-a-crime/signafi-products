import type { DeribitBookSummary, DeribitInstrument, DeribitOrderBook, DeribitTicker } from "./deribit";
import type { YieldSurfaceOptionType, YieldSurfaceSourceRow } from "./pricing/yield-surface";

export interface PricingConfig {
  firmMarginBps: number;
  sellCallTargetFirmProfitBps: number;
  quoteFreshnessSeconds: number;
  defaultOrderBookDepth: number;
  maxDepthCandidates: number;
  maxSlippageBps: number;
}

export interface JoinedPutRow {
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

export async function upsertInstruments(db: D1Database, instruments: DeribitInstrument[], nowMs: number): Promise<number> {
  const activeOptions = instruments.filter(
    (item) => item.kind === "option" && item.option_type && item.strike && item.expiration_timestamp
  );
  if (activeOptions.length === 0) return 0;

  const stmt = db.prepare(
    `INSERT INTO option_instruments (
      instrument_name, instrument_id, base_currency, quote_currency, settlement_currency,
      option_type, strike, expiration_timestamp, creation_timestamp, contract_size,
      min_trade_amount, tick_size, state, is_active, raw_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instrument_name) DO UPDATE SET
      instrument_id = excluded.instrument_id,
      base_currency = excluded.base_currency,
      quote_currency = excluded.quote_currency,
      settlement_currency = excluded.settlement_currency,
      option_type = excluded.option_type,
      strike = excluded.strike,
      expiration_timestamp = excluded.expiration_timestamp,
      creation_timestamp = excluded.creation_timestamp,
      contract_size = excluded.contract_size,
      min_trade_amount = excluded.min_trade_amount,
      tick_size = excluded.tick_size,
      state = excluded.state,
      is_active = excluded.is_active,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at`
  );

  await runInChunks(
    db,
    activeOptions.map((item) =>
      stmt.bind(
        item.instrument_name,
        item.instrument_id ?? null,
        item.base_currency,
        item.quote_currency,
        item.settlement_currency ?? null,
        item.option_type,
        item.strike,
        item.expiration_timestamp,
        item.creation_timestamp ?? null,
        item.contract_size ?? 1,
        item.min_trade_amount ?? 0.1,
        item.tick_size ?? null,
        item.state ?? null,
        item.is_active === false ? 0 : 1,
        JSON.stringify(item),
        nowMs
      )
    ),
    100
  );
  return activeOptions.length;
}

export async function upsertBookSummaries(db: D1Database, summaries: DeribitBookSummary[], nowMs: number): Promise<number> {
  if (summaries.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT INTO option_quotes_latest (
      instrument_name, bid_price, ask_price, mid_price, mark_price, last_price,
      mark_iv, open_interest, volume, underlying_price, underlying_index,
      interest_rate, deribit_timestamp, ingested_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instrument_name) DO UPDATE SET
      bid_price = excluded.bid_price,
      ask_price = excluded.ask_price,
      mid_price = excluded.mid_price,
      mark_price = excluded.mark_price,
      last_price = excluded.last_price,
      mark_iv = excluded.mark_iv,
      open_interest = excluded.open_interest,
      volume = excluded.volume,
      underlying_price = excluded.underlying_price,
      underlying_index = excluded.underlying_index,
      interest_rate = excluded.interest_rate,
      deribit_timestamp = excluded.deribit_timestamp,
      ingested_at = excluded.ingested_at,
      raw_json = excluded.raw_json`
  );

  await runInChunks(
    db,
    summaries.map((item) =>
      stmt.bind(
        item.instrument_name,
        item.bid_price ?? null,
        item.ask_price ?? null,
        item.mid_price ?? null,
        item.mark_price ?? null,
        item.last ?? null,
        item.mark_iv ?? null,
        item.open_interest ?? null,
        item.volume ?? null,
        item.underlying_price ?? null,
        item.underlying_index ?? null,
        item.interest_rate ?? null,
        item.creation_timestamp ?? nowMs,
        nowMs,
        JSON.stringify(item)
      )
    ),
    100
  );
  return summaries.length;
}

export async function upsertTicker(db: D1Database, ticker: DeribitTicker, nowMs: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO option_quotes_latest (
        instrument_name, bid_price, bid_amount, ask_price, ask_amount, mark_price,
        last_price, bid_iv, ask_iv, mark_iv, delta, gamma, theta, vega, rho,
        open_interest, underlying_price, underlying_index, interest_rate, state,
        deribit_timestamp, ingested_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(instrument_name) DO UPDATE SET
        bid_price = excluded.bid_price,
        bid_amount = excluded.bid_amount,
        ask_price = excluded.ask_price,
        ask_amount = excluded.ask_amount,
        mark_price = excluded.mark_price,
        last_price = excluded.last_price,
        bid_iv = excluded.bid_iv,
        ask_iv = excluded.ask_iv,
        mark_iv = excluded.mark_iv,
        delta = excluded.delta,
        gamma = excluded.gamma,
        theta = excluded.theta,
        vega = excluded.vega,
        rho = excluded.rho,
        open_interest = excluded.open_interest,
        underlying_price = excluded.underlying_price,
        underlying_index = excluded.underlying_index,
        interest_rate = excluded.interest_rate,
        state = excluded.state,
        deribit_timestamp = excluded.deribit_timestamp,
        ingested_at = excluded.ingested_at,
        raw_json = excluded.raw_json`
    )
    .bind(
      ticker.instrument_name,
      ticker.best_bid_price ?? null,
      ticker.best_bid_amount ?? null,
      ticker.best_ask_price ?? null,
      ticker.best_ask_amount ?? null,
      ticker.mark_price ?? null,
      ticker.last_price ?? null,
      ticker.bid_iv ?? null,
      ticker.ask_iv ?? null,
      ticker.mark_iv ?? null,
      ticker.greeks?.delta ?? null,
      ticker.greeks?.gamma ?? null,
      ticker.greeks?.theta ?? null,
      ticker.greeks?.vega ?? null,
      ticker.greeks?.rho ?? null,
      ticker.open_interest ?? null,
      ticker.underlying_price ?? null,
      ticker.underlying_index ?? null,
      ticker.interest_rate ?? null,
      ticker.state ?? null,
      ticker.timestamp ?? nowMs,
      nowMs,
      JSON.stringify(ticker)
    )
    .run();
}

export async function insertOrderBookSnapshot(
  db: D1Database,
  book: DeribitOrderBook,
  depth: number,
  source: string,
  nowMs: number
): Promise<number | null> {
  const result = await db
    .prepare(
      `INSERT INTO order_book_snapshots (
        instrument_name, depth, source, bids_json, asks_json, best_bid_price,
        best_bid_amount, best_ask_price, best_ask_amount, change_id,
        deribit_timestamp, ingested_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      book.instrument_name,
      depth,
      source,
      JSON.stringify(book.bids ?? []),
      JSON.stringify(book.asks ?? []),
      book.best_bid_price ?? null,
      book.best_bid_amount ?? null,
      book.best_ask_price ?? null,
      book.best_ask_amount ?? null,
      book.change_id ?? null,
      book.timestamp ?? nowMs,
      nowMs,
      JSON.stringify(book)
    )
    .run();
  return Number(result.meta.last_row_id ?? null);
}

export async function getPricingConfig(db: D1Database): Promise<PricingConfig> {
  const rows = await db.prepare("SELECT key, value FROM pricing_config").all<{ key: string; value: string }>();
  const map = new Map(rows.results.map((row) => [row.key, row.value]));
  return {
    firmMarginBps: Number(map.get("firm_margin_bps") ?? 200),
    sellCallTargetFirmProfitBps: Number(map.get("sell_call_target_firm_profit_bps") ?? 500),
    quoteFreshnessSeconds: Number(map.get("quote_freshness_seconds") ?? 10),
    defaultOrderBookDepth: Number(map.get("default_order_book_depth") ?? 100),
    maxDepthCandidates: Number(map.get("max_depth_candidates") ?? 12),
    maxSlippageBps: Number(map.get("max_slippage_bps") ?? 500)
  };
}

export async function updatePricingConfig(
  db: D1Database,
  updates: Partial<Pick<PricingConfig, "firmMarginBps" | "sellCallTargetFirmProfitBps">>,
  nowMs: number
): Promise<PricingConfig> {
  const statements: D1PreparedStatement[] = [];

  if (typeof updates.firmMarginBps === "number") {
    statements.push(upsertPricingConfigStatement(db, "firm_margin_bps", String(updates.firmMarginBps), nowMs));
  }
  if (typeof updates.sellCallTargetFirmProfitBps === "number") {
    statements.push(
      upsertPricingConfigStatement(
        db,
        "sell_call_target_firm_profit_bps",
        String(updates.sellCallTargetFirmProfitBps),
        nowMs
      )
    );
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return getPricingConfig(db);
}

export async function getPutCandidates(db: D1Database, nowMs: number): Promise<JoinedPutRow[]> {
  const result = await db
    .prepare(
      `SELECT
        i.instrument_name,
        i.option_type,
        i.strike,
        i.expiration_timestamp,
        i.min_trade_amount,
        i.contract_size,
        q.bid_price,
        q.bid_amount,
        q.ask_price,
        q.ask_amount,
        q.mark_price,
        q.last_price,
        q.bid_iv,
        q.ask_iv,
        q.mark_iv,
        q.open_interest,
        q.underlying_price,
        q.underlying_index,
        q.interest_rate,
        q.deribit_timestamp,
        q.ingested_at
      FROM option_instruments i
      JOIN option_quotes_latest q ON q.instrument_name = i.instrument_name
      WHERE i.option_type = 'put'
        AND i.is_active = 1
        AND i.expiration_timestamp > ?
        AND q.bid_price IS NOT NULL
        AND q.bid_price > 0`
    )
    .bind(nowMs)
    .all<JoinedPutRow>();
  return result.results;
}

export async function getCallCandidates(db: D1Database, nowMs: number): Promise<JoinedPutRow[]> {
  const result = await db
    .prepare(
      `SELECT
        i.instrument_name,
        i.option_type,
        i.strike,
        i.expiration_timestamp,
        i.min_trade_amount,
        i.contract_size,
        q.bid_price,
        q.bid_amount,
        q.ask_price,
        q.ask_amount,
        q.mark_price,
        q.last_price,
        q.bid_iv,
        q.ask_iv,
        q.mark_iv,
        q.open_interest,
        q.underlying_price,
        q.underlying_index,
        q.interest_rate,
        q.deribit_timestamp,
        q.ingested_at
      FROM option_instruments i
      JOIN option_quotes_latest q ON q.instrument_name = i.instrument_name
      WHERE i.option_type = 'call'
        AND i.is_active = 1
        AND i.expiration_timestamp > ?
        AND q.bid_price IS NOT NULL
        AND q.bid_price > 0`
    )
    .bind(nowMs)
    .all<JoinedPutRow>();
  return result.results;
}

export async function getInstrumentQuote(db: D1Database, instrumentName: string): Promise<JoinedPutRow | null> {
  const row = await db
    .prepare(
      `SELECT
        i.instrument_name,
        i.option_type,
        i.strike,
        i.expiration_timestamp,
        i.min_trade_amount,
        i.contract_size,
        q.bid_price,
        q.bid_amount,
        q.ask_price,
        q.ask_amount,
        q.mark_price,
        q.last_price,
        q.bid_iv,
        q.ask_iv,
        q.mark_iv,
        q.open_interest,
        q.underlying_price,
        q.underlying_index,
        q.interest_rate,
        q.deribit_timestamp,
        q.ingested_at
      FROM option_instruments i
      LEFT JOIN option_quotes_latest q ON q.instrument_name = i.instrument_name
      WHERE i.instrument_name = ?`
    )
    .bind(instrumentName)
    .first<JoinedPutRow>();
  return row ?? null;
}

export async function getYieldSurfaceRows(
  db: D1Database,
  optionType: YieldSurfaceOptionType,
  nowMs: number,
  limit: number
): Promise<YieldSurfaceSourceRow[]> {
  const result = await db
    .prepare(
      `SELECT
        i.instrument_name,
        i.base_currency,
        i.option_type,
        i.strike,
        i.expiration_timestamp,
        q.bid_price,
        q.bid_amount,
        q.ask_price,
        q.ask_amount,
        q.mark_price,
        q.last_price,
        q.mark_iv,
        q.open_interest,
        q.underlying_price,
        q.deribit_timestamp,
        q.ingested_at
      FROM option_instruments i
      JOIN option_quotes_latest q ON q.instrument_name = i.instrument_name
      WHERE i.base_currency = 'BTC'
        AND i.option_type = ?
        AND i.is_active = 1
        AND i.expiration_timestamp > ?
        AND q.bid_price IS NOT NULL
        AND q.bid_price > 0
      ORDER BY i.expiration_timestamp ASC, i.strike ASC
      LIMIT ?`
    )
    .bind(optionType, nowMs, limit)
    .all<YieldSurfaceSourceRow>();
  return result.results;
}

export async function insertAudit(
  db: D1Database,
  request: unknown,
  instrumentName: string | null,
  snapshotId: number | null,
  calculation: unknown,
  checks: unknown,
  nowMs: number
): Promise<number | null> {
  const result = await db
    .prepare(
      `INSERT INTO dcn_quote_audit (
        created_at, request_json, instrument_name, order_book_snapshot_id, calculation_json, pass_fail_json
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(nowMs, JSON.stringify(request), instrumentName, snapshotId, JSON.stringify(calculation), JSON.stringify(checks))
    .run();
  return Number(result.meta.last_row_id ?? null);
}

function upsertPricingConfigStatement(db: D1Database, key: string, value: string, nowMs: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO pricing_config(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at`
    )
    .bind(key, value, nowMs);
}

async function runInChunks(db: D1Database, statements: D1PreparedStatement[], chunkSize: number): Promise<void> {
  for (let index = 0; index < statements.length; index += chunkSize) {
    await db.batch(statements.slice(index, index + chunkSize));
  }
}
