"use client";

import { useEffect, useMemo, useState } from "react";
import type { DcnCandidate, MarketOption } from "@/types";
import { formatNumber, formatPct, formatUsd } from "@/lib/format";
import { calculateScenario, getScenarioRange } from "@/lib/dcn-scenario";

interface Health {
  activeInstrumentCount?: number;
  quoteCount?: number;
  staleQuoteCount?: number;
  latestQuoteAt?: number;
  streamStatus?: unknown;
  mock?: boolean;
}

export function AdminConsole() {
  const [health, setHealth] = useState<Health | null>(null);
  const [options, setOptions] = useState<MarketOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [instrumentName, setInstrumentName] = useState("BTC-31JUL26-75000-P");
  const [selectedOptionType, setSelectedOptionType] = useState<"call" | "put">("put");
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [selectedStrike, setSelectedStrike] = useState("");
  const [investmentUsdt, setInvestmentUsdt] = useState(500000);
  const [expiryPrice, setExpiryPrice] = useState<number | null>(null);
  const [audit, setAudit] = useState<DcnCandidate | null>(null);
  const [quoteVerification, setQuoteVerification] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void refreshHealth();
    void loadOptions();
  }, []);

  useEffect(() => {
    if (options.length === 0 || selectedExpiry) return;
    const preferred =
      options.find((option) => option.instrument_name === instrumentName) ??
      options.find((option) => option.option_type === "put" && (option.bid_price ?? 0) > 0) ??
      options.find((option) => option.option_type === "put") ??
      options[0];
    if (!preferred) return;
    setSelectedOptionType(preferred.option_type);
    setSelectedExpiry(String(preferred.expiration_timestamp));
    setSelectedStrike(String(preferred.strike));
  }, [instrumentName, options, selectedExpiry]);

  const expiryOptions = useMemo(() => {
    const expiries = new Map<number, MarketOption>();
    for (const option of options) {
      if (option.option_type === selectedOptionType && option.expiration_timestamp) {
        expiries.set(option.expiration_timestamp, option);
      }
    }
    return Array.from(expiries.keys()).sort((a, b) => a - b);
  }, [options, selectedOptionType]);

  useEffect(() => {
    if (expiryOptions.length === 0) return;
    if (!expiryOptions.some((expiry) => String(expiry) === selectedExpiry)) {
      setSelectedExpiry(String(expiryOptions[0]));
    }
  }, [expiryOptions, selectedExpiry]);

  const strikeOptions = useMemo(() => {
    const expiry = Number(selectedExpiry);
    const strikes = new Set<number>();
    for (const option of options) {
      if (option.option_type === selectedOptionType && option.expiration_timestamp === expiry) {
        strikes.add(option.strike);
      }
    }
    return Array.from(strikes).sort((a, b) => a - b);
  }, [options, selectedExpiry, selectedOptionType]);

  useEffect(() => {
    if (strikeOptions.length === 0) return;
    if (!strikeOptions.some((strike) => String(strike) === selectedStrike)) {
      setSelectedStrike(String(strikeOptions[0]));
    }
  }, [selectedStrike, strikeOptions]);

  const selectedOption = useMemo(() => {
    const expiry = Number(selectedExpiry);
    const strike = Number(selectedStrike);
    return (
      options.find(
        (option) =>
          option.option_type === selectedOptionType &&
          option.expiration_timestamp === expiry &&
          option.strike === strike
      ) ?? null
    );
  }, [options, selectedExpiry, selectedOptionType, selectedStrike]);

  useEffect(() => {
    if (selectedOption) setInstrumentName(selectedOption.instrument_name);
  }, [selectedOption]);

  useEffect(() => {
    setAudit(null);
    setQuoteVerification(null);
    setExpiryPrice(null);
  }, [instrumentName, investmentUsdt]);

  useEffect(() => {
    if (!audit) return;
    const range = getScenarioRange(audit);
    setExpiryPrice((current) =>
      current === null || current < range.min || current > range.max ? range.defaultPrice : current
    );
  }, [audit?.instrumentName, audit?.strike]);

  async function refreshHealth() {
    const response = await fetch("/api/admin/market-health", { cache: "no-store" });
    setHealth(await response.json());
  }

  async function loadOptions() {
    setOptionsLoading(true);
    try {
      const response = await fetch("/api/market/options?limit=1000", { cache: "no-store" });
      const payload = (await response.json()) as { options?: MarketOption[] };
      setOptions((payload.options ?? []).filter((option) => option.expiration_timestamp && option.strike));
    } finally {
      setOptionsLoading(false);
    }
  }

  async function runAudit() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/dcn-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instrumentName,
          investmentUsdt,
          targetYieldBps: 1000,
          runwayDays: 92,
          firmMarginBps: 200,
          orderBookDepth: 100,
          scenarioExpiryPrice: expiryPrice ?? undefined
        })
      });
      const payload = await response.json();
      setAudit(payload.calculation ?? null);
    } finally {
      setLoading(false);
    }
  }

  async function verifyQuote() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/verify-quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instrumentName, depth: 100 })
      });
      setQuoteVerification(await response.json());
    } finally {
      setLoading(false);
    }
  }

  const scenarioRange = audit ? getScenarioRange(audit) : null;
  const selectedExpiryPrice = scenarioRange ? expiryPrice ?? scenarioRange.defaultPrice : null;
  const selectedScenario = audit && selectedExpiryPrice !== null ? calculateScenario(audit, selectedExpiryPrice) : null;

  return (
    <main className="admin-page">
      <section className="admin-header">
        <div className="pill">Backend verification</div>
        <h1>DCN pricing audit</h1>
        <p className="small-muted">
          Check that Deribit quotes are fresh, depth is sufficient, and Signafi margin/profit checks pass before a
          client-facing yield is shown.
        </p>
      </section>

      <section className="admin-shell">
        <div className="admin-grid">
          <Metric label="Active instruments" value={health?.activeInstrumentCount ?? "-"} />
          <Metric label="Stored quotes" value={health?.quoteCount ?? "-"} />
          <Metric label="Stale quotes" value={health?.staleQuoteCount ?? "-"} tone={health?.staleQuoteCount ? "warn" : "ok"} />
        </div>

        <div className="audit-grid" style={{ marginTop: 24 }}>
          <div className="admin-card">
            <h2 className="card-title">Run verification</h2>
            <div className="form-grid">
              <label>
                <span className="field-label">Expiry date</span>
                <select
                  className="admin-input"
                  value={selectedExpiry}
                  onChange={(event) => setSelectedExpiry(event.target.value)}
                  disabled={optionsLoading || expiryOptions.length === 0}
                >
                  {expiryOptions.map((expiry) => (
                    <option key={expiry} value={expiry}>
                      {formatExpiry(expiry)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">Call / Put</span>
                <select
                  className="admin-input"
                  value={selectedOptionType}
                  onChange={(event) => setSelectedOptionType(event.target.value as "call" | "put")}
                  disabled={optionsLoading}
                >
                  <option value="put">Put</option>
                  <option value="call">Call</option>
                </select>
              </label>
              <label>
                <span className="field-label">Strike</span>
                <select
                  className="admin-input"
                  value={selectedStrike}
                  onChange={(event) => setSelectedStrike(event.target.value)}
                  disabled={optionsLoading || strikeOptions.length === 0}
                >
                  {strikeOptions.map((strike) => (
                    <option key={strike} value={strike}>
                      {formatUsd(strike)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">Investment USDT</span>
                <input
                  className="admin-input"
                  type="number"
                  value={investmentUsdt}
                  onChange={(event) => setInvestmentUsdt(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="soft-row" style={{ marginTop: 12 }}>
              <span>Selected instrument</span>
              <strong className="mono">{optionsLoading ? "Loading..." : instrumentName || "-"}</strong>
            </div>
            {selectedOptionType === "call" ? (
              <p className="card-copy" style={{ marginTop: 10 }}>
                Quote verification works for calls. DCN sell-put calculation audit is available for put instruments only.
              </p>
            ) : null}
            <div className="quick-btns">
              <button
                className="admin-button"
                onClick={runAudit}
                disabled={loading || selectedOptionType !== "put" || !instrumentName}
              >
                Verify calculations
              </button>
              <button className="btn-ghost" onClick={verifyQuote} disabled={loading || !instrumentName}>
                Verify Deribit quote
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  void refreshHealth();
                  void loadOptions();
                }}
                disabled={loading || optionsLoading}
              >
                Refresh market
              </button>
            </div>

            {audit ? (
              <>
                <div className="metric-grid">
                  <Metric label="Client yield" value={formatPct(audit.clientYield)} tone={audit.eligible ? "ok" : "warn"} />
                  <Metric label="Effective C15 bid" value={formatNumber(audit.effectivePutBidPrice, 5)} />
                  <Metric
                    label="Selected firm P&L"
                    value={formatUsd(selectedScenario?.firmProfitUsdt)}
                    tone={(selectedScenario?.firmProfitUsdt ?? 0) > 0 ? "ok" : "fail"}
                  />
                  <Metric
                    label="Client payout"
                    value={
                      selectedScenario?.clientPayoutAsset === "BTC"
                        ? `${formatNumber(selectedScenario.clientPayoutAmount, 6)} BTC`
                        : formatUsd(selectedScenario?.clientPayoutAmount, 2)
                    }
                  />
                </div>

                {scenarioRange && selectedExpiryPrice !== null && selectedScenario ? (
                  <div className="scenario-panel">
                    <div className="row-between">
                      <div>
                        <div className="field-label">BTC expiry price</div>
                        <strong>{selectedScenario.side === "downside" ? "Downside BTC payout" : "Upside USDT payout"}</strong>
                      </div>
                      <strong className="mono">{formatUsd(selectedExpiryPrice)}</strong>
                    </div>
                    <input
                      type="range"
                      min={scenarioRange.min}
                      max={scenarioRange.max}
                      step={scenarioRange.step}
                      value={selectedExpiryPrice}
                      onChange={(event) => setExpiryPrice(Number(event.target.value))}
                    />
                    <div className="range-labels">
                      <span>{formatUsd(scenarioRange.min)}</span>
                      <span>Strike {formatUsd(audit.strike)}</span>
                      <span>{formatUsd(scenarioRange.max)}</span>
                    </div>
                    <div className="metric-grid">
                      <Metric label="Annualized firm P&L" value={formatPct(selectedScenario.annualizedFirmProfit)} />
                      <Metric label="Option settlement BTC" value={formatNumber(selectedScenario.optionSettlementBtc, 6)} />
                      <Metric label="Net hedge BTC" value={formatNumber(selectedScenario.netHedgeBtc, 6)} />
                      <Metric label="BTC to purchase" value={formatNumber(selectedScenario.btcToPurchase, 6)} />
                    </div>
                  </div>
                ) : null}

                <h3 className="card-title" style={{ marginTop: 24 }}>Workbook formula trace</h3>
                <table className="trace-table">
                  <thead>
                    <tr>
                      <th>Cell</th>
                      <th>Label</th>
                      <th>Formula</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...audit.formulaTrace, ...(selectedScenario?.formulaTrace ?? [])].map((row) => (
                      <tr key={`${row.cell}-${row.label}`}>
                        <td className="mono">{row.cell}</td>
                        <td>{row.label}</td>
                        <td>{row.formula}</td>
                        <td className="mono">{String(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </div>

          <div className="stack">
            <div className="admin-card">
              <h2 className="card-title">Depth and slippage</h2>
              {audit ? (
                <>
                  <div className="soft-row">
                    <span>Required contracts</span>
                    <strong className="mono">{formatNumber(audit.depth.requiredContracts, 1)}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Filled contracts</span>
                    <strong className="mono">{formatNumber(audit.depth.filledContracts, 1)}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Top bid</span>
                    <strong className="mono">{formatNumber(audit.depth.bestBidPrice, 5)}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Avg executable bid</span>
                    <strong className="mono">{formatNumber(audit.depth.effectivePutBidPrice, 5)}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Slippage</span>
                    <strong className="mono">{formatPct(audit.depth.slippagePct, 3)}</strong>
                  </div>
                </>
              ) : (
                <p className="card-copy">Run a calculation audit to view consumed bid levels and slippage.</p>
              )}
            </div>

            <div className="admin-card">
              <h2 className="card-title">Formula template</h2>
              {audit?.formulaTemplate ? (
                <>
                  <div className="soft-row">
                    <span>Template</span>
                    <strong>{audit.formulaTemplate.label}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Version</span>
                    <strong className="mono">{audit.formulaTemplate.version}</strong>
                  </div>
                  <div className="soft-row">
                    <span>Workbook</span>
                    <strong>{audit.formulaTemplate.sourceWorkbook}</strong>
                  </div>
                </>
              ) : (
                <p className="card-copy">Run a calculation audit to view the active formula template.</p>
              )}
            </div>

            <div className="admin-card">
              <h2 className="card-title">Pass/fail checks</h2>
              {audit && selectedScenario ? (
                <>
                  <CheckRow label="Quote fresh" ok={audit.checks.quoteFresh} />
                  <CheckRow label="Sufficient depth" ok={audit.checks.sufficientDepth} />
                  <CheckRow label="Premium covers interest" ok={audit.checks.premiumCoversInterest} />
                  <CheckRow label="Selected firm P&L positive" ok={(selectedScenario.firmProfitUsdt ?? 0) > 0} />
                </>
              ) : (
                <p className="card-copy">Run a calculation audit to view pass/fail checks.</p>
              )}
            </div>

            <div className="admin-card">
              <h2 className="card-title">Quote verification payload</h2>
              <pre className="json-box">{quoteVerification ? JSON.stringify(quoteVerification, null, 2) : "No quote verification run yet."}</pre>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function formatExpiry(timestamp: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "2-digit"
  })
    .format(new Date(timestamp))
    .replace(",", "")
    .toUpperCase();
}

function CheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="soft-row">
      <span>{label}</span>
      <span className={`status-badge ${ok ? "status-live" : "status-fail"}`}>{ok ? "Pass" : "Fail"}</span>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "fail" }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${tone === "ok" ? "green" : tone === "fail" ? "red" : tone === "warn" ? "purple" : ""}`}>
        {value}
      </div>
    </div>
  );
}
