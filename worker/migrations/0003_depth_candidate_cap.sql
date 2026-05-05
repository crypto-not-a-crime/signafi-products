UPDATE pricing_config
SET value = '12',
    updated_at = unixepoch() * 1000
WHERE key = 'max_depth_candidates'
  AND CAST(value AS INTEGER) > 12;
