INSERT OR IGNORE INTO pricing_config(key, value, updated_at)
VALUES ('ppp_include_delivery_fees', '1', unixepoch() * 1000);
