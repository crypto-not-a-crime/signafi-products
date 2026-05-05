CREATE TABLE IF NOT EXISTS option_instruments (
  instrument_name TEXT PRIMARY KEY,
  instrument_id INTEGER,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  settlement_currency TEXT,
  option_type TEXT NOT NULL CHECK (option_type IN ('call', 'put')),
  strike REAL NOT NULL,
  expiration_timestamp INTEGER NOT NULL,
  creation_timestamp INTEGER,
  contract_size REAL DEFAULT 1,
  min_trade_amount REAL DEFAULT 0.1,
  tick_size REAL,
  state TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  raw_json TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_option_instruments_lookup
  ON option_instruments(option_type, expiration_timestamp, strike);

CREATE TABLE IF NOT EXISTS option_quotes_latest (
  instrument_name TEXT PRIMARY KEY,
  bid_price REAL,
  bid_amount REAL,
  ask_price REAL,
  ask_amount REAL,
  mid_price REAL,
  mark_price REAL,
  last_price REAL,
  bid_iv REAL,
  ask_iv REAL,
  mark_iv REAL,
  delta REAL,
  gamma REAL,
  theta REAL,
  vega REAL,
  rho REAL,
  open_interest REAL,
  volume REAL,
  underlying_price REAL,
  underlying_index TEXT,
  interest_rate REAL,
  state TEXT,
  deribit_timestamp INTEGER,
  ingested_at INTEGER NOT NULL,
  raw_json TEXT,
  FOREIGN KEY (instrument_name) REFERENCES option_instruments(instrument_name)
);

CREATE INDEX IF NOT EXISTS idx_option_quotes_ingested
  ON option_quotes_latest(ingested_at);

CREATE TABLE IF NOT EXISTS order_book_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_name TEXT NOT NULL,
  depth INTEGER NOT NULL,
  source TEXT NOT NULL,
  bids_json TEXT NOT NULL,
  asks_json TEXT NOT NULL,
  best_bid_price REAL,
  best_bid_amount REAL,
  best_ask_price REAL,
  best_ask_amount REAL,
  change_id INTEGER,
  deribit_timestamp INTEGER,
  ingested_at INTEGER NOT NULL,
  raw_json TEXT,
  FOREIGN KEY (instrument_name) REFERENCES option_instruments(instrument_name)
);

CREATE INDEX IF NOT EXISTS idx_order_book_snapshots_instrument_time
  ON order_book_snapshots(instrument_name, ingested_at DESC);

CREATE TABLE IF NOT EXISTS pricing_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO pricing_config(key, value, updated_at)
VALUES
  ('firm_margin_bps', '200', unixepoch() * 1000),
  ('quote_freshness_seconds', '10', unixepoch() * 1000),
  ('default_order_book_depth', '100', unixepoch() * 1000),
  ('max_depth_candidates', '25', unixepoch() * 1000),
  ('max_slippage_bps', '500', unixepoch() * 1000);

CREATE TABLE IF NOT EXISTS dcn_quote_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  request_json TEXT NOT NULL,
  instrument_name TEXT,
  order_book_snapshot_id INTEGER,
  calculation_json TEXT NOT NULL,
  pass_fail_json TEXT NOT NULL,
  FOREIGN KEY (instrument_name) REFERENCES option_instruments(instrument_name),
  FOREIGN KEY (order_book_snapshot_id) REFERENCES order_book_snapshots(id)
);
