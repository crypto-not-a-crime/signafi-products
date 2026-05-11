INSERT OR IGNORE INTO pricing_config(key, value, updated_at)
VALUES
  ('sell_put_pricing_method', 'firm_margin', unixepoch() * 1000),
  ('sell_put_target_firm_profit_bps', '500', unixepoch() * 1000);
