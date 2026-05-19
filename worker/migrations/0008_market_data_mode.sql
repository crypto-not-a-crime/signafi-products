INSERT OR IGNORE INTO pricing_config(key, value, updated_at)
VALUES
  ('market_data_mode', 'legacy_rest', unixepoch() * 1000),
  ('last_instrument_sync_at', '0', unixepoch() * 1000),
  ('last_summary_sync_at', '0', unixepoch() * 1000);
