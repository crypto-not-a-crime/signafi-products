import { describe, expect, it } from "vitest";
import { buildYieldSurface, type YieldSurfaceSourceRow } from "../src/pricing/yield-surface";

const NOW = Date.UTC(2026, 4, 7);
const EXPIRY_31_JUL_2026 = Date.UTC(2026, 6, 31, 8, 0);

describe("annualized yield surface", () => {
  it("uses UTC DTE and annualizes the option bid premium", () => {
    const surface = buildYieldSurface(
      [
        row({
          instrument_name: "BTC-31JUL26-73000-P",
          strike: 73000,
          expiration_timestamp: EXPIRY_31_JUL_2026,
          bid_price: 0.035
        })
      ],
      { nowMs: NOW, optionType: "put" }
    );

    expect(surface.points).toHaveLength(1);
    expect(surface.points[0].daysToExpiry).toBe(85);
    expect(surface.points[0].annualizedYield).toBeCloseTo((0.035 / 85) * 365, 12);
  });

  it("includes a future same-day expiry with a one-day yield denominator", () => {
    const sameDayFutureExpiry = Date.UTC(2026, 4, 7, 8, 0);
    const surface = buildYieldSurface(
      [
        row({
          instrument_name: "BTC-07MAY26-82000-C",
          option_type: "call",
          strike: 82000,
          expiration_timestamp: sameDayFutureExpiry,
          bid_price: 0.001
        })
      ],
      { nowMs: NOW, optionType: "call" }
    );

    expect(surface.points).toHaveLength(1);
    expect(surface.points[0].daysToExpiry).toBe(1);
    expect(surface.points[0].annualizedYield).toBeCloseTo(0.365, 12);
  });

  it("excludes expired, zero-bid, null-bid, and non-BTC rows", () => {
    const surface = buildYieldSurface(
      [
        row({ instrument_name: "BTC-31JUL26-73000-P", bid_price: 0.035 }),
        row({ instrument_name: "BTC-01MAY26-73000-P", expiration_timestamp: Date.UTC(2026, 4, 1), bid_price: 0.035 }),
        row({ instrument_name: "BTC-31JUL26-74000-P", strike: 74000, bid_price: 0 }),
        row({ instrument_name: "BTC-31JUL26-75000-P", strike: 75000, bid_price: null }),
        row({ instrument_name: "ETH-31JUL26-3000-P", base_currency: "ETH", strike: 3000, bid_price: 0.1 })
      ],
      { nowMs: NOW, optionType: "put" }
    );

    expect(surface.points.map((point) => point.instrumentName)).toEqual(["BTC-31JUL26-73000-P"]);
  });

  it("returns calls or puts according to the requested option type", () => {
    const rows = [
      row({ instrument_name: "BTC-31JUL26-73000-P", option_type: "put", bid_price: 0.035 }),
      row({ instrument_name: "BTC-31JUL26-90000-C", option_type: "call", strike: 90000, bid_price: 0.045 })
    ];

    const puts = buildYieldSurface(rows, { nowMs: NOW, optionType: "put" });
    const calls = buildYieldSurface(rows, { nowMs: NOW, optionType: "call" });

    expect(puts.points.map((point) => point.instrumentName)).toEqual(["BTC-31JUL26-73000-P"]);
    expect(calls.points.map((point) => point.instrumentName)).toEqual(["BTC-31JUL26-90000-C"]);
  });
});

function row(overrides: Partial<YieldSurfaceSourceRow> = {}): YieldSurfaceSourceRow {
  return {
    instrument_name: "BTC-31JUL26-73000-P",
    base_currency: "BTC",
    option_type: "put",
    strike: 73000,
    expiration_timestamp: EXPIRY_31_JUL_2026,
    bid_price: 0.035,
    bid_amount: 12.5,
    ask_price: 0.036,
    ask_amount: 8.2,
    mark_price: 0.0355,
    last_price: null,
    mark_iv: 41.8,
    open_interest: 29.6,
    underlying_price: 81145.41,
    deribit_timestamp: NOW,
    ingested_at: NOW,
    ...overrides
  };
}
